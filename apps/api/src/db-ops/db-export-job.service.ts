import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  type DbExportJobCreate,
  type DbExportJobDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
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
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DbExportJobRepository,
    private readonly grants: DbOpsGrantRepository,
    private readonly operatorAudit: OperatorActionAuditService,
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
    return this.toDto(job);
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
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  }
}
