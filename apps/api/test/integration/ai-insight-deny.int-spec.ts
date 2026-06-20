import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { KpiService } from "../../src/kpi/kpi.service";
import { KpiRepository } from "../../src/kpi/kpi.repository";
import { CostService } from "../../src/finance/cost.service";
import { CostRepository } from "../../src/finance/cost.repository";
// 🔴 RED: AI-1 GREEN phải tạo AiInsightService/AiClient. Import này khiến CẢ suite ĐỎ (module-not-found)
//    ĐÚNG LÝ DO trước implement — KHÔNG implement GREEN ở đây.
import { AiInsightService } from "../../src/ai/ai-insight.service";
import { AiClient, type AiSummarizeResult } from "../../src/ai/ai-client";
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

/**
 * AI-1 — DENY-PATH (RED-first, TDD §6 / TASKS §5.5). Module AI = READ-ONLY: đọc kpi_results + cost_records
 * ĐÃ MASK theo permission → tóm tắt qua Claude. KHÔNG ghi DB. Mirror finance-cost-deny / kpi-deny.
 *
 * 5 chốt fail-closed GREEN phải thoả:
 *  (a) Permission fail-closed — user KHÔNG read:kpi → summarizeInsight ném ForbiddenException, KHÔNG gọi
 *      Claude (assert mock 0 lần) — check NGOÀI mọi I/O.
 *  (b) RLS 2-tenant — login A chỉ tổng hợp kpi/cost của A, 0 row của B (seed 2 tenant qua direct).
 *  (c) MASK trước LLM — user CÓ read:kpi nhưng KHÔNG view-finance → cost amount trong prompt = MASKED
 *      ([ẩn]), KHÔNG số THẬT (assert payload gửi Claude mock không chứa số tiền thật).
 *  (d) Read-only — AiInsightService KHÔNG có create/update/delete/insert; KHÔNG ghi audit_logs/outbox
 *      (assert count audit_logs/outbox KHÔNG đổi sau gọi).
 *  (e) Config — thiếu ANTHROPIC_API_KEY → AiClient ném lỗi cấu hình rõ ràng (KHÔNG hardcode/nuốt lỗi).
 *
 * Postgres THẬT (CI; local cần lane DB mediaos_ai1). KHÔNG mock RLS/permission. Claude = MOCK (DI).
 */

/** Mock AiClient: ghi lại prompt + đếm số lần gọi; KHÔNG gọi API thật (deterministic, 0 token). */
class MockAiClient {
  calls: string[] = [];
  resolveModel(): "claude-opus-4-8" {
    return "claude-opus-4-8";
  }
  async summarize(prompt: string): Promise<AiSummarizeResult> {
    this.calls.push(prompt);
    return { summary: "tóm tắt giả lập", model: "claude-opus-4-8" };
  }
}

