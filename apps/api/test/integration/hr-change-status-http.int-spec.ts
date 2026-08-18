/**
 * S10-HR-STATUSUI-1 — HR change-status qua HTTP THẬT (CROWN-JEWEL: FSM + audit append-only + khoá tài khoản).
 *
 * WO này mở rộng hợp đồng `changeEmployeeStatusSchema` thêm `endDate` (ngày nghỉ việc, SPEC-03 §11.5 /
 * §18.3 rule 5) và ghi `employee_profiles.end_date` CÙNG MỘT TRANSACTION với `status` — thay vì bắt FE gọi
 * hai lượt (PATCH endDate rồi POST change-status), lượt hai hỏng để lại đúng trạng thái sai lệch mà WO mô tả.
 *
 * Vì sao phải là int-spec HTTP chứ không phải unit: guard chain (JwtAuthGuard → CompanyGuard → 2FA →
 * PermissionGuard) · ZodValidationPipe · response envelope CHỈ chạy khi đi qua HTTP thật.
 *
 * Nguyên tắc dựng ca (docs/plans/S10-HR-STATUSUI-1.md §5):
 *   - ALLOW ĐẶT TRƯỚC DENY. Ca (f) ALLOW-khoá là bắt buộc: thiếu nó thì (f2) "không bị khoá" xanh RỖNG
 *     (bài học deny-cases-vacuous-without-allow-case).
 *   - (f2) ĐỌC LẠI DB xác nhận employee_profiles.user_id = actor.userId TRƯỚC khi assert — chặn ở
 *     hr-write.service.ts:510 là `row.userId && row.userId !== user.id`, fixture quên liên kết
 *     (user_id IS NULL) ⇒ ca xanh vì LÝ DO SAI.
 *   - Actor KHÔNG BAO GIỜ là super-admin (memory superadmin-not-a-canonical-role: test bằng SA = tautology).
 *     Mỗi ca có actor RIÊNG (memory per-user-rate-limit-throttles-own-int-spec).
 *   - Ca âm assert cả `end_date` KHÔNG đổi, không chỉ status/history/audit — nếu không, một đường ghi
 *     endDate đặt nhầm TRƯỚC kiểm FSM vẫn lọt.
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env trỏ DATABASE_URL vào DB dev dùng
 * chung (hasDb=true) → chỉ chạy trên lane DB cô lập, nếu không thì đỏ-oan/xanh-giả.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
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

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

/** Ngày gieo sẵn trên hồ sơ — mọi ca âm assert giá trị này KHÔNG đổi. */
const SEEDED_END_DATE = "2026-01-31";
const NEW_END_DATE = "2026-08-08";
const OVERWRITE_END_DATE = "2026-09-30";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface Actor {
  email: string;
  userId: string;
}

/**
 * Actor RIÊNG cho mỗi ca (cách ly rate-limit per-user). Role company-scoped ad-hoc mang đúng cặp cần —
 * KHÔNG super-admin, KHÔNG wildcard. `pairs` rỗng = actor không có quyền gì (ca DENY 403).
 */
