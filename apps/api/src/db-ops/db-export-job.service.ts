import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  type DbExportJobCreate,
  type DbExportJobDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { ObjectStorageService } from "../storage/object-storage.service";
import { OperatorActionAuditService } from "../platform/operator-action-audit.service";
import { assertColumnsAllowed, assertTableAllowed } from "./db-ops-allowlist";
import { AUDIT_DB_EXPORT } from "./db-ops.constants";
import { DbExportJobRepository, type DbExportJobRow } from "./db-export-job.repository";
import { DbOpsGrantRepository } from "./db-ops-grant.repository";

export interface OperatorUser {
  id: string;
  companyId: string;
}

/**
 * DbExportJobService (🔴 AC-9 P4 — scaffold; worker materialize DEFER). create/list/status.
 *
 * Gate: assertGrantActive (break-glass 'active' còn hạn cho target) — fail-closed 403, mirror data-browser.
 * Table/filter cột ∈ allowlist (default-DENY → 400). create ghi audit operator.db_export (object_type=
 * 'company') trong tx withTenant(target) RIÊNG. KHÔNG worker chạy thật (chỉ enqueue 'queued' + record).
 */
@Injectable()
export class DbExportJobService {
  private readonly logger = new Logger(DbExportJobService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DbExportJobRepository,
    private readonly grants: DbOpsGrantRepository,
    private readonly operatorAudit: OperatorActionAuditService,
    private readonly storage: ObjectStorageService,
  ) {}

  async createJob(operator: OperatorUser, input: DbExportJobCreate): Promise<DbExportJobDto> {
    const table = assertTableAllowed(input.table);
    const filters = (input.filters ?? []).map((f) => {
      assertColumnsAllowed(table, [f.column]); // 400 nếu cột ngoài allowlist
      return { column: f.column, value: f.value };
    });

    await this.assertGrantActive(operator, input.targetCompanyId);

    const filterJson = filters.length ? filters : null;
    const job = await this.db.withTransaction((tx) =>
      this.repo.insertJobTx(tx, {
        requesterUserId: operator.id,
        targetTenantId: input.targetCompanyId,
        tableName: table,
        filter: filterJson,
      }),
    );

    // Audit fail-closed (mirror data-browser): KHÔNG row data, chỉ metadata (table + filter cột).
    await this.db.withTenant(input.targetCompanyId, async (tx) => {
      await this.operatorAudit.recordOperatorAction(tx, {
        operatorId: operator.id,
        targetTenantId: input.targetCompanyId,
        action: AUDIT_DB_EXPORT,
        objectId: job.id,
        after: { table, filters: filters.map((f) => f.column), status: job.status },
      });
    });

    return this.toDto(job);
  }

  async listJobs(operator: OperatorUser): Promise<DbExportJobDto[]> {
    const rows = await this.db.withTransaction((tx) =>
      this.repo.listJobsForRequesterTx(tx, operator.id),
    );
    return rows.map((r) => this.toDto(r));
  }

  async getJob(operator: OperatorUser, jobId: string): Promise<DbExportJobDto> {
    const job = await this.db.withTransaction((tx) => this.repo.findJobByIdTx(tx, jobId));
    if (!job || job.requesterUserId !== operator.id) {
      throw new NotFoundException("Export job not found.");
    }
    const dto = this.toDto(job);
    // Download URL EPHEMERAL: presign ON-DEMAND chỉ khi 'done' + có object_key + storage cấu hình. KHÔNG
    // persist URL (BẤT BIẾN #3). assertKeyInTenant (trong createDownloadUrl) ép key thuộc prefix target.
    if (dto.status === "done" && job.objectKey) {
      if (this.storage.isConfigured()) {
        dto.downloadUrl = await this.storage.createDownloadUrl(job.objectKey, job.targetTenantId);
      } else {
        // KHÔNG nuốt im lặng: job 'done' có file nhưng storage chưa cấu hình ở deployment này ⇒ downloadUrl
        // null KHÔNG có tín hiệu — log WARN để ops chẩn đoán (thay vì dead-end im lặng).
        this.logger.warn(
          `export job ${job.id} 'done' có object_key nhưng storage chưa cấu hình — downloadUrl=null.`,
        );
      }
    }
    return dto;
  }

  private async assertGrantActive(operator: OperatorUser, targetTenantId: string): Promise<void> {
    const grant = await this.db.withTransaction((tx) =>
      this.grants.findActiveGrantForTargetTx(tx, operator.id, targetTenantId),
    );
    if (!grant) {
      throw new ForbiddenException(
        "Export yêu cầu 1 break-glass grant đang ACTIVE còn hạn cho tenant này.",
      );
    }
  }

  private toDto(row: DbExportJobRow): DbExportJobDto {
    return {
      id: row.id,
      requesterUserId: row.requesterUserId,
      targetTenantId: row.targetTenantId,
      tableName: row.tableName,
      filter: row.filter ?? null,
      status: row.status as DbExportJobDto["status"],
      rowCount: row.rowCount ?? null,
      error: row.error ?? null,
      downloadUrl: null, // set on-demand ở getJob khi 'done' (presigned ephemeral).
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  }
}
