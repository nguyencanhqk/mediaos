import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { FOUNDATION_ERROR_CODES } from "@mediaos/contracts";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { DatabaseService } from "../../db/db.service";
import { dataRetentionPolicies } from "../../db/schema/retention";
import { AuditService } from "../../events/audit.service";
import type {
  CleanupAction,
  CleanupResult,
  CreatePolicyInput,
  RetentionActor,
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

  /**
   * Bảng runCleanup TUYỆT ĐỐI KHÔNG được xóa (BẤT BIẾN #2, CLAUDE §2). Kể cả policy is_enabled=true +
   * cleanup_action=Delete + dryRun=false ⇒ vẫn no-op (deletedRecords=0). Hai nhóm:
   *  (a) append-only / ledger / snapshot: audit/log/ledger/snapshot mà app role KHÔNG có UPDATE/DELETE ở DB.
   *  (b) cascade-guard (S5-FND-REVOKE-1): org_units/projects — soft-delete NHƯNG hard-delete sẽ cascade xóa
   *      cứng goals + ledger goal_updates (mig 0504), nên retention cũng KHÔNG được xóa.
   *
   * PROTECTED_TABLES là LỚP APP phòng-thủ-thứ-hai (defense-in-depth) TRÊN REVOKE-ở-DB (migration): chặn
   * ngay trước khi phát lệnh, không dựa vào DB ném lỗi (42501 uncaught sẽ làm hỏng cả lượt cleanup tenant).
   */
  private static readonly PROTECTED_TABLES = new Set([
    // Audit trail (CLAUDE §2 core append-only).
    "audit_logs",
    // AUTH security/login logs (mig REVOKE UPDATE/DELETE — S2-AUTH-DB-2 / G16-1b).
    "login_logs",
    "user_security_events",
    "security_alerts",
    // Foundation file access trail (mig 0433 REVOKE UPDATE/DELETE — append-only).
    "file_access_logs",
    // API key usage ledger (AC-5 — mig 0310 append-only).
    "api_key_usages",
    // ATT / LEAVE ledgers + logs (CLAUDE §2 — DB-04/DB-05 append-only).
    "attendance_logs",
    "leave_balance_transactions",
    // TASK activity trail (CLAUDE §2 — DB-06 append-only).
    "task_activity_logs",
    // NOTI delivery trail (CLAUDE §2 — DB-08 append-only).
    "notification_delivery_logs",
    // HR employee status history (CLAUDE §2 — DB-03 append-only snapshot).
    "employee_status_histories",
    // Payroll snapshots + finance ledgers (Phase 2 / G12-G13 — append-only, GIỮ).
    "payslips",
    "payslip_items",
    "kpi_results",
    "profit_snapshots",
    "revenue_records",
    "cost_records",
    // Seed provenance (FOUNDATION — append-only batch/item).
    "seed_batches",
    "seed_items",
    // Cascade-guard (S5-FND-REVOKE-1 — KHÔNG append-only; 2 bảng này soft-delete). Lý do bảo vệ KHÁC tập
    // trên: org_units/projects có FK ON DELETE CASCADE từ goals (department_id/project_id, mig 0504) →
    // goal_updates (ledger append-only). Hard-delete qua retention ⇒ cascade xóa CỨNG goals + ledger =
    // vi phạm BẤT BIẾN #2. Đây là LỚP APP khớp với DB REVOKE (mig 0510 REVOKE DELETE khỏi mediaos_app):
    // retention no-op (deletedRecords=0) TRƯỚC khi phát lệnh ⇒ tránh 42501 uncaught làm hỏng cả lượt cleanup.
    "org_units",
    "projects",
  ]);

  /**
   * true nếu `entityType` là bảng append-only/ledger được bảo vệ (BẤT BIẾN #2). Public để test set-membership
   * trực tiếp (chứng minh phủ ĐỦ tập) + cho consumer (job/UI) kiểm tra trước khi chạy cleanup.
   */
  static isProtectedTable(entityType: string): boolean {
    return RetentionService.PROTECTED_TABLES.has(entityType);
  }

  constructor(
    private readonly db: DatabaseService,
    // EventsModule cung cấp AuditService (Nest DI). Default new AuditService() giữ >0 call-site
    // `new RetentionService(db)` trong test/legacy không vỡ (mirror AuditService×masker).
    private readonly audit: AuditService = new AuditService(),
  ) {}

  /**
   * Tạo chính sách lưu trữ cho tenant. company_id = companyId (KHÔNG global NULL — BẤT BIẾN #1).
   *
   * CÙNG tx (withTenant): insert policy → ghi audit CREATE (append-only, cùng commit/rollback — BẤT BIẾN #2).
   * Audit action='RetentionPolicyCreated' actionGroup='CONFIG_UPDATE' object_type='retention_policy' (CHECK
   * mig 0456). newValues = SNAPSHOT CẤU HÌNH (KHÔNG secret/PII/companyId/createdBy — BẤT BIẾN #3); oldValues
   * bỏ trống (đối tượng mới). actor?.id → actorUserId + created_by (nếu có).
   */
  async createPolicy(
    input: CreatePolicyInput,
    actor?: RetentionActor,
  ): Promise<RetentionPolicyRow> {
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
          createdBy: actor?.id ?? createdBy ?? null,
        })
        .returning();

      const row = inserted[0] as RetentionPolicyRow;

      // Audit CÙNG tx (append-only — rollback ⇒ 0 audit). object_type ∈ AUDIT_OBJECT_TYPES + CHECK (mig 0456).
      await this.audit.record(tx, {
        action: "RetentionPolicyCreated",
        actionGroup: "CONFIG_UPDATE",
        objectType: "retention_policy",
        objectId: row.id,
        actorUserId: actor?.id ?? createdBy ?? undefined,
        actorType: "User",
        moduleCode: row.moduleCode,
        entityType: "retention_policy",
        entityId: row.id,
        newValues: toRetentionAuditSnapshot(row),
        sensitivityLevel: "Sensitive",
        resultStatus: "Success",
        dataScope: "Company",
        permissionCode: "FOUNDATION.RETENTION.MANAGE",
      });

      this.logger.log(
        `createPolicy: id=${row.id} module=${moduleCode} entity=${entityType} enabled=${isEnabled}`,
      );
      return row;
    });
  }

  /**
   * PATCH chính sách (soft-update — BẤT BIẾN #2, KHÔNG DELETE). CÙNG tx: đọc old → update → ghi audit
   * CONFIG_UPDATE object_type='retention_policy' (append-only, cùng commit — BẤT BIẾN #2).
   *
   *  - FAIL-CLOSED: policy không tồn tại / thuộc tenant khác (RLS che) / đã soft-delete ⇒ 0 row → NotFound
   *    (KHÔNG NPE/500). Read TRƯỚC update để có old-snapshot + xác định tồn tại trong CÙNG tenant-tx.
   *  - Audit old/new = SNAPSHOT CẤU HÌNH (KHÔNG secret/PII); AuditService mask + auto changed_fields.
   *    permissionCode='FOUNDATION.RETENTION.MANAGE' (is_sensitive). actorUserId = actor.id (nếu có).
   */
  async updatePolicy(
    companyId: string,
    policyId: string,
    input: UpdatePolicyInput,
    actor?: RetentionActor,
  ): Promise<RetentionPolicyRow> {
    return this.db.withTenant(companyId, async (tx) => {
      // (1) Đọc old TRONG tenant-tx (RLS ép company_id). deleted_at IS NULL ⇒ soft-deleted coi như không tồn tại.
      const existingRows = await tx
        .select()
        .from(dataRetentionPolicies)
        .where(
          and(
            eq(dataRetentionPolicies.id, policyId),
            eq(dataRetentionPolicies.companyId, companyId),
            isNull(dataRetentionPolicies.deletedAt),
          ),
        )
        .limit(1);

      const existing = existingRows[0] as RetentionPolicyRow | undefined;
      // FAIL-CLOSED: 0 row (không tồn tại / tenant khác / đã xóa) → 404, KHÔNG NPE/500 khi audit snapshot.
      if (!existing) {
        throw new NotFoundException({
          code: FOUNDATION_ERROR_CODES.RETENTION_POLICY_NOT_FOUND,
          message: `Không tìm thấy chính sách lưu trữ id=${policyId}.`,
        });
      }

      const now = new Date();
      const updatedRows = await tx
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
          updatedBy: actor?.id ?? input.updatedBy ?? null,
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

      const updated = updatedRows[0] as RetentionPolicyRow;

      // (3) Audit CÙNG tx (append-only). object_type ∈ AUDIT_OBJECT_TYPES + CHECK DB (mig 0456).
      await this.audit.record(tx, {
        action: "RetentionPolicyUpdated",
        actionGroup: "CONFIG_UPDATE",
        objectType: "retention_policy",
        objectId: updated.id,
        actorUserId: actor?.id ?? input.updatedBy ?? undefined,
        actorType: "User",
        moduleCode: updated.moduleCode,
        entityType: "retention_policy",
        entityId: updated.id,
        oldValues: toRetentionAuditSnapshot(existing),
        newValues: toRetentionAuditSnapshot(updated),
        sensitivityLevel: "Sensitive",
        resultStatus: "Success",
        dataScope: "Company",
        permissionCode: "FOUNDATION.RETENTION.MANAGE",
      });

      return updated;
    });
  }

  /**
   * Danh sách MỌI chính sách của tenant (deleted_at IS NULL), GỒM CẢ policy disabled (is_enabled=false) —
   * cho màn hình quản trị retention (S2-FE-FND-6). withTenant + RLS ép company_id. company_id = companyId
   * tường minh (KHÔNG kèm global NULL — chỉ policy của tenant). Sắp module_code, entity_type ổn định.
   */
  async listPolicies(companyId: string): Promise<RetentionPolicyRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select()
        .from(dataRetentionPolicies)
        .where(
          and(
            eq(dataRetentionPolicies.companyId, companyId),
            isNull(dataRetentionPolicies.deletedAt),
          ),
        )
        .orderBy(asc(dataRetentionPolicies.moduleCode), asc(dataRetentionPolicies.entityType));
      return rows as RetentionPolicyRow[];
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

      // FAIL-CLOSED: 0 row (không tồn tại / tenant khác — RLS che / đã xoá) → 404, KHÔNG cast NPE → 500.
      const policy = policyRows[0] as RetentionPolicyRow | undefined;
      if (!policy) {
        throw new NotFoundException({
          code: FOUNDATION_ERROR_CODES.RETENTION_POLICY_NOT_FOUND,
          message: `Không tìm thấy chính sách lưu trữ id=${policyId}.`,
        });
      }
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

      // FAIL-CLOSED: 0 row (không tồn tại / tenant khác — RLS che / đã xoá) → 404, KHÔNG cast NPE → 500.
      const policy = policyRows[0] as RetentionPolicyRow | undefined;
      if (!policy) {
        throw new NotFoundException({
          code: FOUNDATION_ERROR_CODES.RETENTION_POLICY_NOT_FOUND,
          message: `Không tìm thấy chính sách lưu trữ id=${policyId}.`,
        });
      }
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

      const eligibleCount = await this._countEligible(tx, companyId, policy.entityType, cutoffTime);

      // BẤT BIẾN #2: bảng được bảo vệ (append-only/ledger HOẶC cascade-guard org_units/projects) KHÔNG bao giờ được xóa.
      if (RetentionService.PROTECTED_TABLES.has(policy.entityType)) {
        this.logger.warn(
          `runCleanup: policy=${policyId} entity=${policy.entityType} là bảng được bảo vệ — bỏ qua (BẤT BIẾN #2)`,
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

/**
 * Snapshot cấu hình policy cho audit before/after (BẤT BIẾN #3). CHỈ field CẤU HÌNH — KHÔNG id/companyId/
 * createdBy/updatedBy/metadata/deletedAt (nội bộ). data_retention_policies KHÔNG có cột secret/PII nên
 * snapshot an toàn; AuditService vẫn mask + tính changed_fields (chỉ TÊN field) như phòng thủ chiều sâu.
 */
function toRetentionAuditSnapshot(row: RetentionPolicyRow): Record<string, unknown> {
  return {
    moduleCode: row.moduleCode,
    entityType: row.entityType,
    retentionDays: row.retentionDays,
    cleanupAction: row.cleanupAction,
    archiveAfterDays: row.archiveAfterDays,
    deleteAfterDays: row.deleteAfterDays,
    isLegalHoldSupported: row.isLegalHoldSupported,
    isEnabled: row.isEnabled,
    description: row.description,
  };
}