async function mkActor(
  direct: Pool,
  tenant: SeededTenant,
  tag: string,
  pairs: Array<[string, string]> = [["change-status", "employee"]],
): Promise<Actor> {
  const hash = await hashedPw();
  const email = `${tag}@${tenant.slug}.test`;
  const userId = await seedUser(direct, tenant.companyId, email, hash);
  if (pairs.length > 0) {
    const roleId = await seedRole(direct, tenant.companyId, `qa-cs-${tag}-${userId.slice(0, 8)}`);
    for (const [action, resourceType] of pairs) {
      // change-status:employee là cặp KHÔNG nhạy cảm (mig 0444, auth-seed-canonical-roles.int-spec.ts:117).
      // Catalog quyền là TOÀN CỤC + ON CONFLICT DO NOTHING ⇒ khai lệch is_sensitive sẽ đóng dấu sai cho
      // mọi spec khác (memory test-fixture-stamps-global-permission-catalog).
      const permId = await seedPermissionCatalog(direct, action, resourceType, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);
  }
  return { email, userId };
}

/** Hồ sơ gieo TRỰC TIẾP (superuser, bỏ qua RLS) — không đi qua API create nên không tiêu thụ sequence mã NV. */
async function seedEmployee(
  direct: Pool,
  companyId: string,
  userId: string | null,
  opts: { status?: string; endDate?: string | null } = {},
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, status, work_type, end_date)
     VALUES ($1, $2, $3, 'offline', $4) RETURNING id`,
    [companyId, userId, opts.status ?? "active", opts.endDate ?? SEEDED_END_DATE],
  );
  return r.rows[0].id as string;
}

/** `end_date` là cột `date` — ép về chuỗi YYYY-MM-DD để so sánh xác định (node-pg tự parse thành Date). */
async function readEmployee(
  direct: Pool,
  id: string,
): Promise<{ status: string; endDate: string | null; userId: string | null }> {
  const r = await direct.query(
    `SELECT status, user_id, to_char(end_date, 'YYYY-MM-DD') AS end_date
       FROM employee_profiles WHERE id = $1`,
    [id],
  );
  return {
    status: r.rows[0].status as string,
    endDate: r.rows[0].end_date as string | null,
    userId: r.rows[0].user_id as string | null,
  };
}

async function readUser(
  direct: Pool,
  userId: string,
): Promise<{ status: string; lockedAt: Date | null }> {
  const r = await direct.query(`SELECT status, locked_at FROM users WHERE id = $1`, [userId]);
  return { status: r.rows[0].status as string, lockedAt: r.rows[0].locked_at as Date | null };
}

async function countHistory(direct: Pool, employeeId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM employee_status_histories WHERE employee_id = $1`,
    [employeeId],
  );
  return r.rows[0].n as number;
}

