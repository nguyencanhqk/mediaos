import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../db/db.service";
import { PermissionService } from "../../permission/permission.service";
import type { FilePermissionInput } from "../files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../files/resolvers/file-owner-permission-resolver";
import { FileRepository } from "../files/file.repository";
import {
  BRANDING_MODULE_CODE,
  BRANDING_UPDATE_PAIR,
  brandingEntityTypes,
} from "./branding.constants";

/**
 * S5-BRAND-BE-1 (security-review BLOCK #1) — CompanyBrandingFileResolver.
 *
 * VÌ SAO BẮT BUỘC: `FilePolicyService.decideForLinkedFile` FAIL-CLOSED — link nào có (moduleCode,
 * entityType) CHƯA đăng ký resolver thì trả thẳng `deny-no-resolver`, **KHÔNG escalate** xuống fallback
 * `FOUNDATION.FILE.*` (file-policy.service.ts). Nên vừa `setAsset` tạo link (FOUNDATION, company-logo)
 * là file thành module-owned ⇒ nếu thiếu resolver:
 *   - `files.link` 403 cho role chỉ có `update:foundation-company` ⇒ mục tiêu "chạy trọn flow mà không
 *     cần quyền file" KHÔNG đạt;
 *   - `getDownloadUrl` Forbidden ⇒ `GET /branding` LUÔN trả null ⇒ tính năng chết trong im lặng.
 * `files.module.ts` ghi rõ điều kiện dùng export FileRepository/FileLinkRepository là "khi module tự
 * đăng ký FileOwnerPermissionResolver CỦA NÓ" — đây chính là resolver đó. Tiền lệ: MeAvatarFileResolver.
 *
 * MÔ HÌNH QUYỀN (khớp NGUYÊN VĂN gate của CompanyBrandingController — không tự chế cặp mới):
 *   VIEW / DOWNLOAD          ⇐ `view:foundation-company`
 *   LINK / UNLINK / DELETE   ⇐ `update:foundation-company` **VÀ** file do CHÍNH caller upload.
 *
 * Owner-check ở LINK là chốt chặn tại NGUỒN (mirror MeAvatarFileResolver.canLinkFile, S5-ME-BE-5): nếu
 * không có nó, holder `link:foundation-file` (seed = company-admin, mig 0005) gọi THẲNG
 * `POST /foundation/files/:id/links` với (FOUNDATION, company-logo, entityId=companyId) để gắn file NGƯỜI
 * KHÁC (bản scan CCCD/hợp đồng trong tenant) làm logo — rồi mọi user có `view:foundation-company` tải được.
 *
 * `entityId` của mọi link branding LUÔN là `companies.id` của tenant. Ta ép `entityId === companyId`
 * (fail-closed): entityId lạ ⇒ deny, không cho mượn kênh branding trỏ sang entity khác.
 *
 * Resolver CHỈ nhận metadata quyền (FilePermissionInput) — không thấy storage_path/checksum (CLAUDE §2.3).
 * Đăng ký additively ở `CompanyModule.onModuleInit` (module đã import FilesModule ⇒ cùng singleton
 * FilePolicyService). KHÔNG đụng app.module.ts.
 */
@Injectable()
export class CompanyBrandingFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = BRANDING_MODULE_CODE;
  readonly entityTypes: readonly string[] = brandingEntityTypes();

  constructor(
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly fileRepo: FileRepository,
  ) {}

  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.canRead(input);
  }

  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.canRead(input);
  }

  canLinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canWrite(input, { requireFileOwnership: true });
  }

  canUnlinkFile(input: FilePermissionInput): Promise<boolean> {
    // Unlink KHÔNG đòi sở hữu file: gỡ logo cũ (có thể do admin TRƯỚC upload) là thao tác hợp lệ của
    // bất kỳ ai giữ update:foundation-company. Rủi ro thấp — unlink là soft-delete, không rò nội dung.
    return this.canWrite(input, { requireFileOwnership: false });
  }

  canDeleteFile(input: FilePermissionInput): Promise<boolean> {
    return this.canWrite(input, { requireFileOwnership: true });
  }

  /**
   * READ = MỌI thành viên của CHÍNH tenant đó (chỉ tenant-check, KHÔNG đòi cặp quyền).
   *
   * VÌ SAO KHÔNG gate `view:foundation-company` (S5-BRAND-FE-2, owner chốt): cặp đó DB thật chỉ cấp cho
   * company-admin ⇒ nếu gate ở đây thì presign deny cho mọi nhân viên khác, và logo trên vỏ app + favicon
   * động chỉ chạy đúng với ~1 người/công ty (tính năng nhìn như xong nhưng không phải).
   *
   * An toàn: logo/favicon LÀ tài sản thương hiệu công khai theo bản chất — nhân viên nào cũng nhìn thấy
   * chúng trên topbar/tab. Đây KHÔNG phải nới quyền cho file bất kỳ: `entityId === companyId` ép đúng công
   * ty của caller, và `CompanyBrandingService.resolveAsset` chỉ ký file CÓ link branding SỐNG (self-defending
   * #5) ⇒ con trỏ bị đầu độc trỏ sang tài liệu nội bộ vẫn KHÔNG bao giờ tới được đây.
   *
   * GHI: mọi đường GHI (link/unlink/delete) VẪN gate `update:foundation-company` — xem canWrite.
   */
  private canRead(input: FilePermissionInput): Promise<boolean> {
    return Promise.resolve(input.entityId === input.companyId);
  }

  /** WRITE ⇐ update:foundation-company (+ tuỳ chọn: file do chính caller upload). Fail-closed mọi nhánh. */
  private async canWrite(
    input: FilePermissionInput,
    opts: { requireFileOwnership: boolean },
  ): Promise<boolean> {
    if (input.entityId !== input.companyId) return false;
    const decision = await this.permission.can({
      userId: input.userId,
      companyId: input.companyId,
      action: BRANDING_UPDATE_PAIR.action,
      resourceType: BRANDING_UPDATE_PAIR.resourceType,
    });
    if (!decision.allow) return false;
    if (!opts.requireFileOwnership) return true;

    // fileId vắng (pre-link check) → deny (fail-closed, mirror MeAvatarFileResolver).
    if (!input.fileId) return false;
    const fileId = input.fileId;
    const file = await this.db.withTenant(input.companyId, (tx) =>
      this.fileRepo.findByIdTx(input.companyId, fileId, tx),
    );
    return file?.ownerUserId === input.userId;
  }
}
