/**
 * S5-GOAL-BE-2 — check-in · chốt kỳ · mở lại: DENY-PATH + sổ append-only (SPEC-10 §12/§13.4/§15).
 *
 * Phủ: GOAL-ERR-006 (status ≠ Active · ngoài data-scope · gửi 2 giá trị) · GOAL-ERR-014 (finalize sai
 * trạng thái) · 403 khi THIẾU cặp ('finalize','goal') dù có mọi cặp khác · nội dung 1 hàng `goal_updates`
 * (old/new + confidence + note) · **PROBE THẬT**: app role UPDATE/DELETE `goal_updates` phải bị Postgres
 * TỪ CHỐI (append-only ở tầng GRANT, không phải quy ước tầng service) · audit_logs cho finalize/reopen.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd", "goalbe2checkin"].join("!");

function todayShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const PERIOD = {
  periodType: "quarter" as const,
  periodStart: todayShift(-30),
  periodEnd: todayShift(60),
};

describe.skipIf(!hasLaneDb)("S5-GOAL-BE-2 check-in/finalize (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let ouA = "";
  let ouB = "";
  let adminEmp = "";
  let staffEmp = "";
  let otherDeptEmp = "";
  let token = "";
  /** Trưởng phòng A: đủ cặp GOAL @Department NHƯNG **KHÔNG** có ('finalize','goal'). */
  let headToken = "";

  const auth = (m: "get" | "post" | "patch" | "delete", u: string, t = token) =>
    request(app.getHttpServer())[m](u).set("Authorization", `Bearer ${t}`);

  const createGoal = async (body: Record<string, unknown>): Promise<string> => {
    const res = await auth("post", "/goals").send({ ...PERIOD, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "goalbe2c");
    companyIds.push(A.companyId);
    await direct.query(
      `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          reset_policy, increment_by, current_value, status)
       VALUES ($1,'GOAL','goal','Company','GOAL-',4,'Never',1,0,'Active')
       ON CONFLICT DO NOTHING`,
      [A.companyId],
    );

    const mkOu = async (name: string) => {
      const r = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [A.companyId, name],
      );
      return r.rows[0].id as string;
    };
    ouA = await mkOu("Phòng A");
    ouB = await mkOu("Phòng B");

    const mkEmp = async (email: string, orgUnitId: string) => {
      const userId = await seedUser(direct, A.companyId, email, hash);
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1,$2,$3,'active') RETURNING id`,
        [A.companyId, userId, orgUnitId],
      );
      return { userId, empId: r.rows[0].id as string };
    };
    const admin = await mkEmp(`admin@${A.slug}.test`, ouA);
    adminEmp = admin.empId;
    const staff = await mkEmp(`staff@${A.slug}.test`, ouA);
    staffEmp = staff.empId;
    const other = await mkEmp(`other@${A.slug}.test`, ouB);
    otherDeptEmp = other.empId;

    // Role 1 — admin @Company, ĐỦ 7 cặp GOAL.
    const adminRole = await seedRole(direct, A.companyId, "goal-be2-c-admin");
    for (const action of [
      "access",
      "view",
      "create",
      "update",
      "delete",
      "checkin",
      "finalize",
    ] as const) {
      const permId = await seedPermissionCatalog(direct, action, "goal", false);
      await seedRolePermission(direct, adminRole, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, admin.userId, adminRole, A.companyId);

    // Role 2 — trưởng phòng B @Department: có checkin/view/update NHƯNG THIẾU finalize.
    const headRole = await seedRole(direct, A.companyId, "goal-be2-c-head");
    for (const action of ["access", "view", "create", "update", "checkin"] as const) {
      const permId = await seedPermissionCatalog(direct, action, "goal", false);
      await seedRolePermission(direct, headRole, permId, "ALLOW", "Department");
    }
    await seedUserRole(direct, other.userId, headRole, A.companyId);
    await direct.query("UPDATE org_units SET head_user_id = $1 WHERE id = $2", [other.userId, ouB]);

    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.accessToken as string;
    };
    token = await login(`admin@${A.slug}.test`);
    headToken = await login(`other@${A.slug}.test`);
    expect(adminEmp && staffEmp && otherDeptEmp).toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    await direct.query("DELETE FROM goal_updates WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── C1. GOAL-ERR-006 — điều kiện check-in ─────────────────────────────────────
  describe("C1. GOAL-ERR-006 (check-in)", () => {
    it("status Draft / Completed / Cancelled ⇒ 422 GOAL-ERR-006", async () => {
      for (const status of ["Draft", "Completed", "Cancelled"] as const) {
        const g = await createGoal({
          name: `Check-in ${status}`,
          level: "department",
          departmentId: ouA,
          status,
          progressMode: "manual",
          measureType: "percent",
        });
        const res = await auth("post", `/goals/${g}/check-in`).send({ progressPercent: 10 });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(JSON.stringify(res.body)).toContain("GOAL-ERR-006");
      }
    });

    it("gửi CẢ currentValue lẫn progressPercent ⇒ 422 (không đoán hộ người dùng)", async () => {
      const g = await createGoal({
        name: "Check-in mập mờ",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
      });
      const res = await auth("post", `/goals/${g}/check-in`).send({
        currentValue: 5,
        progressPercent: 50,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-006");
    });

    it("actor NGOÀI data-scope (mục tiêu phòng khác) ⇒ 403, và DB không có hàng sổ nào", async () => {
      const g = await createGoal({
        name: "Mục tiêu phòng A",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
      });
      const res = await auth("post", `/goals/${g}/check-in`, headToken).send({
        progressPercent: 99,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      const rows = await direct.query("SELECT 1 FROM goal_updates WHERE goal_id = $1", [g]);
      expect(rows.rowCount).toBe(0);
    });

    it("Active + trong scope ⇒ 201 và ghi ĐÚNG 1 hàng sổ với old/new + confidence + note", async () => {
      const g = await createGoal({
        name: "Check-in hợp lệ",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
      });
      const first = await auth("post", `/goals/${g}/check-in`).send({
        progressPercent: 20,
        confidence: 70,
        note: "Đang bám tiến độ",
      });
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const second = await auth("post", `/goals/${g}/check-in`).send({
        progressPercent: 35,
        confidence: 80,
        note: "Tăng tốc",
      });
      expect(second.status, JSON.stringify(second.body)).toBe(201);

      const rows = await direct.query(
        `SELECT update_type, old_current_value, new_current_value,
                old_progress_percent, new_progress_percent, confidence, note
           FROM goal_updates WHERE goal_id = $1 ORDER BY created_at`,
        [g],
      );
      expect(rows.rowCount).toBe(2);
      expect(rows.rows[0].update_type).toBe("checkin");
      expect(rows.rows[0].old_progress_percent).toBeNull();
      expect(Number(rows.rows[0].new_progress_percent)).toBe(20);
      expect(rows.rows[0].confidence).toBe(70);
      expect(rows.rows[0].note).toBe("Đang bám tiến độ");
      expect(Number(rows.rows[1].old_progress_percent)).toBe(20);
      expect(Number(rows.rows[1].new_progress_percent)).toBe(35);

      // GOAL-API-008 — sổ đọc được qua API, mới nhất trước.
      const list = await auth("get", `/goals/${g}/updates?limit=10`);
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect(list.body.data).toHaveLength(2);
      expect(list.body.data[0].newProgressPercent).toBe(35);
    });
  });

  // ── C2. Append-only ở TẦNG GRANT (không phải quy ước service) ──────────────────
  describe("C2. goal_updates append-only (probe DB thật bằng APP ROLE)", () => {
    it("app role: INSERT/SELECT được, UPDATE và DELETE bị Postgres TỪ CHỐI", async () => {
      const g = await createGoal({
        name: "Sổ append-only",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
      });
      await auth("post", `/goals/${g}/check-in`).send({ progressPercent: 11 });
      const row = await direct.query("SELECT id FROM goal_updates WHERE goal_id = $1 LIMIT 1", [g]);
      expect(row.rowCount).toBe(1);
      const updateId = row.rows[0].id as string;

      // Kết nối bằng ĐÚNG app role (DATABASE_URL) — direct pool là superuser nên KHÔNG chứng minh được gì.
      const appPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      try {
        const client = await appPool.connect();
        try {
          await client.query("SELECT set_config('app.current_company_id', $1, false)", [
            A.companyId,
          ]);
          const readable = await client.query("SELECT id FROM goal_updates WHERE id = $1", [
            updateId,
          ]);
          expect(readable.rowCount).toBe(1);

          await expect(
            client.query("UPDATE goal_updates SET note = 'sửa trộm' WHERE id = $1", [updateId]),
          ).rejects.toThrow(/permission denied/i);
          await expect(
            client.query("DELETE FROM goal_updates WHERE id = $1", [updateId]),
          ).rejects.toThrow(/permission denied/i);
        } finally {
          client.release();
        }
      } finally {
        await appPool.end();
      }

      // Hàng vẫn nguyên vẹn sau 2 lần thử ghi đè.
      const after = await direct.query("SELECT note FROM goal_updates WHERE id = $1", [updateId]);
      expect(after.rows[0].note).not.toBe("sửa trộm");
    });
  });

  // ── C3. Chốt kỳ / mở lại (GOAL-ERR-014 · GOAL-ERR-005 · cặp finalize) ──────────
  describe("C3. finalize / reopen", () => {
    const mkActiveGoal = (name: string, status = "Active") =>
      createGoal({
        name,
        level: "department",
        departmentId: ouA,
        status,
        progressMode: "manual",
        measureType: "percent",
      });

    it("status Draft / Cancelled ⇒ 422 GOAL-ERR-014", async () => {
      for (const status of ["Draft", "Cancelled"] as const) {
        const g = await mkActiveGoal(`Chốt ${status}`, status);
        const res = await auth("post", `/goals/${g}/finalize`).send({});
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(JSON.stringify(res.body)).toContain("GOAL-ERR-014");
      }
    });

    it("THIẾU cặp ('finalize','goal') ⇒ 403 dù có đủ view/update/checkin", async () => {
      const g = await createGoal({
        name: "Mục tiêu phòng B",
        level: "department",
        departmentId: ouB,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
      });
      // Chứng minh actor THỰC SỰ ghi được mục tiêu này bằng cặp khác (403 dưới KHÔNG do sai scope).
      const ok = await auth("post", `/goals/${g}/check-in`, headToken).send({ progressPercent: 5 });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);

      for (const route of ["finalize", "reopen"] as const) {
        const res = await auth("post", `/goals/${g}/${route}`, headToken).send({});
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      }
      const rows = await direct.query("SELECT finalized_at FROM goals WHERE id = $1", [g]);
      expect(rows.rows[0].finalized_at).toBeNull();
    });

    it("reopen mục tiêu CHƯA chốt ⇒ 422 (không có gì để mở lại)", async () => {
      const g = await mkActiveGoal("Chưa chốt mà đòi mở");
      const res = await auth("post", `/goals/${g}/reopen`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-005");
    });

    it("finalize ⇒ ledger 'finalize' + audit_logs; reopen ⇒ ledger 'reopen' + audit_logs", async () => {
      const g = await mkActiveGoal("Chốt rồi mở");
      await auth("post", `/goals/${g}/check-in`).send({ progressPercent: 88 });

      const fin = await auth("post", `/goals/${g}/finalize`).send({ note: "Chốt quý" });
      expect(fin.status, JSON.stringify(fin.body)).toBe(201);
      expect(fin.body.data.finalizedAt).not.toBeNull();

      // Chốt lần hai ⇒ 422 GOAL-ERR-005 (khoá chống đua ở writer).
      const twice = await auth("post", `/goals/${g}/finalize`).send({});
      expect(twice.status).toBe(422);
      expect(JSON.stringify(twice.body)).toContain("GOAL-ERR-005");

      const re = await auth("post", `/goals/${g}/reopen`).send({ note: "Mở lại vì sót số" });
      expect(re.status, JSON.stringify(re.body)).toBe(201);
      expect(re.body.data.finalizedAt).toBeNull();

      const ledger = await direct.query(
        "SELECT update_type, note FROM goal_updates WHERE goal_id = $1 ORDER BY created_at",
        [g],
      );
      expect(ledger.rows.map((r) => r.update_type)).toEqual(["checkin", "finalize", "reopen"]);
      expect(ledger.rows[1].note).toBe("Chốt quý");

      const audits = await direct.query(
        `SELECT action FROM audit_logs
          WHERE company_id = $1 AND object_type = 'goal' AND object_id = $2
          ORDER BY created_at`,
        [A.companyId, g],
      );
      const actions = audits.rows.map((r) => r.action as string);
      expect(actions).toContain("GoalFinalized");
      expect(actions).toContain("GoalReopened");
    });
  });
});