describe.skipIf(!hasDb)(
  "AI-1 ai-insight deny-path (permission fail-closed + RLS + mask-before-LLM + read-only)",
  () => {
    const direct = directPool();
    let A: SeededTenant;
    let B: SeededTenant;
    /** user A có read:kpi nhưng KHÔNG view-finance (kiểm mask). */
    let kpiOnlyA: string;
    /** user A có read:kpi + view-finance (kiểm số thật vào prompt). */
    let financeA: string;
    /** user A KHÔNG có quyền gì (deny-path). */
    let noPermA: string;
    let svc: AiInsightService;
    let mockClient: MockAiClient;

    const REAL_COST_AMOUNT = 777333;

    /** Seed 1 cost gốc cho tenant t với amount cụ thể. Trả id. */
    async function seedCost(t: SeededTenant, enteredBy: string, amount: number): Promise<string> {
      const r = await direct.query(
        `INSERT INTO cost_records
           (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind, vendor_name)
         VALUES ($1, 'production', $2, 'VND', current_date, $3, 'original', 'NhaCungCapTest') RETURNING id`,
        [t.companyId, amount, enteredBy],
      );
      return r.rows[0].id as string;
    }

    /** Seed 1 kpi_result cho tenant t. */
    async function seedKpiResult(t: SeededTenant, subjectUserId: string): Promise<string> {
      const def = await direct.query(
        `INSERT INTO kpi_definitions (company_id, name, weights)
         VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [
          t.companyId,
          `aidef-${randomUUID().slice(0, 8)}`,
          JSON.stringify({
            tasksDone: 20,
            onTimeRate: 20,
            evaluationScore: 20,
            defectScore: 20,
            firstPassApprovalRate: 20,
          }),
        ],
      );
      const r = await direct.query(
        `INSERT INTO kpi_results
           (company_id, definition_id, subject_user_id, period_start, period_end,
            tasks_done, on_time_rate, evaluation_score, defect_score, first_pass_approval_rate,
            total_score, computed_by)
         VALUES ($1, $2, $3, '2026-05-01', '2026-06-01', 80, 90, 85, 95, 88, 87, $4) RETURNING id`,
        [t.companyId, def.rows[0].id, subjectUserId, subjectUserId],
      );
      return r.rows[0].id as string;
    }

    async function countAudit(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

    async function countOutbox(companyId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM outbox_events WHERE company_id = $1`,
        [companyId],
      );
      return r.rows[0].n as number;
    }

    beforeAll(async () => {
      A = await seedCompany(direct, "aiInsA");
      B = await seedCompany(direct, "aiInsB");

      // read:kpi catalog perm (non-sensitive) + view-finance catalog perm (SENSITIVE).
      const readKpiPerm = await seedPermissionCatalog(direct, "read", "kpi", false);
      const viewFinancePerm = await seedPermissionCatalog(direct, "view-finance", "finance", true);

      // kpiOnlyA: chỉ read:kpi (KHÔNG view-finance) → cost amount phải MASK.
      const kpiRole = await seedRole(direct, A.companyId, `ai-kpi-${randomUUID().slice(0, 8)}`);
      await seedRolePermission(direct, kpiRole, readKpiPerm, "ALLOW");
      kpiOnlyA = await seedUser(direct, A.companyId, `ai-kpi-${randomUUID().slice(0, 8)}@a.test`);
      await seedUserRole(direct, kpiOnlyA, kpiRole, A.companyId);

      // financeA: read:kpi + view-finance → cost amount số THẬT.
      const finRole = await seedRole(direct, A.companyId, `ai-fin-${randomUUID().slice(0, 8)}`);
      await seedRolePermission(direct, finRole, readKpiPerm, "ALLOW");
      await seedRolePermission(direct, finRole, viewFinancePerm, "ALLOW");
      financeA = await seedUser(direct, A.companyId, `ai-fin-${randomUUID().slice(0, 8)}@a.test`);
      await seedUserRole(direct, financeA, finRole, A.companyId);

      // noPermA: role rỗng (không read:kpi).
      const emptyRole = await seedRole(
        direct,
        A.companyId,
        `ai-noperm-${randomUUID().slice(0, 8)}`,
      );
      noPermA = await seedUser(direct, A.companyId, `ai-noperm-${randomUUID().slice(0, 8)}@a.test`);
      await seedUserRole(direct, noPermA, emptyRole, A.companyId);

      const db = new DatabaseService();
      const audit = new AuditService();
      const outbox = new OutboxService();
      const permission = new PermissionService(new PermissionRepository(db));
      const kpi = new KpiService(db, new KpiRepository(db), permission, audit, outbox);
      const cost = new CostService(db, new CostRepository(db), permission, audit, outbox);
      mockClient = new MockAiClient();
      // DI mock vào vị trí AiClient — KHÔNG gọi API thật.
      svc = new AiInsightService(permission, kpi, cost, mockClient as unknown as AiClient);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
    });

    // ── (a) Permission fail-closed — thiếu read:kpi → Forbidden, KHÔNG gọi Claude ──
    describe("(a) permission fail-closed (deny ⇒ no LLM call)", () => {
      it("summarizeInsight thiếu read:kpi → ForbiddenException + mock Claude 0 lần", async () => {
        const before = mockClient.calls.length;
        await expect(
          svc.summarizeInsight(A.companyId, noPermA, {
            period: "month",
            scope: "company",
            limit: 20,
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        // fail-closed NGOÀI I/O: KHÔNG gọi LLM khi bị từ chối (không tốn token / không lộ data).
        expect(mockClient.calls.length).toBe(before);
      });
    });

    // ── (b) RLS 2-tenant — login A chỉ tổng hợp dữ liệu A ─────────────────────────
    describe("(b) RLS 2-tenant isolation", () => {
      it("login A tổng hợp KPI/cost của A, KHÔNG đụng dữ liệu B", async () => {
        // KPI subject = chính financeA → "own" scope (read:kpi không có quyền rộng) vẫn thấy được.
        await seedKpiResult(A, financeA);
        await seedKpiResult(
          B,
          await seedUser(direct, B.companyId, `b-${randomUUID().slice(0, 8)}@b.test`),
        );
        await seedCost(A, financeA, 111);
        // amount của B = số đặc trưng (khó là substring của số khác) → assert RLS chắc chắn.
        const tenantBAmount = 8675309424242;
        await seedCost(B, financeA, tenantBAmount);

        const before = mockClient.calls.length;
        const out = await svc.summarizeInsight(A.companyId, financeA, {
          period: "month",
          scope: "company",
          limit: 50,
        });
        // chỉ thấy dữ liệu A (cost B không được nhúng vào prompt).
        const prompt = mockClient.calls[mockClient.calls.length - 1];
        expect(mockClient.calls.length).toBe(before + 1);
        expect(prompt).not.toContain(String(tenantBAmount));
        expect(out.kpiCount).toBeGreaterThanOrEqual(1);
        expect(out.costCount).toBeGreaterThanOrEqual(1);
      });
    });

    // ── (c) MASK trước LLM — thiếu view-finance → cost amount MASKED trong prompt ──
    describe("(c) mask-before-LLM (no raw amount to Claude when no view-finance)", () => {
      it("read:kpi nhưng KHÔNG view-finance → prompt chứa '[ẩn]', KHÔNG số tiền thật", async () => {
        await seedCost(A, financeA, REAL_COST_AMOUNT);
        const out = await svc.summarizeInsight(A.companyId, kpiOnlyA, {
          period: "month",
          scope: "company",
          limit: 50,
        });
        const prompt = mockClient.calls[mockClient.calls.length - 1];
        expect(prompt).not.toContain(String(REAL_COST_AMOUNT));
        expect(prompt).toContain("[ẩn]");
        expect(out.financeMasked).toBe(true);
      });

      it("read:kpi + view-finance → prompt chứa số tiền thật (không mask)", async () => {
        await seedCost(A, financeA, REAL_COST_AMOUNT);
        const out = await svc.summarizeInsight(A.companyId, financeA, {
          period: "month",
          scope: "company",
          limit: 50,
        });
        const prompt = mockClient.calls[mockClient.calls.length - 1];
        expect(prompt).toContain(String(REAL_COST_AMOUNT));
        expect(out.financeMasked).toBe(false);
      });
    });

    // ── (d) Read-only — KHÔNG ghi DB / audit / outbox + KHÔNG có method ghi ───────
    describe("(d) read-only (no INSERT/UPDATE/DELETE, no audit/outbox)", () => {
      it("AiInsightService KHÔNG có method ghi (create/update/delete/insert)", () => {
        const s = svc as unknown as Record<string, unknown>;
        expect(s.create).toBeUndefined();
        expect(s.update).toBeUndefined();
        expect(s.delete).toBeUndefined();
        expect(s.insert).toBeUndefined();
        expect(typeof svc.summarizeInsight).toBe("function");
      });

      it("summarizeInsight KHÔNG ghi audit_logs/outbox (count không đổi)", async () => {
        await seedKpiResult(A, financeA);
        const auditBefore = await countAudit(A.companyId);
        const outboxBefore = await countOutbox(A.companyId);

        await svc.summarizeInsight(A.companyId, financeA, {
          period: "month",
          scope: "company",
          limit: 20,
        });

        expect(await countAudit(A.companyId)).toBe(auditBefore);
        expect(await countOutbox(A.companyId)).toBe(outboxBefore);
      });
    });
  },
);
