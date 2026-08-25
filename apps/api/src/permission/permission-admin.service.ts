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
  ObjectSubjectType,
  RemoveObjectPermissionRequest,
  SetObjectPermissionRequest,
  UserRoleDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { SecurityEventWriter } from "../auth/security-event-writer.service";
import { PermissionService } from "./permission.service";
import { PermissionAdminRepository, type ObjectPermissionKey } from "./permission-admin.repository";
import {
  pgErrorCode,
  pgErrorField,
  PG_CHECK_VIOLATION,
  PG_FK_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "../common/db-error";

/** Ngưỡng cảnh báo fan-out invalidation theo role (không cắt — chỉ log để quan sát). */
const ROLE_FANOUT_WARN_THRESHOLD = 200;

type RequestUser = { id: string; companyId: string };

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
    // S2-AUTH-BE-8: writer timeline `user_security_events` (dual-write cạnh audit_logs — ROLE_ASSIGNED/
    // ROLE_REMOVED cho viewer AUTH-API-402). SecurityEventWriter stateless (chỉ phụ thuộc AuditMaskerService
    // @Global) → đăng ký LÀM PROVIDER cục bộ ở PermissionModule (KHÔNG lấy từ AuthModule export) để tránh
    // import-cycle Auth↔Permission (đã forwardRef). Optional theo convention codebase: Nest LUÔN inject
    // (provider đã đăng ký) ⇒ production luôn emit; chỉ vắng khi int-spec dựng service bằng tay với 5 arg →
    // guard `?.` bỏ qua để KHÔNG vỡ regression — KHÔNG phải nuốt lỗi.
    private readonly securityEvents?: SecurityEventWriter,
  ) {}

  // ── (A) gán / thu role cho user (user_roles) ─────────────────────────────────

  // S10-SEC-ROLEMEMBERFE-1 (KI-073): annotation là RATCHET, không phải trang trí — `return existing`/
  // `return inserted` (hàng drizzle, `expiresAt: Date`) sẽ ĐỎ typecheck với `expiresAt: string|null`
  // của UserRoleDto ⇒ đột biến "trả nguyên hàng ở một nhánh" bị compiler bắt trước khi test chạy.
  async assignRole(
    actor: RequestUser,
    targetUserId: string,
    dto: AssignRoleRequest,
  ): Promise<UserRoleDto> {
    // Gate read-only ⇒ NGOÀI write-tx (tránh nested withTenant → connection lồng nhau).
    await this.assertCan(actor, "assign-role", "user", targetUserId);
    // SoD: chống tự leo thang đặc quyền (nếu assign-role:user về sau cấp cho role không-admin).
    if (actor.id === targetUserId) {
      throw new ForbiddenException("Cannot assign a role to yourself (separation of duties)");
    }
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
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
        // KI-073: GIỮ nhánh no-op (D3) — "vá" bằng cách luôn ghi lại là biến oracle ĐỌC thành khuếch
        // đại GHI (tombstone rác + RoleReassigned giả + permission.changed đập cache toàn hệ). Ca O4
        // ghim: sau POST no-op, cả user_roles/audit/outbox/security-events đều đứng yên.
        if (existing && sameExpiry(existing.expiresAt, expiresAt)) {
          return this.projectAssignResult(actor.companyId, targetUserId, dto.roleId, expiresAt);
        }
        // Đổi expiry: SOFT-DELETE hàng active (deleted_by=actor) + INSERT hàng mới (mig 0471; partial-unique
        // chỉ chặn active nên INSERT sau soft-delete không vỡ). KHÔNG hard-delete → giữ tombstone forensic.
        if (existing) {
          await this.repo.deleteUserRole(tx, actor.companyId, targetUserId, dto.roleId, actor.id);
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
          before: existing
            ? { id: existing.id, roleId: existing.roleId, expiresAt: existing.expiresAt }
            : null,
          after: { userId: targetUserId, roleId: dto.roleId, expiresAt },
        });
        // S2-AUTH-BE-8: dual-write timeline bảo mật TRONG cùng tx (rollback ⇒ 0 orphan). subject=target
        // (userId NOT NULL), actor=admin. payload CHỈ roleId (non-sensitive — KHÔNG PII/secret); masker vẫn
        // che phòng thủ theo tên khóa. severity gán từ contracts map (ROLE_ASSIGNED='medium'). Cả assign lẫn
        // reassign đều là ROLE_ASSIGNED (không có ROLE_REASSIGNED trong contracts union).
        await this.securityEvents?.record(tx, {
          eventType: "ROLE_ASSIGNED",
          userId: targetUserId,
          actorUserId: actor.id,
          payload: { roleId: dto.roleId },
        });
        await this.emitPermissionChangedForUser(tx, actor.companyId, targetUserId);

        return this.projectAssignResult(actor.companyId, targetUserId, dto.roleId, expiresAt);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to assign role");
    }
  }

  /**
   * S10-SEC-ROLEMEMBERFE-1 (KI-073, D2/D7) — bộ chiếu DUY NHẤT cho thân trả về của `assignRole`,
   * dùng chung CẢ BA nhánh (no-op / fresh / reassign): đúng bốn khoá caller cung cấp hoặc suy ra
   * được ⇒ 0 bit. KHÔNG trả hàng DB (`existing`/`inserted`): `id`/`grantedBy`/`createdAt` phân biệt
   * được "đã là thành viên" với "vừa gán" — oracle dựng lại tập thành viên mà KI-071 vừa giấu, im
   * lặng ở mọi câu trả lời dương (nhánh no-op không ghi gì).
   *
   * ⚠️ audit/security-event Ở TRÊN vẫn PHẢI ăn `inserted.id`/hàng thật (bất biến #2 — đột biến M-F);
   * bộ chiếu này chỉ dành cho THÂN HTTP. `expiresAt` echo INSTANT của request dạng ISO — an toàn ở
   * cả ba nhánh vì `sameExpiry` là bằng-tuyệt-đối (no-op ⇒ bằng request theo định nghĩa).
   */
  private projectAssignResult(
    companyId: string,
    userId: string,
    roleId: string,
    expiresAt: Date | null,
  ): UserRoleDto {
    return { userId, roleId, companyId, expiresAt: expiresAt?.toISOString() ?? null };
  }

  /**
   * S10-SEC-ROLEMEMBERDEL-1 (KI-074) — bit CÓ THẨM QUYỀN của CHÍNH actor trên cặp DANH BẠ `view:user`,
   * thứ lái hình dạng câu trả lời ÂM của `revokeRole`. ADR `DECISIONS-10`.
   *
   * ⚠️ KHÔNG truyền `opts` — đây là dòng dễ copy sai nhất của cả bản vá. `view:user` là
   * `is_sensitive = false` (mig 0444:39); thêm `{ isSensitive: true }` theo khuôn `foundation/audit`
   * sẽ ép nhánh exact-only (`permission.service.ts:602-604`) ⇒ mọi vai chỉ giữ `*:*` tụt về `null`
   * ⇒ 204 ⇒ MẤT tín hiệu 404 trong im lặng, đúng hồi quy mà hướng (a) bị loại vì gây ra.
   * Ghim: `permission-admin.ki074.spec.ts` U5 (1 lời gọi, ĐÚNG 4 đối số).
   *
   * ⚠️ `null` ⇒ `false` (tức 204), KHÔNG phải `Company`. `null` nghĩa "KHÔNG có thẩm quyền" — 0 grant,
   * một DENY khớp, `data_scope` không chuẩn hoá được, hoặc lỗi hạ tầng (resolver tự nuốt, fail-closed).
   * Fail-closed ở ĐÂY = im lặng; ở `listMembersInner` = 403. Không mâu thuẫn: cả hai đều là
   * "nghi ngờ ⇒ lộ ít hơn". Hệ quả vận hành: sự cố hạ tầng ở câu scope biến 404 thành 204 cho cả
   * actor Company — MẤT TÍN HIỆU tạm thời, không phải mất quyền; đối chiếu log
   * `resolveStrongestScope() infrastructure error` cùng request.
   */
  private async hasCompanyWideDirectory(actor: RequestUser): Promise<boolean> {
    const scope = await this.permissionService.resolveStrongestScope(
      actor.id,
      actor.companyId,
      "view",
      "user",
    );
    if (scope === null) {
      // Dòng log RIÊNG của route này, có `roleId`-free nhưng ĐỦ định danh call-site. Vì sao cần:
      // `resolveStrongestScope` nuốt MỌI lỗi rồi trả `null` và chỉ log một dòng chung keyed theo
      // (userId, companyId, "view", "user") — mà cặp đó còn nhiều người tiêu thụ khác
      // (`auth-users.service`, `role-admin.service`, …). Không có dòng này thì người trực ca KHÔNG
      // phân biệt được "actor hẹp thật" (204 đúng thiết kế) với "câu scope vừa hỏng" (204 sai, actor
      // đáng lẽ nhận 404) — đúng khoảng mù mà FULL gate silent-failure-hunter chỉ ra.
      //
      // ⚠️ Log SERVER-SIDE, KHÔNG đổi một byte nào của response ⇒ KHÔNG tái tạo oracle.
      this.logger.warn(
        "revokeRole: resolveStrongestScope(view:user) trả null → nhánh 204 im lặng. HAI nguyên " +
          "nhân, đừng quy tội một chiều: (a) actor thật sự không có grant `view:user` (đúng thiết " +
          "kế, DECISIONS-10 §R1); (b) câu scope vừa LỖI và resolver fail-closed — đối chiếu dòng " +
          "`resolveStrongestScope() infrastructure error` CÙNG request trước khi kết luận.",
        { actorUserId: actor.id, companyId: actor.companyId },
      );
    }
    return scope === "Company" || scope === "System";
  }

  async revokeRole(actor: RequestUser, targetUserId: string, roleId: string) {
    await this.assertCan(actor, "assign-role", "user", targetUserId);
    try {
      // KI-074: lấy bit thẩm quyền NGOÀI write-tx. `resolveStrongestScope` tự mở `withTenant`
      // (permission.repository.ts:70) ⇒ gọi trong tx là withTenant LỒNG NHAU: xin connection thứ hai
      // trong khi đang giữ một connection (PgBouncer transaction-mode), + một transaction TÁCH RỜI
      // không thấy ghi chưa commit. Đúng bẫy mà `assignRole` ở trên đã ghi cho `assertCan`.
      // TRONG `try` có chủ ý: resolver hôm nay tự nuốt mọi lỗi, nhưng đó là hợp đồng KHÔNG được
      // compiler ép — ném ra ngoài `try` sẽ bỏ qua `mapError` và rò stack ra 500.
      // Giá: nay THÊM 1 transaction — tổng **3** cho mỗi DELETE (`assertCan` · `hasCompanyWideDirectory`
      // · write-tx), kể cả nhánh dương. Ba cái TUẦN TỰ và await đủ ⇒ đỉnh connection đồng thời vẫn là
      // 1 ⇒ không có rủi ro cạn pool PgBouncer. Nó KHÔNG làm phẳng kênh thời gian (chỉ cộng hằng số
      // vào cả hai nhánh) — kênh đó ở lại dạng ghi nhận, xem DECISIONS-10 §4.
      const directoryWide = await this.hasCompanyWideDirectory(actor);
      await this.db.withTenant(actor.companyId, async (tx) => {
        // Đọc TRƯỚC khi xoá → audit `before` đủ (grantedBy/expiresAt) + objectId = id hàng thật.
        const existing = await this.repo.findUserRole(tx, actor.companyId, targetUserId, roleId);
        if (!existing) {
          // ⚠️ HAI lệnh dưới đây, ĐÚNG thứ tự này. Đảo lại thì actor Company vẫn ra 404 (test của họ
          // KHÔNG phát hiện) nhưng actor hẹp nhận 204 cho role của TENANT KHÁC ⇒ mất BẤT BIẾN #1
          // trong im lặng. Ca ghim: int `D-X1`.

          // (2) Role không assignable TRONG TENANT NÀY → 404 cho MỌI actor. RLS `roles_tenant_isolation`
          // (mig 0005:37-44) giấu role company-scoped của tenant khác; `notOperatorRole()` loại role
          // aud='operator'. Role SYSTEM (company_id IS NULL) THẤY ĐƯỢC ở mọi tenant ⇒ rơi xuống nhánh
          // dưới ⇒ actor hẹp nhận 204 — hành vi ĐÃ KÝ (DECISIONS-10 §R2, bảng ba lớp role).
          //
          // ⚠️ Lệnh này PHẢI ở trong `if (!existing)`, KHÔNG được nâng lên đầu hàm: nó lọc
          // `deleted_at IS NULL`, nên nâng lên sẽ KHOÁ VĨNH VIỄN việc gỡ vai của một role vừa bị
          // soft-delete (user giữ quyền tồn đọng mà không gỡ được). Ghim: unit U9.
          if (!(await this.repo.findAssignableRole(tx, roleId))) {
            throw new NotFoundException("User does not have this role");
          }
          // (1)+(3) Trong-tenant "user không giữ role này": 404 CHỈ cho actor thấy được toàn danh bạ.
          // Còn lại → 204 với ĐÚNG 0 ghi. KHÔNG audit/security-event giả "cho giống nhánh dương" —
          // đó là biến oracle ĐỌC thành GHI giả (cùng luật no-op của KI-073 ca O4).
          if (directoryWide) {
            throw new NotFoundException("User does not have this role");
          }
          return;
        }
        // Gỡ role = SOFT-DELETE (UPDATE set deleted_at/deleted_by=actor, mig 0471) — KHÔNG hard-delete.
        await this.repo.deleteUserRole(tx, actor.companyId, targetUserId, roleId, actor.id);

        await this.audit.record(tx, {
          action: "RoleRevoked",
          objectType: "user_role",
          objectId: existing.id,
          actorUserId: actor.id,
          before: {
            userId: targetUserId,
            roleId,
            grantedBy: existing.grantedBy,
            expiresAt: existing.expiresAt,
          },
        });
        // S2-AUTH-BE-8: dual-write timeline bảo mật TRONG cùng tx (rollback ⇒ 0 orphan). subject=target,
        // actor=admin, payload={roleId} non-sensitive. severity từ contracts map (ROLE_REMOVED='medium').
        await this.securityEvents?.record(tx, {
          eventType: "ROLE_REMOVED",
          userId: targetUserId,
          actorUserId: actor.id,
          payload: { roleId },
        });
        await this.emitPermissionChangedForUser(tx, actor.companyId, targetUserId);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to revoke role");
    }
  }

  // ── (B) object-permission override (object_permissions) ──────────────────────

  async setObjectPermission(actor: RequestUser, dto: SetObjectPermissionRequest) {
    await this.assertCan(actor, "grant-object-permission", "permission", null);
    try {
      return await this.db.withTenant(actor.companyId, async (tx) => {
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
        await this.emitPermissionChangedForSubject(
          tx,
          actor.companyId,
          dto.subjectType,
          dto.subjectId,
        );

        return inserted;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to set object permission");
    }
  }

  async removeObjectPermission(actor: RequestUser, dto: RemoveObjectPermissionRequest) {
    await this.assertCan(actor, "grant-object-permission", "permission", null);
    try {
      await this.db.withTenant(actor.companyId, async (tx) => {
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
        await this.emitPermissionChangedForSubject(
          tx,
          actor.companyId,
          dto.subjectType,
          dto.subjectId,
        );
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
    subjectType: ObjectSubjectType,
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

  /**
   * user → 1 event; role → fan-out 1 event / user đang giữ role (0 user ⇒ chỉ TTL phủ tương lai).
   * subjectType là union 'user'|'role' (Zod-validated) → KHÔNG nhánh ngầm; KHÔNG drop event để giữ
   * đúng invalidation. Fan-out lớn = warn (observability) chứ không cắt — cắt = cache stale = lỗ hổng.
   */
  private async emitPermissionChangedForSubject(
    tx: TenantTx,
    companyId: string,
    subjectType: ObjectSubjectType,
    subjectId: string,
  ): Promise<void> {
    if (subjectType === "user") {
      await this.emitPermissionChangedForUser(tx, companyId, subjectId);
      return;
    }
    const userIds = await this.repo.findUserIdsWithRole(tx, companyId, subjectId);
    if (userIds.length > ROLE_FANOUT_WARN_THRESHOLD) {
      this.logger.warn(
        `permission.changed fan-out lớn: ${userIds.length} user giữ role ${subjectId} (1 outbox/user trong cùng tx)`,
      );
    }
    for (const userId of userIds) {
      await this.emitPermissionChangedForUser(tx, companyId, userId);
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
      return new ConflictException("Permission grant already exists");
    }
    if (code === PG_CHECK_VIOLATION) {
      return new BadRequestException("Invalid permission grant");
    }
    // Lỗi PG không phân loại / lỗi lập trình: log đủ code/detail/constraint để on-call grep được
    // (KHÔNG leak ra response — chỉ vào logger). Response giữ generic.
    this.logger.error(context, {
      stack: err instanceof Error ? err.stack : String(err),
      pgCode: code,
      pgDetail: pgErrorField(err, "detail"),
      pgConstraint: pgErrorField(err, "constraint"),
    });
    return new InternalServerErrorException(context);
  }
}
