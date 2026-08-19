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
  const ASSIGN = /\b(?:req|request)\b\s*(?:\.reauthContext|\[\s*["']reauthContext["']\s*\])\s*=(?!=)([^;\n]*)/g;
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

/** Vì sao một route khai `requiresReauth` là không thể gọi thành công. */
export interface UnreachableRoute {
  key: string;
  path: string;
  reason: "no-id-param" | "no-step-up-writer";
}

/**
 * PHÉP ĐO THUẦN (không I/O) để chính nó test được — xem ca "chứng minh cổng KHÔNG rỗng" ở dưới.
 * `stepUpExists` = kết quả của `hasReauthWriter` trên `src/**`.
 */
export function findUnreachableReauthRoutes(
  routes: readonly RouteInfo[],
  stepUpExists: boolean,
): UnreachableRoute[] {
  const out: UnreachableRoute[] = [];
  for (const r of routes.filter((x) => x.requiresReauth === true)) {
    // PHẢI là đúng segment `:id`, KHÔNG phải "có param nào đó": `permission.guard.ts` đọc
    // `req.params?.id ?? null`, nên route kiểu `/employees/:employeeId/files/:fileId/secret` (hình dạng
    // CÓ THẬT trong repo: employee-file · chat-rooms · company-branding · dashboard-widget-data) vẫn cho
    // `resourceId = null` ⇒ chết y hệt KI-065. Nới chỗ này thành `startsWith(":")` là tự tháo cổng.
    if (!r.path.split("/").includes(":id")) {
      out.push({ key: routeKey(r), path: r.path, reason: "no-id-param" });
    }
    if (!stepUpExists) {
      out.push({ key: routeKey(r), path: r.path, reason: "no-step-up-writer" });
    }
  }
  return out;
}

/** Đọc đệ quy mọi file `.ts` sản phẩm dưới `src/**` (bỏ spec — spec tự dựng `reauthContext` giả). */
function readSrcSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      readSrcSources(full, acc);
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (/\.(spec|int\.spec|e2e-spec|int-spec)\.ts$/.test(entry)) continue;
    acc.push(readFileSync(full, "utf8"));
  }
  return acc;
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
    expect(patch, "không tìm thấy route PATCH /settings/security-policy trong census").toBeDefined();
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
        ...bad.map(
          (b) =>
            `  • ${b.key} — ${b.path} — ${
              b.reason === "no-id-param"
                ? "route KHÔNG có `:param` ⇒ resourceId luôn null ⇒ deny-object-required VĨNH VIỄN"
                : "KHÔNG có nơi nào trong src/** GHI `reauthContext` ⇒ deny-reauth-required VĨNH VIỄN"
            }`,
        ),
        "",
        "Đây ĐÚNG là KI-065 (route cấu hình bảo mật chết 403 im lặng 1 tháng). Cách xử lý:",
        "  (a) chưa có step-up thật  → BỎ `requiresReauth`, giữ `isSensitive` (ADR DECISIONS-09);",
        "  (b) cần ép xác thực lại   → xây step-up THẬT (guard/endpoint GHI `req.reauthContext`)",
        "      + route phải có `:param` để object-tier chạy, rồi mới gắn cờ.",
        "TUYỆT ĐỐI KHÔNG nới `needsObjectGrant` trong `permission.decide.ts` để 'chữa' — làm vậy là",
        "gỡ cổng object-grant của MỌI route nhạy cảm khác (reviewer-proposed-fix-can-open-holes).",
        "",
      ].join("\n"),
    ).toEqual([]);
  });

  // ─── Chứng minh cổng KHÔNG rỗng (nếu không có ca này, 0 route requiresReauth = luôn xanh) ─────────
  it("PHÉP THỬ NGƯỢC: route giả khai `requiresReauth` bị BẮT ở cả hai chiều", () => {
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

    // Không `:param` VÀ không step-up ⇒ hai vi phạm.
    expect(findUnreachableReauthRoutes([fake], false).map((b) => b.reason)).toEqual([
      "no-id-param",
      "no-step-up-writer",
    ]);
    // Có step-up nhưng vẫn thiếu `:param` ⇒ còn đúng một vi phạm.
    expect(findUnreachableReauthRoutes([fake], true).map((b) => b.reason)).toEqual(["no-id-param"]);
    // Có param NHƯNG KHÔNG PHẢI `:id` ⇒ vẫn phải bị BẮT (guard chỉ đọc `req.params?.id`).
    const withOtherParam: RouteInfo = { ...fake, path: "/api/v1/employees/:employeeId/files/:fileId" };
    expect(findUnreachableReauthRoutes([withOtherParam], true).map((b) => b.reason)).toEqual([
      "no-id-param",
    ]);
    // Có `:id` + có step-up ⇒ hợp lệ, cổng nhả.
    const withId: RouteInfo = { ...fake, path: "/api/v1/platform-accounts/:id/secret" };
    expect(findUnreachableReauthRoutes([withId], true)).toEqual([]);
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

  it("hiện trạng 19/08/2026 được ĐO, không phải giả định: chưa có step-up nào trong src/**", () => {
    // Ca này CỐ Ý sẽ đỏ vào ngày step-up thật ra đời — lúc đó chỉ cần lật assert sang `true` và
    // cập nhật docblock, vì cổng chính ở trên đã tự nới theo.
    // GIỚI HẠN ĐÃ BIẾT (FULL gate 19/08): `hasReauthWriter` là phép quét văn bản. Một writer viết theo
    // hình dạng ngoài hai mẫu đã nhận (vd tên khoá dựng động `req["reauth"+"Context"] =`) sẽ KHÔNG được
    // thấy ⇒ ca này vẫn xanh dù step-up đã có, tức tín hiệu nhắc S10-AUTH-STEPUP-1 im lặng. Chiều đó KHÔNG
    // mở cổng (cổng chính vẫn bắt route khai cờ là `no-step-up-writer` = fail-closed); WO step-up phải
    // chủ động lật ca này thay vì trông chờ nó tự đỏ.
    expect(
      stepUpExists,
      "Có writer `reauthContext` mới trong src/** — step-up đã tồn tại? Cập nhật WO S10-AUTH-STEPUP-1.",
    ).toBe(false);
  });
});
