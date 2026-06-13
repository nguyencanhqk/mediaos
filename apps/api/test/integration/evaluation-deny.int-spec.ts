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
// 🔴 RED: G8-3 GREEN phải tạo Service/Repo evaluation. Import này khiến CẢ suite ĐỎ (module-not-found)
//    ĐÚNG LÝ DO trước implement.
import { EvaluationService } from "../../src/evaluation/evaluation.service";
import { EvaluationRepository } from "../../src/evaluation/evaluation.repository";
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
 * G8-3 — DENY-PATH (RED-first). Evaluation results/scores = APPEND-ONLY (bất biến #2), config nhạy
 * cảm (permission). 5 chốt fail-closed mà GREEN phải thoả:
 *
 *  (a) RLS 2-tenant — login A KHÔNG đọc evaluation_templates/criteria/results/scores của B (0 row).
 *  (b) Append-only  — app role KHÔNG UPDATE/DELETE evaluation_results & evaluation_scores (SELECT,INSERT).
 *  (c) Permission   — recordScores thiếu score:evaluation → Forbidden, KHÔNG ghi.
 *  (d) Audit        — recordScores ghi audit_logs object_type='evaluation_result' đúng company_id, cùng tx.
 *  (e) WITH CHECK   — INSERT company_id ≠ app.current_company_id bị chặn.
 *
 * Postgres THẬT (CI; local cần lane DB mediaos_g8). KHÔNG mock RLS.
 */
describe.skipIf(!hasDb)(
  "G8-3 evaluation deny-path (RLS 2-tenant + append-only + permission + audit)",
  () => {
    const direct = directPool();
    const app = appPool(2);
    let A: SeededTenant;
    let B: SeededTenant;
    let userA: string;
    /** user A có quyền chấm điểm (role tenant gắn score:evaluation). */
    let scorerA: string;
    let svc: EvaluationService;

    /** Seed 1 workflow step cho tenant t (chain tối thiểu). Trả {stepId, userId}. */
    async function seedStep(t: SeededTenant): Promise<{ stepId: string; userId: string }> {
      const userId = await seedUser(
        direct,
        t.companyId,
        `eval-chain-${randomUUID().slice(0, 8)}@x.test`,
      );
      const prj = await direct.query(
        `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [t.companyId, `eval-prj-${randomUUID().slice(0, 8)}`],
      );
      const ci = await direct.query(
        `INSERT INTO content_items (company_id, project_id, title, status)
       VALUES ($1, $2, 'eval-ci', 'draft') RETURNING id`,
        [t.companyId, prj.rows[0].id],
      );
      const def = await direct.query(
        `INSERT INTO workflow_definitions (company_id, code, name, applies_to, max_approval_level, allow_parallel_steps)
       VALUES ($1, $2, 'Eval Def', 'content_item', 1, false) RETURNING id`,
        [t.companyId, `eval-def-${randomUUID().slice(0, 8)}`],
      );
      const inst = await direct.query(
        `INSERT INTO workflow_instances
         (company_id, workflow_definition_id, content_item_id, created_by, current_step_order, status)
       VALUES ($1, $2, $3, $4, 1, 'active') RETURNING id`,
        [t.companyId, def.rows[0].id, ci.rows[0].id, userId],
      );
      const step = await direct.query(
        `INSERT INTO workflow_steps
         (company_id, workflow_instance_id, step_order, step_code, step_name, status)
       VALUES ($1, $2, 1, 'script', 'Viết kịch bản', 'not_started') RETURNING id`,
        [t.companyId, inst.rows[0].id],
      );
      return { stepId: step.rows[0].id as string, userId };
    }

    /** Seed 1 template + 1 tiêu chí (weight=100). Trả {templateId, criteriaId}. */
    async function seedTemplate(
      t: SeededTenant,
    ): Promise<{ templateId: string; criteriaId: string }> {
      const tpl = await direct.query(
        `INSERT INTO evaluation_templates (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `eval-tpl-${randomUUID().slice(0, 8)}`],
      );
      const crit = await direct.query(
        `INSERT INTO evaluation_criteria (company_id, template_id, name, weight, min_score, max_score)
       VALUES ($1, $2, 'crit', 100, 0, 10) RETURNING id`,
        [t.companyId, tpl.rows[0].id],
      );
      return { templateId: tpl.rows[0].id as string, criteriaId: crit.rows[0].id as string };
    }

    async function countResults(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM evaluation_results WHERE company_id = $1`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

    async function countResultAudit(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = 'evaluation_result'`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

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
      A = await seedCompany(direct, "evalA");
      B = await seedCompany(direct, "evalB");
      userA = await seedUser(direct, A.companyId, `eval-a-${randomUUID().slice(0, 8)}@a.test`);

      // scorerA: role tenant của A gắn score:evaluation (seed 0085 đã có catalog row).
      const permId = await seedPermissionCatalog(direct, "score", "evaluation", false);
      const scorerRole = await seedRole(
        direct,
        A.companyId,
        `eval-scorer-${randomUUID().slice(0, 8)}`,
      );
      await seedRolePermission(direct, scorerRole, permId, "ALLOW");
      scorerA = await seedUser(
        direct,
        A.companyId,
        `eval-scorer-${randomUUID().slice(0, 8)}@a.test`,
      );
      await seedUserRole(direct, scorerA, scorerRole, A.companyId);

      const db = new DatabaseService();
      const audit = new AuditService();
      const outbox = new OutboxService();
      const permission = new PermissionService(new PermissionRepository(db));
      svc = new EvaluationService(db, new EvaluationRepository(db), permission, audit, outbox);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    // ── (a) RLS 2-tenant ─────────────────────────────────────────────────────────
    describe("(a) RLS 2-tenant isolation", () => {
      it("listTemplates(A) thấy template A, KHÔNG thấy template B", async () => {
        const { templateId: tA } = await seedTemplate(A);
        const { templateId: tB } = await seedTemplate(B);
        const rows = await svc.listTemplates(A.companyId, scorerA, {});
        const ids = new Set(rows.map((r) => r.id));
        expect(ids.has(tA)).toBe(true);
        expect(ids.has(tB)).toBe(false);
      });

      it("APP role khác ngữ cảnh → KHÔNG SELECT được template/result tenant khác (0 row)", async () => {
        const { templateId: tB } = await seedTemplate(B);
        const seen = await asApp(A.companyId, async (c) => {
          const r = await c.query(`SELECT id FROM evaluation_templates WHERE id = $1`, [tB]);
          return r.rowCount ?? 0;
        });
        expect(seen).toBe(0);
      });
    });

    // ── (b) Append-only — results/scores no UPDATE/DELETE for app role ──────────
    describe("(b) append-only (no UPDATE/DELETE for app role)", () => {
      it("app role KHÔNG có quyền UPDATE evaluation_results", async () => {
        const { stepId, userId } = await seedStep(A);
        const { templateId } = await seedTemplate(A);
        const res = await direct.query(
          `INSERT INTO evaluation_results
           (company_id, template_id, workflow_step_id, evaluator_user_id, total_score)
         VALUES ($1, $2, $3, $4, 80.00) RETURNING id`,
          [A.companyId, templateId, stepId, userId],
        );
        await expect(
          asApp(A.companyId, (c) =>
            c.query(`UPDATE evaluation_results SET total_score = 0 WHERE id = $1`, [
              res.rows[0].id,
            ]),
          ),
        ).rejects.toThrow(/permission denied|must be owner/i);
      });

      it("app role KHÔNG có quyền DELETE evaluation_scores", async () => {
        const { stepId, userId } = await seedStep(A);
        const { templateId, criteriaId } = await seedTemplate(A);
        const res = await direct.query(
          `INSERT INTO evaluation_results
           (company_id, template_id, workflow_step_id, evaluator_user_id, total_score)
         VALUES ($1, $2, $3, $4, 80.00) RETURNING id`,
          [A.companyId, templateId, stepId, userId],
        );
        const sc = await direct.query(
          `INSERT INTO evaluation_scores (company_id, result_id, criteria_id, score)
         VALUES ($1, $2, $3, 8.00) RETURNING id`,
          [A.companyId, res.rows[0].id, criteriaId],
        );
        await expect(
          asApp(A.companyId, (c) =>
            c.query(`DELETE FROM evaluation_scores WHERE id = $1`, [sc.rows[0].id]),
          ),
        ).rejects.toThrow(/permission denied|must be owner/i);
      });

      it("EvaluationService KHÔNG có update()/delete() trên kết quả chấm", () => {
        const s = svc as unknown as Record<string, unknown>;
        expect(s.updateScore).toBeUndefined();
        expect(s.deleteResult).toBeUndefined();
      });
    });

    // ── (c) Permission deny — recordScores thiếu score:evaluation → 403 fail-closed ──
    describe("(c) permission deny (fail-closed)", () => {
      it("recordScores KHÔNG có quyền score:evaluation → ForbiddenException, KHÔNG ghi", async () => {
        const { stepId } = await seedStep(A);
        const { templateId, criteriaId } = await seedTemplate(A);
        const before = await countResults(A.companyId);
        await expect(
          svc.recordScores(A.companyId, userA, {
            templateId,
            workflowStepId: stepId,
            scores: [{ criteriaId, score: 8 }],
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        const after = await countResults(A.companyId);
        expect(after).toBe(before);
      });
    });

    // ── (d) Audit — recordScores ghi audit object_type='evaluation_result' cùng tx ──
    describe("(d) audit on scoring", () => {
      it("recordScores ghi audit_logs object_type='evaluation_result' + chain result→scores", async () => {
        const { stepId } = await seedStep(A);
        const { templateId, criteriaId } = await seedTemplate(A);
        const beforeAudit = await countResultAudit(A.companyId);

        const result = await svc.recordScores(A.companyId, scorerA, {
          templateId,
          workflowStepId: stepId,
          scores: [{ criteriaId, score: 9 }],
        });

        const chk = await direct.query(
          `SELECT count(*)::int AS n FROM evaluation_scores WHERE result_id = $1`,
          [result.id],
        );
        expect(chk.rows[0].n).toBe(1);
        const afterAudit = await countResultAudit(A.companyId);
        expect(afterAudit).toBe(beforeAudit + 1);
      });

      it("chấm lại trùng (result đã có criteria) → append-only chain vẫn ghi result MỚI (không sửa cũ)", async () => {
        const { stepId } = await seedStep(A);
        const { templateId, criteriaId } = await seedTemplate(A);
        const r1 = await svc.recordScores(A.companyId, scorerA, {
          templateId,
          workflowStepId: stepId,
          scores: [{ criteriaId, score: 5 }],
        });
        const r2 = await svc.recordScores(A.companyId, scorerA, {
          templateId,
          workflowStepId: stepId,
          scores: [{ criteriaId, score: 7 }],
        });
        expect(r1.id).not.toBe(r2.id); // bản ghi mới — bất biến #2
      });
    });

    // ── (e) WITH CHECK — INSERT company_id sai tenant bị chặn ───────────────────
    describe("(e) WITH CHECK blocks cross-tenant insert", () => {
      it("INSERT evaluation_templates company_id ≠ ngữ cảnh → RLS WITH CHECK chặn (0 row hiệu lực)", async () => {
        // Ngữ cảnh A nhưng ép company_id = B → WITH CHECK violation.
        await expect(
          asApp(A.companyId, (c) =>
            c.query(
              `INSERT INTO evaluation_templates (company_id, name) VALUES ($1, 'cross-tenant')`,
              [B.companyId],
            ),
          ),
        ).rejects.toThrow(/row-level security|violates row-level security policy/i);
      });
    });
  },
);
