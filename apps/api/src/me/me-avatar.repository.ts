import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles, files } from "../db/schema";

/**
 * S5-ME-BE-2 — self-scope ownership check dùng bởi `MeAvatarFileResolver` (đăng ký vào FilePolicyService)
 * + `MeAvatarService`. CHỈ 1 query: "employeeId có PHẢI là employee active liên kết CHÍNH userId?" — Own-scope
 * thuần (KHÔNG Team/Department escalation, khớp thiết kế `update:avatar` chỉ seed Own — mig 0495).
 */
@Injectable()
export class MeAvatarRepository {
  async isOwnEmployeeTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
    userId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, employeeId),
          eq(employeeProfiles.userId, userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return !!row;
  }

  /**
   * S5-ME-BE-5 (security) — file `fileId` có phải DO CHÍNH `userId` upload (owner_user_id) trong tenant?
   * Dùng bởi `MeAvatarFileResolver.canLinkFile` để chống FORGE link: chỉ cho gắn ME/avatar bằng file MÌNH
   * sở hữu (mirror MeAvatarService.setAvatar owner-check) — đóng vector admin dùng /foundation/files/:id/links
   * gắn file người khác làm avatar rồi ký/tải qua đường directory. Company-scoped + chưa xoá.
   */
  async isFileOwnedByTx(
    tx: TenantTx,
    companyId: string,
    fileId: string,
    userId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.companyId, companyId),
          eq(files.id, fileId),
          eq(files.ownerUserId, userId),
          isNull(files.deletedAt),
        ),
      )
      .limit(1);
    return !!row;
  }

  /**
   * S5-ME-BE-4 — đọc `avatar_url` (= fileId, xem me-avatar.service.ts docstring) của employee CỦA CHÍNH userId.
   * Own-scope ép Ở REPO (defense-in-depth, mirror `isOwnEmployeeTx`): `eq(userId)` để dù caller có lỡ truyền
   * employeeId không phải của mình vẫn 0-row (KHÔNG lộ avatar same-tenant người khác). withTenant + eq(company_id)
   * (BẤT BIẾN #1). null khi không có row / chưa set avatar / cross-tenant RLS 0-row / employeeId≠userId.
   */
  async getAvatarFileIdTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
    userId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ avatarUrl: employeeProfiles.avatarUrl })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, employeeId),
          eq(employeeProfiles.userId, userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row?.avatarUrl ?? null;
  }
}
