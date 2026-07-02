import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AdminUserDto,
  AdminUserListDto,
  ListUsersQuery,
  UpdateUserRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import type { User } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { AuthService } from "../auth/auth.service";
import { AdminUsersRepository, adminUserSnapshot } from "./admin-users.repository";

/** Actor = admin đang thao tác (id/companyId từ JWT — KHÔNG nhận từ body — BẤT BIẾN #1). */
export interface AdminActor {
  id: string;
  companyId: string;
}

/** Map row → DTO view. KHÔNG passwordHash (BẤT BIẾN #3) — chỉ phơi cột non-secret. */
function toDto(row: User): AdminUserDto {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status as AdminUserDto["status"],
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

const USER_NOT_FOUND = "Không tìm thấy người dùng.";
const CANNOT_TARGET_SELF = "Không thể thực hiện thao tác này trên chính tài khoản của bạn.";

/**
 * ACCT-2 AdminUsersService — quản trị user (list/get/update/suspend/reactivate/soft-delete). MỌI thao tác
 * qua db.withTenant(companyId) + repo WHERE company_id (BẤT BIẾN #1). Audit ghi TRONG cùng tx (append-only,
 * cùng commit/rollback — BẤT BIẾN #2). Thao tác nhạy cảm (suspend/delete) self-guard chống lockout.
 * Cross-tenant / không tồn tại / đã xoá → NotFound (RLS che, KHÔNG lộ tồn tại — no-op an toàn, không audit rác).
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AdminUsersRepository,
    private readonly audit: AuditService,
    // S2-AUTH-BE-9: suspend = thu hồi MỌI phiên qua AuthService.revokeAllForUserTx (đối xứng lock).
    // UsersModule đã imports forwardRef(AuthModule) + AuthModule export AuthService.
    private readonly auth: AuthService,
  ) {}

  /** GET /users — danh sách LIVE + tổng. Chỉ đọc (không audit). */
  async listUsers(companyId: string, query: ListUsersQuery): Promise<AdminUserListDto> {
    return this.db.withTenant(companyId, async (tx) => {
      const { rows, total } = await this.repo.findManyTx(tx, companyId, {
        status: query.status,
        q: query.q,
        limit: query.limit,
        offset: query.offset,
      });
      return { users: rows.map(toDto), total };
    });
  }

  /** GET /users/:id — 1 user LIVE. Không thấy / cross-tenant (RLS) → NotFound. */
  async getUser(companyId: string, id: string): Promise<AdminUserDto> {
    return this.db.withTenant(companyId, async (tx) => {
      const row = await this.repo.findByIdTx(tx, companyId, id);
      if (!row) throw new NotFoundException(USER_NOT_FOUND);
      return toDto(row);
    });
  }

  /** PATCH /users/:id — sửa hồ sơ (fullName). Không khớp (không thấy/đã xoá) → NotFound, KHÔNG audit rác. */
  async updateUser(actor: AdminActor, id: string, dto: UpdateUserRequest): Promise<AdminUserDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      const updated = await this.repo.updateProfileTx(tx, actor.companyId, id, dto.fullName);
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      await this.audit.record(tx, {
        action: "user.updated",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: adminUserSnapshot(before),
        after: adminUserSnapshot(updated),
      });
      return toDto(updated);
    });
  }

  /** POST /users/:id/suspend — status='suspended'. Self-guard (chống lockout). Không khớp → NotFound. */
  async suspendUser(actor: AdminActor, id: string, reason?: string): Promise<AdminUserDto> {
    this.assertNotSelf(actor, id);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);
      const updated = await this.repo.setStatusTx(tx, actor.companyId, id, "suspended");
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      // S2-AUTH-BE-9: tạm khoá = thu hồi MỌI phiên (refresh_tokens + user_sessions) NGAY trong CÙNG tx
      // (đối xứng lock). Refresh token cũ trình lại → 401 tức thì. count vào audit after.
      const revokedSessionCount = await this.auth.revokeAllForUserTx(tx, id, "suspended");
      await this.audit.record(tx, {
        action: "user.suspended",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: adminUserSnapshot(before),
        after: { ...adminUserSnapshot(updated), reason: reason ?? null, revokedSessionCount },
      });
      return toDto(updated);
    });
  }

  /** POST /users/:id/reactivate — đòi status hiện='suspended' → 'active'. Không khớp → NotFound/BadRequest. */
  async reactivateUser(actor: AdminActor, id: string): Promise<AdminUserDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);
      if (before.status !== "suspended") {
        throw new BadRequestException("Chỉ có thể mở khoá tài khoản đang bị tạm khoá.");
      }
      const updated = await this.repo.setStatusTx(tx, actor.companyId, id, "active");
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      await this.audit.record(tx, {
        action: "user.reactivated",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: adminUserSnapshot(before),
        after: adminUserSnapshot(updated),
      });
      return toDto(updated);
    });
  }

  /**
   * DELETE /users/:id — XOÁ-MỀM (set deleted_at + status). KHÔNG hard-delete (BẤT BIẾN #2). Self-guard.
   * Đã xoá / không thấy → NotFound (no-op, KHÔNG audit rác).
   */
  async softDeleteUser(actor: AdminActor, id: string): Promise<AdminUserDto> {
    this.assertNotSelf(actor, id);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      const deleted = await this.repo.softDeleteTx(tx, actor.companyId, id);
      if (!deleted) throw new NotFoundException(USER_NOT_FOUND);
      await this.audit.record(tx, {
        action: "user.deleted",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: adminUserSnapshot(before),
        after: adminUserSnapshot(deleted),
      });
      return toDto(deleted);
    });
  }

  /** Chống tự khoá/xoá chính mình (lockout). actor.id === target → BadRequest TRƯỚC khi chạm DB. */
  private assertNotSelf(actor: AdminActor, id: string): void {
    if (actor.id === id) throw new BadRequestException(CANNOT_TARGET_SELF);
  }
}
