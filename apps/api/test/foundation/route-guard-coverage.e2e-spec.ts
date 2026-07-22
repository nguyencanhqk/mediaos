/**
 * S5-BRAND review-2 (MEDIUM) — GUARD COVERAGE: mọi route của một controller ĐÃ GATE đều phải được gate.
 *
 * VÌ SAO CÓ FILE NÀY. `CompanyBrandingController` chuyển `@UseGuards(PermissionGuard)` từ CẤP CLASS sang
 * THEO ROUTE (bắt buộc: guard fail-closed 403 khi route thiếu `@RequirePermission`, nên route đọc
 * authenticated-only phải nằm NGOÀI guard). Hệ quả là **mặc định của controller đó lật từ fail-closed sang
 * fail-open**:
 *   - guard cấp class  → route mới quên `@RequirePermission` = 403 (an toàn, ồn ào, sửa ngay).
 *   - guard theo route → route mới quên `@UseGuards`         = MỞ CHO MỌI USER ĐÃ ĐĂNG NHẬP, IM LẶNG.
 * Không có test nào trong repo bắt được lớp lỗi này (đã grep). Đây là test đó.
 *
 * QUY TẮC (cố ý HẸP để không ồn): CHỈ soi controller đã có ÍT NHẤT MỘT route mang `@RequirePermission`
 * — tức controller "có ý định gate". Trong controller đó, MỌI route khác PHẢI hoặc (a) có
 * `@RequirePermission`, hoặc (b) có `@Public()`, hoặc (c) nằm trong `INTENTIONALLY_UNGATED` dưới đây kèm
 * lý do. Controller hoàn toàn không gate (auth/login, health probe…) NẰM NGOÀI phạm vi — chúng có mô hình
 * bảo mật riêng và ép chúng vào đây chỉ tạo allow-list rác.
 *
 * KHÔNG cần Postgres — chỉ scan metadata (mirror openapi-docs.e2e-spec). Vì vậy KHÔNG skipIf(!hasDb):
 * test này PHẢI chạy trong suite mặc định `pnpm test` để CI thực sự gác.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { IS_PUBLIC } from "../../src/permission/public.decorator";
import { REQUIRE_PERMISSION } from "../../src/permission/require-permission.decorator";

const HTTP_METHOD_NAME = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "ALL",
  "OPTIONS",
  "HEAD",
] as const;

/**
 * BASELINE NỢ — route MUTATION chưa gate ĐÃ TỒN TẠI TRƯỚC test này. Cố ý liệt kê tường minh thay vì nới
 * luật cho xanh: mục đích của test là chặn route MỚI, đồng thời làm nợ cũ HIỆN RA thay vì ẩn đi.
 *
 * Cả 7 dòng đều thuộc `WorkflowController` — workflow của `content_items`, tức module CONTENT/media đã
 * PARK theo de-media-fy (CLAUDE.md §1: "code media/finance park (out-of-scope), không phát triển tiếp,
 * không xoá ở đợt này"). Chính docstring của controller (workflow.controller.ts:71-72) ghi nhận trạng thái
 * này. KHÔNG vá ở PR này (ngoài phạm vi + chạm module park); ghi nhận để lượng sóng sau quyết định:
 * gate lại hay xoá cùng lúc dọn media.
 *
 * ⚠️ Thêm dòng vào đây là một QUYẾT ĐỊNH BẢO MẬT, không phải thao tác dọn test. Route mutation mới của
 * module đang phát triển PHẢI gate, không được vào danh sách này.
 */
const MUTATION_BASELINE: Readonly<Record<string, string>> = {
  "WorkflowController#startWorkflow": "module CONTENT đã park (de-media-fy) — nợ có sẵn",
  "WorkflowController#startStep": "module CONTENT đã park (de-media-fy) — nợ có sẵn",
  "WorkflowController#submitStep": "module CONTENT đã park (de-media-fy) — nợ có sẵn",
  "WorkflowController#checkItem": "module CONTENT đã park (de-media-fy) — nợ có sẵn",
  "WorkflowController#uncheckItem": "module CONTENT đã park (de-media-fy) — nợ có sẵn",
  "WorkflowController#approve": "module CONTENT đã park (de-media-fy) — nợ có sẵn",
  "WorkflowController#requestRevision": "module CONTENT đã park (de-media-fy) — nợ có sẵn",
};

