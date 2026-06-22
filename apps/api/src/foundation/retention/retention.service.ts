import { Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { DatabaseService } from "../../db/db.service";
import { dataRetentionPolicies } from "../../db/schema/retention";
import type {
  CleanupAction,
  CleanupResult,
  CreatePolicyInput,
  RetentionPolicyRow,
  RunCleanupOptions,
  SimulateResult,
  UpdatePolicyInput,
} from "./retention.types";
import { DEFAULT_CLEANUP_BATCH_SIZE } from "./retention.types";

/**
 * FOUNDATION-BE-8 — RetentionService (BACKEND-11 §17.3/§17.4).
 *
 * CRUD chính sách lưu trữ (data_retention_policies) + simulate (đếm eligible, KHÔNG mutate) +
 * runCleanup (dry-run mặc định; chỉ xóa khi is_enabled && !dryRun — §17.4.1).
 *
 * BẤT BIẾN:
 *  #1 — mọi write/read đi qua withTenant(companyId) (RLS+FORCE ép ở DB).
 *  #2 — KHÔNG hard-delete policy (soft-delete deleted_at); KHÔNG xóa audit_logs (append-only).
 *  #3 — cleanup TUYỆT ĐỐI KHÔNG xóa khi !is_enabled (§17.4.1).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  /** Bảng append-only không bao giờ được xóa (BẤT BIẾN #2). */
  private static readonly PROTECTED_TABLES = new Set([
    "audit_logs",
    "payslips",
    "payslip_items",
    "kpi_results",
    "profit_snapshots",
    "revenue_records",
    "cost_records",
    "seed_batches",
    "seed_items",
  ]);

  constructor(private readonly db: DatabaseService) {}

  /** Tạo chính sách lưu trữ cho tenant. company_id = companyId (KHÔNG global NULL). */
  async createPolicy(input: CreatePolicyInput): Promise<RetentionPolicyRow> {
    const {
      companyId,
      moduleCode,
      entityType,
      retentionDays,
      cleanupAction = "None",
      archiveAfterDays = null,
      deleteAfterDays = null,
      isLegalHoldSupported = false,
      isEnabled = false,
      description = null,
      createdBy = null,
    } = input;

    return this.db.withTenant(companyId, async (tx) => {
      const inserted = await tx
        .insert(dataRetentionPolicies)
        .values({
          companyId,
          moduleCode,
          entityType,
          retentionDays,
          cleanupAction,
          archiveAfterDays,
          deleteAfterDays,
          isLegalHoldSupported,
          isEnabled,
          description,
          createdBy: createdBy ?? null,
        })
        .returning();

      const row = inserted[0] as RetentionPolicyRow;
      this.logger.log(
        `createPolicy: id=${row.id} module=${moduleCode} entity=${entityType} enabled=${isEnabled}`,
      );
      return row;
    });
  }

  /** Patch chính sách (soft-update — BẤT BIẾN #2, KHÔNG DELETE). */
  async updatePolicy(
    companyId: string,
    policyId: string,
    input: UpdatePolicyInput,
  ): Promise<RetentionPolicyRow> {
    return this.db.withTenant(companyId, async (tx) => {
      const now = new Date();
      const updated = await tx
        .update(dataRetentionPolicies)
        .set({
          ...(input.retentionDays !== undefined && { retentionDays: input.retentionDays }),
          ...(input.cleanupAction !== undefined && { cleanupAction: input.cleanupAction }),
          ...(input.archiveAfterDays !== undefined && { archiveAfterDays: input.archiveAfterDays }),
          ...(input.deleteAfterDays !== undefined && { deleteAfterDays: input.deleteAfterDays }),
          ...(input.isLegalHoldSupported !== undefined && {
            isLegalHoldSupported: input.isLegalHoldSupported,
          }),
          ...(input.isEnabled !== undefined && { isEnabled: input.isEnabled }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.updatedBy !== undefined && { updatedBy: input.updatedBy }),
          updatedAt: now,
        })
        .where(
          and(
            eq(dataRetentionPolicies.id, policyId),
            eq(dataRetentionPolicies.companyId, companyId),
            isNull(dataRetentionPolicies.deletedAt),
          ),
        )
        .returning();

      return updated[0] as RetentionPolicyRow;
    });
  }

  /** Soft-delete chính sách (BẤT BIẾN #2 — KHÔNG hard-delete). */
  async deletePolicy(
    companyId: string,
    policyId: string,
    deletedBy?: string | null,
  ): Promise<void> {
    await this.db.withTenant(companyId, async (tx) => {
      const now = new Date();
      await tx
        .update(dataRetentionPolicies)
        .set({ deletedAt: now, deletedBy: deletedBy ?? null, updatedAt: now })
        .where(
          and(
            eq(dataRetentionPolicies.id, policyId),
            eq(dataRetentionPolicies.companyId, companyId),
          ),
        )
        .returning();
    });
  }

  /** Lấy 1 chính sách theo id (trong tenant). */
  async getPolicy(companyId: string, policyId: string): Promise<RetentionPolicyRow | null> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select()
        .from(dataRetentionPolicies)
        .where(
          and(
            eq(dataRetentionPolicies.id, policyId),
            eq(dataRetentionPolicies.companyId, companyId),
          ),
        )
        .limit(1);
      return (rows[0] as RetentionPolicyRow) ?? null;
    });
  }

  /** Danh sách policy enabled (cho cleanup job lặp qua). */
  async listEnabledPolicies(companyId: string): Promise<RetentionPolicyRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select()
        .from(dataRetentionPolicies)
        .where(
          and(
            eq(dataRetentionPolicies.companyId, companyId),
            eq(dataRetentionPolicies.isEnabled, true),
            isNull(dataRetentionPolicies.deletedAt),
          ),
        );
      return rows as RetentionPolicyRow[];
    });
  }

  /**
   * Simulate: đếm eligible records theo policy — READ-ONLY, KHÔNG mutate (§17.3).
   * cutoffTime = now - retentionDays.
   */
  async simulate(companyId: string, policyId: string): Promise<SimulateResult> {
    return this.db.withTenant(companyId, async (tx) => {
      const policyRows = await tx
        .select()
        .from(dataRetentionPolicies)
        .where(
          and(
            eq(dataRetentionPolicies.id, policyId),
            eq(dataRetentionPolicies.companyId, companyId),
          ),
        )
        .limit(1);

      const policy = policyRows[0] as RetentionPolicyRow;
      const cutoffTime = this._cutoff(policy.retentionDays);
      const eligibleCount = await this._countEligible(tx, companyId, policy.entityType, cutoffTime);

      return {
        policyId: policy.id,
        moduleCode: policy.moduleCode,
        entityType: policy.entityType,
        eligibleRecords: eligibleCount,
        action: policy.cleanupAction as CleanupAction,
        cutoffTime,
        isEnabled: policy.isEnabled,
      };
    });
  }

  /**
   * runCleanup: xóa/archive/anonymize records theo policy.
   *  - dryRun mặc định true (§17.4 safety) — chỉ đếm, KHÔNG xóa.
   *  - !is_enabled → skippedDisabled=true, KHÔNG xóa (§17.4.1).
   *  - entityType trong PROTECTED_TABLES → KHÔNG xóa (BẤT BIẾN #2).
   */
  async runCleanup(
    companyId: string,
    policyId: string,
    options: RunCleanupOptions = {},
  ): Promise<CleanupResult> {
    const { dryRun = true, batchSize = DEFAULT_CLEANUP_BATCH_SIZE } = options;

    return this.db.withTenant(companyId, async (tx) => {
      const policyRows = await tx
        .select()
        .from(dataRetentionPolicies)
        .where(
          and(
            eq(dataRetentionPolicies.id, policyId),
            eq(dataRetentionPolicies.companyId, companyId),
          ),
        )
        .limit(1);

      const policy = policyRows[0] as RetentionPolicyRow;
      const cutoffTime = this._cutoff(policy.retentionDays);

      // §17.4.1: policy chưa active → skip, KHÔNG xóa.
      if (!policy.isEnabled) {
        const eligibleCount = await this._countEligible(
          tx,
          companyId,
          policy.entityType,
          cutoffTime,
        );
        this.logger.log(
          `runCleanup: policy=${policyId} SKIPPED (disabled) eligible=${eligibleCount}`,
        );
        return {
          policyId,
          eligibleRecords: eligibleCount,
          deletedRecords: 0,
          cutoffTime,
          dryRun,
          skippedDisabled: true,
        };
      }

      const eligibleCount = await this._countEligible(
        tx,
        companyId,
        policy.entityType,
        cutoffTime,
      );

      // BẤT BIẾN #2: bảng append-only KHÔNG bao giờ được xóa.
      if (RetentionService.PROTECTED_TABLES.has(policy.entityType)) {
        this.logger.warn(
          `runCleanup: policy=${policyId} entity=${policy.entityType} là append-only — bỏ qua (BẤT BIẾN #2)`,
        );
        return {
          policyId,
          eligibleRecords: eligibleCount,
          deletedRecords: 0,
          cutoffTime,
          dryRun,
          skippedDisabled: false,
        };
      }

      // dryRun mode: đếm nhưng không xóa.
      if (dryRun) {
        this.logger.log(
          `runCleanup: policy=${policyId} DRY-RUN entity=${policy.entityType} eligible=${eligibleCount}`,
        );
        return {
          policyId,
          eligibleRecords: eligibleCount,
          deletedRecords: 0,
          cutoffTime,
          dryRun: true,
          skippedDisabled: false,
        };
      }

      // Xóa thật (chỉ action=Delete được xử lý ở lane này; Archive/Anonymize → log + skip).
      let deletedRecords = 0;
      if (policy.cleanupAction === "Delete") {
        deletedRecords = await this._deleteEligible(
          tx,
          companyId,
          policy.entityType,
          cutoffTime,
          batchSize,
        );
      } else {
        this.logger.log(
          `runCleanup: policy=${policyId} action=${policy.cleanupAction} — chỉ Delete được xử lý ở lane BE-8`,
        );
      }

      this.logger.log(
        `runCleanup: policy=${policyId} entity=${policy.entityType} deleted=${deletedRecords} eligible=${eligibleCount}`,
      );
      return {
        policyId,
        eligibleRecords: eligibleCount,
        deletedRecords,
        cutoffTime,
        dryRun: false,
        skippedDisabled: false,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers nội bộ
  // ---------------------------------------------------------------------------

  private _cutoff(retentionDays: number): Date {
    return new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  }

  /**
   * Đếm eligible records theo entity_type (table name) + cutoff.
   * Validate entity_type chống SQL injection (chỉ chấp nhận snake_case identifier hợp lệ).
   */
  private async _countEligible(
    tx: TenantTx,
    companyId: string,
    entityType: string,
    cutoffTime: Date,
  ): Promise<number> {
    if (!/^[a-z_][a-z0-9_]*$/.test(entityType)) {
      this.logger.warn(`_countEligible: entity_type không hợp lệ "${entityType}" — trả 0`);
      return 0;
    }

    // sql.identifier() sinh SQL identifier an toàn (KHÔNG string-concat).
    const result = await tx.execute(
      sql`SELECT count(*)::int AS count
          FROM ${sql.identifier(entityType)}
          WHERE company_id = ${companyId}::uuid
            AND created_at < ${cutoffTime.toISOString()}::timestamptz`,
    );
    const row = (result as { rows: Record<string, unknown>[] }).rows[0];
    return typeof row?.count === "number" ? row.count : Number(row?.count ?? 0);
  }

  /**
   * Xóa (DELETE) records eligible — batchSize giới hạn (§17.4.5).
   * CHỈ gọi khi !dryRun && is_enabled && action=Delete && entityType NOT in PROTECTED_TABLES.
   */
  private async _deleteEligible(
    tx: TenantTx,
    companyId: string,
    entityType: string,
    cutoffTime: Date,
    batchSize: number,
  ): Promise<number> {
    if (!/^[a-z_][a-z0-9_]*$/.test(entityType)) {
      return 0;
    }

    const result = await tx.execute(
      sql`DELETE FROM ${sql.identifier(entityType)}
          WHERE id IN (
            SELECT id FROM ${sql.identifier(entityType)}
            WHERE company_id = ${companyId}::uuid
              AND created_at < ${cutoffTime.toISOString()}::timestamptz
            LIMIT ${batchSize}
          )`,
    );
    return (result as { rowCount?: number }).rowCount ?? 0;
  }
}
