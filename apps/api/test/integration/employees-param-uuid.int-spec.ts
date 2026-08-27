/**
 * S10-FND-PARAMUUID-3 · lane **L1-EMP** (KI-078 đợt 2) — biên HTTP THẬT cho kênh **PARAM** của
 * hồ sơ nhân sự + yêu cầu đổi hồ sơ (SPEC-03). **8 tham số / 3 controller.**
 *
 *   GET    /employees/:id                              [EmployeesController#getEmployee]        read:employee
 *   PATCH  /employees/:id                              [EmployeesController#updateEmployee]     update:employee
 *   DELETE /employees/:id                              [EmployeesController#deleteEmployee]     delete:employee   (204)
 *   GET    /hr/employees/:id                           [HrReadController#getEmployee]           read:employee
 *   GET    /hr/profile-change-requests/:id             [PCRController#getDetail]                create:profile-change-request
 *   POST   /hr/profile-change-requests/:id/approve     [PCRController#approveRequest]           approve:profile-change-request (200)
 *   POST   /hr/profile-change-requests/:id/reject      [PCRController#rejectRequest]            approve:profile-change-request (200)
 *   POST   /hr/profile-change-requests/:id/cancel      [PCRController#cancelRequest]            create:profile-change-request  (200)
 *
 * ─── MỨC ĐỘ — PHÁT BIỂU TRƯỚC MỌI SỐ ĐO ─────────────────────────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: `:id` rác đi hết đường tới Postgres, vỡ `22P02`, filter trả **500**.
 * Request vẫn **bị từ chối**, KHÔNG hàng nào rò, KHÔNG quyền nào bị vượt, KHÔNG hồ sơ nào bị ghi
 * ⇒ **KHÔNG phải lỗ bảo mật**. Giá trị của bản vá đúng hai điều:
 *   (a) hợp đồng API — client nhận **400** có mã thay vì 500 vô nghĩa;
 *   (b) chấm dứt việc payload rác bơm **500 GIẢ** vào giám sát, làm loãng tín hiệu 500 THẬT.
 * Y hệt KI-068 (kênh BODY), KI-077 (`foundation/files`) và đợt 1 của KI-078.
 *
 * ─── SỐ ĐO HTTP (điền sau lần chạy ĐỎ đầu tiên — xem docs/plans/S10-FND-PARAMUUID-3.md §L4) ─────
 * (ghi ĐÚNG NHƯ ĐO; route nào KHÔNG trả 500 thì ghi lại sự thật đó, KHÔNG ép cho khớp mô tả KI-078)
 *
 * ─── VÌ SAO CA "ALLOW trên HÀNG THẬT" LÀ BẮT BUỘC ──────────────────────────────────────────────
 * Đây là vế DUY NHẤT bắt được ca `:id` hoá ra là **mã nghiệp vụ/slug**: khi đó `ParseUUIDPipe` CHẶN
 * OAN request hợp lệ, mà ca "UUID hợp lệ không tồn tại → 404" vẫn xanh. Ghim status 2xx ĐƠN TRỊ ĐO
 * ĐƯỢC cho MỖI loại khoá được vá ([[deny-cases-vacuous-without-allow-case]]).
 *
 * ─── LUẬT ĐO (vi phạm một điều là số đo VÔ GIÁ TRỊ) ─────────────────────────────────────────────
 * • Guard chạy TRƯỚC pipe ⇒ probe không token chỉ ra 401 = số 0 đội lốt. Mọi ca dùng actor ĐÃ đăng nhập.
 * • Actor KHÔNG phải super-admin ([[superadmin-not-a-canonical-role]]); KHÔNG seed `*:*` — `permissions`
 *   là catalog TOÀN CỤC và `cleanupTenants` không dọn nó ([[test-fixture-stamps-global-permission-catalog]]).
 * • Body PHẢI HỢP LỆ (`reject` đòi `rejectionReason` min(1); PATCH dùng `notes`) — 400-do-body là số đo GIẢ.
 * • TUYỆT ĐỐI KHÔNG gửi `Idempotency-Key`: interceptor (`common/idempotency/idempotency.interceptor.ts:69-70`)
 *   chạy TRƯỚC pipe. `employees.controller.ts` CÓ `@Idempotent()` nhưng chỉ trên `@Post()` tạo mới
 *   (KHÔNG có `:id`) — ba route `:id` của nó KHÔNG mang decorator đó.
 * • NGƯỠNG CHỐNG NỚI: DENY ở lại **400 ĐƠN TRỊ**. `expect([400,500]).toContain(...)` là mở lại lỗ
 *   trong khi sổ ghi ĐÓNG ([[tests-can-pin-a-hole-open]]).
 *
 * ─── TIỀN ĐIỀU KIỆN FSM cho ca ALLOW của PCR ───────────────────────────────────────────────────
 * `getDetail` + `cancel` ép **OWN-scope**: `profile-change-request.service.ts:255-258,486-492` so
 * `employee_profiles.id` của actor với `req.employeeId`, lệch ⇒ 404/403. ⇒ actor PHẢI có
 * `employee_profiles` row và PCR phải thuộc chính row đó.
 * `approve`/`reject` đòi `status='Pending'` (khác ⇒ 409) và `changedFields` KHÔNG chạm
 * `PROFILE_CHANGE_SENSITIVE_FIELDS` (`identity_*`) — chạm thì cần thêm `view-identity:employee`
 * (is_sensitive) ⇒ ForbiddenException. Dùng `phone` (allowed, KHÔNG sensitive).
 * Mỗi ca ALLOW ghi-trạng-thái tiêu thụ MỘT PCR riêng: approve/reject/cancel đều đẩy khỏi `Pending`.
 * Ca ALLOW rơi 409/403/422 ⇒ **SỬA FIXTURE**, không nới assert.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). DB phát triển: `mediaos_paramuuid3`.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s10paramuuid3l1");

/** Giá trị KHÔNG phải UUID dùng chung mọi ca — một hình dạng, để so sánh giữa các route có nghĩa. */
const JUNK = "khong-phai-uuid";