interface RouteInfo {
  controller: string;
  method: string;
  httpMethod: string;
  path: string;
  hasPermission: boolean;
  isPublic: boolean;
}

function collectRoutes(app: INestApplication): RouteInfo[] {
  const discovery = app.get(DiscoveryService, { strict: false });
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { metatype, instance } = wrapper;
    if (!metatype || instance == null) continue;
    const prototype = Object.getPrototypeOf(instance) as object;

    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[methodName];
      if (typeof handler !== "function") continue;
      // Không có PATH_METADATA ⇒ không phải route handler (helper thường của controller).
      const routePath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (routePath === undefined) continue;

      const methodIdx: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      // Metadata đọc ở CẢ handler LẪN class (getAllAndOverride của guard cũng vậy) — decorator cấp class
      // phủ cho mọi route là hợp lệ.
      const hasPermission =
        Reflect.getMetadata(REQUIRE_PERMISSION, handler) !== undefined ||
        Reflect.getMetadata(REQUIRE_PERMISSION, metatype) !== undefined;
      const isPublic =
        Reflect.getMetadata(IS_PUBLIC, handler) === true ||
        Reflect.getMetadata(IS_PUBLIC, metatype) === true;

      routes.push({
        controller: metatype.name,
        method: methodName,
        httpMethod:
          typeof methodIdx === "number" ? (HTTP_METHOD_NAME[methodIdx] ?? String(methodIdx)) : "?",
        path: String(routePath),
        hasPermission,
        isPublic,
      });
    }
  }
  return routes;
}

describe("Route guard coverage — controller đã gate thì gate ĐỦ", () => {
  let app: INestApplication;
  let routes: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    routes = collectRoutes(app);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it("quét được route (sanity — 0 route nghĩa là scanner hỏng, không phải repo sạch)", () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.some((r) => r.hasPermission)).toBe(true);
  });

  it("mọi route MUTATION của controller đã gate đều được gate (hoặc @Public, hoặc baseline có lý do)", () => {
    // Vì sao chỉ soi MUTATION: quy ước nhà của repo này là "GHI thì gate, ĐỌC mở cho thành viên tenant"
    // — OrgController (docstring: "READ (list/tree/members) GIỮ mở cho mọi user tenant"),
    // ApprovalInboxController (inbox đọc own-scope), WorkflowTemplatesController (list/detail),
    // SettingsController (settings/public). Bắt cả GET sẽ sinh allow-list rác 15 dòng cho hành vi ĐÚNG,
    // làm loãng tín hiệu thật. Rủi ro thật khi bỏ guard cấp class là route GHI mới lọt — soi đúng nó.
    const gatedControllers = new Set(
      routes.filter((r) => r.hasPermission).map((r) => r.controller),
    );

    const offenders = routes
      .filter((r) => gatedControllers.has(r.controller))
      .filter((r) => r.httpMethod !== "GET")
      .filter((r) => !r.hasPermission && !r.isPublic)
      .filter((r) => MUTATION_BASELINE[`${r.controller}#${r.method}`] === undefined);

    const report = offenders
      .map((r) => `  ${r.controller}#${r.method} (${r.httpMethod} ${r.path || "/"})`)
      .join("\n");

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `Route GHI KHÔNG gate trong controller đã gate — thêm @UseGuards(PermissionGuard) + ` +
            `@RequirePermission:\n${report}`,
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

  it("mỗi dòng BASELINE phải trỏ route CÓ THẬT (nợ đã trả thì phải gỡ khỏi danh sách)", () => {
    const known = new Set(routes.map((r) => `${r.controller}#${r.method}`));
    const stale = Object.keys(MUTATION_BASELINE).filter((k) => !known.has(k));
    expect(stale, `baseline trỏ route không tồn tại: ${stale.join(", ")}`).toEqual([]);
  });
});
