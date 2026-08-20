/**
 * S10-QA-SECPOLICY-GATE-1 (KI-065) — CỔNG: không route nào được khai một cấu hình quyền BẤT KHẢ THI.
 *
 * VÌ SAO CÓ FILE NÀY. `permission.decide.ts` tính
 *   `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)`
 * nên chỉ cần thêm `requiresReauth: true` vào một `@RequirePermission` là route đó bước vào
 * "reveal-secret class": phải có OBJECT-level ALLOW gắn với một `resourceId` cụ thể, **và** một cửa sổ
 * re-auth còn hạn. Hai điều kiện đó có thể **không tồn tại đường nào để thoả mãn**:
 *
 *   (1) route KHÔNG có đúng segment `:id` ⇒ `PermissionGuard` truyền `resourceId = req.params?.id ?? null`
 *       ⇒ object-tier bị bỏ qua HOÀN TOÀN ⇒ `deny-object-required` VĨNH VIỄN. Lưu ý: một param TÊN KHÁC
 *       (`:fileId`, `:userId`…) KHÔNG cứu được — guard chỉ đọc `id`;
 *   (2) KHÔNG chỗ nào trong `apps/api/src` GHI `req.reauthContext` ⇒ `isReauthValid()` luôn false
 *       ⇒ kể cả khi có object grant vẫn `deny-reauth-required` VĨNH VIỄN.
 *
 * Cả hai hỏng **đúng chiều an toàn** (403, fail-closed) — nên KHÔNG có exception, KHÔNG có log lỗi,
 * KHÔNG có cảnh báo nào. Đó là lý do `PATCH /settings/security-policy` chết **im lặng** từ 2026-07 tới
 * 14/08/2026, và chỉ lộ ra khi có người viết test HTTP thật (KI-065). Cổng này biến đúng cái bẫy đó
 * thành ĐỎ ở CI, ngay khi ai đó gõ lại cờ.
 *
 * CỔNG TỰ NHẢ, KHÔNG PHẢI DANH SÁCH TÊN ROUTE: điều kiện (2) đo bằng **sự tồn tại của một nơi GHI**
 * `reauthContext` trong `src/**`. Ngày ai đó xây step-up thật (WO `S10-AUTH-STEPUP-1`), cổng tự cho
 * phép route khai `requiresReauth` mà không phải sửa file này.
 *
 * ─── CẬP NHẬT 20/08/2026 (S10-AUTH-STEPUP-1) — STEP-UP THẬT ĐÃ TỒN TẠI ───────────────────────────
 * `ReauthGuard` (`src/permission/guards/reauth.guard.ts`) giờ GHI `req.reauthContext` ⇒ điều kiện (2)
 * ở trên đã thoả TOÀN CỤC. Nhưng "toàn cục thoả" **không** có nghĩa một route CỤ THỂ gọi được — đó là
 * đúng cái nhầm lẫn đã đẻ ra KI-065 lần đầu. Vì vậy cổng lên **BỐN** lý do (xem `UnreachableRoute`):
 *
 *   (3) `no-reauth-guard`   — route không khai `@UseGuards(ReauthGuard, PermissionGuard)` **ĐÚNG THỨ
 *       TỰ**. Đo VỊ TRÍ trong chuỗi ghép `[classGuards, routeGuards]`, KHÔNG đo sự tồn tại: cả hai guard
 *       cùng có mặt nhưng `PermissionGuard` chạy trước thì nó ĐỌC `req.reauthContext` khi chưa ai GHI ⇒
 *       `deny-reauth-required` vĩnh viễn, im lặng y hệt KI-065.
 *   (4) `pair-not-mintable` — cặp `(action, resourceType)` của route không nằm trong `REVEAL_CLASS_PAIRS`
 *       (registry mà chính `POST /auth/step-up` đọc). Hôm nay registry **RỖNG có chủ đích** (D3) ⇒ lý do
 *       này bắt MỌI route dám khai cờ. Đó là hành vi ĐÚNG: chưa cặp nào được duyệt thì endpoint luôn trả
 *       400 `AUTH-ERR-STEP-UP-PAIR-NOT-ALLOWED`, tức KHÔNG tồn tại đường cấp cửa sổ cho route đó.
 *
 * Hai lý do mới đọc dữ liệu ĐÃ CÓ SẴN trong census runtime (`classGuards`/`routeGuards`/`permission`) —
 * vẫn 0 regex trên mã nguồn (bất biến của `route-census.ts`).
 *
 * KHÔNG cần Postgres — chỉ boot + đọc metadata + đọc filesystem. Vì vậy KHÔNG `skipIf(!hasDb)`:
 * test này PHẢI chạy trong suite mặc định `pnpm test` để CI thực sự gác.
 */

