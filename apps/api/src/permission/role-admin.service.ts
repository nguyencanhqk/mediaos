import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  AssignRolePermissionRequest,
  CreateRoleRequest,
  RevokeRolePermissionRequest,
  RoleWriteResultDto,
  UpdateRoleRequest,
} from "@mediaos/contracts";
import type { Role } from "../db/schema";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PermissionService } from "./permission.service";
import { RoleAdminRepository } from "./role-admin.repository";
import {
  pgErrorCode,
  pgErrorField,
  PG_CHECK_VIOLATION,
  PG_FK_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "../common/db-error";

type RequestUser = { id: string; companyId: string };

/** SCOPE CEILING (S2-AUTH-BE-6 done_when — CHỐT 2026-07-02): dataScope gán cho role PHẢI ≤ Company. */
const MAX_ASSIGNABLE_DATA_SCOPE = "System";

/**
 * DTO write result cho create/update role — CHỈ field theo roleWriteResultSchema (S2-AUTH-BE-6/11),
 * KHÔNG lộ deletedAt (soft-delete internal). requiresTwoFactor phản chiếu roles.requires_two_factor.
 */
function toRoleWriteResult(role: Role): RoleWriteResultDto {
  return {
    id: role.id,
    companyId: role.companyId,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    requiresTwoFactor: role.requiresTwoFactor,
  };
}

/**
 * RoleAdminService (S2-AUTH-BE-6) — quản lý role WRITE (create/update, KHÔNG sửa system role) + gán/gỡ
 * permission cho role (role_permissions). CROWN JEWEL — chống leo thang đặc quyền.
 *
 * HỢP ĐỒNG mọi mutation — TRONG CÙNG 1 transaction: (1) ghi row (roles/role_permissions),
 * (2) audit_logs (BẤT BIẾN #2). role_permissions KHÔNG emit permission.changed cache-invalidation ở đây
 * (out-of-scope done_when S2-AUTH-BE-6 — theo dõi ở S2-AUTH-BE-6 follow-up nếu cần realtime).
 *
 * Permission gate: create/update:role (seed 0005, is_sensitive=false, company-admin đã có sẵn) ·
 * assign:permission (seed 0460, is_sensitive=true — ANTI-ESCALATION pin company-admin, KHÔNG kế thừa
 * wildcard, KHÔNG mirror grant thực actor — N=1 chưa có non-admin giữ assign:permission).
 */
@Injectable()
export class RoleAdminService {
  private readonly logger = new Logger(RoleAdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly repo: RoleAdminRepository,
  ) {}

  // ── (A) create / update role ─────────────────────────────────────────────────

  async createRole(actor: RequestUser, dto: CreateRoleRequest): Promise<RoleWriteResultDto> {
    await this.assertCan(actor, "create", "role", false);
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        const inserted = await this.repo.insertRoleTx(tx, {
          companyId: actor.companyId,
          name: dto.name,
          description: dto.description ?? null,
          // Optional ⇒ client cũ không gửi → false (non-breaking). Chỉ role thường (insert is_system=false).
          requiresTwoFactor: dto.requiresTwoFactor ?? false,
        });

        await this.audit.record(tx, {
          action: "RoleCreated",
          objectType: "role",
          objectId: inserted.id,
          actorUserId: actor.id,
          before: null,
          after: {
            name: inserted.name,
            description: inserted.description,
            requiresTwoFactor: inserted.requiresTwoFactor,
          },
        });

        return toRoleWriteResult(inserted);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to create role");
    }
  }

  async updateRole(
    actor: RequestUser,
    roleId: string,
    dto: UpdateRoleRequest,
  ): Promise<RoleWriteResultDto> {
    await this.assertCan(actor, "update", "role", false);
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        const existing = await this.repo.findRoleByIdTx(tx, roleId);
        if (!existing) {
          throw new NotFoundException("Role not found");
        }
        // system-defined role (is_system=true) → KHÔNG cho sửa (kể cả khi RLS lộ nó cho tenant đọc).
        // Rule này bao trọn requiresTwoFactor: gửi cờ lên system role → REJECT 400 TRƯỚC mọi update/audit.
        if (existing.isSystem) {
          throw new BadRequestException("Cannot modify a system-defined role");
        }
        // RLS WITH CHECK cũng chặn ghi company_id khác-tenant; kiểm tường minh ở app cho lỗi rõ ràng.
        if (existing.companyId !== actor.companyId) {
          throw new NotFoundException("Role not found");
        }

        const patch: { name?: string; description?: string | null; requiresTwoFactor?: boolean } =
          {};
        if (dto.name !== undefined) patch.name = dto.name;
        if (dto.description !== undefined) patch.description = dto.description;
        if (dto.requiresTwoFactor !== undefined) patch.requiresTwoFactor = dto.requiresTwoFactor;

        if (Object.keys(patch).length === 0) {
          return toRoleWriteResult(existing);
        }

        const updated = await this.repo.updateRoleTx(tx, actor.companyId, roleId, patch);
        if (!updated) {
          throw new NotFoundException("Role not found");
        }

        await this.audit.record(tx, {
          action: "RoleUpdated",
          objectType: "role",
          objectId: updated.id,
          actorUserId: actor.id,
          before: {
            name: existing.name,
            description: existing.description,
            requiresTwoFactor: existing.requiresTwoFactor,
          },
          after: {
            name: updated.name,
            description: updated.description,
            requiresTwoFactor: updated.requiresTwoFactor,
          },
        });

        return toRoleWriteResult(updated);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to update role");
    }
  }

  // ── (B) assign / revoke permission cho role (role_permissions) ────────────────

  async assignPermissionToRole(
    actor: RequestUser,
    roleId: string,
    dto: AssignRolePermissionRequest,
  ) {
    // SCOPE CEILING (fail-closed TRƯỚC mọi DB access): dataScope='System' → 400, 0 row, 0 audit.
    if ((dto.dataScope as string) === MAX_ASSIGNABLE_DATA_SCOPE) {
      throw new BadRequestException(
        "dataScope 'System' is not assignable via role write API (scope ceiling)",
      );
    }
    // ANTI-ESCALATION: assign:permission CHỈ company-admin (isSensitive:true, wildcard KHÔNG kế thừa).
    await this.assertCan(actor, "assign", "permission", true);

    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        const role = await this.repo.findRoleByIdTx(tx, roleId);
        if (!role) {
          throw new NotFoundException("Role not found");
        }
        if (role.companyId !== null && role.companyId !== actor.companyId) {
          throw new NotFoundException("Role not found");
        }

        // Cặp KHÔNG có trong catalog → 400 (KHÔNG 500/FK error).
        const permission = await this.repo.findPermissionTx(tx, dto.action, dto.resourceType);
        if (!permission) {
          throw new BadRequestException(`Unknown permission: ${dto.action}:${dto.resourceType}`);
        }

        const existing = await this.repo.findRolePermissionTx(tx, roleId, permission.id, "ALLOW");
        // Cùng data_scope ⇒ no-op idempotent.
        if (existing && existing.dataScope === dto.dataScope) {
          return {
            roleId,
            permissionId: permission.id,
            action: dto.action,
            resourceType: dto.resourceType,
            effect: "ALLOW" as const,
            dataScope: existing.dataScope,
          };
        }
        // Đổi scope: KHÔNG có UPDATE grant ⇒ DELETE + INSERT.
        if (existing) {
          await this.repo.deleteRolePermissionReturningTx(tx, roleId, permission.id, "ALLOW");
        }

        const inserted = await this.repo.insertRolePermissionTx(tx, {
          roleId,
          permissionId: permission.id,
          effect: "ALLOW",
          dataScope: dto.dataScope,
        });
        if (!inserted) {
          throw new ConflictException("Permission grant already exists");
        }

        await this.audit.record(tx, {
          action: existing ? "PermissionReassigned" : "PermissionAssigned",
          objectType: "role_permission",
          objectId: roleId,
          actorUserId: actor.id,
          before: existing
            ? {
                action: dto.action,
                resourceType: dto.resourceType,
                effect: "ALLOW",
                dataScope: existing.dataScope,
              }
            : null,
          after: {
            action: dto.action,
            resourceType: dto.resourceType,
            effect: "ALLOW",
            dataScope: dto.dataScope,
          },
        });

        return {
          roleId,
          permissionId: permission.id,
          action: dto.action,
          resourceType: dto.resourceType,
          effect: "ALLOW" as const,
          dataScope: dto.dataScope,
        };
      });
    } catch (err) {
      throw this.mapError(err, "Failed to assign permission to role");
    }
  }

  async revokePermissionFromRole(
    actor: RequestUser,
    roleId: string,
    dto: RevokeRolePermissionRequest,
  ) {
    await this.assertCan(actor, "assign", "permission", true);

    try {
      await this.db.withTenant(actor.companyId, async (tx) => {
        const role = await this.repo.findRoleByIdTx(tx, roleId);
        if (!role) {
          throw new NotFoundException("Role not found");
        }
        if (role.companyId !== null && role.companyId !== actor.companyId) {
          throw new NotFoundException("Role not found");
        }

        const permission = await this.repo.findPermissionTx(tx, dto.action, dto.resourceType);
        if (!permission) {
          throw new BadRequestException(`Unknown permission: ${dto.action}:${dto.resourceType}`);
        }

        const deleted = await this.repo.deleteRolePermissionReturningTx(
          tx,
          roleId,
          permission.id,
          "ALLOW",
        );
        if (!deleted) {
          throw new NotFoundException("Role does not have this permission");
        }

        await this.audit.record(tx, {
          action: "PermissionRevoked",
          objectType: "role_permission",
          objectId: roleId,
          actorUserId: actor.id,
          before: {
            action: dto.action,
            resourceType: dto.resourceType,
            effect: "ALLOW",
            dataScope: deleted.dataScope,
          },
        });
      });
    } catch (err) {
      throw this.mapError(err, "Failed to revoke permission from role");
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  /**
   * Fail-closed gate — company-level explicit ALLOW đủ (KHÔNG cần object-grant).
   * isSensitive=true (assign:permission) ⇒ wildcard `*:*` KHÔNG kế thừa, cần ALLOW tường minh.
   * isSensitive=false (create/update:role — catalog is_sensitive=false, mig 0005) ⇒ wildcard hợp lệ,
   * khớp hành vi @RequirePermission không kèm { isSensitive:true } ở các controller khác (auth-users…).
   */
  private async assertCan(
    actor: RequestUser,
    action: string,
    resourceType: string,
    isSensitive: boolean,
  ): Promise<void> {
    const decision = await this.permissionService.can({
      userId: actor.id,
      companyId: actor.companyId,
      action,
      resourceType,
      resourceId: null,
      isSensitive,
      objectGrantRequired: false,
    });
    if (!decision.allow) {
      throw new ForbiddenException(`Insufficient permission: ${action}:${resourceType}`);
    }
  }

  /** PG/infra → 500 generic (KHÔNG leak schema); FK/unique/check → 4xx; HttpException giữ nguyên. */
  private mapError(err: unknown, context: string): HttpException {
    if (err instanceof HttpException) return err;
    const code = pgErrorCode(err);
    if (code === PG_FK_VIOLATION) {
      return new BadRequestException("Referenced entity does not exist");
    }
    if (code === PG_UNIQUE_VIOLATION) {
      return new ConflictException("Role name already exists");
    }
    if (code === PG_CHECK_VIOLATION) {
      return new BadRequestException("Invalid role write");
    }
    this.logger.error(context, {
      stack: err instanceof Error ? err.stack : String(err),
      pgCode: code,
      pgDetail: pgErrorField(err, "detail"),
      pgConstraint: pgErrorField(err, "constraint"),
    });
    return new InternalServerErrorException(context);
  }
}