/** Body HỢP LỆ theo `packages/contracts/src/employees.ts:93` — 400 quan sát được PHẢI đến từ PARAM. */
const PATCH_EMP_BODY = { notes: "L1 param-uuid probe" } as const;
/** `approveProfileChangeRequestSchema` — `note` optional; gửi rỗng vẫn hợp lệ. */
const APPROVE_BODY = { note: "L1 probe" } as const;
/** `rejectProfileChangeRequestSchema` — `rejectionReason` min(1) BẮT BUỘC. */
const REJECT_BODY = { rejectionReason: "L1 param-uuid probe" } as const;

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-3 · L1-EMP — biên HTTP kênh PARAM của employees + profile-change-requests",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";
    let actorUserId = "";
    let actorEmployeeId = "";

    const http = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });

    /** Hồ sơ nhân sự dùng-một-lần (ca DELETE tiêu thụ hàng thật). */
    async function seedEmployeeProfile(): Promise<string> {
      const uid = await seedUser(
        direct,
        A.companyId,
        `emp-${randomUUID().slice(0, 8)}@s10pu3l1.local`,
      );
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [A.companyId, uid],
      );
      return r.rows[0].id as string;
    }

    /**
     * PCR `Pending` THUỘC VỀ actor (own-scope của getDetail/cancel) với field KHÔNG nhạy cảm.
     * Mỗi ca ALLOW ghi-trạng-thái gọi hàm này một lần: approve/reject/cancel đẩy PCR khỏi `Pending`,
     * dùng lại một bản ghi là ca sau rơi 409 rồi bị "chữa" bằng nới assert.
     */
    async function seedPendingPcr(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO profile_change_requests
           (company_id, employee_id, requested_by, status, old_values, new_values, changed_fields)
         VALUES ($1, $2, $3, 'Pending', $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id`,
        [
          A.companyId,
          actorEmployeeId,
          actorUserId,
          JSON.stringify({ phone: "0900000000" }),
          JSON.stringify({ phone: "0911111111" }),
          JSON.stringify(["phone"]),
        ],
      );
      return r.rows[0].id as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod validate ở BIÊN → envelope → filter. Thiếu một lớp thì mọi kết luận về
      // "400 hay 500" đều đo một stack KHÁC với PROD.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10pu3l1");
      companyIds.push(A.companyId);

      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `hr-${randomUUID().slice(0, 8)}@s10pu3l1.local`;
      actorUserId = await seedUser(direct, A.companyId, email, hash);

      // Actor CÓ hồ sơ nhân sự của chính mình — bắt buộc cho own-scope của PCR getDetail/cancel.
      const empRes = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [A.companyId, actorUserId],
      );
      actorEmployeeId = empRes.rows[0].id as string;

      // Role RIÊNG của test, chỉ đúng những cặp quyền của các route đang đo — không mượn
      // company-admin, không `*:*`. Cặp lấy từ `@RequirePermission` đọc thẳng trên controller.
      const roleId = await seedRole(direct, A.companyId, `s10pu3l1-${randomUUID().slice(0, 8)}`);
      const pairs: Array<[string, string]> = [
        ["read", "employee"],
        ["update", "employee"],
        ["delete", "employee"],
        ["create", "profile-change-request"],
        ["approve", "profile-change-request"],
      ];
      for (const [action, resourceType] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      // `export:employee` khai `isSensitive: true` ở controller (`hr-read.controller.ts:71`) ⇒ catalog
      // phải ghim ĐÚNG cờ đó, nếu không guard fail-closed và ca literal-sibling `employees/export`
      // đo được 403 chứ không phải hành vi định tuyến ([[sensitive-capability-allowlist-is-backend]]).
      const exportPermId = await seedPermissionCatalog(direct, "export", "employee", true);
      await seedRolePermission(direct, roleId, exportPermId, "ALLOW", "Company");
      await seedUserRole(direct, actorUserId, roleId, A.companyId);

      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      token = res.body.data.accessToken as string;
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    /**
     * Oracle DENY: tham số rác phải bị chặn ở BIÊN bằng 400 ĐƠN TRỊ và KHÔNG mang hiện vật đường 500 cũ.
     * `error.type` là hiện vật phân biệt: `'Error'` (lỗi PG `22P02` lọt tới DB) hoặc `'ZodError'`
     * (schema ném thô). Neo theo hiện vật chứ không chỉ theo status: một ngày ai đó map `22P02` thành
     * 400 ở filter thì status xanh mà lỗ vẫn nguyên vị trí — request rác vẫn đi hết đường tới DB.
     */
    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    /**
     * Oracle ALLOW dùng chung — loại CẢ 400 VÀ 500. Chỉ đòi `≠400` là ca XANH-RỖNG: route vẫn
     * 500/429/401 mà lưới vẫn xanh. Còn siết thêm một bậc: ghim status ĐƠN TRỊ ĐO ĐƯỢC, đối xứng
     * với luật DENY 400 đơn trị.
     */
    function expectPassedBoundary(res: request.Response, expectedStatus: number): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
      expect(res.status, body).toBe(expectedStatus);
    }

    // ══ 1. GET /employees/:id ═══════════════════════════════════════════════════════
    it("PARAM · GET /employees/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/employees/${JUNK}`).set(auth()));
    });

    it("ALLOW · GET /employees/:id UUID hợp lệ (không tồn tại) đi qua biên → 404 đơn trị", async () => {
      expectPassedBoundary(await http().get(`/employees/${randomUUID()}`).set(auth()), 404);
    });

    it("ALLOW-200 · GET /employees/:id trên HÀNG THẬT (loại khoá employee_profile)", async () => {
      const id = await seedEmployeeProfile();
      const res = await http().get(`/employees/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 2. PATCH /employees/:id ═════════════════════════════════════════════════════
    it("PARAM · PATCH /employees/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().patch(`/employees/${JUNK}`).set(auth()).send(PATCH_EMP_BODY),
      );
    });

    it("ALLOW-200 · PATCH /employees/:id trên HÀNG THẬT (body hợp lệ ⇒ 400 không thể do body)", async () => {
      const id = await seedEmployeeProfile();
      const res = await http().patch(`/employees/${id}`).set(auth()).send(PATCH_EMP_BODY);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 3. DELETE /employees/:id ════════════════════════════════════════════════════
    it("PARAM · DELETE /employees/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().delete(`/employees/${JUNK}`).set(auth()));
    });

    it("ALLOW-204 · DELETE /employees/:id trên HÀNG THẬT (@HttpCode(204) đọc từ controller)", async () => {
      const id = await seedEmployeeProfile();
      const res = await http().delete(`/employees/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    // ══ 4. GET /hr/employees/:id ════════════════════════════════════════════════════
    it("PARAM · GET /hr/employees/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/hr/employees/${JUNK}`).set(auth()));
    });

    it("ALLOW-200 · GET /hr/employees/:id trên HÀNG THẬT", async () => {
      const id = await seedEmployeeProfile();
      const res = await http().get(`/hr/employees/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 5. GET /hr/profile-change-requests/:id ══════════════════════════════════════
    it("PARAM · GET /hr/profile-change-requests/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/hr/profile-change-requests/${JUNK}`).set(auth()));
    });

    it("ALLOW-200 · GET PCR/:id trên HÀNG THẬT của chính actor (loại khoá profile_change_request)", async () => {
      const id = await seedPendingPcr();
      const res = await http().get(`/hr/profile-change-requests/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 6. POST /hr/profile-change-requests/:id/approve ═════════════════════════════
    it("PARAM · POST PCR/:id/approve với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .post(`/hr/profile-change-requests/${JUNK}/approve`)
          .set(auth())
          .send(APPROVE_BODY),
      );
    });

    it("ALLOW-200 · approve trên PCR Pending HÀNG THẬT (@HttpCode(200), field KHÔNG nhạy cảm)", async () => {
      const id = await seedPendingPcr();
      const res = await http()
        .post(`/hr/profile-change-requests/${id}/approve`)
        .set(auth())
        .send(APPROVE_BODY);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 7. POST /hr/profile-change-requests/:id/reject ══════════════════════════════
    it("PARAM · POST PCR/:id/reject với :id rác → 400 ở BIÊN", async () => {
      // Body HỢP LỆ (`rejectionReason` có mặt) ⇒ 400 sau bản vá KHÔNG thể đến từ body-pipe.
      expectRejectedAtBoundary(
        await http()
          .post(`/hr/profile-change-requests/${JUNK}/reject`)
          .set(auth())
          .send(REJECT_BODY),
      );
    });

    it("ALLOW-200 · reject trên PCR Pending HÀNG THẬT", async () => {
      const id = await seedPendingPcr();
      const res = await http()
        .post(`/hr/profile-change-requests/${id}/reject`)
        .set(auth())
        .send(REJECT_BODY);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 8. POST /hr/profile-change-requests/:id/cancel ══════════════════════════════
    it("PARAM · POST PCR/:id/cancel với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().post(`/hr/profile-change-requests/${JUNK}/cancel`).set(auth()).send({}),
      );
    });

    it("ALLOW-200 · cancel trên PCR Pending HÀNG THẬT của chính actor", async () => {
      const id = await seedPendingPcr();
      const res = await http()
        .post(`/hr/profile-change-requests/${id}/cancel`)
        .set(auth())
        .send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ 9. Hồi quy ĐỊNH TUYẾN — literal-sibling ═════════════════════════════════════
    /**
     * Liệt kê bằng ĐỌC FILE, không bằng lời (đợt 1 bỏ sót đúng ba route kiểu này):
     *   · `hr-read.controller.ts:53` `GET /hr/employees/summary` — cùng cấp `hr/employees/:id`
     *   · `hr-read.controller.ts:70` `GET /hr/employees/export`  — cùng cấp, `@Res()` CSV ⇒ CHỈ assert status
     *   · `profile-change-request.controller.ts:65` `GET /hr/profile-change-requests/me` — cùng cấp `:id`
     * Gắn pipe cho route `:id` KHÔNG được làm chúng đổi hành vi.
     */
    it("ĐỊNH TUYẾN · GET /hr/employees/summary vẫn 200 sau khi gắn pipe", async () => {
      const res = await http().get("/hr/employees/summary").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /hr/employees/export vẫn 200 sau khi gắn pipe (@Res CSV ⇒ chỉ assert status)", async () => {
      // `@Res()` library-mode ⇒ KHÔNG qua ResponseEnvelopeInterceptor: thân là bytes CSV, không phải
      // envelope JSON. Vì vậy ca này CHỈ ghim status — assert `body.data` ở đây là assert một thứ
      // không tồn tại và sẽ đỏ vì lý do sai.
      const res = await http().get("/hr/employees/export").set(auth());
      expect(res.status, res.text?.slice(0, 200)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /hr/profile-change-requests/me vẫn 200 sau khi gắn pipe", async () => {
      const res = await http().get("/hr/profile-change-requests/me").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  },
);
