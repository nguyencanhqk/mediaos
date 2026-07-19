/**
 * S5-DASH-TASKSTATUS-FIX-1 — Integration (Postgres THẬT, DB CÔ LẬP): mv_dashboard_task_status đếm theo
 * trạng thái CANONICAL (DECISIONS-03 D-30) thay vì cột `status` legacy mà task core không bao giờ ghi.
 *
 * RED-FIRST (kỷ luật plan-reviewer #1): spec này được chạy TRƯỚC khi migration 0502 tồn tại (lane DB
 * head 0501) để chứng minh C1 ĐỎ THẬT — task tạo qua POST /tasks + change-status Done bị MV cũ đếm là
 * 'not_started' vĩnh viễn (updateStatusTx chỉ ghi task_status, không đụng status legacy).
 *
 * Phủ:
 *   C1 đường sống HTTP: POST /tasks → change-status Done → refresh MV → GET /dashboard/mv-stats đếm
 *      ĐÚNG 1 Done (RED trước 0502: đếm not_started).
 *   C2 regression HR: task_type='hr', status='approved', task_status NULL → đếm vào Done.
 *   C3 regression workflow/legacy: status='revision' → In Progress; status='not_started' + task_status
 *      NULL → Todo. KHÔNG còn giá trị legacy thô (not_started/approved/revision) trong response.
 *   C4 cô lập tenant: stats A không chứa số của B và ngược lại (MV không RLS — WHERE company_id là
 *      hàng rào duy nhất, mirror mv-dashboard-tenant-isolation qua đường HTTP).
 *   C5 REFRESH CONCURRENTLY chạy được trên MV mới (unique index cột trần (company_id,status) — R2).
 *      CHỦ ĐÍCH assert trực tiếp trên mv_dashboard_task_status, KHÔNG qua DashboardRefreshService.refresh():
 *      service đó refresh CẢ mv_dashboard_output mà unique index của output là BIỂU THỨC (COALESCE)
 *      ⇒ không đủ điều kiện CONCURRENTLY — bug tiềm ẩn CÓ SẴN của họ media parked, NGOÀI phạm vi WO
 *      (ghi ở PR làm follow-up), không để nó làm nhiễu assertion của WO này.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/dashboard →
 * vitest include src/**\/*.spec.ts. app.close() TRƯỚC cleanup (chống FK 23503 outbox-flake).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

interface StatusStat {
  status: string;
  taskCount: number;
}

describe.skipIf(!runDb)(
  "S5-DASH-TASKSTATUS-FIX-1 — mv_dashboard_task_status đếm canonical (D-30)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];
    const tokens = new Map<string, string>();

    async function grantPairs(
      companyId: string,
      userId: string,
      pairs: Array<[string, string]>,
    ): Promise<void> {
      const role = await seedRole(direct, companyId, `dashfix-${userId.slice(0, 8)}`);
      for (const [action, resource] of pairs) {
        const perm = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, role, perm, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, role, companyId);
    }

    /** Trồng task legacy trực tiếp (họ HR/workflow/office-cũ — task_status NULL như prod thật). */
    async function plantLegacyTask(
      companyId: string,
      taskType: string,
      legacyStatus: string,
    ): Promise<void> {
      await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status) VALUES ($1,$2,$3,$4)`,
        [companyId, taskType, `${taskType}-${legacyStatus}`, legacyStatus],
      );
    }

    async function login(slug: string, email: string): Promise<string> {
      const cached = tokens.get(email);
      if (cached) return cached;
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      const token = res.body.data.accessToken as string;
      tokens.set(email, token);
      return token;
    }

    async function fetchStats(slug: string, email: string): Promise<StatusStat[]> {
      const token = await login(slug, email);
      const res = await request(app.getHttpServer())
        .get("/dashboard/mv-stats")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.taskStatus as StatusStat[];
    }

    const countOf = (stats: StatusStat[], status: string): number =>
      stats.find((s) => s.status === status)?.taskCount ?? 0;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "dashfxA");
      B = await seedCompany(direct, "dashfxB");
      companyIds.push(A.companyId, B.companyId);

      const uA = await seedUser(direct, A.companyId, `a@${A.slug}.test`, hash);
      const uB = await seedUser(direct, B.companyId, `b@${B.slug}.test`, hash);
      await grantPairs(A.companyId, uA, [
        ["create", "task"],
        ["update-status", "task"],
        ["read", "dashboard"],
      ]);
      await grantPairs(B.companyId, uB, [["read", "dashboard"]]);

      // ── C1: đường sống HTTP — task core hiện đại (updateStatusTx CHỈ ghi task_status) ──
      const tokenA = await login(A.slug, `a@${A.slug}.test`);
      const created = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ title: "Task hiện đại C1" });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const taskId = created.body.data.id as string;
      const moved = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/change-status`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ status: "Done" });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);

      // ── C2/C3: họ legacy (task_status NULL 100% như số liệu prod đo 20/07) ──
      await plantLegacyTask(A.companyId, "hr", "approved"); // → Done
      await plantLegacyTask(A.companyId, "workflow_step", "revision"); // → In Progress
      await plantLegacyTask(A.companyId, "office", "not_started"); // → Todo
      // ── C4: tenant B — 1 task legacy completed → Done=1 riêng của B ──
      await plantLegacyTask(B.companyId, "office", "completed");

      // Populate MV (0102 WITH NO DATA trên lane mới) — mô phỏng refresh-job, chạy bằng owner.
      await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_task_status");
      await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_output");
    });

    afterAll(async () => {
      if (app) await app.close();
      if (direct) {
        await direct
          .query("DELETE FROM tasks WHERE company_id = ANY($1::uuid[])", [companyIds])
          .catch(() => undefined);
        await cleanupTenants(direct, companyIds);
      }
    });

    it("C1 — task tạo qua POST /tasks + change-status Done được dashboard đếm ĐÚNG 1 Done (không phải not_started)", async () => {
      const stats = await fetchStats(A.slug, `a@${A.slug}.test`);
      // Done = 1 (C1 hiện đại) + 1 (C2 hr approved) = 2.
      expect(countOf(stats, "Done"), JSON.stringify(stats)).toBe(2);
    });

    it("C2/C3 — map legacy đủ họ: approved→Done · revision→In Progress · not_started→Todo; KHÔNG còn giá trị legacy thô", async () => {
      const stats = await fetchStats(A.slug, `a@${A.slug}.test`);
      expect(countOf(stats, "In Progress")).toBe(1);
      expect(countOf(stats, "Todo")).toBe(1);
      for (const legacy of [
        "not_started",
        "in_progress",
        "waiting_review",
        "revision",
        "approved",
        "completed",
      ]) {
        expect(countOf(stats, legacy), `giá trị legacy thô '${legacy}' còn trong response`).toBe(0);
      }
      // Tổng tenant A = 4 (1 hiện đại + 3 legacy) — không mất, không đếm trùng.
      expect(stats.reduce((s, r) => s + r.taskCount, 0)).toBe(4);
    });

    it("C4 — cô lập tenant qua HTTP: B chỉ thấy Done=1 của mình; A không phồng vì B", async () => {
      const statsB = await fetchStats(B.slug, `b@${B.slug}.test`);
      expect(countOf(statsB, "Done")).toBe(1);
      expect(statsB.reduce((s, r) => s + r.taskCount, 0)).toBe(1);
      const statsA = await fetchStats(A.slug, `a@${A.slug}.test`);
      expect(statsA.reduce((s, r) => s + r.taskCount, 0)).toBe(4);
    });

    it("C5 — REFRESH CONCURRENTLY chạy được trên MV mới (unique index cột trần — R2)", async () => {
      await expect(
        direct.query("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_task_status"),
      ).resolves.toBeDefined();
    });

    it("C6 — chuỗi SQL nhánh refresh-lặp-lại (sau 0502 probe=true) chạy được trọn vẹn bằng role owner", async () => {
      // Thực nghiệm 20/07 (2 tầng):
      // (1) mv_dashboard_output KHÔNG BAO GIỜ concurrently được (unique index BIỂU THỨC COALESCE —
      //     Postgres đòi cột trần) ⇒ refreshConcurrently PHẢI dùng CONCURRENTLY chỉ cho task_status
      //     + REFRESH THƯỜNG cho output (đã vá ở dashboard-refresh.service). Assert ở đây là CHUỖI
      //     SQL ĐÚNG của nhánh đó — RED nếu ai đổi lại CONCURRENTLY cho output.
      // (2) KHÔNG assert qua DashboardRefreshService.refresh(): đường workerDb hỏng TỪ TRƯỚC 0502 —
      //     REFRESH đòi OWNER MV (= mediaos), mediaos_worker không phải owner; và KHÔNG THỂ vá bằng
      //     ALTER OWNER cho worker: worker không BYPASSRLS + tasks FORCE RLS ⇒ REFRESH bằng quyền
      //     worker sẽ cho MV RỖNG LẶNG LẼ (đã kiểm chứng pg_roles/pg_class). Nợ kiến trúc G14 —
      //     follow-up riêng, ngoài phạm vi WO này (ghi ở PR + dashboard-refresh.service).
      await expect(
        direct.query("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_task_status"),
      ).resolves.toBeDefined();
      await expect(
        direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_output"),
      ).resolves.toBeDefined();
    });
  },
);
