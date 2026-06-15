import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
// 🔴 RED: G8-4 GREEN phải tạo Service/Repo kpi. Import này khiến CẢ suite ĐỎ (module-not-found)
//    ĐÚNG LÝ DO trước implement.
import { KpiService } from "../../src/kpi/kpi.service";
import { KpiRepository } from "../../src/kpi/kpi.repository";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
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

/**
 * G8-4 — DENY-PATH (RED-first). kpi_results = SNAPSHOT APPEND-ONLY (bất biến #2); config nhạy cảm
 * (permission). BR-007: ban đầu = THAM KHẢO (confirmed_* NULL). 5 chốt fail-closed GREEN phải thoả:
 *
 *  (a) RLS 2-tenant — login A KHÔNG đọc kpi_definitions/kpi_results của B (0 row).
 *  (b) Append-only  — app role KHÔNG UPDATE/DELETE kpi_results (GRANT SELECT,INSERT only).
 *  (c) WITH CHECK   — INSERT kpi_results company_id ≠ app.current_company_id bị chặn.
 *  (d) Permission   — computeKpi thiếu manage:kpi-definition/read:kpi → Forbidden, KHÔNG ghi;
 *                     confirm thiếu confirm:kpi → Forbidden.
 *  (e) Audit        — computeKpi ghi audit_logs object_type='kpi_result' cùng tx; confirm ghi đúng company_id.
 *
 * Postgres THẬT (CI; local cần lane DB mediaos_g8kpi). KHÔNG mock RLS.
 */
