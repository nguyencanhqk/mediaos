import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateDepartmentRequest, UpdateDepartmentRequest } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { isUniqueViolation } from "../common/db-error";
import { HrDepartmentRepository } from "./hr-department.repository";

/**
 * S2-HR-BE-3 — HR department service.
 * Business logic: cycle detection (parent_id), soft-delete, audit logging.
 * BẤT BIẾN #1: company_id ở mọi query (qua repository + withTenant).
 * BẤT BIẾN #2: soft-delete (deleted_at), audit append-only.
 */
@Injectable()
export class HrDepartmentService {
  constructor(
    private readonly repo: HrDepartmentRepository,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  listDepartments(companyId: string, status?: string) {
    return this.repo.listDepartments(companyId, status);
  }

  /**
   * managerEmployeeId (DTO) = EMPLOYEE id trưởng phòng theo spec (DB-03 §15 rule 5: "employee active
   * cùng company"); cột lưu hiện thực hoá là org_units.head_user_id (FK users — legacy, xem
   * erd-current Phụ lục A) nên phải resolve user liên kết. Chạy TRONG withTenant tx (RLS lọc —
   * employee tenant khác = 0 row → 400, KHÔNG rò tồn tại).
   */
  private async resolveManagerUserId(
    companyId: string,
    managerEmployeeId: string,
    tx: TenantTx,
  ): Promise<string> {
    const rows = await this.repo.findManagerCandidate(companyId, managerEmployeeId, tx);
    const employee = rows[0];
    if (!employee) {
      throw new BadRequestException("Manager employee does not exist in this company");
    }
    if (employee.status !== "active") {
      throw new BadRequestException("Manager employee must be active");
    }
    if (!employee.userId) {
      throw new BadRequestException("Manager employee has no linked user account");
    }
    return employee.userId;
  }

  async getDepartment(companyId: string, id: string) {
    const rows = await this.repo.findDepartmentById(companyId, id);
    if (!rows[0]) throw new NotFoundException("Department not found");
    return rows[0];
  }

  async createDepartment(companyId: string, actorUserId: string, dto: CreateDepartmentRequest) {
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        // PRE-INSERT: validate parentId exists in the same company (BẤT BIẾN #1 — company_id query).
        // DB-generated UUIDs are always fresh, so post-insert self-ref checks are a no-op.
        // Must run INSIDE tx so the lookup is part of the same tenant context.
        if (dto.parentId) {
          const parentRows = await this.repo.findDepartmentById(companyId, dto.parentId, tx);
          if (!parentRows[0]) {
            throw new BadRequestException(
              "Parent department does not exist in this company (HR-ERR-016)",
            );
          }
        }

        // Trưởng phòng: DTO mang EMPLOYEE id (đúng spec) → resolve user liên kết trong CÙNG tx.
        const headUserId = dto.managerEmployeeId
          ? await this.resolveManagerUserId(companyId, dto.managerEmployeeId, tx)
          : null;

        const rows = await this.repo.createDepartment(
          companyId,
          {
            name: dto.name,
            code: dto.code ?? null,
            parentId: dto.parentId ?? null,
            headUserId,
            description: dto.description ?? null,
            status: dto.status ?? "active",
          },
          tx,
        );
        const created = rows[0];
        if (!created) throw new Error("Failed to create department");

        await this.audit.record(tx, {
          action: "create",
          objectType: "org_unit",
          objectId: created.id,
          actorUserId,
          after: {
            name: dto.name,
            code: dto.code,
            parentId: dto.parentId,
            managerEmployeeId: dto.managerEmployeeId,
            headUserId,
          },
        });

        return created;
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (isUniqueViolation(err)) {
        throw new ConflictException("Department name or code already exists");
      }
      throw err;
    }
  }

  async updateDepartment(
    companyId: string,
    actorUserId: string,
    id: string,
    dto: UpdateDepartmentRequest,
  ) {
    // Cycle detection: if parentId is being changed, validate no cycle results.
    if (dto.parentId !== undefined && dto.parentId !== null) {
      // Self-reference: direct check
      if (dto.parentId === id) {
        throw new BadRequestException("Department cannot reference itself as parent (HR-ERR-016)");
      }
      // Transitive cycle: proposed parentId must not be a descendant of current dept.
      // We get ancestors of the proposed parent; if 'id' appears there, it means
      // proposed parent is a descendant of 'id' → cycle.
      const ancestors = await this.repo.getAncestors(companyId, dto.parentId);
      if (ancestors.includes(id)) {
        throw new BadRequestException(
          "Setting this parent would create a circular department hierarchy (HR-ERR-016)",
        );
      }
    }

    // Fetch before-state for audit
    const before = await this.repo.findDepartmentById(companyId, id);
    if (!before[0]) throw new NotFoundException("Department not found");

    try {
      return await this.db.withTenant(companyId, async (tx) => {
        // undefined = không đổi trưởng phòng · null = GỠ · uuid = EMPLOYEE id → resolve user liên kết.
        const headUserId =
          dto.managerEmployeeId == null
            ? dto.managerEmployeeId
            : await this.resolveManagerUserId(companyId, dto.managerEmployeeId, tx);

        const rows = await this.repo.updateDepartment(
          companyId,
          id,
          {
            name: dto.name,
            code: dto.code,
            parentId: dto.parentId,
            headUserId,
            description: dto.description,
            status: dto.status,
          },
          tx,
        );
        const updated = rows[0];
        if (!updated) throw new NotFoundException("Department not found");

        await this.audit.record(tx, {
          action: "update",
          objectType: "org_unit",
          objectId: id,
          actorUserId,
          before: {
            name: before[0].name,
            code: before[0].code,
            parentId: before[0].parentId,
            status: before[0].status,
            headUserId: before[0].headUserId,
          },
          after: {
            name: dto.name,
            code: dto.code,
            parentId: dto.parentId,
            status: dto.status,
            managerEmployeeId: dto.managerEmployeeId,
            headUserId,
          },
        });

        return updated;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Department name or code already exists");
      }
      throw err;
    }
  }

  async deleteDepartment(companyId: string, actorUserId: string, id: string) {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await this.repo.softDeleteDepartment(companyId, id, tx);
      if (rows.length === 0) throw new NotFoundException("Department not found");

      await this.audit.record(tx, {
        action: "delete",
        objectType: "org_unit",
        objectId: id,
        actorUserId,
        before: { id },
      });
    });
  }
}