import "reflect-metadata";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import {
  REVEAL_CLASS_PAIRS,
  isRevealClassPair,
  type RevealClassPair,
} from "../../src/auth/step-up/reveal-class-pairs";
import { PermissionGuard } from "../../src/permission/guards/permission.guard";
import { ReauthGuard } from "../../src/permission/guards/reauth.guard";
import { collectRoutes, routeKey, type RouteInfo } from "./route-census";

const SRC_ROOT = join(__dirname, "..", "..", "src");

/**
 * Bóc comment TRƯỚC khi tìm nơi GHI `reauthContext`.
 *
 * Bài học `gitleaks-prose-colon-false-positive` + vòng review của S10-FND-VALKEYSCOPE-1: docblock của
 * `permission.guard.ts` NHẮC TÊN `req.reauthContext` bằng văn xuôi. Khớp thô trên mã nguồn sẽ đọc câu
 * mô tả đó thành "đã có step-up" ⇒ cổng xanh RỖNG đúng lúc nó cần đỏ nhất.
 *
 * Giới hạn có chủ đích: `//` nằm trong chuỗi (`"https://…"`) được giữ lại nhờ chốt `[^:]`; trường hợp
 * còn sót chỉ có thể làm hàm này BỎ SÓT một writer ⇒ cổng ĐỎ (fail-closed), không phải xanh oan.
 */
export function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Có nơi nào GHI `reauthContext` không (= có cơ chế step-up thật)?
 *
 * Chữ ký của một WRITER là phép GÁN: `x.reauthContext =` hoặc `x["reauthContext"] =`. Chỉ ĐỌC
 * (`req.reauthContext?.reauthValidUntil`) hay khai kiểu (`reauthContext?: {...}`) KHÔNG tính —
 * đó chính là toàn bộ hiện trạng 19/08/2026 và là lý do route chết.
 */
