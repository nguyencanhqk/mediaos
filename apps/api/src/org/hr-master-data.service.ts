import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateJobLevelRequest,
  UpdateJobLevelRequest,
  CreateContractTypeRequest,
  UpdateContractTypeRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { isUniqueViolation } from "../common/db-error";
import { HrMasterDataRepository } from "./hr-master-data.repository";

/**
 * S2-HR-BE-3 — HR master data service (job_levels + contract_types).
 * Permission gate: manage:master-data (on controller via PermissionGuard).
 * BẤT BIẾN #1: company_id ở mọi query (qua repo + withTenant).
 * BẤT BIẾN #2: soft-delete, audit append-only cùng tx.
 */
@Injectable()
export class HrMasterDataService {
  constructor(
    private readonly repo: HrMasterDataRepository,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Job Levels ────────────────────────────────────────────────────────────────

  listJobLevels(companyId: string, status?: string) {
    return this.repo.listJobLevels(companyId, status);
  }

  async getJobLevel(companyId: string, id: string) {
    const rows = await this.repo.findJobLevelById(companyId, id);
    if (!rows[0]) throw new NotFoundException("Job level not found");
    return rows[0];
  }

  async createJobLevel(companyId: string, actorUserId: string, dto: CreateJobLevelRequest) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const rows = await this.repo.createJobLevel(
          companyId,
          { code: dto.code, name: dto.name, rankOrder: dto.rankOrder },
          tx,
        );
        const created = rows[0];
        if (!created) throw new Error("Failed to create job level");

        await this.audit.record(tx, {
          action: "create",
          objectType: "job_level",
          objectId: created.id,
          actorUserId,
          after: { code: dto.code, name: dto.name, rankOrder: dto.rankOrder },
        });

        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Job level name or code already exists");
      }
      throw err;
    }
  }

  async updateJobLevel(
    companyId: string,
    actorUserId: string,
    id: string,
    dto: UpdateJobLevelRequest,
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const rows = await this.repo.updateJobLevel(
          companyId,
          id,
          {
            code: dto.code,
            name: dto.name,
            rankOrder: dto.rankOrder,
            status: dto.status,
          },
          tx,
        );
        const updated = rows[0];
        if (!updated) throw new NotFoundException("Job level not found");

        await this.audit.record(tx, {
          action: "update",
          objectType: "job_level",
          objectId: id,
          actorUserId,
          after: { code: dto.code, name: dto.name, rankOrder: dto.rankOrder, status: dto.status },
        });

        return updated;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Job level name or code already exists");
      }
      throw err;
    }
  }

  async deleteJobLevel(companyId: string, actorUserId: string, id: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await this.repo.softDeleteJobLevel(companyId, id, tx);
      if (rows.length === 0) throw new NotFoundException("Job level not found");

      await this.audit.record(tx, {
        action: "delete",
        objectType: "job_level",
        objectId: id,
        actorUserId,
        before: { id },
      });
    });
  }

  // ── Contract Types ────────────────────────────────────────────────────────────

  listContractTypes(companyId: string, status?: string) {
    return this.repo.listContractTypes(companyId, status);
  }

  async getContractType(companyId: string, id: string) {
    const rows = await this.repo.findContractTypeById(companyId, id);
    if (!rows[0]) throw new NotFoundException("Contract type not found");
    return rows[0];
  }

  async createContractType(companyId: string, actorUserId: string, dto: CreateContractTypeRequest) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const rows = await this.repo.createContractType(
          companyId,
          { code: dto.code, name: dto.name, requiresEndDate: dto.requiresEndDate },
          tx,
        );
        const created = rows[0];
        if (!created) throw new Error("Failed to create contract type");

        await this.audit.record(tx, {
          action: "create",
          objectType: "contract_type",
          objectId: created.id,
          actorUserId,
          after: { code: dto.code, name: dto.name, requiresEndDate: dto.requiresEndDate },
        });

        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Contract type name or code already exists");
      }
      throw err;
    }
  }

  async updateContractType(
    companyId: string,
    actorUserId: string,
    id: string,
    dto: UpdateContractTypeRequest,
  ) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const rows = await this.repo.updateContractType(
          companyId,
          id,
          {
            code: dto.code,
            name: dto.name,
            requiresEndDate: dto.requiresEndDate,
            status: dto.status,
          },
          tx,
        );
        const updated = rows[0];
        if (!updated) throw new NotFoundException("Contract type not found");

        await this.audit.record(tx, {
          action: "update",
          objectType: "contract_type",
          objectId: id,
          actorUserId,
          after: {
            code: dto.code,
            name: dto.name,
            requiresEndDate: dto.requiresEndDate,
            status: dto.status,
          },
        });

        return updated;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Contract type name or code already exists");
      }
      throw err;
    }
  }

  async deleteContractType(companyId: string, actorUserId: string, id: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await this.repo.softDeleteContractType(companyId, id, tx);
      if (rows.length === 0) throw new NotFoundException("Contract type not found");

      await this.audit.record(tx, {
        action: "delete",
        objectType: "contract_type",
        objectId: id,
        actorUserId,
        before: { id },
      });
    });
  }
}
