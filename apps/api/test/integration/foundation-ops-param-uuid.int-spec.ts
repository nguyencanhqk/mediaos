/**
 * S10-FND-PARAMUUID-4 · lane **L2-FND** (KI-078 đợt 3) — biên HTTP THẬT cho kênh **PARAM** của bốn
 * bề mặt vận hành FOUNDATION ngoài `files/`: audit viewer · ngày nghỉ · retention · sequence.
 * **8 tham số / 4 controller.**
 *
 *   GET    /foundation/audit-logs/all/:id            [AuditController#getSystemDetail]  ⚠️ @OperatorOnly
 *   GET    /foundation/audit-logs/:id                [AuditController#getCompanyDetail] view:audit-log
 *   PATCH  /foundation/public-holidays/:id           [HolidaysController#update]        manage:foundation-holiday
 *   DELETE /foundation/public-holidays/:id           [HolidaysController#remove]        manage    (200!)
 *   POST   /foundation/retention-policies/:id/simulate [RetentionController#simulate]   manage    (200)
 *   PATCH  /foundation/retention-policies/:id        [RetentionController#update]       manage (sensitive)
 *   GET    /foundation/sequences/:id/preview         [SequenceController#preview]       view:foundation-sequence
 *   PATCH  /foundation/sequences/:id                 [SequenceController#update]        update:foundation-sequence
 *
 * ─── VÌ SAO LANE NÀY CẦN HAI ACTOR ────────────────────────────────────────────────────────────
 * `GET /foundation/audit-logs/all/:id` mang `@OperatorOnly()`: `JwtAuthGuard` verify token với
 * `expectedAudience='operator'`, token tenant → **401**. Guard chạy TRƯỚC pipe ⇒ đo route này bằng
 * actor tenant chỉ đo được cái guard, KHÔNG phải cái tham số. Lane vì thế có actor thứ hai gắn
 * `PLATFORM_ADMIN_ROLE` (mẫu `test/foundation/audit-list-filter.int-spec.ts`).
 *
 * Đây là ngoại lệ CÓ CHỦ Ý của luật "actor KHÔNG super-admin": route này THEO THIẾT KẾ chỉ operator
 * vào được — không có actor nào yếu hơn để mượn. Cặp `view:platform-audit` là `is_sensitive=true` nên
 * wildcard `*:*` KHÔNG kế thừa; grant vẫn phải tường minh, không có đường tắt.
 *
 * ─── RỦI RO RIÊNG: `:id` CÓ THỂ LÀ KHOÁ NGHIỆP VỤ ─────────────────────────────────────────────
 * `sequence_counters` LÀ bảng cấp mã (`sequence_key` + `module_code`, unique theo tenant) — đúng tình
 * huống `leave_types` (đợt 1) và `job_levels`/`positions` (đợt 2): nếu `:id` thực ra nhận **khoá
 * nghiệp vụ** thì `ParseUUIDPipe` **CHẶN OAN** request hợp lệ, mà ca "UUID hợp lệ không tồn tại → 404"
 * vẫn xanh. ⇒ `sequence_counters` BẮT BUỘC có ca ALLOW-2xx trên HÀNG THẬT; đó là vế duy nhất phát
 * hiện được ([[deny-cases-vacuous-without-allow-case]]).
 *
 * ─── MỨC ĐỘ — PHÁT BIỂU TRƯỚC MỌI SỐ ĐO ─────────────────────────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: `:id` rác vỡ `22P02` ở Postgres ⇒ **500**, request vẫn bị TỪ CHỐI
 * ⇒ **KHÔNG phải lỗ bảo mật**. Giá trị = hợp đồng API + hết 500 GIẢ trong giám sát.
 *
 * ─── LUẬT ĐO ──────────────────────────────────────────────────────────────────────────────────
 * • Actor ĐÃ đăng nhập (guard chạy TRƯỚC pipe), KHÔNG seed `*:*`.
 * • Body HỢP LỆ cho mọi route ghi — 400-do-body là số đo GIẢ.
 * • KHÔNG gửi `Idempotency-Key`.
 * • DENY = **400 ĐƠN TRỊ** + neo `error.type ∉ {Error, ZodError}`; ALLOW loại CẢ 400 VÀ 500.
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
const LOGIN_PW = loginPasswordFixture("s10paramuuid4l2");

const JUNK = "khong-phai-uuid";

/** Role hạt giống của control-plane — mang `view:platform-audit`. Xem `audit-list-filter.int-spec.ts`. */
const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0";

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-4 · L2-FND — biên HTTP kênh PARAM của audit-logs · public-holidays · retention-policies · sequences",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";
    let operatorToken = "";
    let actorUserId = "";

    const http = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });
    const opAuth = () => ({ Authorization: `Bearer ${operatorToken}` });

    const uniq = () => randomUUID().slice(0, 8);

    /** Một hàng `audit_logs` THẬT của tenant A — loại khoá của CẢ HAI route audit. */
    async function seedAuditRow(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO audit_logs (company_id, action, object_type, actor_user_id, module_code)
         VALUES ($1, $2, 'user', $3, 'SYSTEM') RETURNING id`,
        [A.companyId, `s10pu4-${uniq()}`, actorUserId],
      );
      return r.rows[0].id as string;
    }

    /**
     * `public_holidays` — `holiday_code` là khoá nghiệp vụ RIÊNG bên cạnh `id`. Gieo `company_id` của
     * A (KHÔNG NULL): hàng global thuộc mọi tenant, ghi/xoá lên nó là đổi dữ liệu dùng chung.
     */
    async function seedHoliday(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO public_holidays (company_id, holiday_code, name, holiday_date, holiday_type, status)
         VALUES ($1, $2, $3, $4::date, 'CompanyHoliday', 'Active') RETURNING id`,
        [A.companyId, `HOL-${uniq()}`, `holiday-${uniq()}`, "2031-05-01"],
      );
      return r.rows[0].id as string;
    }

    /**
     * `data_retention_policies` — `(module_code, entity_type)` là khoá nghiệp vụ bên cạnh `id`.
     *
     * ⚠️ `entity_type` PHẢI là TÊN BẢNG CÓ THẬT: `simulate` chạy
     * `SELECT count(*) FROM sql.identifier(entity_type) WHERE company_id = ... AND created_at < ...`
     * (`retention.service.ts:516-521`). Tên bịa lọt qua guard regex `^[a-z_][a-z0-9_]*$` rồi nổ
     * `42P01` ⇒ **500** — đúng mã trạng thái mà lane này đang đi đo, nên fixture sai sẽ giả trang
     * thành "route vẫn hỏng sau khi vá". Dùng `notifications` (có `company_id` + `created_at`).
     *
     * `is_enabled=false` ⇒ nằm ngoài unique partial `uq_data_retention_company_module_entity_active`
     * (chỉ áp khi `is_enabled=true`), nên gọi hàm này nhiều lần KHÔNG vỡ unique.
     */
    async function seedRetentionPolicy(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO data_retention_policies
           (company_id, module_code, entity_type, retention_days, cleanup_action, is_enabled)
         VALUES ($1, 'NOTI', 'notifications', 365, 'None', false) RETURNING id`,
        [A.companyId],
      );
      return r.rows[0].id as string;
    }

    /**
     * `sequence_counters` — bảng CẤP MÃ: `(module_code, sequence_key)` là khoá tự nhiên của nó. Ca
     * ALLOW trên hàng này là thứ CHỨNG MINH `:id` nhận uuid chứ không nhận `sequence_key`.
     */
    async function seedSequence(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO sequence_counters
           (company_id, module_code, sequence_key, scope_type, padding_length, status)
         VALUES ($1, 'SYSTEM', $2, 'Company', 4, 'Active') RETURNING id`,
        [A.companyId, `S10PU4-${uniq()}`],
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
      A = await seedCompany(direct, "s10pu4l2");
      companyIds.push(A.companyId);

      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `fndops-${uniq()}@s10pu4l2.local`;
      actorUserId = await seedUser(direct, A.companyId, email, hash);

      const roleId = await seedRole(direct, A.companyId, `s10pu4l2-${uniq()}`);
      // `is_sensitive` PHẢI khớp catalog (mig 0435) — seedPermissionCatalog DỪNG nếu lệch.
      const pairs: Array<[string, string, boolean]> = [
        ["view", "audit-log", true],
        ["view", "foundation-holiday", false],
        ["manage", "foundation-holiday", false],
        ["view", "foundation-retention", false],
        ["manage", "foundation-retention", true],
        ["view", "foundation-sequence", false],
        ["update", "foundation-sequence", false],
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

      // Actor thứ hai — audience 'operator' cho `/audit-logs/all/:id` (xem docblock đầu file).
      const opEmail = `fndop-${uniq()}@s10pu4l2.local`;
      const opUserId = await seedUser(direct, A.companyId, opEmail, hash);
      await seedUserRole(direct, opUserId, PLATFORM_ADMIN_ROLE, A.companyId);
      const opRes = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email: opEmail, password: LOGIN_PW });
      expect(opRes.status, `login operator ${opEmail}: ${JSON.stringify(opRes.body)}`).toBe(200);
      operatorToken = opRes.body.data.accessToken as string;
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

    // ══ AUDIT — SYSTEM scope (operator) ═════════════════════════════════════════════
    /**
     * Neo TRƯỚC mọi số đo của route này: token operator PHẢI qua được cổng audience. Nếu ca này đỏ thì
     * hai ca dưới đang đo cái GUARD chứ không đo tham số, và "400" quan sát được sẽ là kết luận SAI.
     */
    it("NEO · token operator qua được @OperatorOnly (GET /foundation/audit-logs/all → 200)", async () => {
      const res = await http().get("/foundation/audit-logs/all").set(opAuth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("NEO · token TENANT bị chặn ở @OperatorOnly (401) — actor tenant KHÔNG đo được route /all/:id", async () => {
      const res = await http().get(`/foundation/audit-logs/all/${JUNK}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(401);
    });

    it("PARAM · GET /foundation/audit-logs/all/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().get(`/foundation/audit-logs/all/${JUNK}`).set(opAuth()),
      );
    });

    it("ALLOW-200 · GET /foundation/audit-logs/all/:id trên HÀNG THẬT (loại khoá audit_logs)", async () => {
      const id = await seedAuditRow();
      const res = await http().get(`/foundation/audit-logs/all/${id}`).set(opAuth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ AUDIT — COMPANY scope (tenant) ══════════════════════════════════════════════
    it("PARAM · GET /foundation/audit-logs/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/foundation/audit-logs/${JUNK}`).set(auth()));
    });

    it("ALLOW-200 · GET /foundation/audit-logs/:id trên HÀNG THẬT", async () => {
      const id = await seedAuditRow();
      const res = await http().get(`/foundation/audit-logs/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ PUBLIC HOLIDAYS (bảng CÓ `holiday_code`) ════════════════════════════════════
    it("PARAM · PATCH /foundation/public-holidays/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .patch(`/foundation/public-holidays/${JUNK}`)
          .set(auth())
          .send({ name: `h-${uniq()}` }),
      );
    });

    it("ALLOW-200 · PATCH public-holidays/:id trên HÀNG THẬT — CHỨNG MINH `:id` là UUID, KHÔNG phải `holiday_code`", async () => {
      const id = await seedHoliday();
      const res = await http()
        .patch(`/foundation/public-holidays/${id}`)
        .set(auth())
        .send({ name: `h-${uniq()}` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · DELETE /foundation/public-holidays/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().delete(`/foundation/public-holidays/${JUNK}`).set(auth()),
      );
    });

    it("ALLOW-200 · DELETE public-holidays/:id trên HÀNG THẬT (@HttpCode(200) — KHÔNG phải 204)", async () => {
      const id = await seedHoliday();
      const res = await http().delete(`/foundation/public-holidays/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ RETENTION POLICIES ══════════════════════════════════════════════════════════
    it("PARAM · POST /foundation/retention-policies/:id/simulate với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().post(`/foundation/retention-policies/${JUNK}/simulate`).set(auth()).send({}),
      );
    });

    it("ALLOW-200 · POST retention-policies/:id/simulate trên HÀNG THẬT (@HttpCode(200))", async () => {
      const id = await seedRetentionPolicy();
      const res = await http()
        .post(`/foundation/retention-policies/${id}/simulate`)
        .set(auth())
        .send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · PATCH /foundation/retention-policies/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .patch(`/foundation/retention-policies/${JUNK}`)
          .set(auth())
          .send({ retentionDays: 400 }),
      );
    });

    it("ALLOW-200 · PATCH retention-policies/:id trên HÀNG THẬT", async () => {
      const id = await seedRetentionPolicy();
      const res = await http()
        .patch(`/foundation/retention-policies/${id}`)
        .set(auth())
        .send({ retentionDays: 400 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ SEQUENCES (bảng CẤP MÃ — có `sequence_key`) ═════════════════════════════════
    it("PARAM · GET /foundation/sequences/:id/preview với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().get(`/foundation/sequences/${JUNK}/preview`).set(auth()),
      );
    });

    it("ALLOW-200 · GET sequences/:id/preview trên HÀNG THẬT — CHỨNG MINH `:id` là UUID, KHÔNG phải `sequence_key`", async () => {
      const id = await seedSequence();
      const res = await http().get(`/foundation/sequences/${id}/preview`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    /**
     * Ca ALLOW dạng thứ hai: UUID HỢP LỆ nhưng không tồn tại. Nó tách "400 vì SAI DẠNG" khỏi "404 vì
     * KHÔNG CÓ HÀNG" — nếu pipe chặn oan cả uuid hợp lệ thì ca này ĐỎ trong khi mọi ca DENY vẫn xanh.
     */
    it("ALLOW · GET /foundation/sequences/:id/preview UUID hợp lệ (không tồn tại) → 404 đơn trị", async () => {
      expectPassedBoundary(
        await http().get(`/foundation/sequences/${randomUUID()}/preview`).set(auth()),
        404,
      );
    });

    it("ALLOW · PATCH /foundation/retention-policies/:id UUID hợp lệ (không tồn tại) → 404 đơn trị", async () => {
      expectPassedBoundary(
        await http()
          .patch(`/foundation/retention-policies/${randomUUID()}`)
          .set(auth())
          .send({ retentionDays: 400 }),
        404,
      );
    });

    it("PARAM · PATCH /foundation/sequences/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http().patch(`/foundation/sequences/${JUNK}`).set(auth()).send({ paddingLength: 6 }),
      );
    });

    it("ALLOW-200 · PATCH sequences/:id trên HÀNG THẬT", async () => {
      const id = await seedSequence();
      const res = await http()
        .patch(`/foundation/sequences/${id}`)
        .set(auth())
        .send({ paddingLength: 6 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ Hồi quy ĐỊNH TUYẾN — literal-sibling ════════════════════════════════════════
    /**
     * Liệt kê bằng ĐỌC FILE. Ca ĐẮT NHẤT của nhóm này là `GET /foundation/audit-logs/all`:
     * `all` là **một segment** nên nó KHỚP `@Get(":id")` — thứ duy nhất cứu nó là THỨ TỰ KHAI BÁO
     * (`audit.controller.ts:51` trước `:68`). Gắn `ParseUUIDPipe` vào `:id` mà đảo thứ tự khai báo thì
     * `/all` sẽ rơi vào nhánh `:id` và ăn 400 — ca này là thứ phát hiện được.
     * (`GET /foundation/audit-logs/all` đã ghim ở ca NEO đầu file bằng token operator.)
     */
    it("ĐỊNH TUYẾN · GET /foundation/audit-logs (list company) vẫn 200", async () => {
      const res = await http().get("/foundation/audit-logs").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /foundation/public-holidays vẫn 200", async () => {
      const res = await http().get("/foundation/public-holidays").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /foundation/public-holidays/check-working-day vẫn 200", async () => {
      const res = await http()
        .get("/foundation/public-holidays/check-working-day?date=2031-05-01")
        .set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /foundation/retention-policies vẫn 200", async () => {
      const res = await http().get("/foundation/retention-policies").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /foundation/sequences vẫn 200", async () => {
      const res = await http().get("/foundation/sequences").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  },
);
