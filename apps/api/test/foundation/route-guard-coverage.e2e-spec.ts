/**
 * GUARD COVERAGE + CENSUS RUNTIME — mọi route KHÔNG gate phải mang một phán quyết CÓ CHỮ KÝ.
 *
 * VÌ SAO CÓ FILE NÀY (S5-BRAND review-2). `CompanyBrandingController` chuyển `@UseGuards(PermissionGuard)`
 * từ CẤP CLASS sang THEO ROUTE (bắt buộc: guard fail-closed 403 khi route thiếu `@RequirePermission`, nên
 * route đọc authenticated-only phải nằm NGOÀI guard). Hệ quả là **mặc định của controller đó lật từ
 * fail-closed sang fail-open**:
 *   - guard cấp class  → route mới quên `@RequirePermission` = 403 (an toàn, ồn ào, sửa ngay).
 *   - guard theo route → route mới quên `@UseGuards`         = MỞ CHO MỌI USER ĐÃ ĐĂNG NHẬP, IM LẶNG.
 *
 * VÌ SAO FILE NÀY ĐƯỢC VIẾT LẠI (S6-SEC-ROUTEMAP-1). Bản đầu chỉ soi **MUTATION** của **controller đã
 * gate** — `.filter((r) => r.httpMethod !== "GET")`. Lý do khi đó nghe hợp lý ("quy ước nhà: GHI thì gate,
 * ĐỌC mở cho thành viên tenant") nhưng nó chính là chỗ **KI-030 lọt qua mọi lưới**: `GET /org/employees`,
 * `GET /org/teams`, `GET /org/teams/:id/members` lộ danh bạ + cơ cấu team toàn tenant cho mọi user đã đăng
 * nhập, và không lưới nào kêu. Bộ lọc GET đã bị GỠ. Thay vào đó: **census 100% route** + sổ phán quyết
 * (`route-verdicts.ts`) — route đọc mới không gate giờ làm ĐỎ test thay vì đi qua trong im lặng.
 *
 * PHẠM VI PHÁN QUYẾT = mọi route không `@RequirePermission`, **kể cả `@Public`**. `@Public` bỏ qua CẢ
 * JwtAuthGuard lẫn CompanyGuard nên nó là mức rủi ro cao nhất, không phải mức được miễn ký.
 *
 * KHÔNG cần Postgres — chỉ boot + đọc metadata. Vì vậy KHÔNG `skipIf(!hasDb)`: test này PHẢI chạy trong
 * suite mặc định `pnpm test` để CI thực sự gác.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import {
  GLOBAL_PREFIX,
  collectRoutes,
  isUngated,
  routeKey,
  type RouteInfo,
} from "./route-census";
import { FROZEN_GAPS, ROUTE_VERDICTS, type Verdict } from "./route-verdicts";

/**
 * Artifact MÁY-ĐỌC của census — nguồn số liệu DUY NHẤT cho Phụ lục A của báo cáo S6-SEC-1.
 * Sinh lại bằng: `ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts`
 */
// tsconfig module=commonjs → dùng __dirname (mẫu force-before-backfill-order.int-spec) thay vì import.meta.
// __dirname = apps/api/test/foundation → lùi 4 cấp tới gốc repo, rồi vào docs/_review.
const ARTIFACT_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "docs",
  "_review",
  "S6-SEC-ROUTEMAP-1-route-census.json",
);

const VALID_VERDICTS: readonly Verdict[] = [
  "SELF",
  "PUBLIC",
  "OTHER_GUARD",
  "TENANT_READ",
  "DEAD-410",
  "PARKED",
  "GAP",
];

/** Ô phán quyết KHÔNG BAO GIỜ hợp lệ cho một route GHI: "mở cho cả tenant" và "lỗ đã biết". */
const VERDICTS_FORBIDDEN_ON_MUTATION: readonly Verdict[] = ["TENANT_READ", "GAP"];

interface CensusArtifact {
  readonly note: string;
  readonly generatedBy: string;
  readonly regenerate: string;
  readonly globalPrefix: string;
  readonly totals: Record<string, number>;
  readonly verdictCounts: Record<string, number>;
  readonly routes: readonly Record<string, unknown>[];
}