async function countAudit(direct: Pool, objectId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs
       WHERE object_type = 'employee' AND action = 'change-status' AND object_id = $1`,
    [objectId],
  );
  return r.rows[0].n as number;
}

async function lastAudit(
  direct: Pool,
  objectId: string,
): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }> {
  const r = await direct.query(
    `SELECT before, after FROM audit_logs
       WHERE object_type = 'employee' AND action = 'change-status' AND object_id = $1
       ORDER BY created_at DESC LIMIT 1`,
    [objectId],
  );
  expect(r.rows, `no change-status audit row for ${objectId}`).toHaveLength(1);
  return {
    before: (r.rows[0].before ?? {}) as Record<string, unknown>,
    after: (r.rows[0].after ?? {}) as Record<string, unknown>,
  };
}

describe.skipIf(!hasLaneDb)(
  "S10-HR-STATUSUI-1 change-status + endDate (HTTP, engine quyền thật)",
  () => {
    const direct = directPool();
    let app: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;

    beforeAll(async () => {
      A = await seedCompany(direct, "csA");
      B = await seedCompany(direct, "csB");

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
    });

    afterAll(async () => {
      for (const id of [A.companyId, B.companyId]) {
        await direct
          .query("DELETE FROM employee_status_histories WHERE company_id = $1", [id])
          .catch(() => undefined);
        await direct
          .query("DELETE FROM employee_manager_relations WHERE company_id = $1", [id])
          .catch(() => undefined);
        await direct
          .query("DELETE FROM employee_profiles WHERE company_id = $1", [id])
          .catch(() => undefined);
      }
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      if (app) await app.close();
    });

    // ── ALLOW trước (ca DENY chỉ có nghĩa khi đường sống đã chứng minh được) ────────────────────────

    it("(b) ALLOW → resigned: status + end_date + 1 history + 1 audit trong MỘT lượt gọi", async () => {
      const actor = await mkActor(direct, A, "b-allow");
      const empId = await seedEmployee(direct, A.companyId, null, { status: "active" });
      const token = await login(app, A.slug, actor.email);

      const res = await api(app)
        .post(`/hr/employees/${empId}/change-status`)
        .set(bearer(token))
        .send({
          newStatus: "resigned",
          endDate: NEW_END_DATE,
          reason: "nghỉ việc",
          lockUser: false,
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const emp = await readEmployee(direct, empId);
      expect(emp.status).toBe("resigned");
      expect(emp.endDate).toBe(NEW_END_DATE);
      expect(await countHistory(direct, empId)).toBe(1);
      expect(await countAudit(direct, empId)).toBe(1);

      // Audit append-only: ghi lệch vế là SAI VĨNH VIỄN ⇒ before PHẢI có giá trị cũ thật.
      const audit = await lastAudit(direct, empId);
      expect(audit.before).toMatchObject({ status: "active", endDate: SEEDED_END_DATE });
      expect(audit.after).toMatchObject({ status: "resigned", endDate: NEW_END_DATE });
    });

    it("(b2) ALLOW resigned → terminated: end_date bị GHI ĐÈ bằng ngày mới", async () => {
      const actor = await mkActor(direct, A, "b2-overwrite");
      const empId = await seedEmployee(direct, A.companyId, null, {
        status: "resigned",
        endDate: NEW_END_DATE,
      });
      const token = await login(app, A.slug, actor.email);

      const res = await api(app)
        .post(`/hr/employees/${empId}/change-status`)
        .set(bearer(token))
        .send({ newStatus: "terminated", endDate: OVERWRITE_END_DATE, lockUser: false });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const emp = await readEmployee(direct, empId);
      expect(emp.status).toBe("terminated");
      expect(emp.endDate).toBe(OVERWRITE_END_DATE);
    });

    it("(f) ALLOW khoá: đổi hồ sơ NGƯỜI KHÁC + lockUser ⇒ users.status='suspended' + locked_at NOT NULL", async () => {
      const actor = await mkActor(direct, A, "f-lock");
      const target = await mkActor(direct, A, "f-target", []); // người bị khoá, không cần quyền
      const empId = await seedEmployee(direct, A.companyId, target.userId, { status: "active" });
      const token = await login(app, A.slug, actor.email);

      const before = await readUser(direct, target.userId);
      expect(before.status).not.toBe("suspended");

      const res = await api(app)
        .post(`/hr/employees/${empId}/change-status`)
        .set(bearer(token))
        .send({ newStatus: "resigned", endDate: NEW_END_DATE, lockUser: true });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const after = await readUser(direct, target.userId);
      expect(after.status).toBe("suspended");
      expect(after.lockedAt).not.toBeNull();
    });

    it("(g) active → inactive: audit KHÔNG nói dối — after.endDate == before.endDate, cột end_date không đổi", async () => {
      const actor = await mkActor(direct, A, "g-noninvasive");
      const empId = await seedEmployee(direct, A.companyId, null, { status: "active" });
      const token = await login(app, A.slug, actor.email);

      const res = await api(app)
        .post(`/hr/employees/${empId}/change-status`)
        .set(bearer(token))
        .send({ newStatus: "inactive", reason: "tạm nghỉ", lockUser: false });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const emp = await readEmployee(direct, empId);
      expect(emp.status).toBe("inactive");
      expect(emp.endDate).toBe(SEEDED_END_DATE); // KHÔNG bị chạm

      // `after.endDate = dto.endDate ?? null` sẽ ghi null ở đây trong khi cột không đổi ⇒ audit nói dối.
      const audit = await lastAudit(direct, empId);
      expect(audit.after.endDate).toBe(SEEDED_END_DATE);
      expect(audit.after.endDate).toEqual(audit.before.endDate);
    });

    // ── DENY ────────────────────────────────────────────────────────────────────────────────────────

    it("(a) thiếu endDate khi → resigned ⇒ 400 ở BIÊN, 0 ghi (status·end_date·history·audit đều nguyên)", async () => {
      const actor = await mkActor(direct, A, "a-missing");
      const empId = await seedEmployee(direct, A.companyId, null, { status: "active" });
      const token = await login(app, A.slug, actor.email);

      const res = await api(app)
        .post(`/hr/employees/${empId}/change-status`)
        .set(bearer(token))
        .send({ newStatus: "resigned", reason: "quên ngày", lockUser: false });
      expect(res.status, JSON.stringify(res.body)).toBe(400);

      const emp = await readEmployee(direct, empId);
      expect(emp.status).toBe("active");
      expect(emp.endDate).toBe(SEEDED_END_DATE);
      expect(await countHistory(direct, empId)).toBe(0);
      expect(await countAudit(direct, empId)).toBe(0);
    });

    it("(a2) gửi endDate khi → inactive ⇒ 400 (không nhận rồi bỏ đi), 0 ghi", async () => {
      const actor = await mkActor(direct, A, "a2-extra");
      const empId = await seedEmployee(direct, A.companyId, null, { status: "active" });
      const token = await login(app, A.slug, actor.email);

      const res = await api(app)
        .post(`/hr/employees/${empId}/change-status`)
        .set(bearer(token))
        .send({ newStatus: "inactive", endDate: NEW_END_DATE, lockUser: false });
      expect(res.status, JSON.stringify(res.body)).toBe(400);

      const emp = await readEmployee(direct, empId);
      expect(emp.status).toBe("active");
      expect(emp.endDate).toBe(SEEDED_END_DATE);
      expect(await countHistory(direct, empId)).toBe(0);
      expect(await countAudit(direct, empId)).toBe(0);
    });

    it("(c) transition sai (terminated → active) ⇒ 422, end_date không đổi, 0 ghi", async () => {
      const actor = await mkActor(direct, A, "c-fsm");
      const empId = await seedEmployee(direct, A.companyId, null, { status: "terminated" });
      const token = await login(app, A.slug, actor.email);

      const res = await api(app)
        .post(`/hr/employees/${empId}/change-status`)
        .set(bearer(token))
        .send({ newStatus: "active", lockUser: false });
      expect(res.status, JSON.stringify(res.body)).toBe(422);

      const emp = await readEmployee(direct, empId);
      expect(emp.status).toBe("terminated");
      expect(emp.endDate).toBe(SEEDED_END_DATE);
      expect(await countHistory(direct, empId)).toBe(0);
      expect(await countAudit(direct, empId)).toBe(0);
    });

    it("(d) thiếu quyền change-status ⇒ 403, 0 audit, end_date không đổi", async () => {
      const actor = await mkActor(direct, A, "d-noperm", []); // KHÔNG grant gì
      const empId = await seedEmployee(direct, A.companyId, null, { status: "active" });
      const token = await login(app, A.slug, actor.email);

      const res = await api(app)
        .post(`/hr/employees/${empId}/change-status`)
        .set(bearer(token))
        .send({ newStatus: "resigned", endDate: NEW_END_DATE, lockUser: false });
      expect(res.status, JSON.stringify(res.body)).toBe(403);

      const emp = await readEmployee(direct, empId);
      expect(emp.status).toBe("active");
      expect(emp.endDate).toBe(SEEDED_END_DATE);
      expect(await countAudit(direct, empId)).toBe(0);
    });

    it("(e) 2-tenant: actor công ty A trên hồ sơ công ty B ⇒ 404, không rò tồn tại, 0 ghi", async () => {
      const actor = await mkActor(direct, A, "e-xtenant");
      const bEmpId = await seedEmployee(direct, B.companyId, null, { status: "active" });
      const token = await login(app, A.slug, actor.email);

      const res = await api(app)
        .post(`/hr/employees/${bEmpId}/change-status`)
        .set(bearer(token))
        .send({ newStatus: "resigned", endDate: NEW_END_DATE, lockUser: false });
      expect(res.status, JSON.stringify(res.body)).toBe(404);

      const emp = await readEmployee(direct, bEmpId);
      expect(emp.status).toBe("active");
      expect(emp.endDate).toBe(SEEDED_END_DATE);
      expect(await countHistory(direct, bEmpId)).toBe(0);
      expect(await countAudit(direct, bEmpId)).toBe(0);
    });

    it("(f2) DENY tự khoá: actor đổi CHÍNH hồ sơ mình + lockUser ⇒ tài khoản KHÔNG bị khoá", async () => {
      const actor = await mkActor(direct, A, "f2-self");
      const empId = await seedEmployee(direct, A.companyId, actor.userId, { status: "active" });
      const token = await login(app, A.slug, actor.email);

      // Ghim fixture: chặn ở hr-write.service.ts:510 là `row.userId && row.userId !== user.id`.
      // user_id NULL ⇒ ca vẫn xanh nhưng vì LÝ DO SAI. Xác nhận liên kết TRƯỚC khi assert.
      const linked = await readEmployee(direct, empId);
      expect(linked.userId, "fixture hỏng: hồ sơ phải liên kết CHÍNH actor").toBe(actor.userId);

      const res = await api(app)
        .post(`/hr/employees/${empId}/change-status`)
        .set(bearer(token))
        .send({ newStatus: "resigned", endDate: NEW_END_DATE, lockUser: true });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const after = await readUser(direct, actor.userId);
      expect(after.status).not.toBe("suspended");
      expect(after.lockedAt).toBeNull();
    });
  },
);
