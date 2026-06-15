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
  AssignRoleRequest,
  RemoveObjectPermissionRequest,
  SetObjectPermissionRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "./permission.service";
import { PermissionAdminRepository, type ObjectPermissionKey } from "./permission-admin.repository";

const PG_FK_VIOLATION = "23503";
const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";

type RequestUser = { id: string; companyId: string };

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? ((err as Record<string, unknown>)["code"] as string | undefined)
    : undefined;
}

/** So sánh hai expiry (timestamptz | null) — coi 2 null là bằng nhau. */
function sameExpiry(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}

/**
 * PermissionAdminService (G3 mutation-path) — quản lý phân quyền RUNTIME (CROWN JEWEL).
 *
 * Đóng nốt DoD G3-4 (docs/reviews/g3-gates.md §4.1): trước đây KHÔNG có endpoint gán/thu role hay
 * set object-permission ⇒ KHÔNG ai emit `permission.changed` ⇒ cache chỉ dựa TTL 300s + 0 audit.
 *
 * HỢP ĐỒNG mọi mutation (permission.module.ts §CONTRACT) — TRONG CÙNG 1 transaction:
 *   1) ghi row (user_roles / object_permissions),
 *   2) audit_logs (BẤT BIẾN #2 / CLAUDE.md §8),
 *   3) emit `permission.changed { userId, companyId }` (PermissionCacheInvalidator DEL cap-key <100ms).
 * Role-subject object-grant → fan-out 1 event / user đang giữ role (cache key per-user).
 *
 * Fail-closed: mỗi mutation NHẠY CẢM (leo thang đặc quyền) ⇒ permission.can isSensitive=TRUE
 * (wildcard *:* KHÔNG kế thừa). Quyền: assign-role:user · grant-object-permission:permission.
 */
@Injectable()
export class PermissionAdminService {
  private readonly logger = new Logger(PermissionAdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly repo: PermissionAdminRepository,
  ) {}

  // ── (A) gán / thu role cho user (user_roles) ─────────────────────────────────