function buildArtifact(routes: readonly RouteInfo[]): CensusArtifact {
  const needVerdict = routes.filter((r) => !r.hasPermission);
  const verdictCounts: Record<string, number> = {};
  for (const v of VALID_VERDICTS) verdictCounts[v] = 0;
  for (const r of needVerdict) {
    const entry = ROUTE_VERDICTS[routeKey(r)];
    if (entry) verdictCounts[entry.verdict] = (verdictCounts[entry.verdict] ?? 0) + 1;
  }

  return {
    note:
      "Census runtime 100% route, sinh từ AppModule ĐÃ BOOT (0 regex trên mã nguồn). Sổ phán quyết: apps/api/test/foundation/route-verdicts.ts.",
    generatedBy: "apps/api/test/foundation/route-guard-coverage.e2e-spec.ts",
    regenerate:
      "ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts",
    globalPrefix: GLOBAL_PREFIX,
    totals: {
      routes: routes.length,
      controllers: new Set(routes.map((r) => r.controller)).size,
      gated: routes.filter((r) => r.hasPermission).length,
      gatedAtClassLevel: routes.filter((r) => r.permissionLevel === "class").length,
      public: routes.filter((r) => r.isPublic).length,
      ungated: routes.filter(isUngated).length,
      needVerdict: needVerdict.length,
    },
    verdictCounts,
    routes: routes.map((r) => {
      const entry = ROUTE_VERDICTS[routeKey(r)];
      return {
        key: routeKey(r),
        httpMethod: r.httpMethod,
        path: r.path,
        hasPermission: r.hasPermission,
        permission: r.permission,
        permissionLevel: r.permissionLevel,
        isPublic: r.isPublic,
        classGuards: [...r.classGuards],
        routeGuards: [...r.routeGuards],
        verdict: entry?.verdict ?? null,
        verdictReason: entry?.reason ?? null,
        verdictWo: entry?.wo ?? null,
      };
    }),
  };
}

