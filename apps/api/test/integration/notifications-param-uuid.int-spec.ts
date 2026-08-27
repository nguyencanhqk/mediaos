/**
 * S10-FND-PARAMUUID-4 · lane **L3-NOTI** (KI-078 đợt 3) — biên HTTP THẬT cho kênh **PARAM** của thông
 * báo (SPEC-08) + thùng rác nhân sự. **7 tham số / 3 controller.**
 *
 *   GET    /notifications/:id                  [MyNotificationsController#detail]     read:notification
 *   POST   /notifications/:id/mark-read        [MyNotificationsController#markRead]   mark_read     (200)
 *   DELETE /notifications/:id                  [MyNotificationsController#remove]     delete        (204)
 *   PATCH  /notifications/events/:id           [NotificationAdminController#patchEvent]    update:notification-config
 *   GET    /notifications/templates/:id        [NotificationAdminController#getTemplate]   view:notification-template
 *   PATCH  /notifications/templates/:id        [NotificationAdminController#patchTemplate] update:notification-template
 *   POST   /recycle-bin/employees/:id/restore  [RecycleBinController#restoreEmployee] restore:employee (200)
 *
 * ─── RỦI RO RIÊNG: CATALOG NOTI CÓ MÃ NGHIỆP VỤ BÊN CẠNH `id` ─────────────────────────────────
 * `notification_events` mang `event_code` (`NOTI-EVENT-XXX`, SPEC-01 §9) và `notification_templates`
 * mang `template_code` — catalog nhỏ, kiểu tài nguyên mà FE RẤT dễ tra bằng mã thay vì uuid. Đây đúng
 * lớp đã suýt dính ở `leave_types` (đợt 1) và `job_levels`/`positions` (đợt 2): nếu `:id` thực ra nhận
 * MÃ thì `ParseUUIDPipe` **CHẶN OAN** request hợp lệ, mà ca "UUID hợp lệ không tồn tại → 404" vẫn xanh.
 * ⇒ CẢ HAI loại khoá BẮT BUỘC có ca ALLOW-2xx trên HÀNG THẬT
 * ([[deny-cases-vacuous-without-allow-case]]).
 *
 * ⚠️ Catalog NOTI có hàng GLOBAL (`company_id IS NULL`) dùng chung mọi tenant, và `patchEvent`/
 * `patchTemplate` KHÔNG update hàng global — chúng ghi **company-override**. Fixture vì thế gieo hàng
 * CỦA TENANT A, không mượn hàng global: mượn hàng global là ghi lên dữ liệu dùng chung của lane DB.
 *
 * ─── MỨC ĐỘ — PHÁT BIỂU TRƯỚC MỌI SỐ ĐO ─────────────────────────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: `:id` rác vỡ `22P02` ở Postgres ⇒ **500**, request vẫn bị TỪ CHỐI
 * ⇒ **KHÔNG phải lỗ bảo mật**. Giá trị = hợp đồng API + hết 500 GIẢ trong giám sát.
 *
 * ─── LUẬT ĐO ──────────────────────────────────────────────────────────────────────────────────
 * • Actor ĐÃ đăng nhập (guard chạy TRƯỚC pipe), KHÔNG super-admin, KHÔNG seed `*:*`.
 * • Body HỢP LỆ cho mọi route ghi — 400-do-body là số đo GIẢ.
 * • KHÔNG gửi `Idempotency-Key`.
 * • DENY = **400 ĐƠN TRỊ** + neo `error.type ∉ {Error, ZodError}`; ALLOW loại CẢ 400 VÀ 500.
 * • Cặp own-scope dùng action GẠCH DƯỚI (`mark_read`, KHÔNG phải `mark-read`) —
 *   `notification-permissions.const.ts:22-27`.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). DB phát triển: `mediaos_paramuuid4`.
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
const LOGIN_PW = loginPasswordFixture("s10paramuuid4l3");

const JUNK = "khong-phai-uuid";

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-4 · L3-NOTI — biên HTTP kênh PARAM của notifications (my + admin) · recycle-bin",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";
    let actorUserId = "";

    const http = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });

    const uniq = () => randomUUID().slice(0, 8);

    /**
     * Notification CỦA CHÍNH actor — own-scope tra theo `recipient_user_id`
     * (`my-notifications.repository.ts:59-65`), KHÔNG phải `user_id`. Gieo cả hai để hàng hợp lệ.
     *
     * Mỗi ca ALLOW gọi hàm này MỘT LẦN: `mark-read` và `DELETE` đẩy hàng khỏi trạng thái ban đầu, dùng
     * lại một bản ghi là ca sau đo được thứ khác rồi bị "chữa" bằng nới assert.
     */
    async function seedMyNotification(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO notifications (company_id, user_id, recipient_user_id, body, title, type)
         VALUES ($1, $2, $2, $3, $4, 'general') RETURNING id`,
        [A.companyId, actorUserId, `body-${uniq()}`, `title-${uniq()}`],
      );
      return r.rows[0].id as string;
    }

    /**
     * `notification_events` của TENANT A (không mượn hàng global — xem docblock đầu file).
     * `module_code`/`notification_type`/`default_priority` bị CHECK ràng — dùng giá trị trong ARRAY.
     */
    async function seedEvent(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO notification_events
           (company_id, module_code, event_code, event_name, notification_type, default_priority)
         VALUES ($1, 'NOTI', $2, $3, 'System', 'Normal') RETURNING id`,
        [A.companyId, `NOTI-EVENT-S10PU4-${uniq()}`, `event-${uniq()}`],
      );
      return r.rows[0].id as string;
    }

    /** `notification_templates` của TENANT A, gắn vào một event THẬT của A. */
    async function seedTemplate(): Promise<string> {
      const eventId = await seedEvent();
      const r = await direct.query(
        `INSERT INTO notification_templates
           (company_id, event_id, template_code, channel, locale, title_template, body_template, status)
         VALUES ($1, $2, $3, 'IN_APP', 'vi-VN', $4, $5, 'Active') RETURNING id`,
        [A.companyId, eventId, `TPL-S10PU4-${uniq()}`, `tieu-de-${uniq()}`, `noi-dung-${uniq()}`],
      );
      return r.rows[0].id as string;
    }

    /** `employee_profiles` ĐÃ xoá mềm — nguyên liệu duy nhất của `POST /recycle-bin/.../restore`. */
    async function seedDeletedEmployee(): Promise<string> {
      const uid = await seedUser(direct, A.companyId, `bin-${uniq()}@s10pu4l3.local`);
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, deleted_at)
         VALUES ($1, $2, now()) RETURNING id`,
        [A.companyId, uid],
      );
      return r.rows[0].id as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10pu4l3");
      companyIds.push(A.companyId);

      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `notiadmin-${uniq()}@s10pu4l3.local`;
      actorUserId = await seedUser(direct, A.companyId, email, hash);

      const roleId = await seedRole(direct, A.companyId, `s10pu4l3-${uniq()}`);
      // `is_sensitive` PHẢI khớp catalog — seedPermissionCatalog DỪNG nếu lệch.
      const pairs: Array<[string, string, boolean]> = [
        ["read", "notification", false],
        ["mark_read", "notification", false],
        // Cặp của ca ĐỊNH TUYẾN `POST /notifications/mark-all-read` — thiếu nó thì ca literal-sibling
        // đo được 403 và trở thành ca XANH-RỖNG sau khi ai đó "chữa" bằng cách hạ assert.
        ["mark_all_read", "notification", false],
        ["delete", "notification", false],
        ["view", "notification-config", true],
        ["update", "notification-config", true],
        ["view", "notification-template", true],
        ["update", "notification-template", true],
        ["read", "employee", false],
        ["restore", "employee", true],
      ];
      for (const [action, resourceType, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
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

    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    function expectPassedBoundary(res: request.Response, expectedStatus: number): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
      expect(res.status, body).toBe(expectedStatus);
    }

    // ══ MY NOTIFICATIONS (own-scope tuyệt đối) ══════════════════════════════════════
    it("PARAM · GET /notifications/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/notifications/${JUNK}`).set(auth()));
    });

    it("ALLOW · GET /notifications/:id UUID hợp lệ (không tồn tại) → 404 đơn trị", async () => {
      expectPassedBoundary(await http().get(`/notifications/${randomUUID()}`).set(auth()), 404);
    });

    it("ALLOW-200 · GET /notifications/:id trên HÀNG THẬT (loại khoá notifications)", async () => {
      const id = await seedMyNotification();
      const res = await http().get(`/notifications/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · POST /notifications/:id/mark-read với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().post(`/notifications/${JUNK}/mark-read`).set(auth()).send({}),
      );
    });

    it("ALLOW-200 · POST /notifications/:id/mark-read trên HÀNG THẬT (@HttpCode(200))", async () => {
      const id = await seedMyNotification();
      const res = await http().post(`/notifications/${id}/mark-read`).set(auth()).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · DELETE /notifications/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().delete(`/notifications/${JUNK}`).set(auth()));
    });

    it("ALLOW-204 · DELETE /notifications/:id trên HÀNG THẬT (@HttpCode(204))", async () => {
      const id = await seedMyNotification();
      const res = await http().delete(`/notifications/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    // ══ NOTI ADMIN — events (bảng CÓ `event_code`) ══════════════════════════════════
    it("PARAM · PATCH /notifications/events/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().patch(`/notifications/events/${JUNK}`).set(auth()).send({ is_enabled: false }),
      );
    });

    it("ALLOW-200 · PATCH events/:id trên HÀNG THẬT — CHỨNG MINH `:id` là UUID, KHÔNG phải `event_code`", async () => {
      const id = await seedEvent();
      const res = await http()
        .patch(`/notifications/events/${id}`)
        .set(auth())
        .send({ is_enabled: false });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ NOTI ADMIN — templates (bảng CÓ `template_code`) ════════════════════════════
    it("PARAM · GET /notifications/templates/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/notifications/templates/${JUNK}`).set(auth()));
    });

    it("ALLOW-200 · GET templates/:id trên HÀNG THẬT — CHỨNG MINH `:id` là UUID, KHÔNG phải `template_code`", async () => {
      const id = await seedTemplate();
      const res = await http().get(`/notifications/templates/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · PATCH /notifications/templates/:id với :id rác → 400 ở BIÊN", async () => {
      // `title_template` KHÔNG chứa biến ⇒ 400 quan sát được không thể đến từ assertTemplateVariablesSafe.
      expectRejectedAtBoundary(
        await http()
          .patch(`/notifications/templates/${JUNK}`)
          .set(auth())
          .send({ title_template: `tieu-de-${uniq()}` }),
      );
    });

    it("ALLOW-200 · PATCH templates/:id trên HÀNG THẬT", async () => {
      const id = await seedTemplate();
      const res = await http()
        .patch(`/notifications/templates/${id}`)
        .set(auth())
        .send({ title_template: `tieu-de-${uniq()}` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ RECYCLE BIN ═════════════════════════════════════════════════════════════════
    it("PARAM · POST /recycle-bin/employees/:id/restore với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().post(`/recycle-bin/employees/${JUNK}/restore`).set(auth()).send({}),
      );
    });

    it("ALLOW-200 · POST /recycle-bin/employees/:id/restore trên HÀNG THẬT (@HttpCode(200))", async () => {
      const id = await seedDeletedEmployee();
      const res = await http().post(`/recycle-bin/employees/${id}/restore`).set(auth()).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ Hồi quy ĐỊNH TUYẾN — literal-sibling ════════════════════════════════════════
    /**
     * Liệt kê bằng ĐỌC FILE:
     *  · `my-notifications.controller.ts` khai `@Get("dropdown")` (:71) và `@Get("unread-count")`
     *    (:89) TRƯỚC `@Get(":id")` (:98) — cả hai là MỘT segment nên chúng KHỚP `:id`; chỉ thứ tự
     *    khai báo cứu chúng.
     *  · `@Post("mark-all-read")` (:121) khác SỐ SEGMENT với `@Post(":id/mark-read")` (:111).
     *  · `notification-admin.controller.ts` khai `@Get("templates")` (:148) TRƯỚC
     *    `@Get("templates/:id")` (:175) — chính header của file đã cảnh báo về thứ tự này.
     */
    it("ĐỊNH TUYẾN · GET /notifications/dropdown vẫn 200", async () => {
      const res = await http().get("/notifications/dropdown").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /notifications/unread-count vẫn 200", async () => {
      const res = await http().get("/notifications/unread-count").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · POST /notifications/mark-all-read vẫn 200", async () => {
      const res = await http().post("/notifications/mark-all-read").set(auth()).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /notifications (list của tôi) vẫn 200", async () => {
      const res = await http().get("/notifications").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /notifications/events vẫn 200", async () => {
      const res = await http().get("/notifications/events").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /notifications/templates vẫn 200", async () => {
      const res = await http().get("/notifications/templates").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /recycle-bin/employees vẫn 200", async () => {
      const res = await http().get("/recycle-bin/employees").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  },
);
