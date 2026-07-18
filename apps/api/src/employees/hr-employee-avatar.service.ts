import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import {
  FOUNDATION_FILE_ERROR_CODES,
  type MeAvatarUploadUrlInput,
  type MeAvatarUploadUrlResponse,
} from "@mediaos/contracts";
import { isUniqueViolation } from "../common/db-error";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { FileAccessLogService } from "../foundation/files/file-access-log.service";
import { FileLinkRepository } from "../foundation/files/file-link.repository";
import { FileRepository } from "../foundation/files/file.repository";
import { FileService } from "../foundation/files/files.service";
import { DataScopeService } from "../permission/data-scope.service";
import { HrWriteRepository } from "./hr-write.repository";

type RequestUser = { id: string; companyId: string };

/**
 * S5-HR-AVATAR-1 — taxonomy link avatar (KHỚP me.constants ME_MODULE_CODE/ME_AVATAR_ENTITY_TYPE + literal
 * mirror ở file.repository.ts AVATAR_LINK_*). Hardcode Ở ĐÂY — CẤM import `me/me.constants`:
 * `MeModule` import `EmployeesModule` (đọc `read:employee` source pair cho §12.2 unlinked-check) ⇒ import
 * ngược (employees → me) sẽ tạo DI cycle vỡ khi Nest bootstrap (plan-reviewer #5).
 */
const AVATAR_LINK_MODULE = "ME";
const AVATAR_LINK_ENTITY = "avatar";
const AVATAR_LINK_TYPE = "Avatar";

/** HR employee writes (bao gồm avatar) là thao tác company-wide — mirror HrWriteService.WRITE_SCOPES. */
const WRITE_SCOPES: ReadonlySet<string> = new Set(["Company", "System"]);

/** Response setEmployeeAvatar — CHỈ fileId (KHÔNG downloadUrl): xem docstring setEmployeeAvatar. */
export interface HrEmployeeAvatarResult {
  fileId: string;
}

/**
 * S5-HR-AVATAR-1 — HrEmployeeAvatarService: HR/admin (có `update:employee` + scope Company/System) đặt/gỡ
 * avatar của MỘT NHÂN VIÊN KHÁC (directory-class, mirror `MeAvatarService` self-service nhưng own-scope →
 * HR-managed). Đóng gap: form HR update KHÔNG có field avatar + đường tự-upload chỉ có own-scope (S5-ME-BE-2).
 *
 * BẢO MẬT (CLAUDE.md §2 + docs/plans/S5-HR-AVATAR-1.md QUYẾT ĐỊNH KIẾN TRÚC):
 *  - Authorize = `assertWriteScope` (mirror `HrWriteService.assertWriteScope`) — resolveAndAssert('update',
 *    'employee') rồi fail-closed trừ phi scope ∈ {Company, System}. Route `@RequirePermission` chỉ gate
 *    CẶP quyền; scope-check ở ĐÂY chặn sub-Company (Department/Team) leo thang thành ghi company-wide.
 *  - :employeeId là `@Param` NHƯNG KHÔNG IDOR: assertWriteScope + RLS (company_id mọi query qua withTenant)
 *    khoá — chỉ NV CÙNG company + caller đủ write-scope mới đổi được.
 *  - File-validate TỰ REPLICATE (KHÔNG tin cột, mirror `MeAvatarService.setAvatar`): `ownerUserId === hrUser.id`
 *    (chống forge — HR chỉ gắn avatar bằng file DO CHÍNH HR upload) + Uploaded (confirm-if-pending) + non-
 *    Infected + `image/*`.
 *  - Quản lý `file_links` TRỰC TIẾP (KHÔNG qua `FileService.link/unlink` own-scope — `MeAvatarFileResolver`
 *    chỉ cho phép chủ employee, HR sẽ bị resolver DENY): ĐÃ authorize ở tầng service này rồi tự
 *    `FileLinkRepository.insertTx`/`softDeleteTx` (mirror `FileService.link/unlink` cho audit + access-log,
 *    bỏ qua bước `FilePolicyService.canLink/canUnlink` own-scope).
 *  - **NGUYÊN TỬ 1 TX** (plan-reviewer #1/#2): `setEmployeeAvatar`/`removeEmployeeAvatar` chạy TRỌN VẸN trong
 *    MỘT `db.withTenant` — `findForAvatarUpdateTx` (FOR UPDATE, serialize race HR‖employee tự đổi) → soft-
 *    delete stale link → insert link mới → `updateAvatarUrlTx` → audit — CÙNG tx (rollback nguyên khối nếu
 *    bất kỳ bước nào lỗi, KHÔNG bán-ghi).
 *  - 23505 (unique-violation `uq_file_links_*`) → 409 thân thiện (KHÔNG 500) — bọc `insertTx` mirror
 *    `FileService.insertLinkOrThrow`.
 *  - Audit `avatar-update`/`avatar-remove` object_type='employee' before/after CHỈ `{avatarUrl}` (fileId
 *    reference — KHÔNG PII/storage_path, BẤT BIẾN #3).
 */