describe("Route census runtime + phán quyết gate có chữ ký", () => {
  let app: INestApplication;
  let routes: RouteInfo[];
  /** Tập BẮT BUỘC có phán quyết = mọi route không `@RequirePermission` (gồm cả `@Public`). */
  let needVerdict: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    routes = collectRoutes(app);
    needVerdict = routes.filter((r) => !r.hasPermission);

    if (process.env.ROUTE_CENSUS_WRITE === "1") {
      writeFileSync(ARTIFACT_PATH, `${JSON.stringify(buildArtifact(routes), null, 2)}\n`, "utf8");
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("quét được route (sanity — 0 route nghĩa là scanner hỏng, không phải repo sạch)", () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.some((r) => r.hasPermission)).toBe(true);
    // Bẫy #1 của §0.4: `@RequirePermission` cấp class. Nếu con số này về 0, bộ quét đã mù vế class trở lại
    // và mọi kết luận "route X có gate" bên dưới thành vô giá trị.
    expect(
      routes.filter((r) => r.permissionLevel === "class").length,
      "phải thấy được @RequirePermission khai ở CẤP CLASS (bẫy đếm thừa 11 route /me/* của §0.4)",
    ).toBeGreaterThan(0);
  });

  it("MỌI route không gate đều có ĐÚNG MỘT phán quyết (đây là chỗ route GET mới bị bắt)", () => {
    const missing = needVerdict
      .filter((r) => ROUTE_VERDICTS[routeKey(r)] === undefined)
      .map((r) => `  ${routeKey(r)} (${r.httpMethod} ${r.path})`);

    expect(
      missing,
      missing.length === 0
        ? ""
        : `Route KHÔNG gate mà chưa có phán quyết trong route-verdicts.ts:\n${missing.join("\n")}\n\n` +
            `Chọn MỘT: (a) thêm @RequirePermission + @UseGuards(PermissionGuard) — mặc định đúng cho hầu hết ` +
            `route; hoặc (b) ký một phán quyết trong apps/api/test/foundation/route-verdicts.ts kèm lý do. ` +
            `KHÔNG được nới luật ở file này cho xanh.`,
    ).toEqual([]);
  });

  it("mỗi dòng trong sổ phán quyết phải trỏ route CÓ THẬT và ĐANG không gate (nợ trả rồi thì gỡ)", () => {
    const needVerdictKeys = new Set(needVerdict.map(routeKey));
    const allKeys = new Set(routes.map(routeKey));

    const stale = Object.keys(ROUTE_VERDICTS).filter((k) => !allKeys.has(k));
    expect(stale, `sổ trỏ route KHÔNG TỒN TẠI (đã xoá/đổi tên): ${stale.join(", ")}`).toEqual([]);

    const nowGated = Object.keys(ROUTE_VERDICTS).filter((k) => !needVerdictKeys.has(k));
    expect(
      nowGated,
      `route đã được gate rồi nhưng vẫn còn dòng miễn trừ trong sổ — gỡ đi: ${nowGated.join(", ")}`,
    ).toEqual([]);
  });

  it("phán quyết hợp lệ: đúng ô, có lý do, GAP phải trỏ Work Order", () => {
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(ROUTE_VERDICTS)) {
      if (!VALID_VERDICTS.includes(entry.verdict)) bad.push(`${key}: ô lạ "${entry.verdict}"`);
      if (entry.reason.trim().length < 20) bad.push(`${key}: lý do rỗng/quá ngắn`);
      if (entry.verdict === "GAP" && !entry.wo) bad.push(`${key}: GAP nhưng không trỏ WO nào`);
      if (entry.verdict !== "GAP" && entry.wo) bad.push(`${key}: chỉ GAP mới được mang wo`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("danh sách GAP bị ĐÓNG BĂNG — không ai mở lỗ mới bằng cách viết thêm một dòng", () => {
    const gaps = Object.entries(ROUTE_VERDICTS)
      .filter(([, v]) => v.verdict === "GAP")
      .map(([k]) => k)
      .sort();
    expect(
      gaps,
      `Danh sách GAP đổi. Thêm GAP = thêm lỗ bảo mật đã biết ⇒ phải có WO + owner duyệt. ` +
        `Đóng GAP ⇒ cập nhật FROZEN_GAPS trong route-verdicts.ts kèm bằng chứng.`,
    ).toEqual([...FROZEN_GAPS].sort());
  });

  it("route GHI không bao giờ được mang phán quyết TENANT_READ hoặc GAP", () => {
    // Quy ước nhà cho phép ĐỌC mở trong tenant; nó KHÔNG bao giờ cho phép GHI mở. Một mutation rơi vào
    // hai ô này là dấu hiệu ai đó dán nhãn cho xanh thay vì gate.
    const offenders = needVerdict
      .filter((r) => r.httpMethod !== "GET")
      .filter((r) => {
        const entry = ROUTE_VERDICTS[routeKey(r)];
        return entry !== undefined && VERDICTS_FORBIDDEN_ON_MUTATION.includes(entry.verdict);
      })
      .map((r) => `  ${routeKey(r)} (${r.httpMethod} ${r.path}) → ${ROUTE_VERDICTS[routeKey(r)]?.verdict}`);

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("`@RequirePermission` không bao giờ là TRANG TRÍ — route đã gate phải có PermissionGuard trong chuỗi", () => {
    // Điểm mù thứ hai của lưới cũ, cùng họ với vế GET. `PermissionGuard` KHÔNG phải APP_GUARD
    // (app.module.ts:103-105 chỉ đăng ký JwtAuthGuard · CompanyGuard · TwoFactorEnforcementGuard) — nó là
    // opt-in THEO CONTROLLER. Nghĩa là một route có thể khai `@RequirePermission` đầy đủ, đọc vào tưởng
    // đã gác, mà runtime KHÔNG hề kiểm quyền vì không guard nào đọc metadata đó. Census hiện cho 0 —
    // khoá lại để nó không âm thầm khác 0.
    const decorative = routes
      .filter((r) => r.hasPermission)
      .filter(
        (r) =>
          !r.classGuards.includes("PermissionGuard") && !r.routeGuards.includes("PermissionGuard"),
      )
      .map((r) => `  ${routeKey(r)} (${r.httpMethod} ${r.path}) khai ${r.permission} nhưng không guard nào đọc`);

    expect(
      decorative,
      decorative.length === 0
        ? ""
        : `@RequirePermission KHÔNG có PermissionGuard đi kèm ⇒ quyền khai ra chỉ để trang trí:\n${decorative.join("\n")}`,
    ).toEqual([]);
  });

  it("CompanyBrandingController: đúng 1 route đọc mở, 4 route ghi đều gate (chốt hồi quy trực tiếp)", () => {
    const branding = routes.filter((r) => r.controller === "CompanyBrandingController");
    expect(branding.length, "5 route branding").toBe(5);

    const ungated = branding.filter((r) => !r.hasPermission);
    expect(ungated.map((r) => r.method)).toEqual(["getBranding"]);

    // 4 route MUTATION phải gate — đây là bất biến bị đe doạ khi bỏ guard cấp class.
    const mutations = branding.filter((r) => r.httpMethod !== "GET");
    expect(mutations.length).toBe(4);
    expect(mutations.every((r) => r.hasPermission)).toBe(true);
  });

  it("artifact census đã commit khớp census runtime (số trong Phụ lục A không được chép tay)", () => {
    const live = buildArtifact(routes);
    const committed = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as CensusArtifact;

    const hint =
      `\n\nSinh lại artifact bằng:\n  ${live.regenerate}\n` +
      `rồi đối chiếu lại số liệu Phụ lục A trong docs/_review/S6-SEC-1-*.md.`;

    // So sánh theo KHOÁ trước để thông báo lỗi còn đọc được (452 route in ra nguyên khối thì vô dụng).
    const liveKeys = new Set(live.routes.map((r) => String(r.key)));
    const committedKeys = new Set(committed.routes.map((r) => String(r.key)));
    const added = [...liveKeys].filter((k) => !committedKeys.has(k)).sort();
    const removed = [...committedKeys].filter((k) => !liveKeys.has(k)).sort();
    expect(added, `route MỚI chưa có trong artifact: ${added.join(", ")}${hint}`).toEqual([]);
    expect(removed, `artifact còn route đã BIẾN MẤT: ${removed.join(", ")}${hint}`).toEqual([]);

    const committedByKey = new Map(committed.routes.map((r) => [String(r.key), r]));
    const changed = live.routes
      .filter((r) => JSON.stringify(committedByKey.get(String(r.key))) !== JSON.stringify(r))
      .map((r) => String(r.key));
    expect(changed, `route đổi thuộc tính gate/phán quyết: ${changed.join(", ")}${hint}`).toEqual([]);

    expect(committed.totals, `tổng số lệch${hint}`).toEqual(live.totals);
    expect(committed.verdictCounts, `phân bố phán quyết lệch${hint}`).toEqual(live.verdictCounts);
  });
});
