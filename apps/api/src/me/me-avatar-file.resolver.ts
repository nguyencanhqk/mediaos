import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import { MeAvatarRepository } from "./me-avatar.repository";
import { ME_AVATAR_ENTITY_TYPE, ME_MODULE_CODE } from "./me.constants";

/**
 * S5-ME-BE-2 — MeAvatarFileResolver (mirror `EmployeeFileResolver`/`HrContractFileResolver`).
 *
 * Registers `(moduleCode='ME', entityType='avatar')` into the shared singleton `FilePolicyService`
 * (MeModule.onModuleInit) so avatar `file_links` rows dispatch HERE instead of falling back to
 * `FOUNDATION.FILE.*` — which is seeded ONLY to company-admin (bulk non-sensitive grant, mig 0005; no
 * grant block for employee/manager/hr — mig 0444/0477 audited). Without this resolver, 3 of 4 canonical
 * roles would 403 on link/unlink/delete despite holding `update:avatar` (Own, mig 0495) — breaking
 * self-service avatar for most users.
 *
 * `entityId` on every avatar link is `employee_profiles.id` of the employee linked to the CALLING user
 * (SPEC-09 §14.4 own-scope). The ONLY check needed is ownership — `update:avatar` is seeded Own-only for
 * ALL 4 roles (no Team/Department escalation), so re-calling PermissionService here would be redundant;
 * the route's `@RequirePermission` already gated entry. Fail-closed: no row (not-found / cross-tenant RLS
 * 0-row / not-my-employee) ⇒ false ⇒ deny-resolver (never a false-ALLOW).
 */
@Injectable()
export class MeAvatarFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = ME_MODULE_CODE;
  readonly entityTypes: readonly string[] = [ME_AVATAR_ENTITY_TYPE];

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MeAvatarRepository,
  ) {}

  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.ownsAvatarEntity(input);
  }

  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.ownsAvatarEntity(input);
  }

  /**
   * S5-ME-BE-5 (security) — gắn file làm ME/avatar đòi CHỦ SỞ HỮU CẢ entity (employee của mình) LẪN file
   * (owner_user_id === caller). Owner-check ENTITY-only cũ để lọt vector: holder `link:foundation-file`
   * (seed = company-admin) dùng POST /foundation/files/:id/links gắn file NGƯỜI KHÁC (vd ảnh CCCD) làm avatar
   * của employee mình → ký/tải qua directory (avatar-presign) hoặc download own-scope. Thêm owner-check file
   * (mirror MeAvatarService.setAvatar:owner-check) đóng tại NGUỒN. fileId vắng (pre-link) → deny (fail-closed).
   */
  canLinkFile(input: FilePermissionInput): Promise<boolean> {
    if (!input.fileId) return Promise.resolve(false);
    const fileId = input.fileId;
    return this.db.withTenant(input.companyId, async (tx) => {
      const ownsEntity = await this.repo.isOwnEmployeeTx(
        tx,
        input.companyId,
        input.entityId,
        input.userId,
      );
      if (!ownsEntity) return false;
      return this.repo.isFileOwnedByTx(tx, input.companyId, fileId, input.userId);
    });
  }

  canUnlinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.ownsAvatarEntity(input);
  }

  canDeleteFile(input: FilePermissionInput): Promise<boolean> {
    return this.ownsAvatarEntity(input);
  }

  private ownsAvatarEntity(input: FilePermissionInput): Promise<boolean> {
    return this.db.withTenant(input.companyId, (tx) =>
      this.repo.isOwnEmployeeTx(tx, input.companyId, input.entityId, input.userId),
    );
  }
}
