/**
 * S10-CLEAN-WORKFLOWPARK-1 — KHẲNG ĐỊNH PHẦN BỊ XOÁ.
 *
 * VÌ SAO CÓ FILE NÀY. Gỡ code chạm bề mặt API là loại thay đổi mà review gate MÙ: reviewer được hỏi
 * "code này có đúng không" nên chỉ soi thứ CÒN đó; thứ biến mất chỉ hiện ra dưới dạng dấu `-` trong
 * diff (bài học PR #133 — hai route notification bị gỡ lặng lẽ, WO sau "chữa" bằng cách gỡ luôn
 * chuông thông báo khỏi console). "Build vẫn xanh" KHÔNG chứng minh gì cho phần bị xoá: xoá một
 * controller thì không còn gì để compile hỏng.
 *
 * Nên bề mặt bị gỡ phải có ca test RIÊNG khẳng định nó **thực sự biến mất ở runtime**, và ca đối
 * chứng khẳng định bản vá **không cắt lẹm sang module đang sống**.
 *
 * Đo bằng `collectRoutes()` (metadata của `AppModule` ĐÃ BOOT — 0 regex trên mã nguồn, cùng nguồn
 * sự thật mà `PermissionGuard` đọc lúc chạy thật). KHÔNG cần Postgres ⇒ KHÔNG `skipIf(!hasDb)`:
 * spec này phải chạy trong `pnpm test` mặc định thì CI mới thật sự gác.
 */

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { collectRoutes, type RouteInfo } from "./route-census";

/**
 * Base path bị gỡ — so BẰNG NHAU trên `controllerPath` (giá trị khai trong `@Controller(...)`),
 * KHÔNG so `startsWith` trên `path`.
 *
 * ⚠️ Bản nháp đầu của spec này lọc `path.split("/")[0]` và ca (1) XANH RỖNG: `path` là đường dẫn
 * ĐẦY ĐỦ *kèm tiền tố toàn cục* (`/api/v1/workflow/...`), nên đoạn đầu luôn là `api` và tập lọc
 * luôn rỗng — ca vẫn xanh y nguyên cả khi controller còn sống. Ca đối chứng (3) là thứ duy nhất
 * làm lộ chuyện đó. Giữ ghi chú này: neo sai làm ca tự-xanh nguy hiểm hơn ca đỏ.
 *
 * So BẰNG NHAU cũng để `workflow` không nuốt `workflow-templates`: hai base path khác nhau phải
 * được liệt kê riêng, ngày mai có `workflows-v2` sống lại thì nó là route KHÁC, không im lặng gộp.
 */
const REMOVED_CONTROLLER_PATHS = ["workflow", "workflow-templates"] as const;

/** `controllerPath` do Nest trả về CÓ dấu `/` đầu (`"/approval"`). Chuẩn hoá để so bằng nhau. */
function basePath(route: { controllerPath: string }): string {
  return route.controllerPath.replace(/^\/+/, "");
}

describe("S10-CLEAN-WORKFLOWPARK-1 — bề mặt HTTP của module `workflow/` đã bị GỠ", () => {
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

  it("(1) AppModule ĐÃ BOOT không còn route nào thuộc `/workflow` hay `/workflow-templates`", () => {
    const survivors = routes.filter((r) =>
      REMOVED_CONTROLLER_PATHS.includes(basePath(r) as never),
    );
    const detail = survivors.map((r) => `  ${r.httpMethod} /${r.path}  (${r.controller})`).join("\n");
    expect(
      survivors.length,
      `Còn ${survivors.length} route của module PARK workflow/ sống ở runtime:\n${detail}`,
    ).toBe(0);
  });

  it("(2) không còn controller nào của module `workflow/` được đăng ký", () => {
    const controllers = [...new Set(routes.map((r) => r.controller))];
    expect(controllers).not.toContain("WorkflowController");
    expect(controllers).not.toContain("WorkflowTemplatesController");
  });

  /**
   * ĐỐI CHỨNG — không có ca này thì ca (1) xanh cả khi bản vá lỡ tay gỡ nhầm nửa app. `approval/`
   * là module ĐANG SỐNG và nó phụ thuộc `ApprovalService` NẰM TRONG `workflow/`; đường ranh của bản
   * vá đi giữa hai thứ đó, nên nó phải được đo chứ không được tin.
   */
  it("(3) đối chứng: module `approval/` ĐANG SỐNG vẫn còn nguyên bề mặt", () => {
    const approvalRoutes = routes.filter((r) => basePath(r) === "approval");
    expect(approvalRoutes.length).toBeGreaterThan(0);
    expect([...new Set(routes.map((r) => r.controller))]).toContain("ApprovalInboxController");
  });
});