  async assignRole(actor: RequestUser, targetUserId: string, dto: AssignRoleRequest) {
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        await this.assertCan(actor, "assign-role", "user", targetUserId);

        // Validate trước (FK không ép tenant cho user_id; role có thể là system role).
        if (!(await this.repo.findAssignableRole(tx, dto.roleId))) {
          throw new NotFoundException("Role not found");
        }
        if (!(await this.repo.findUserInTenant(tx, actor.companyId, targetUserId))) {
          throw new NotFoundException("User not found");
        }

        const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
        const existing = await this.repo.findUserRole(
          tx,
          actor.companyId,
          targetUserId,
          dto.roleId,
        );

        // Đã gán + cùng expiry ⇒ no-op idempotent (cache đã nhất quán, không audit/emit lại).
        if (existing && sameExpiry(existing.expiresAt, expiresAt)) {
          return existing;
        }
        // Đổi expiry: KHÔNG có UPDATE grant ⇒ DELETE + INSERT.
        if (existing) {
          await this.repo.deleteUserRole(tx, actor.companyId, targetUserId, dto.roleId);
        }

        const inserted = await this.repo.insertUserRole(tx, {
          companyId: actor.companyId,
          userId: targetUserId,
          roleId: dto.roleId,
          grantedBy: actor.id,
          expiresAt,
        });
        if (!inserted) {
          // Mất race với một assign song song cùng key → 23505 đã nuốt ở onConflictDoNothing.
          throw new ConflictException("Role assignment already exists");
        }

        await this.audit.record(tx, {
          action: existing ? "RoleReassigned" : "RoleAssigned",
          objectType: "user_role",
          objectId: inserted.id,
          actorUserId: actor.id,
          before: existing ? { roleId: existing.roleId, expiresAt: existing.expiresAt } : null,
          after: { userId: targetUserId, roleId: dto.roleId, expiresAt },
        });
        await this.emitPermissionChangedForUser(tx, actor.companyId, targetUserId);

        return inserted;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to assign role");
    }
  }

  async revokeRole(actor: RequestUser, targetUserId: string, roleId: string) {
    try {
      await this.db.withTenant(actor.companyId, async (tx) => {
        await this.assertCan(actor, "assign-role", "user", targetUserId);

        const deletedId = await this.repo.deleteUserRole(
          tx,
          actor.companyId,
          targetUserId,
          roleId,
        );
        if (!deletedId) {
          throw new NotFoundException("User does not have this role");
        }

        await this.audit.record(tx, {
          action: "RoleRevoked",
          objectType: "user_role",
          objectId: deletedId,
          actorUserId: actor.id,
          before: { userId: targetUserId, roleId },
        });
        await this.emitPermissionChangedForUser(tx, actor.companyId, targetUserId);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to revoke role");
    }
  }

  // ── (B) object-permission override (object_permissions) ──────────────────────

  async setObjectPermission(actor: RequestUser, dto: SetObjectPermissionRequest) {
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
        await this.assertCan(actor, "grant-object-permission", "permission", null);

        const permissionId = await this.resolvePermissionId(tx, dto.action, dto.resourceType);
        await this.assertSubjectExists(tx, actor.companyId, dto.subjectType, dto.subjectId);

        const key: ObjectPermissionKey = {
          companyId: actor.companyId,
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
          permissionId,
          objectType: dto.objectType,
          objectId: dto.objectId,
        };

        const existing = await this.repo.findObjectPermission(tx, key);
        // Cùng effect ⇒ no-op idempotent.
        if (existing && existing.effect === dto.effect) {
          return existing;
        }
        // Đổi effect: KHÔNG có UPDATE grant ⇒ DELETE + INSERT (flip).
        if (existing) {
          await this.repo.deleteObjectPermissionByKey(tx, key);
        }

        const inserted = await this.repo.insertObjectPermission(tx, {
          companyId: actor.companyId,
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
          permissionId,
          objectType: dto.objectType,
          objectId: dto.objectId,
          effect: dto.effect,
          grantedBy: actor.id,
        });

        await this.audit.record(tx, {
          action: "ObjectPermissionSet",
          objectType: "object_permission",
          objectId: inserted.id,
          actorUserId: actor.id,
          before: existing ? { effect: existing.effect } : null,
          after: {
            subjectType: dto.subjectType,
            subjectId: dto.subjectId,
            action: dto.action,
            resourceType: dto.resourceType,
            objectType: dto.objectType,
            objectId: dto.objectId,
            effect: dto.effect,
          },
        });
        await this.emitPermissionChangedForSubject(tx, actor.companyId, dto.subjectType, dto.subjectId);

        return inserted;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to set object permission");
    }
  }

  async removeObjectPermission(actor: RequestUser, dto: RemoveObjectPermissionRequest) {
    try {
      await this.db.withTenant(actor.companyId, async (tx) => {
        await this.assertCan(actor, "grant-object-permission", "permission", null);

        const permissionId = await this.resolvePermissionId(tx, dto.action, dto.resourceType);
        const key: ObjectPermissionKey = {
          companyId: actor.companyId,
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
          permissionId,
          objectType: dto.objectType,
          objectId: dto.objectId,
        };

        const deleted = await this.repo.deleteObjectPermissionByKeyEffect(tx, key, dto.effect);
        if (!deleted) {
          throw new NotFoundException("Object permission not found");
        }

        await this.audit.record(tx, {
          action: "ObjectPermissionRemoved",
          objectType: "object_permission",
          objectId: deleted.id,
          actorUserId: actor.id,
          before: {
            subjectType: dto.subjectType,
            subjectId: dto.subjectId,
            action: dto.action,
            resourceType: dto.resourceType,
            objectType: dto.objectType,
            objectId: dto.objectId,
            effect: dto.effect,
          },
        });
        await this.emitPermissionChangedForSubject(tx, actor.companyId, dto.subjectType, dto.subjectId);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to remove object permission");
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  /** Fail-closed sensitive gate. resourceId null = type-level (vẫn ép explicit non-wildcard ALLOW). */
  private async assertCan(
    actor: RequestUser,
    action: string,
    resourceType: string,
    resourceId: string | null,
  ): Promise<void> {
    const decision = await this.permissionService.can({
      userId: actor.id,
      companyId: actor.companyId,
      action,
      resourceType,
      resourceId,
      isSensitive: true,
      // Không phải reveal-secret ⇒ company-level explicit ALLOW là đủ (KHÔNG cần object-grant).
      objectGrantRequired: false,
    });
    if (!decision.allow) {
      throw new ForbiddenException("Insufficient permission to manage permissions");
    }
  }

  private async resolvePermissionId(
    tx: TenantTx,
    action: string,
    resourceType: string,
  ): Promise<string> {
    const id = await this.repo.findPermissionId(tx, action, resourceType);
    if (!id) {
      throw new BadRequestException(`Unknown permission: ${action}:${resourceType}`);
    }
    return id;
  }

  private async assertSubjectExists(
    tx: TenantTx,
    companyId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<void> {
    const found =
      subjectType === "role"
        ? await this.repo.findAssignableRole(tx, subjectId)
        : await this.repo.findUserInTenant(tx, companyId, subjectId);
    if (!found) {
      throw new NotFoundException(`Subject not found: ${subjectType} ${subjectId}`);
    }
  }

  private async emitPermissionChangedForUser(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<void> {
    await this.outbox.enqueue(tx, {
      eventType: "permission.changed",
      payload: { userId, companyId },
    });
  }

  /** user → 1 event; role → fan-out 1 event / user đang giữ role (0 user ⇒ chỉ TTL phủ tương lai). */
  private async emitPermissionChangedForSubject(
    tx: TenantTx,
    companyId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<void> {
    if (subjectType === "user") {
      await this.emitPermissionChangedForUser(tx, companyId, subjectId);
      return;
    }
    const userIds = await this.repo.findUserIdsWithRole(tx, companyId, subjectId);
    for (const userId of userIds) {
      await this.emitPermissionChangedForUser(tx, companyId, userId);
    }
  }

  /** PG/infra → 500 generic (KHÔNG leak schema); FK/unique/check → 4xx; HttpException giữ nguyên. */
  private mapError(err: unknown, context: string): HttpException {
    if (err instanceof HttpException) return err;
    const code = pgCode(err);
    if (code === PG_FK_VIOLATION) {
      return new BadRequestException("Referenced entity does not exist");
    }
    if (code === PG_UNIQUE_VIOLATION) {
      return new ConflictException("Permission grant already exists");
    }
    if (code === PG_CHECK_VIOLATION) {
      return new BadRequestException("Invalid permission grant");
    }
    this.logger.error(context, err instanceof Error ? err.stack : String(err));
    return new InternalServerErrorException(context);
  }
}