@Injectable()
export class HrEmployeeAvatarService {
  constructor(
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    private readonly files: FileService,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
    private readonly accessLog: FileAccessLogService,
    private readonly hrWriteRepo: HrWriteRepository,
    private readonly audit: AuditService,
  ) {}

  /** Mirror `HrWriteService.assertWriteScope` — fail-closed trừ phi scope Company/System. */
  private async assertWriteScope(user: RequestUser): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "update",
      "employee",
    );
    if (!WRITE_SCOPES.has(scope)) {
      throw new ForbiddenException(
        "AUTH-ERR-SCOPE-DENIED: employee avatar write requires Company scope",
      );
    }
  }

  /**
   * POST /hr/employees/:id/avatar/upload-url — đăng ký file ẢNH Private owned-by-HR (chuẩn bị gắn avatar
   * cho NV KHÁC). assertWriteScope TRƯỚC (fail-closed) → verify employee tồn tại trong tenant (404 sớm,
   * KHÔNG register file rác cho employee ma) → validate `declaredMimeType` image/* (chặn sớm, mirror
   * MeAvatarService.createUploadUrl) → tái dùng `FileService.upload` nội bộ (owner=hrUser.id).
   */
  async createUploadUrl(
    hrUser: RequestUser,
    employeeId: string,
    input: MeAvatarUploadUrlInput,
  ): Promise<MeAvatarUploadUrlResponse> {
    await this.assertWriteScope(hrUser);
    const exists = await this.db.withTenant(hrUser.companyId, (tx) =>
      this.hrWriteRepo.findForAvatarUpdateTx(tx, hrUser.companyId, employeeId),
    );
    if (!exists) throw new NotFoundException("Employee not found");

    if (!input.declaredMimeType.startsWith("image/")) {
      throw new UnsupportedMediaTypeException({
        code: FOUNDATION_FILE_ERROR_CODES.MIME,
        message: `${FOUNDATION_FILE_ERROR_CODES.MIME}: avatar phải là ảnh (mime khai báo: ${input.declaredMimeType}).`,
      });
    }

    const reg = await this.files.upload(
      { id: hrUser.id, companyId: hrUser.companyId },
      {
        originalName: input.originalName,
        declaredMimeType: input.declaredMimeType,
        sizeBytes: input.sizeBytes,
        visibility: "Private",
      },
    );
    return { fileId: reg.fileId, uploadUrl: reg.uploadUrl, expiresAt: reg.expiresAt };
  }

  /**
   * POST /hr/employees/:id/avatar — gắn avatar (từ 1 file ĐÃ/ĐANG upload qua createUploadUrl phía trên,
   * confirm-if-pending fold vào đây — endpoint MỚI, không shipped-regression) cho employeeId. TRỌN VẸN
   * trong MỘT `withTenant` tx (plan-reviewer #1/#2 — atomic, chống bán-ghi + race).
   *
   * Response CHỈ `{fileId}` — CỐ Ý KHÔNG gọi `FileService.getDownloadUrl` (nó dispatch qua
   * `MeAvatarFileResolver` own-scope: `ownsAvatarEntity` check `userId === employee.user_id`, HR KHÔNG phải
   * chủ employee ⇒ sẽ 403 NGAY SAU KHI đã ghi thành công — vỡ luồng HR dù write hợp lệ). FE refetch employee
   * detail (avatarUrl đã resolve qua AvatarPresignService, S5-ME-BE-5) để hiển thị.
   */
  async setEmployeeAvatar(
    hrUser: RequestUser,
    employeeId: string,
    fileId: string,
  ): Promise<HrEmployeeAvatarResult> {
    await this.assertWriteScope(hrUser);

    // Existence 404 sớm (tx ngắn) TRƯỚC khi confirm/validate file — không register/confirm cho employee ma.
    const exists = await this.db.withTenant(hrUser.companyId, (tx) =>
      this.hrWriteRepo.findForAvatarUpdateTx(tx, hrUser.companyId, employeeId),
    );
    if (!exists) throw new NotFoundException("Employee not found");

    // Validate + confirm-if-pending NGOÀI atomic tx (DB/security review): confirmUpload mở tx RIÊNG + đọc/hash
    // bytes storage — KHÔNG được nested trong FOR-UPDATE (giữ lock employee + connection qua I/O ⇒ pool-starve
    // + "atomic" sai). Đưa toàn bộ file-I/O ra ngoài; atomic tx chỉ còn pure-DB.
    await this.confirmAndValidateOwnImageFile(hrUser, fileId);

    // Atomic pure-DB (rollback nguyên khối): lock → unlink stale → insert link → set avatar_url → audit.
    return this.db.withTenant(hrUser.companyId, async (tx) => {
      const employee = await this.hrWriteRepo.findForAvatarUpdateTx(
        tx,
        hrUser.companyId,
        employeeId,
      );
      if (!employee) throw new NotFoundException("Employee not found"); // đã bị xoá giữa 2 phase

      // Replace semantics: gỡ (soft-delete) link avatar CŨ của employee này TRƯỚC khi tạo link mới — soft-
      // delete stale TRƯỚC insert ⇒ không đụng uq_file_links_primary_per_entity_type (plan-review #1).
      await this.unlinkStaleAvatarLinksTx(tx, hrUser, employeeId);
      await this.insertAvatarLinkOrThrowTx(tx, hrUser, employeeId, fileId);

      const before = employee.avatarUrl;
      await this.hrWriteRepo.updateAvatarUrlTx(tx, hrUser.companyId, employeeId, fileId);
      await this.audit.record(tx, {
        action: "avatar-update",
        objectType: "employee",
        objectId: employeeId,
        actorUserId: hrUser.id,
        before: { avatarUrl: before },
        after: { avatarUrl: fileId },
      });

      return { fileId };
    });
  }

  /**
   * Validate file để gắn avatar — NGOÀI atomic tx (confirm mở tx riêng + storage I/O). Chống forge
   * (ownerUserId===hrUser.id) + confirm-if-pending + Uploaded + non-Infected + image/* (mirror
   * MeAvatarService.setAvatar). Mỗi read tx ngắn — KHÔNG giữ lock employee.
   */
  private async confirmAndValidateOwnImageFile(hrUser: RequestUser, fileId: string): Promise<void> {
    let file = await this.db.withTenant(hrUser.companyId, (tx) =>
      this.fileRepo.findByIdTx(hrUser.companyId, fileId, tx),
    );
    if (!file) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: file not found");
    // Chống forge: CHỈ gắn avatar bằng file DO CHÍNH HR upload.
    if (file.ownerUserId !== hrUser.id) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: file does not belong to the caller");
    }
    if (file.uploadStatus === "Pending") {
      await this.files.confirmUpload({ id: hrUser.id, companyId: hrUser.companyId }, fileId, {});
      const refreshed = await this.db.withTenant(hrUser.companyId, (tx) =>
        this.fileRepo.findByIdTx(hrUser.companyId, fileId, tx),
      );
      if (!refreshed) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: file not found");
      file = refreshed;
    }
    if (file.uploadStatus !== "Uploaded") {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_PENDING,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_PENDING}: file chưa upload xong (confirm trước khi gắn avatar).`,
      });
    }
    if (file.scanStatus === "Infected") {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.INFECTED,
        message: `${FOUNDATION_FILE_ERROR_CODES.INFECTED}: không thể gắn avatar từ file đang Infected.`,
      });
    }
    if (!file.mimeType.startsWith("image/")) {
      throw new UnsupportedMediaTypeException({
        code: FOUNDATION_FILE_ERROR_CODES.MIME,
        message: `${FOUNDATION_FILE_ERROR_CODES.MIME}: avatar phải là ảnh (mime hiện tại: ${file.mimeType}).`,
      });
    }
  }

  /**
   * DELETE /hr/employees/:id/avatar — gỡ avatar hiện có (idempotent — không có avatar vẫn OK, KHÔNG audit
   * no-op rác). TRỌN VẸN trong MỘT tx (mirror setEmployeeAvatar).
   */
  async removeEmployeeAvatar(hrUser: RequestUser, employeeId: string): Promise<void> {
    await this.assertWriteScope(hrUser);
    await this.db.withTenant(hrUser.companyId, async (tx) => {
      const employee = await this.hrWriteRepo.findForAvatarUpdateTx(
        tx,
        hrUser.companyId,
        employeeId,
      );
      if (!employee) throw new NotFoundException("Employee not found");

      await this.unlinkStaleAvatarLinksTx(tx, hrUser, employeeId);

      const before = employee.avatarUrl;
      if (before === null) return; // Idempotent no-op thật (client retry) — KHÔNG ghi audit rác.

      await this.hrWriteRepo.updateAvatarUrlTx(tx, hrUser.companyId, employeeId, null);
      await this.audit.record(tx, {
        action: "avatar-remove",
        objectType: "employee",
        objectId: employeeId,
        actorUserId: hrUser.id,
        before: { avatarUrl: before },
        after: { avatarUrl: null },
      });
    });
  }

  /** Soft-delete mọi link ME/avatar SỐNG của employeeId + access-log Unlink (mirror FileService.unlink). */
  private async unlinkStaleAvatarLinksTx(
    tx: TenantTx,
    hrUser: RequestUser,
    employeeId: string,
  ): Promise<void> {
    const stale = await this.linkRepo.listActiveByEntityTx(
      hrUser.companyId,
      AVATAR_LINK_MODULE,
      AVATAR_LINK_ENTITY,
      employeeId,
      tx,
    );
    for (const link of stale) {
      const affected = await this.linkRepo.softDeleteTx(hrUser.companyId, link.id, hrUser.id, tx);
      if (affected === 0) continue; // Đã gỡ song song (race) — KHÔNG log trùng.
      await this.accessLog.record(tx, {
        fileId: link.fileId,
        action: "Unlink",
        accessGranted: true,
        actorUserId: hrUser.id,
        fileLinkId: link.id,
        moduleCode: AVATAR_LINK_MODULE,
        entityType: AVATAR_LINK_ENTITY,
        entityId: employeeId,
        permissionCode: "FOUNDATION.FILE.UNLINK",
      });
    }
  }

  /**
   * Insert link avatar mới, bọc bắt 23505 → 409 (mirror `FileService.insertLinkOrThrow`, KHÔNG phân biệt
   * theo tên constraint — soft-delete stale TRƯỚC nên chỉ còn nguy cơ race hiếm, 1 mã lỗi đủ dùng ở đây).
   */
  private async insertAvatarLinkOrThrowTx(
    tx: TenantTx,
    hrUser: RequestUser,
    employeeId: string,
    fileId: string,
  ): Promise<void> {
    try {
      const created = await this.linkRepo.insertTx(
        {
          companyId: hrUser.companyId,
          fileId,
          moduleCode: AVATAR_LINK_MODULE,
          entityType: AVATAR_LINK_ENTITY,
          entityId: employeeId,
          linkType: AVATAR_LINK_TYPE,
          accessScope: "Owner",
          isPrimary: true,
          createdBy: hrUser.id,
        },
        tx,
      );
      await this.accessLog.record(tx, {
        fileId,
        action: "Link",
        accessGranted: true,
        actorUserId: hrUser.id,
        fileLinkId: created.id,
        moduleCode: AVATAR_LINK_MODULE,
        entityType: AVATAR_LINK_ENTITY,
        entityId: employeeId,
        permissionCode: "FOUNDATION.FILE.LINK",
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: FOUNDATION_FILE_ERROR_CODES.DUP_LINK,
          message: `${FOUNDATION_FILE_ERROR_CODES.DUP_LINK}: không thể gắn avatar (đụng ràng buộc trùng lặp — thử lại).`,
        });
      }
      throw err;
    }
  }
}
