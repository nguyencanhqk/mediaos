/**
 * Tầng HTTP của ProfileChangeRequestController — CHẠY KHÔNG CẦN DB.
 *
 * Vì sao cần file này: approve/reject từng chết 400 ngay ở pipe validate, TRƯỚC khi vào service —
 * `@UsePipes(new ZodValidationPipe(schema))` áp cho MỌI tham số của handler (pipe khởi tạo kèm schema
 * bỏ qua metadata.type), nên `@Param("id") id: string` bị đem so với schema object và ném
 * "Expected object, received string". Toàn bộ test cũ hoặc gọi service trực tiếp, hoặc diễn lại SQL của
 * repository — KHÔNG cái nào đi qua HTTP ⇒ tất cả vẫn xanh trong khi nút "Duyệt" hỏng trên production.
 *
 * Test này đi ĐÚNG đường HTTP thật (pipe + binding tham số) với service giả, nên bắt được lớp lỗi đó và
 * KHÔNG cần Postgres (không bị skip như các int-spec gated bởi LANE_DB).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication, ExecutionContext } from "@nestjs/common";
import request from "supertest";
import { ProfileChangeRequestController } from "./profile-change-request.controller";
import { ProfileChangeRequestService } from "./profile-change-request.service";
import { PermissionGuard } from "../permission/guards/permission.guard";

const REQUEST_ID = "31516076-63ce-4262-aadf-fe74f1a5eaa7";

const svc = {
  approveRequest: vi.fn(async () => ({ id: REQUEST_ID, status: "Approved" })),
  rejectRequest: vi.fn(async () => ({ id: REQUEST_ID, status: "Rejected" })),
  cancelRequest: vi.fn(async () => ({ id: REQUEST_ID, status: "Cancelled" })),
  createRequest: vi.fn(),
  listOwnRequests: vi.fn(),
  listRequests: vi.fn(),
  getRequestDetail: vi.fn(),
};

/** Guard quyền thay bằng stub: file này kiểm TẦNG HTTP, deny-path quyền đã có int-spec riêng. */
const allowGuard = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().user = { id: "u-1", companyId: "co-1" };
    return true;
  },
};

describe("ProfileChangeRequestController (HTTP layer, không DB)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProfileChangeRequestController],
      providers: [{ provide: ProfileChangeRequestService, useValue: svc }],
    })
      .overrideGuard(PermissionGuard)
      .useValue(allowGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("POST :id/approve với body rỗng {} → KHÔNG 400, service nhận đúng id", async () => {
    const res = await request(app.getHttpServer())
      .post(`/hr/profile-change-requests/${REQUEST_ID}/approve`)
      .send({});

    expect(res.status).toBe(200);
    expect(svc.approveRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u-1" }),
      REQUEST_ID,
      expect.any(Object),
    );
  });

  /**
   * GHI NHẬN HIỆN TRẠNG (không phải mong muốn): approve schema toàn field optional (`note?`) nên POST
   * không body lẽ ra hợp lệ, nhưng body undefined vẫn trượt validate → 400. KHÔNG ảnh hưởng UI (web-core
   * luôn gửi `{}` kèm Content-Type: application/json), chỉ cấn với client khác (curl/mobile/tích hợp).
   * Sửa đúng chỗ là `.default({})` trong contracts — cố ý CHƯA làm ở đây để không mở rộng phạm vi sang
   * package dùng chung. Test này để nếu ai đó sửa thì thấy ngay chứ không đổi ngầm.
   */
  it("POST :id/approve KHÔNG gửi body → hiện vẫn 400 (giới hạn đã biết, UI không dính)", async () => {
    const res = await request(app.getHttpServer()).post(
      `/hr/profile-change-requests/${REQUEST_ID}/approve`,
    );

    expect(res.status).toBe(400);
  });

  it("POST :id/reject với lý do → KHÔNG 400, lý do tới service", async () => {
    const res = await request(app.getHttpServer())
      .post(`/hr/profile-change-requests/${REQUEST_ID}/reject`)
      .send({ rejectionReason: "Thiếu giấy tờ" });

    expect(res.status).toBe(200);
    expect(svc.rejectRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u-1" }),
      REQUEST_ID,
      expect.objectContaining({ rejectionReason: "Thiếu giấy tờ" }),
    );
  });

  it("POST :id/reject THIẾU lý do → 400 (validate body VẪN còn hiệu lực, không phải tắt pipe)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/hr/profile-change-requests/${REQUEST_ID}/reject`)
      .send({});

    expect(res.status).toBe(400);
  });
});
