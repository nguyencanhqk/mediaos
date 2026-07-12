/**
 * S4-INT-2 — DASH cache invalidation từ event TASK/NOTI/ATT/LEAVE (real Nest app, real DB).
 * Route: POST /internal/v1/dashboard/cache/invalidate (InternalDashboardCacheController →
 * DashboardCacheInvalidationService). Mẫu duyệt: noti-event-intake.int-spec.ts (S4-NOTI-BE-2).
 *
 * RED-first — deny-path đi đầu:
 *   (a) trust boundary: không Bearer → 401; JWT + thiếu/sai x-internal-key → 403; INTERNAL_API_KEY unset → 403.
 *   (b) eventCode ngoài registry (mã không có producer, vd TASK_CREATED/ATTENDANCE_CHECKED_IN) → 400
 *       DASH-ERR-UNKNOWN_INVALIDATION_EVENT, KHÔNG đụng cache nào.
 *   (c) body.company_id khác token → 400 DASH-ERR-COMPANY-MISMATCH.
 *   (d) happy-path mapping đúng §11.5 reconciled: TASK_ASSIGNED→MY_TASKS+TASK_ALERTS (KHÔNG đụng
 *       PROJECT_PROGRESS); TASK_STATUS_CHANGED→+PROJECT_PROGRESS; NOTIFICATION_CREATED/READ→NOTIFICATIONS.
 *   (e) userIds scoping: invalidate userIds=[u1] KHÔNG đụng cache riêng của u2 (ngoài phạm vi event) nhưng
 *       VẪN invalidate cache company-shared (user_id NULL, ảnh hưởng mọi viewer).
 *   (f) cross-tenant: company A invalidate KHÔNG đụng cache company B (company-scoped, RLS + WHERE tường minh).
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");
const INTERNAL_KEY = "test-internal-key-int-2";
const PASSWORD = "Passw0rd!test99";
const runDb = hasDb && Boolean(process.env.LANE_DB);

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

function auth(token: string, key = INTERNAL_KEY) {
  return { Authorization: `Bearer ${token}`, "x-internal-key": key };
}

describe.skipIf(!runDb)(
  "S4-INT-2 dashboard cache invalidate (HTTP trust-boundary + mapping)",
  () => {
    const direct = directPool();
    let nest: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];
    let actorEmail = "";

    /** widget_id GLOBAL (company_id IS NULL) theo widget_code — seed bởi migration 0484/0493, KHÔNG per-company. */
    async function widgetId(code: string): Promise<string> {
      const r = await direct.query(
        `SELECT id FROM dashboard_widgets WHERE widget_code=$1 AND company_id IS NULL AND deleted_at IS NULL`,
        [code],
      );
      if (r.rows.length === 0)
        throw new Error(`widget catalog thiếu ${code} — migration chưa chạy?`);
      return r.rows[0].id as string;
    }

    /** Seed 1 cache row ACTIVE (deleted_at IS NULL) — userId null ⇒ company-shared ('co'). */
    async function seedCache(
      companyId: string,
      wId: string,
      opts: { userId?: string | null; keySuffix?: string } = {},
    ): Promise<string> {
      const key = `Employee:seed:${opts.keySuffix ?? randomUUID().slice(0, 8)}`;
      const r = await direct.query(
        `INSERT INTO dashboard_widget_cache
         (company_id, widget_id, dashboard_type, user_id, cache_scope, cache_key, data, status,
          generated_at, expires_at)
       VALUES ($1, $2, 'Employee', $3, $4, $5, '{}'::jsonb, 'Fresh', now(), now() + interval '5 minutes')
       RETURNING id`,
        [companyId, wId, opts.userId ?? null, opts.userId ? "Own" : "Company", key],
      );
      return r.rows[0].id as string;
    }

    async function isActive(cacheId: string): Promise<boolean> {
      const r = await direct.query(`SELECT deleted_at FROM dashboard_widget_cache WHERE id=$1`, [
        cacheId,
      ]);
      return r.rows[0].deleted_at === null;
    }

    beforeAll(async () => {
      process.env.INTERNAL_API_KEY = INTERNAL_KEY;
      const hash = await hashedPw();
      A = await seedCompany(direct, "int2a");
      B = await seedCompany(direct, "int2b");
      companyIds.push(A.companyId, B.companyId);

      actorEmail = `actor@${A.slug}.test`;
      await seedUser(direct, A.companyId, actorEmail, hash);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      for (const companyId of companyIds) {
        await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = $1", [companyId]);
      }
      await cleanupTenants(direct, companyIds);
      await direct.end();
      if (nest) await nest.close();
      delete process.env.INTERNAL_API_KEY;
    });

    // ── (a) trust boundary — fail-closed ────────────────────────────────────────────
    it("(a) không Bearer → 401", async () => {
      const res = await api(nest)
        .post("/internal/v1/dashboard/cache/invalidate")
        .set("x-internal-key", INTERNAL_KEY)
        .send({ eventCode: "TASK_ASSIGNED" });
      expect(res.status).toBe(401);
    });

    it("(a) JWT hợp lệ + thiếu x-internal-key → 403", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const res = await api(nest)
        .post("/internal/v1/dashboard/cache/invalidate")
        .set("Authorization", `Bearer ${token}`)
        .send({ eventCode: "TASK_ASSIGNED" });
      expect(res.status).toBe(403);
    });

    it("(a) JWT hợp lệ + sai x-internal-key → 403", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const res = await api(nest)
        .post("/internal/v1/dashboard/cache/invalidate")
        .set(auth(token, "wrong-key"))
        .send({ eventCode: "TASK_ASSIGNED" });
      expect(res.status).toBe(403);
    });

    it("(a) INTERNAL_API_KEY unset → 403 (fail-closed)", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const saved = process.env.INTERNAL_API_KEY;
      delete process.env.INTERNAL_API_KEY;
      try {
        const res = await api(nest)
          .post("/internal/v1/dashboard/cache/invalidate")
          .set(auth(token, saved ?? INTERNAL_KEY))
          .send({ eventCode: "TASK_ASSIGNED" });
        expect(res.status).toBe(403);
      } finally {
        process.env.INTERNAL_API_KEY = saved;
      }
    });

    // ── (b) eventCode ngoài registry (mã không có producer thật) ───────────────────
    it.each(["TASK_CREATED", "ATTENDANCE_CHECKED_IN", "EMPLOYEE_CREATED", "NOTI_TEST_UNKNOWN"])(
      "(b) eventCode=%s ngoài registry → 400 DASH-ERR-UNKNOWN_INVALIDATION_EVENT",
      async (eventCode) => {
        const token = await login(nest, A.slug, actorEmail);
        const res = await api(nest)
          .post("/internal/v1/dashboard/cache/invalidate")
          .set(auth(token))
          .send({ eventCode });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(res.body.error.code).toBe("DASH-ERR-UNKNOWN_INVALIDATION_EVENT");
      },
    );

    // ── (c) company_id spoof qua body ───────────────────────────────────────────────
    it("(c) body.company_id = B, token = A → 400 DASH-ERR-COMPANY-MISMATCH", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const res = await api(nest)
        .post("/internal/v1/dashboard/cache/invalidate")
        .set(auth(token))
        .send({ eventCode: "TASK_ASSIGNED", company_id: B.companyId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("DASH-ERR-COMPANY-MISMATCH");
    });

    // ── (d) happy-path mapping đúng §11.5 reconciled ────────────────────────────────
    it("(d) TASK_ASSIGNED → invalidate MY_TASKS + TASK_ALERTS, KHÔNG đụng PROJECT_PROGRESS", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const myTasksId = await widgetId("MY_TASKS");
      const taskAlertsId = await widgetId("TASK_ALERTS");
      const projectProgressId = await widgetId("PROJECT_PROGRESS");
      const cMyTasks = await seedCache(A.companyId, myTasksId);
      const cAlerts = await seedCache(A.companyId, taskAlertsId);
      const cProject = await seedCache(A.companyId, projectProgressId);

      const res = await api(nest)
        .post("/internal/v1/dashboard/cache/invalidate")
        .set(auth(token))
        .send({ eventCode: "TASK_ASSIGNED" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.invalidatedWidgets.sort()).toEqual(["MY_TASKS", "TASK_ALERTS"].sort());

      expect(await isActive(cMyTasks)).toBe(false);
      expect(await isActive(cAlerts)).toBe(false);
      expect(await isActive(cProject)).toBe(true); // ngoài phạm vi event — KHÔNG đụng
    });

    it("(d) TASK_STATUS_CHANGED → invalidate MY_TASKS + TASK_ALERTS + PROJECT_PROGRESS", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const projectProgressId = await widgetId("PROJECT_PROGRESS");
      const cProject = await seedCache(A.companyId, projectProgressId);

      const res = await api(nest)
        .post("/internal/v1/dashboard/cache/invalidate")
        .set(auth(token))
        .send({ eventCode: "TASK_STATUS_CHANGED" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.invalidatedWidgets.sort()).toEqual(
        ["MY_TASKS", "TASK_ALERTS", "PROJECT_PROGRESS"].sort(),
      );
      expect(await isActive(cProject)).toBe(false);
    });

    it.each(["TASK_DUE_DATE_CHANGED", "TASK_OVERDUE"])(
      "(d) %s → invalidate TASK_ALERTS",
      async (eventCode) => {
        const token = await login(nest, A.slug, actorEmail);
        const taskAlertsId = await widgetId("TASK_ALERTS");
        const cAlerts = await seedCache(A.companyId, taskAlertsId);

        const res = await api(nest)
          .post("/internal/v1/dashboard/cache/invalidate")
          .set(auth(token))
          .send({ eventCode });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.invalidatedWidgets).toContain("TASK_ALERTS");
        expect(await isActive(cAlerts)).toBe(false);
      },
    );

    it.each(["NOTIFICATION_CREATED", "NOTIFICATION_READ"])(
      "(d) %s → invalidate NOTIFICATIONS",
      async (eventCode) => {
        const token = await login(nest, A.slug, actorEmail);
        const notiId = await widgetId("NOTIFICATIONS");
        const cNoti = await seedCache(A.companyId, notiId);

        const res = await api(nest)
          .post("/internal/v1/dashboard/cache/invalidate")
          .set(auth(token))
          .send({ eventCode });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.invalidatedWidgets).toEqual(["NOTIFICATIONS"]);
        expect(await isActive(cNoti)).toBe(false);
      },
    );

    it("(d) LEAVE_REQUEST_APPROVED → invalidate PENDING_LEAVE + LEAVE_CALENDAR + LEAVE_BALANCE + ATTENDANCE_TODAY", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const res = await api(nest)
        .post("/internal/v1/dashboard/cache/invalidate")
        .set(auth(token))
        .send({ eventCode: "LEAVE_REQUEST_APPROVED" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.invalidatedWidgets.sort()).toEqual(
        ["PENDING_LEAVE", "LEAVE_CALENDAR", "LEAVE_BALANCE", "ATTENDANCE_TODAY"].sort(),
      );
    });

    // ── (e) userIds scoping — KHÔNG đụng cache user khác ngoài phạm vi event ───────
    it("(e) userIds=[u1]: invalidate cache riêng của u1 + cache company-shared, KHÔNG đụng cache riêng của u2", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const u1 = await seedUser(
        direct,
        A.companyId,
        `u1-${randomUUID().slice(0, 6)}@${A.slug}.test`,
      );
      const u2 = await seedUser(
        direct,
        A.companyId,
        `u2-${randomUUID().slice(0, 6)}@${A.slug}.test`,
      );
      const myTasksId = await widgetId("MY_TASKS");
      const cU1 = await seedCache(A.companyId, myTasksId, { userId: u1, keySuffix: `u1-${u1}` });
      const cU2 = await seedCache(A.companyId, myTasksId, { userId: u2, keySuffix: `u2-${u2}` });
      const cShared = await seedCache(A.companyId, myTasksId, {
        userId: null,
        keySuffix: "shared",
      });

      const res = await api(nest)
        .post("/internal/v1/dashboard/cache/invalidate")
        .set(auth(token))
        .send({ eventCode: "TASK_ASSIGNED", userIds: [u1] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(await isActive(cU1)).toBe(false);
      expect(await isActive(cShared)).toBe(false);
      expect(await isActive(cU2)).toBe(true); // ngoài phạm vi event — KHÔNG đụng
    });

    // ── (f) cross-tenant — company-scoped ───────────────────────────────────────────
    it("(f) company A invalidate KHÔNG đụng cache company B", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const myTasksId = await widgetId("MY_TASKS");
      const cB = await seedCache(B.companyId, myTasksId, { keySuffix: "cross-tenant-b" });

      const res = await api(nest)
        .post("/internal/v1/dashboard/cache/invalidate")
        .set(auth(token))
        .send({ eventCode: "TASK_ASSIGNED" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(await isActive(cB)).toBe(true);
    });
  },
);