export function hasReauthWriter(sources: readonly string[]): boolean {
  // Neo vào ĐỐI TƯỢNG REQUEST, không phải "bất kỳ thứ gì có thuộc tính cùng tên": một `dto.reauthContext =
  // x` trên một model không liên quan KHÔNG phải step-up. Và loại giá trị RỖNG (`null`/`undefined`) — gán
  // một chỗ trống rồi tuyên bố "đã có xác thực lại" là đúng kiểu cửa sau giả mà ADR DECISIONS-09 §2 cấm.
  // BÓC vế phải rồi kiểm, KHÔNG dùng lookahead phủ định đứng sau `\s*`: `\s*` backtrack được về 0 ký tự
  // nên `(?!null)` sau nó bị vô hiệu — `req.reauthContext = null` vẫn khớp. Ca thử-ngược bên dưới đã bắt
  // đúng lỗ này (19/08/2026) khi nó còn là lookahead; giữ ca đó làm chốt.
  const ASSIGN =
    /\b(?:req|request)\b\s*(?:\.reauthContext|\[\s*["']reauthContext["']\s*\])\s*=(?!=)([^;\n]*)/g;
  // `Object.assign(req, { reauthContext: … })` — dạng ghi hợp lệ mà phép gán ở trên không thấy.
  const OBJECT_ASSIGN = /Object\.assign\s*\(\s*(?:req|request)\b[^)]*\breauthContext\s*:/;
  return sources.some((src) => {
    const code = stripComments(src);
    if (OBJECT_ASSIGN.test(code)) return true;
    for (const m of code.matchAll(ASSIGN)) {
      const rhs = (m[1] ?? "").trim();
      // Vế phải RỖNG (gán xuống dòng) ⇒ KHÔNG kết luận là writer — bỏ sót là chiều fail-closed.
      if (rhs.length > 0 && !/^(?:null|undefined)\b/.test(rhs)) return true;
    }
    return false;
  });
}

/**
 * Vì sao một route khai `requiresReauth` là không thể gọi thành công.
 *
 * BỐN lý do, mỗi cái đóng một cách route chết **im lặng** — xem `findUnreachableReauthRoutes`.
 * Hai lý do đầu có từ 19/08/2026 (KI-065); hai lý do sau thêm khi step-up thật ra đời
 * (S10-AUTH-STEPUP-1) — vì **có writer `reauthContext`** KHÔNG đủ để một route CỤ THỂ gọi được.
 */
export interface UnreachableRoute {
  key: string;
  path: string;
  reason: "no-id-param" | "no-reauth-guard" | "pair-not-mintable" | "no-step-up-writer";
}

/**
 * Câu giải thích cho từng lý do — in ra khi cổng ĐỎ. Bản đồ ĐẦY ĐỦ theo union (`Record<...>`), nên thêm
 * một lý do mà quên viết câu giải thích ⇒ typecheck ĐỎ, không phải một dòng lỗi trống rỗng lúc 2h sáng.
 */
const REASON_HINTS: Record<UnreachableRoute["reason"], string> = {
  "no-id-param":
    "route KHÔNG có segment `:id` ⇒ resourceId luôn null ⇒ deny-object-required VĨNH VIỄN",
  "no-reauth-guard":
    "chuỗi guard KHÔNG có `ReauthGuard` đứng TRƯỚC `PermissionGuard` ⇒ không ai ghi " +
    "`req.reauthContext` cho route này ⇒ deny-reauth-required VĨNH VIỄN",
  "pair-not-mintable":
    "cặp `action:resourceType` KHÔNG nằm trong `REVEAL_CLASS_PAIRS` ⇒ `POST /auth/step-up` trả 400 " +
    "`AUTH-ERR-STEP-UP-PAIR-NOT-ALLOWED` ⇒ KHÔNG có đường cấp cửa sổ cho route này",
  "no-step-up-writer":
    "KHÔNG có nơi nào trong src/** GHI `reauthContext` ⇒ deny-reauth-required VĨNH VIỄN",
};

/**
 * `ReauthGuard` có chạy TRƯỚC `PermissionGuard` cho route này không?
 *
 * ĐO THỨ TỰ, KHÔNG ĐO SỰ TỒN TẠI. `ReauthGuard` là thứ GHI `req.reauthContext`; `PermissionGuard` là
 * thứ ĐỌC nó (permission.guard.ts:124). Chạy sai thứ tự ⇒ engine đọc `undefined` ⇒
 * `deny-reauth-required` VĨNH VIỄN, không exception, không log — đúng hình dạng KI-065 nhưng với một
 * nguyên nhân MỚI mà phiên bản cổng cũ không thấy (nó chỉ hỏi "src/** có writer nào không").
 *
 * CHUỖI GHÉP `[classGuards, routeGuards]` là ĐÚNG thứ tự Nest chạy: guard cấp CLASS luôn đi trước guard
 * cấp ROUTE, và trong cùng một cấp thì theo thứ tự khai. `route-census.ts` giữ nguyên thứ tự khai ở cả
 * hai mảng (:151 và :186-187) nên phép đo này khớp runtime, không phải xấp xỉ.
 *
 * GHIM BẰNG `Class.name`, KHÔNG LITERAL CHUỖI: đổi tên guard bằng refactor của IDE sẽ đổi luôn
 * `ReauthGuard.name`, nhưng KHÔNG đổi một chuỗi `"ReauthGuard"` nằm trong test ⇒ cổng hoá xanh-rỗng
 * (không route nào khớp tên cũ nữa) đúng lúc nó cần đỏ nhất.
 *
 * FAIL-CLOSED khi thiếu `PermissionGuard`: một route reveal-class không có `PermissionGuard` thì chẳng ai
 * ĐỌC cửa sổ cả — cờ `requiresReauth` khi đó là trang trí. Trả `false` (= bị bắt) thay vì bỏ qua.
 */
export function hasReauthGuardBeforePermissionGuard(route: RouteInfo): boolean {
  const chain = [...route.classGuards, ...route.routeGuards];
  const reauthIdx = chain.indexOf(ReauthGuard.name);
  const permissionIdx = chain.indexOf(PermissionGuard.name);
  if (reauthIdx === -1 || permissionIdx === -1) return false;
  return reauthIdx < permissionIdx;
}

/**
 * PHÉP ĐO THUẦN (không I/O) để chính nó test được — xem các ca "PHÉP THỬ NGƯỢC" ở dưới.
 *
 * `stepUpExists` = kết quả của `hasReauthWriter` trên `src/**`.
 * `pairs` = REGISTRY CẶP MINTABLE — mặc định là CHÍNH `REVEAL_CLASS_PAIRS` mà `POST /auth/step-up` đọc
 * (một nguồn, hai đầu đọc). Tham số chỉ tồn tại để các ca thử-ngược dựng registry giả — KHÔNG phải để
 * ai đó truyền một danh sách rộng hơn vào cổng chính.
 *
 * THỨ TỰ ĐẨY LÝ DO (ổn định, có test ghim): hình dạng route (`no-id-param`) → chuỗi guard
 * (`no-reauth-guard`) → registry (`pair-not-mintable`) → năng lực toàn cục (`no-step-up-writer`).
 */
export function findUnreachableReauthRoutes(
  routes: readonly RouteInfo[],
  stepUpExists: boolean,
  pairs: readonly RevealClassPair[] = REVEAL_CLASS_PAIRS,
): UnreachableRoute[] {
  const out: UnreachableRoute[] = [];
  for (const r of routes.filter((x) => x.requiresReauth === true)) {
    const hit = (reason: UnreachableRoute["reason"]): void => {
      out.push({ key: routeKey(r), path: r.path, reason });
    };

    // PHẢI là đúng segment `:id`, KHÔNG phải "có param nào đó": `permission.guard.ts` đọc
    // `req.params?.id ?? null`, nên route kiểu `/employees/:employeeId/files/:fileId/secret` (hình dạng
    // CÓ THẬT trong repo: employee-file · chat-rooms · company-branding · dashboard-widget-data) vẫn cho
    // `resourceId = null` ⇒ chết y hệt KI-065. Nới chỗ này thành `startsWith(":")` là tự tháo cổng.
    if (!r.path.split("/").includes(":id")) hit("no-id-param");

    // Chuỗi guard sai thứ tự (hoặc thiếu hẳn `ReauthGuard`) ⇒ không ai ghi `req.reauthContext` cho
    // route NÀY, dù src/** có writer.
    if (!hasReauthGuardBeforePermissionGuard(r)) hit("no-reauth-guard");

    // Cặp `action:resourceType` phải MINT được. `permission` của census là chuỗi đã ghép; cắt ở dấu `:`
    // ĐẦU TIÊN rồi để phần còn lại cho `resourceType` (dấu `:` thứ hai sẽ không khớp cặp nào ⇒
    // fail-closed). HÔM NAY registry RỖNG (D3) nên lý do này bắt MỌI route dám khai cờ — đó là hành vi
    // ĐÚNG: chưa cặp nào được duyệt thì `POST /auth/step-up` luôn 400, tức không có đường cấp cửa sổ.
    const rawPair = r.permission ?? "";
    const sep = rawPair.indexOf(":");
    const action = sep === -1 ? rawPair : rawPair.slice(0, sep);
    const resourceType = sep === -1 ? "" : rawPair.slice(sep + 1);
    if (!isRevealClassPair(pairs, action, resourceType)) hit("pair-not-mintable");

    if (!stepUpExists) hit("no-step-up-writer");
  }
  return out;
}

/**
 * Đọc đệ quy mọi file `.ts` sản phẩm dưới `src/**` (bỏ spec — spec tự dựng `reauthContext` giả),
 * GIỮ LẠI đường dẫn: ca "writer là DUY NHẤT" cần biết writer nằm ở FILE NÀO, không chỉ "có hay không".
 */
function readSrcFiles(dir: string, acc: { path: string; code: string }[] = []): typeof acc {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      readSrcFiles(full, acc);
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (/\.(spec|int\.spec|e2e-spec|int-spec)\.ts$/.test(entry)) continue;
    acc.push({ path: full, code: readFileSync(full, "utf8") });
  }
  return acc;
}

/** Chỉ phần nội dung — dùng cho phép đo boolean `hasReauthWriter` trên toàn `src/**`. */
function readSrcSources(dir: string): string[] {
  return readSrcFiles(dir).map((f) => f.code);
}

describe("S10-QA-SECPOLICY-GATE-1 — cấu hình `requiresReauth` phải GỌI ĐƯỢC (KI-065)", () => {
  let app: INestApplication;
  let routes: RouteInfo[];
  let stepUpExists: boolean;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    routes = collectRoutes(app);
    stepUpExists = hasReauthWriter(readSrcSources(SRC_ROOT));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it("census không rỗng (nếu app không boot được thì mọi assert dưới đây là xanh RỖNG)", () => {
    expect(routes.length).toBeGreaterThan(100);
    // Canary thứ hai: quét nhầm thư mục cũng cho `hasReauthWriter === false` — TRÙNG với kỳ vọng hiện
    // tại ⇒ cổng xanh vì tình cờ, không vì đúng. Đo luôn số file đọc được.
    expect(readSrcSources(SRC_ROOT).length).toBeGreaterThan(100);
  });

  it("trường `isSensitive`/`requiresReauth` của census đọc ĐÚNG từ route THẬT (không chỉ từ object giả)", () => {
    // Hai ca thử-ngược bên dưới dựng RouteInfo bằng tay ⇒ chúng KHÔNG chứng minh `collectRoutes()` trích
    // đúng hai trường mới. Neo vào chính route của KI-065.
    const patch = routes.find((r) => routeKey(r) === "SecurityPolicyController#updatePolicy");
    const get = routes.find((r) => routeKey(r) === "SecurityPolicyController#getPolicy");
    expect(
      patch,
      "không tìm thấy route PATCH /settings/security-policy trong census",
    ).toBeDefined();
    expect(get).toBeDefined();
    expect(patch?.isSensitive).toBe(true);
    expect(patch?.requiresReauth ?? false).toBe(false);
    expect(get?.isSensitive).toBe(true);
  });

  it("KHÔNG route nào khai `requiresReauth` mà không có đường thoả mãn (0 route chết)", () => {
    const bad = findUnreachableReauthRoutes(routes, stepUpExists);
    expect(
      bad,
      [
        "",
        "Route dưới đây khai `requiresReauth: true` nhưng KHÔNG THỂ được ALLOW bởi bất kỳ actor nào:",
        ...bad.map((b) => `  • ${b.key} — ${b.path} — ${REASON_HINTS[b.reason]}`),
        "",
        "Đây ĐÚNG là KI-065 (route cấu hình bảo mật chết 403 im lặng 1 tháng). Cách xử lý:",
        "  (a) chưa duyệt cặp mintable → BỎ `requiresReauth`, giữ `isSensitive` (ADR DECISIONS-09);",
        "  (b) cần ép xác thực lại     → route phải có `:id`, khai `@UseGuards(ReauthGuard,",
        "      PermissionGuard)` ĐÚNG THỨ TỰ, và cặp phải nằm trong `REVEAL_CLASS_PAIRS`",
        "      (thêm cặp = quyết định bảo mật, §6 điểm 5 — không phải thao tác cho xanh).",
        "TUYỆT ĐỐI KHÔNG nới `needsObjectGrant` trong `permission.decide.ts` để 'chữa' — làm vậy là",
        "gỡ cổng object-grant của MỌI route nhạy cảm khác (reviewer-proposed-fix-can-open-holes).",
        "",
      ].join("\n"),
    ).toEqual([]);
  });

  // ─── Chứng minh cổng KHÔNG rỗng (nếu không có ca này, 0 route requiresReauth = luôn xanh) ─────────
  it("PHÉP THỬ NGƯỢC: route giả khai `requiresReauth` bị BẮT ở cả BỐN chiều", () => {
    // Registry GIẢ chỉ dùng cho các ca dưới đây — cổng chính (`it` ở trên) vẫn đọc `REVEAL_CLASS_PAIRS`
    // THẬT. Không có nó thì mọi ca ở đây kéo theo `pair-not-mintable` và ta không đo tách được từng lý do.
    const okPairs: readonly RevealClassPair[] = [{ action: "configure", resourceType: "company" }];
    const fake = {
      controller: "FakeController",
      method: "update",
      httpMethod: "PATCH",
      path: "/api/v1/settings/fake-singleton",
      controllerPath: "/settings/fake-singleton",
      hasPermission: true,
      permission: "configure:company",
      permissionLevel: "handler",
      isSensitive: true,
      requiresReauth: true,
      isPublic: false,
      classGuards: [],
      routeGuards: [],
    } satisfies RouteInfo;
    /** Chuỗi guard ĐÚNG: cùng cấp route, `ReauthGuard` trước. Dùng `.name` — xem docblock của phép đo. */
    const goodGuards = { routeGuards: [ReauthGuard.name, PermissionGuard.name] } as const;

    // Không `:id`, không guard, cặp ngoài registry (registry giả rỗng) VÀ không step-up ⇒ BỐN vi phạm,
    // đúng thứ tự đã ghim.
    expect(findUnreachableReauthRoutes([fake], false, []).map((b) => b.reason)).toEqual([
      "no-id-param",
      "no-reauth-guard",
      "pair-not-mintable",
      "no-step-up-writer",
    ]);
    // Có step-up + guard đúng + cặp mintable nhưng vẫn thiếu `:id` ⇒ còn đúng một vi phạm.
    expect(
      findUnreachableReauthRoutes([{ ...fake, ...goodGuards }], true, okPairs).map((b) => b.reason),
    ).toEqual(["no-id-param"]);
    // Có param NHƯNG KHÔNG PHẢI `:id` ⇒ vẫn phải bị BẮT (guard chỉ đọc `req.params?.id`).
    const withOtherParam: RouteInfo = {
      ...fake,
      ...goodGuards,
      path: "/api/v1/employees/:employeeId/files/:fileId",
    };
    expect(
      findUnreachableReauthRoutes([withOtherParam], true, okPairs).map((b) => b.reason),
    ).toEqual(["no-id-param"]);
    // Đủ CẢ BỐN điều kiện ⇒ hợp lệ, cổng nhả.
    const withId: RouteInfo = {
      ...fake,
      ...goodGuards,
      path: "/api/v1/platform-accounts/:id/secret",
    };
    expect(findUnreachableReauthRoutes([withId], true, okPairs)).toEqual([]);
  });

  it("PHÉP THỬ NGƯỢC `no-reauth-guard`: cổng đo THỨ TỰ, không đo sự tồn tại", () => {
    const okPairs: readonly RevealClassPair[] = [{ action: "configure", resourceType: "company" }];
    const base = {
      controller: "FakeController",
      method: "reveal",
      httpMethod: "GET",
      path: "/api/v1/fake/:id/secret",
      controllerPath: "/fake",
      hasPermission: true,
      permission: "configure:company",
      permissionLevel: "handler",
      isSensitive: true,
      requiresReauth: true,
      isPublic: false,
      classGuards: [],
      routeGuards: [],
    } satisfies RouteInfo;
    const reasons = (r: RouteInfo): string[] =>
      findUnreachableReauthRoutes([r], true, okPairs).map((b) => b.reason);

    // (a) ĐÚNG THỨ TỰ, cùng cấp route ⇒ nhả.
    expect(reasons({ ...base, routeGuards: [ReauthGuard.name, PermissionGuard.name] })).toEqual([]);
    // (a') SAI THỨ TỰ, cùng cấp route ⇒ ĐỎ. Cả HAI guard đều CÓ MẶT — phép đo "tồn tại" sẽ xanh oan ở
    // đúng ca này, và đây chính là cách `PermissionGuard` đọc `req.reauthContext` trước khi nó được ghi.
    expect(reasons({ ...base, routeGuards: [PermissionGuard.name, ReauthGuard.name] })).toEqual([
      "no-reauth-guard",
    ]);
    // (b) `PermissionGuard` cấp CLASS + `ReauthGuard` cấp ROUTE ⇒ ĐỎ: Nest chạy guard cấp class TRƯỚC,
    // nên thứ tự KHAI trong file trông "đúng" mà thực thi thì ngược.
    expect(
      reasons({
        ...base,
        classGuards: [PermissionGuard.name],
        routeGuards: [ReauthGuard.name],
      }),
    ).toEqual(["no-reauth-guard"]);
    // (b') Ngược lại — `ReauthGuard` cấp CLASS, `PermissionGuard` cấp ROUTE ⇒ hợp lệ.
    expect(
      reasons({
        ...base,
        classGuards: [ReauthGuard.name],
        routeGuards: [PermissionGuard.name],
      }),
    ).toEqual([]);
    // Thiếu hẳn `ReauthGuard` ⇒ ĐỎ; thiếu hẳn `PermissionGuard` cũng ĐỎ (fail-closed: cờ trang trí).
    expect(reasons({ ...base, routeGuards: [PermissionGuard.name] })).toEqual(["no-reauth-guard"]);
    expect(reasons({ ...base, routeGuards: [ReauthGuard.name] })).toEqual(["no-reauth-guard"]);
  });

  it("PHÉP THỬ NGƯỢC `pair-not-mintable`: registry RỖNG ⇒ MỌI route dám khai cờ đều bị BẮT", () => {
    const wellFormed = {
      controller: "FakeController",
      method: "reveal",
      httpMethod: "GET",
      path: "/api/v1/fake/:id/secret",
      controllerPath: "/fake",
      hasPermission: true,
      permission: "reveal-secret:platform_account",
      permissionLevel: "handler",
      isSensitive: true,
      requiresReauth: true,
      isPublic: false,
      classGuards: [],
      routeGuards: [ReauthGuard.name, PermissionGuard.name],
    } satisfies RouteInfo;

    // Route HOÀN HẢO về mọi mặt còn lại (có `:id`, guard đúng thứ tự, có step-up writer) — vẫn ĐỎ, vì
    // registry THẬT rỗng (D3). Đây là cổng chống tái diễn KI-065: gắn cờ trước khi duyệt cặp = route chết.
    expect(findUnreachableReauthRoutes([wellFormed], true).map((b) => b.reason)).toEqual([
      "pair-not-mintable",
    ]);
    // Cặp CÓ trong registry ⇒ nhả. So khớp CHÍNH XÁC cả hai vế (dùng lại `isRevealClassPair` của src).
    const minted: readonly RevealClassPair[] = [
      { action: "reveal-secret", resourceType: "platform_account" },
    ];
    expect(findUnreachableReauthRoutes([wellFormed], true, minted)).toEqual([]);
    // Cặp GẦN GIỐNG (lệch một vế) KHÔNG được nhả — không tiền tố, không ký tự đại diện.
    expect(
      findUnreachableReauthRoutes([wellFormed], true, [
        { action: "reveal-secret", resourceType: "platform_accounts" },
      ]).map((b) => b.reason),
    ).toEqual(["pair-not-mintable"]);
    // Route khai cờ mà KHÔNG có `@RequirePermission` (permission = null) ⇒ không cặp nào khớp ⇒ ĐỎ.
    expect(
      findUnreachableReauthRoutes(
        [{ ...wellFormed, permission: null, hasPermission: false }],
        true,
        minted,
      ).map((b) => b.reason),
    ).toEqual(["pair-not-mintable"]);
  });

  it("`REVEAL_CLASS_PAIRS` THẬT vẫn RỖNG — cổng `pair-not-mintable` không xanh vì ai đó bồi cặp", () => {
    // Không có ca này, một PR thêm cặp vào registry sẽ lặng lẽ tháo cổng ở trên mà không ai thấy.
    // Thêm cặp = quyết định bảo mật (ba điều kiện §6 điểm 5) ⇒ phải sửa CHÍNH dòng này, có chủ ý.
    expect(REVEAL_CLASS_PAIRS).toEqual([]);
  });

  it("PHÉP THỬ NGƯỢC: `hasReauthWriter` phân biệt GHI thật với văn xuôi trong comment", () => {
    expect(hasReauthWriter(["req.reauthContext = { reauthValidUntil: until };"])).toBe(true);
    expect(hasReauthWriter(['request["reauthContext"] = ctx;'])).toBe(true);
    // Chỉ ĐỌC + docblock nhắc tên (đúng hiện trạng permission.guard.ts) ⇒ KHÔNG tính là writer.
    expect(
      hasReauthWriter([
        "/** req.reauthContext is populated upstream (ReauthGuard) — x.reauthContext = y */",
        "const v = req.reauthContext?.reauthValidUntil ?? null;",
        "// TODO: req.reauthContext = window;",
        "interface R { reauthContext?: { reauthValidUntil?: Date | null } }",
      ]),
    ).toBe(false);
    // So sánh `===` KHÔNG phải phép gán.
    expect(hasReauthWriter(["if (req.reauthContext === undefined) return;"])).toBe(false);
    // Gán RỖNG không phải step-up (nếu tính, một dòng phòng thủ vô hại sẽ tự tháo cổng).
    expect(hasReauthWriter(["req.reauthContext = null;"])).toBe(false);
    expect(hasReauthWriter(["request.reauthContext = undefined;"])).toBe(false);
    // Thuộc tính CÙNG TÊN trên một đối tượng không liên quan cũng không phải step-up.
    expect(hasReauthWriter(["userProfileDto.reauthContext = payload.ctx;"])).toBe(false);
    // Dạng ghi bất biến hợp lệ vẫn phải được nhận.
    expect(hasReauthWriter(["Object.assign(req, { reauthContext: { reauthValidUntil } });"])).toBe(
      true,
    );
  });

  it("hiện trạng 20/08/2026 được ĐO, không phải giả định: step-up ĐÃ TỒN TẠI trong src/**", () => {
    // ĐÃ LẬT (S10-AUTH-STEPUP-1, 20/08/2026). Bản trước assert `false` với ghi chú "cố ý sẽ đỏ vào ngày
    // step-up thật ra đời". Ngày đó là hôm nay: `apps/api/src/permission/guards/reauth.guard.ts` GHI
    // `req.reauthContext` — writer DUY NHẤT trong toàn bộ `src/**` (DECISIONS-09 §6 điểm 11.2).
    //
    // CA NÀY GIỜ ĐO CHIỀU NGƯỢC LẠI: ai đó GỠ/đổi hình dạng writer (refactor, revert, "dọn code") sẽ làm
    // ca này ĐỎ NGAY, thay vì để mọi route reveal-class im lặng quay về `deny-reauth-required` vĩnh viễn.
    //
    // GIỚI HẠN ĐÃ BIẾT (giữ nguyên từ bản trước): `hasReauthWriter` là phép quét văn bản; một writer viết
    // theo hình dạng ngoài hai mẫu đã nhận (vd `req["reauth"+"Context"] =`) sẽ KHÔNG được thấy ⇒ ca này
    // ĐỎ dù step-up còn sống. Chiều đó KHÔNG mở cổng — nó chỉ ồn, và ồn là đúng chiều an toàn.
    expect(
      stepUpExists,
      "KHÔNG còn writer `reauthContext` nào trong src/** — ReauthGuard đã bị gỡ/đổi hình dạng? " +
        "Mọi route reveal-class sẽ 403 im lặng (KI-065). Xem DECISIONS-09 §6 điểm 11.2.",
    ).toBe(true);
  });

  it("writer là DUY NHẤT và nằm ĐÚNG ở `permission/guards/reauth.guard.ts` (§6 điểm 11.2)", () => {
    // `hasReauthWriter` chỉ trả boolean "có/không" ⇒ nó KHÔNG bắt được ngày ai đó thêm writer THỨ HAI ở
    // một service ngẫu nhiên. Hai writer = hai nguồn sự thật cho cùng một câu hỏi bảo mật; cái thứ hai
    // thường là bản "tiện hơn" (tự tính `Date.now() + ttl`) và nó gỡ sạch bước xác thực lại.
    const files = readSrcFiles(SRC_ROOT);
    const writers = files
      .filter((f) => hasReauthWriter([f.code]))
      .map((f) => f.path.replace(/\\/g, "/"));
    expect(writers, `writer tìm thấy: ${writers.join(", ") || "(không có)"}`).toHaveLength(1);
    expect(writers[0]).toContain("src/permission/guards/reauth.guard.ts");
  });
});