describe.skipIf(!hasDb)(
  "G8-4 kpi deny-path (RLS 2-tenant + append-only + WITH CHECK + permission + audit)",
  () => {
    const direct = directPool();
    const app = appPool(2);
    let A: SeededTenant;
    let B: SeededTenant;
    let userA: string;
    /** user A có quyền read:kpi (compute) + confirm:kpi. */
    let analystA: string;
    let confirmerA: string;
    let svc: KpiService;

    const validWeights = {
      tasksDone: 20,
      onTimeRate: 20,
      evaluationScore: 20,
      defectScore: 20,
      firstPassApprovalRate: 20,
    };

    /** Seed 1 kpi_definition (weights tổng=100) cho tenant t. Trả definitionId. */
    async function seedDefinition(t: SeededTenant): Promise<string> {
      const r = await direct.query(
        `INSERT INTO kpi_definitions (company_id, name, weights)
         VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [t.companyId, `kpi-def-${randomUUID().slice(0, 8)}`, JSON.stringify(validWeights)],
      );
      return r.rows[0].id as string;
    }

    async function seedSubjectUser(t: SeededTenant): Promise<string> {
      return seedUser(direct, t.companyId, `kpi-subj-${randomUUID().slice(0, 8)}@x.test`);
    }

    async function countResults(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM kpi_results WHERE company_id = $1`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

    async function countResultAudit(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
         WHERE company_id = $1 AND object_type = 'kpi_result'`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

    const period = {
      periodStart: "2026-05-01T00:00:00.000Z",
      periodEnd: "2026-06-01T00:00:00.000Z",
    };

    /** Chạy 1 câu lệnh qua APP role trong ngữ cảnh tenant (set_config local). */
    async function asApp<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
        const out = await fn(c);
        await c.query("ROLLBACK");
        return out;
      } catch (e) {
        try {
          await c.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        c.release();
      }
    }

    beforeAll(async () => {
      A = await seedCompany(direct, "kpiA");
      B = await seedCompany(direct, "kpiB");
      userA = await seedUser(direct, A.companyId, `kpi-a-${randomUUID().slice(0, 8)}@a.test`);

      // analystA: role tenant của A gắn read:kpi (compute).
      const readPermId = await seedPermissionCatalog(direct, "read", "kpi", false);
      const analystRole = await seedRole(direct, A.companyId, `kpi-analyst-${randomUUID().slice(0, 8)}`);
      await seedRolePermission(direct, analystRole, readPermId, "ALLOW");
      analystA = await seedUser(direct, A.companyId, `kpi-analyst-${randomUUID().slice(0, 8)}@a.test`);
      await seedUserRole(direct, analystA, analystRole, A.companyId);

      // confirmerA: role tenant của A gắn confirm:kpi.
      const confirmPermId = await seedPermissionCatalog(direct, "confirm", "kpi", false);
      const confirmRole = await seedRole(direct, A.companyId, `kpi-confirmer-${randomUUID().slice(0, 8)}`);
      await seedRolePermission(direct, confirmRole, confirmPermId, "ALLOW");
      // confirmer cũng cần read:kpi để compute trước khi confirm trong test (gắn cả 2).
      await seedRolePermission(direct, confirmRole, readPermId, "ALLOW");
      confirmerA = await seedUser(direct, A.companyId, `kpi-confirmer-${randomUUID().slice(0, 8)}@a.test`);
      await seedUserRole(direct, confirmerA, confirmRole, A.companyId);

      const db = new DatabaseService();
      const audit = new AuditService();
      const outbox = new OutboxService();
      const permission = new PermissionService(new PermissionRepository(db));
      svc = new KpiService(db, new KpiRepository(db), permission, audit, outbox);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    // ── (a) RLS 2-tenant ─────────────────────────────────────────────────────────
    describe("(a) RLS 2-tenant isolation", () => {
      it("listDefinitions(A) thấy def A, KHÔNG thấy def B", async () => {
        const dA = await seedDefinition(A);
        const dB = await seedDefinition(B);
        const rows = await svc.listDefinitions(A.companyId, analystA, {});
        const ids = new Set(rows.map((r) => r.id));
        expect(ids.has(dA)).toBe(true);
        expect(ids.has(dB)).toBe(false);
      });

      it("APP role khác ngữ cảnh → KHÔNG SELECT được kpi_results tenant khác (0 row)", async () => {
        const dB = await seedDefinition(B);
        const subjB = await seedSubjectUser(B);
        const res = await direct.query(
          `INSERT INTO kpi_results
             (company_id, definition_id, subject_user_id, period_start, period_end,
              tasks_done, on_time_rate, evaluation_score, defect_score, first_pass_approval_rate,
              total_score, computed_by)
           VALUES ($1, $2, $3, $4, $5, 100, 100, 80, 100, 75, 91, $3) RETURNING id`,
          [B.companyId, dB, subjB, period.periodStart, period.periodEnd],
        );
        const seen = await asApp(A.companyId, async (c) => {
          const r = await c.query(`SELECT id FROM kpi_results WHERE id = $1`, [res.rows[0].id]);
          return r.rowCount ?? 0;
        });
        expect(seen).toBe(0);
      });
    });

    // ── (b) Append-only — kpi_results no UPDATE/DELETE for app role ──────────────
    describe("(b) append-only (no UPDATE/DELETE for app role)", () => {
      it("app role KHÔNG có quyền UPDATE kpi_results", async () => {
        const d = await seedDefinition(A);
        const subj = await seedSubjectUser(A);
        const res = await direct.query(
          `INSERT INTO kpi_results
             (company_id, definition_id, subject_user_id, period_start, period_end,
              tasks_done, on_time_rate, evaluation_score, defect_score, first_pass_approval_rate,
              total_score, computed_by)
           VALUES ($1, $2, $3, $4, $5, 100, 100, 80, 100, 75, 91, $3) RETURNING id`,
          [A.companyId, d, subj, period.periodStart, period.periodEnd],
        );
        await expect(
          asApp(A.companyId, (c) =>
            c.query(`UPDATE kpi_results SET total_score = 0 WHERE id = $1`, [res.rows[0].id]),
          ),
        ).rejects.toThrow(/permission denied|must be owner/i);
      });

      it("app role KHÔNG có quyền DELETE kpi_results", async () => {
        const d = await seedDefinition(A);
        const subj = await seedSubjectUser(A);
        const res = await direct.query(
          `INSERT INTO kpi_results
             (company_id, definition_id, subject_user_id, period_start, period_end,
              tasks_done, on_time_rate, evaluation_score, defect_score, first_pass_approval_rate,
              total_score, computed_by)
           VALUES ($1, $2, $3, $4, $5, 100, 100, 80, 100, 75, 91, $3) RETURNING id`,
          [A.companyId, d, subj, period.periodStart, period.periodEnd],
        );
        await expect(
          asApp(A.companyId, (c) =>
            c.query(`DELETE FROM kpi_results WHERE id = $1`, [res.rows[0].id]),
          ),
        ).rejects.toThrow(/permission denied|must be owner/i);
      });

      it("KpiService KHÔNG có update()/delete() trên kết quả KPI", () => {
        const s = svc as unknown as Record<string, unknown>;
        expect(s.updateResult).toBeUndefined();
        expect(s.deleteResult).toBeUndefined();
      });
    });

    // ── (c) WITH CHECK — INSERT company_id sai tenant bị chặn ───────────────────
    describe("(c) WITH CHECK blocks cross-tenant insert", () => {
      it("INSERT kpi_results company_id ≠ ngữ cảnh → RLS WITH CHECK chặn", async () => {
        const dB = await seedDefinition(B);
        const subjB = await seedSubjectUser(B);
        // Ngữ cảnh A nhưng ép company_id = B → WITH CHECK violation.
        await expect(
          asApp(A.companyId, (c) =>
            c.query(
              `INSERT INTO kpi_results
                 (company_id, definition_id, subject_user_id, period_start, period_end,
                  tasks_done, on_time_rate, evaluation_score, defect_score, first_pass_approval_rate,
                  total_score, computed_by)
               VALUES ($1, $2, $3, $4, $5, 100, 100, 80, 100, 75, 91, $3)`,
              [B.companyId, dB, subjB, period.periodStart, period.periodEnd],
            ),
          ),
        ).rejects.toThrow(/row-level security|violates row-level security policy/i);
      });
    });

    // ── (d) Permission deny — compute/confirm thiếu quyền → 403 fail-closed ──────
    describe("(d) permission deny (fail-closed)", () => {
      it("computeKpi KHÔNG có quyền read:kpi → ForbiddenException, KHÔNG ghi", async () => {
        const d = await seedDefinition(A);
        const subj = await seedSubjectUser(A);
        const before = await countResults(A.companyId);
        await expect(
          svc.computeKpi(A.companyId, userA, {
            definitionId: d,
            subjectUserId: subj,
            ...period,
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        const after = await countResults(A.companyId);
        expect(after).toBe(before);
      });

      it("confirmResult KHÔNG có quyền confirm:kpi → ForbiddenException", async () => {
        const d = await seedDefinition(A);
        const subj = await seedSubjectUser(A);
        const computed = await svc.computeKpi(A.companyId, analystA, {
          definitionId: d,
          subjectUserId: subj,
          ...period,
        });
        await expect(
          svc.confirmResult(A.companyId, analystA, { kpiResultId: computed.id }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });

    // ── (e) Audit + BR-007 — compute/confirm ghi audit; confirmed_* mặc định NULL ──
    describe("(e) audit + BR-007 (compute ghi audit; confirm = snapshot mới)", () => {
      it("computeKpi ghi audit_logs object_type='kpi_result' + confirmed_* NULL (THAM KHẢO)", async () => {
        const d = await seedDefinition(A);
        const subj = await seedSubjectUser(A);
        const beforeAudit = await countResultAudit(A.companyId);

        const result = await svc.computeKpi(A.companyId, analystA, {
          definitionId: d,
          subjectUserId: subj,
          ...period,
        });

        // BR-007: ban đầu = THAM KHẢO → confirmed_* NULL.
        expect(result.confirmedBy).toBeNull();
        expect(result.confirmedAt).toBeNull();

        const afterAudit = await countResultAudit(A.companyId);
        expect(afterAudit).toBe(beforeAudit + 1);
      });

      it("confirmResult (confirm:kpi) → INSERT snapshot MỚI có confirmed_* (append-only, KHÔNG sửa cũ)", async () => {
        const d = await seedDefinition(A);
        const subj = await seedSubjectUser(A);
        const computed = await svc.computeKpi(A.companyId, confirmerA, {
          definitionId: d,
          subjectUserId: subj,
          ...period,
        });
        const confirmed = await svc.confirmResult(A.companyId, confirmerA, {
          kpiResultId: computed.id,
        });

        // Append-only: bản ghi MỚI (id khác), bản gốc vẫn confirmed_* NULL.
        expect(confirmed.id).not.toBe(computed.id);
        expect(confirmed.confirmedBy).toBe(confirmerA);
        expect(confirmed.confirmedAt).not.toBeNull();

        const original = await direct.query(
          `SELECT confirmed_by, confirmed_at FROM kpi_results WHERE id = $1`,
          [computed.id],
        );
        expect(original.rows[0].confirmed_by).toBeNull();
        expect(original.rows[0].confirmed_at).toBeNull();
      });
    });
  },
);
