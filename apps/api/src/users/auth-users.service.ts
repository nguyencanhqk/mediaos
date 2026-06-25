import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { eq, sql, type SQL } from "drizzle-orm";
import type {
  AuthUserDto,
  AuthUserListDto,
  CreateAuthUserRequest,
  DataScope,
  ListAuthUsersQuery,
  UpdateAuthUserRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { users, type User } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { PasswordService } from "../auth/password.service";
import { PermissionService } from "../permission/permission.service";
import { AuthUsersRepository, authUserSnapshot } from "./auth-users.repository";

/** Actor = admin đang thao tác (id/companyId từ JWT — KHÔNG nhận từ body — BẤT BIẾN #1). */
export interface AuthUserActor {
  id: string;
  companyId: string;
}

/** Map row → DTO view. KHÔNG passwordHash/normalizedEmail (mask ở SERVER — BẤT BIẾN #3). */
function toDto(row: User): AuthUserDto {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status as AuthUserDto["status"],
    lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
    lockedReason: row.lockedReason ?? null,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const USER_NOT_FOUND = "Không tìm thấy người dùng.";
const CANNOT_TARGET_SELF = "Không thể khoá/mở khoá chính tài khoản của bạn.";
const EMAIL_TAKEN = "Email đã tồn tại trong công ty.";
const ALREADY_LOCKED = "Tài khoản đã bị khoá.";
const NOT_LOCKED = "Tài khoản chưa bị khoá.";

const VIEW_ACTION = "view";
const USER_RESOURCE = "user";

/**
 * S2-AUTH-BE-3 AuthUsersService — user admin (list/get/create/update/lock/unlock). MỌI thao tác qua
 * db.withTenant(companyId) + repo WHERE company_id (BẤT BIẾN #1). Audit ghi TRONG cùng tx (append-only,
 * cùng commit/rollback — BẤT BIẾN #2). create hash mật khẩu (argon2, BẤT BIẾN #3). lock/unlock self-guard
 * chống lockout. Cross-tenant / không tồn tại → NotFound (RLS che, KHÔNG lộ tồn tại — no-op, 0 audit rác).
 *
 * data-scope-aware (BACKEND-03 §18): list resolve strongest scope (view:user) rồi BOUND rows theo scope
 * trên BẢNG users (Company/System=tenant, Own=self) — fail-closed sql`false` khi scope null hoặc scope
 * cần org-mapping (Team/Department) chưa hỗ trợ cho users (§13 chỉ cấp Company cho view:user).
 */
@Injectable()
export class AuthUsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AuthUsersRepository,
    private readonly audit: AuditService,
    private readonly password: PasswordService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * GET /auth/users — danh sách LIVE + tổng (data-scope-aware). Chỉ đọc (không audit). PermissionGuard
   * đã gate view:user TRƯỚC; ở đây resolve scope MẠNH NHẤT để bound rows (KHÔNG match-all). Scope null
   * (về lý thuyết guard đã chặn) → predicate false (0 rows, fail-closed).
   */
  async listUsers(actor: AuthUserActor, query: ListAuthUsersQuery): Promise<AuthUserListDto> {
    const scope = await this.permissions.resolveStrongestScope(
      actor.id,
      actor.companyId,
      VIEW_ACTION,
      USER_RESOURCE,
    );
    const predicate = this.buildUserScopeCondition(scope, actor);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const { rows, total } = await this.repo.findManyTx(tx, actor.companyId, predicate, {
        status: query.status,
        q: query.q,
        limit: query.limit,
        offset: query.offset,
      });
      return { users: rows.map(toDto), total };
    });
  }

  /** GET /auth/users/:id — 1 user LIVE. Không thấy / cross-tenant (RLS) → NotFound. */
  async getUser(actor: AuthUserActor, id: string): Promise<AuthUserDto> {
    const scope = await this.permissions.resolveStrongestScope(
      actor.id,
      actor.companyId,
      VIEW_ACTION,
      USER_RESOURCE,
    );
    return this.db.withTenant(actor.companyId, async (tx) => {
      const row = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!row) throw new NotFoundException(USER_NOT_FOUND);
      // data-scope: Own-scope chỉ thấy chính mình; cross-scope target → NotFound (KHÔNG lộ tồn tại).
      if (!this.isInScope(scope, actor, row)) throw new NotFoundException(USER_NOT_FOUND);
      return toDto(row);
    });
  }

  /**
   * POST /auth/users — tạo user (hash mật khẩu). Email trùng tenant → 409. Audit 'user.created' TRONG tx
   * (snapshot KHÔNG passwordHash — BẤT BIẾN #3). Plaintext CHỈ tới PasswordService.hash, KHÔNG vào audit.
   */
  async createUser(actor: AuthUserActor, dto: CreateAuthUserRequest): Promise<AuthUserDto> {
    const passwordHash = await this.password.hash(dto.password);
    return this.db.withTenant(actor.companyId, async (tx) => {
      if (await this.repo.emailExistsTx(tx, actor.companyId, dto.email)) {
        throw new ConflictException(EMAIL_TAKEN);
      }
      const created = await this.repo.createTx(tx, actor.companyId, {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        createdBy: actor.id,
      });
      await this.audit.record(tx, {
        action: "user.created",
        objectType: "user",
        actorUserId: actor.id,
        objectId: created.id,
        after: authUserSnapshot(created),
      });
      return toDto(created);
    });
  }

  /** PATCH /auth/users/:id — sửa hồ sơ (fullName). Không khớp → NotFound, KHÔNG audit rác. */
  async updateUser(
    actor: AuthUserActor,
    id: string,
    dto: UpdateAuthUserRequest,
  ): Promise<AuthUserDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);
      const updated = await this.repo.updateProfileTx(
        tx,
        actor.companyId,
        id,
        dto.fullName,
        actor.id,
      );
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      await this.audit.record(tx, {
        action: "user.updated",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: authUserSnapshot(before),
        after: authUserSnapshot(updated),
      });
      return toDto(updated);
    });
  }

  /**
   * POST /auth/users/:id/lock — status='locked' (chặn login). Self-guard (chống lockout). Đã 'locked'
   * → 400 (no-op, KHÔNG audit rác). Không thấy / cross-tenant → NotFound TRƯỚC khi audit.
   */
  async lockUser(actor: AuthUserActor, id: string, reason?: string): Promise<AuthUserDto> {
    this.assertNotSelf(actor, id);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);
      if (before.status === "locked") throw new BadRequestException(ALREADY_LOCKED);
      const updated = await this.repo.setLockTx(tx, actor.companyId, id, actor.id, reason ?? null);
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      await this.audit.record(tx, {
        action: "user.locked",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: authUserSnapshot(before),
        after: authUserSnapshot(updated),
      });
      return toDto(updated);
    });
  }

  /**
   * POST /auth/users/:id/unlock — đòi status hiện='locked' → 'active' + clear lockedAt. Self-guard.
   * Không 'locked' → 400. Không thấy / cross-tenant → NotFound TRƯỚC khi audit.
   */
  async unlockUser(actor: AuthUserActor, id: string): Promise<AuthUserDto> {
    this.assertNotSelf(actor, id);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);
      if (before.status !== "locked") throw new BadRequestException(NOT_LOCKED);
      const updated = await this.repo.setUnlockTx(tx, actor.companyId, id, actor.id);
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      await this.audit.record(tx, {
        action: "user.unlocked",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: authUserSnapshot(before),
        after: authUserSnapshot(updated),
      });
      return toDto(updated);
    });
  }

  /** Chống tự khoá/mở khoá chính mình (lockout). actor.id === target → BadRequest TRƯỚC khi chạm DB. */
  private assertNotSelf(actor: AuthUserActor, id: string): void {
    if (actor.id === id) throw new BadRequestException(CANNOT_TARGET_SELF);
  }

  /**
   * Predicate data-scope trên BẢNG users. LUÔN mang company_id (phòng thủ kép trên RLS — KHÔNG bao giờ
   * bare match-all). Company/System (N=1) → tenant. Own → chính actor. Team/Department (users KHÔNG có
   * org-mapping) + scope null → fail-closed sql`false` (0 rows).
   */
  private buildUserScopeCondition(scope: DataScope | null, actor: AuthUserActor): SQL {
    switch (scope) {
      case "System":
      case "Company":
        return eq(users.companyId, actor.companyId);
      case "Own":
        return eq(users.id, actor.id);
      default:
        return sql`false`;
    }
  }

  /** Membership test cho 1 row đã load (get-by-id). Defense-in-depth ngoài RLS. */
  private isInScope(scope: DataScope | null, actor: AuthUserActor, row: User): boolean {
    if (row.companyId !== actor.companyId) return false;
    switch (scope) {
      case "System":
      case "Company":
        return true;
      case "Own":
        return row.id === actor.id;
      default:
        return false;
    }
  }
}
