import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import {
  FOUNDATION_FILE_ERROR_CODES,
  type ConfirmUploadResponse,
  type MeAvatar,
  type MeAvatarUploadUrlInput,
  type MeAvatarUploadUrlResponse,
  type MeCurrentAvatar,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { FileLinkRepository } from "../foundation/files/file-link.repository";
import { FileRepository } from "../foundation/files/file.repository";
import { FileService } from "../foundation/files/files.service";
import { HrWriteService } from "../employees/hr-write.service";
import { MeAvatarRepository } from "./me-avatar.repository";
import { MeCurrentPersonResolver } from "./me-current-person.resolver";
import { ME_AVATAR_ENTITY_TYPE, ME_MODULE_CODE, ME_UNLINKED_EMPLOYEE_CODE } from "./me.constants";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * S5-ME-BE-2 — MeAvatarService (SPEC-09 §14.2/§17 · §21 ME-DEC-004). TÁI DÙNG `FileService` (register/
 * confirm/MIME-size ĐÃ có ở foundation/files — KHÔNG dựng pipeline upload mới): `POST /me/avatar` nhận
 * `fileId` của 1 file ĐÃ upload+confirm qua flow chuẩn `/foundation/files/upload` → PUT → `:id/confirm`.
 *
 * `employee_profiles.avatar_url` lưu `fileId` (UUID) — KHÔNG phải URL bền vững: storage chỉ cấp signed-URL
 * TTL-ngắn (StorageAdapter cấm persist — xem docstring). Tiền lệ: `profile-change-request.repository.ts`
 * đã mô tả field self-service này là "avatar_file_id" dù cột SQL tên avatar_url. Response `downloadUrl`
 * TƯƠI (ký ngay lúc trả lời) để FE hiển thị tức thời, KHÔNG persist.
 *
 * Xác thực file TRỰC TIẾP qua `FileRepository.findByIdTx` — CỐ Ý KHÔNG qua `FileService.getMetadata`
 * (gate `view:foundation-file` chỉ company-admin có, xem me-avatar-file.resolver.ts docstring): ownership
 * (`ownerUserId === actor.id`, chống IDOR — chỉ gắn file DO CHÍNH MÌNH upload) + state (`Uploaded`, non-
 * Infected) + MIME `image/*` (ràng buộc avatar-là-ảnh, file service chung không tự ép) là gate CỦA RIÊNG
 * avatar. `FileService.link/unlink/getDownloadUrl` sau đó dispatch qua `MeAvatarFileResolver` (Own-scope).
 */
@Injectable()
export class MeAvatarService {
  private readonly logger = new Logger(MeAvatarService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly currentPerson: MeCurrentPersonResolver,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
    private readonly files: FileService,
    private readonly hrWrite: HrWriteService,
    private readonly repo: MeAvatarRepository,
  ) {}

  /**
   * S5-ME-BE-4 — POST /me/avatar/upload-url. Đăng ký 1 file ẢNH Private owned-by-actor để chuẩn bị gắn avatar
   * (own-scope), TÁI DÙNG `FileService.upload` nội bộ (gate foundation-file nằm ở FilesController ⇒ service
   * KHÔNG gate; controller gate `update:avatar` Own). Đóng "Nợ để lại" S5-ME-BE-2: employee/manager/hr KHÔNG có
   * `upload:foundation-file` vẫn tự tạo được presigned-PUT qua đường ME này.
   *
   * KHÔNG kèm module/entity metadata khi register — link ME/avatar CHỈ tạo ở POST /me/avatar (sau confirm),
   * tránh dispatch policy sớm khi file chưa Uploaded. resolveOwnEmployeeIdOrThrow TRƯỚC (unlinked → 409, mutation).
   */
  async createUploadUrl(
    actor: Actor,
    input: MeAvatarUploadUrlInput,
  ): Promise<MeAvatarUploadUrlResponse> {
    await this.resolveOwnEmployeeIdOrThrow(actor);
    // Ràng buộc avatar-là-ảnh ở tầng ME (defense-in-depth; FileService re-validate allowlist + size ở register,
    // re-check checksum/size ở confirm). Chặn sớm để KHÔNG register file rác không phải ảnh.
    if (!input.declaredMimeType.startsWith("image/")) {
      throw new UnsupportedMediaTypeException({
        code: FOUNDATION_FILE_ERROR_CODES.MIME,
        message: `${FOUNDATION_FILE_ERROR_CODES.MIME}: avatar phải là ảnh (mime khai báo: ${input.declaredMimeType}).`,
      });
    }
    const reg = await this.files.upload(
      { id: actor.id, companyId: actor.companyId },
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
   * S5-ME-BE-4 — POST /me/avatar/confirm. Own-scope wrapper của `FileService.confirmUpload` (flip Pending→Uploaded
   * sau khi client PUT bytes) — cho phép role không có `upload:foundation-file` hoàn tất bước confirm của flow.
   *
   * Owner-check (`ownerUserId === actor.id`) chạy TRƯỚC confirm (mirror setAvatar) — chống IDOR: KHÔNG confirm
   * file DO NGƯỜI KHÁC upload. findByIdTx → !file → 404 TRƯỚC owner-check (oracle 404-vs-403 chấp nhận: fileId
   * là UUID không đoán + đồng nhất setAvatar). confirmUpload idempotent (file đã Uploaded → 200).
   */
  async confirmOwnUpload(actor: Actor, fileId: string): Promise<ConfirmUploadResponse> {
    const file = await this.db.withTenant(actor.companyId, (tx) =>
      this.fileRepo.findByIdTx(actor.companyId, fileId, tx),
    );
    if (!file) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: file not found");
    if (file.ownerUserId !== actor.id) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: file does not belong to the caller");
    }
    return this.files.confirmUpload({ id: actor.id, companyId: actor.companyId }, fileId, {});
  }

  /**
   * S5-ME-BE-4 — GET /me/avatar. Trả avatar hiện tại đã ký (TTL-ngắn) hoặc `null`. FAIL-SOFT (read tải-trang
   * KHÔNG được ném lỗi cứng làm vỡ trang — mirror SPEC-09 §12.2): unlinked → null; chưa set avatar → null;
   * `getDownloadUrl` ném Forbidden/NotFound/Conflict (link ME/avatar bị gỡ/khuyết, file Infected/not-downloadable,
   * hoặc avatar set qua đường admin với link khác) → CATCH HẸP theo kiểu → null. Lỗi hạ tầng/DB KHÁC propagate
   * (KHÔNG bare catch — tránh silent-failure). Own-scope: employeeId resolve từ token (KHÔNG nhận từ client) +
   * `getDownloadUrl` re-check qua MeAvatarFileResolver.
   */
  async getCurrentAvatar(actor: Actor): Promise<MeCurrentAvatar> {
    const person = await this.currentPerson.resolve(actor);
    if (person.linkStatus === "unlinked") return null;
    const employeeId = person.employee.employeeId;

    const fileId = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.getAvatarFileIdTx(tx, actor.companyId, employeeId, actor.id),
    );
    if (!fileId) return null;

    try {
      const { url, expiresAt } = await this.files.getDownloadUrl(
        { id: actor.id, companyId: actor.companyId },
        fileId,
      );
      return { fileId, downloadUrl: url, expiresAt };
    } catch (err) {
      // Catch HẸP theo 3 loại getDownloadUrl có thể ném (files.service.ts): NotFoundException (row mất/RLS
      // 0-row) · ForbiddenException (resolver own-scope deny) · ConflictException (NOT-DOWNLOADABLE/infected).
      // Bất kỳ loại KHÁC (StorageNotConfigured/QueryFailed/Internal…) PHẢI propagate — KHÔNG nuốt (silent-failure).
      if (
        err instanceof ForbiddenException ||
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        // WARN (không debug): nhánh này CHỈ tới được khi avatar_url ĐÃ set nhưng file KHÔNG tải được ⇒ LUÔN là
        // dữ liệu không nhất quán (con trỏ avatar treo / avatar set qua đường admin với link khác) — cần thấy.
        this.logger.warn(
          `getCurrentAvatar degrade→null cho employee ${employeeId} (file ${fileId}): ${err.constructor.name} — avatar_url treo?`,
        );
        return null;
      }
      throw err;
    }
  }

  async setAvatar(actor: Actor, fileId: string): Promise<MeAvatar> {
    const employeeId = await this.resolveOwnEmployeeIdOrThrow(actor);
    const requestUser = { id: actor.id, companyId: actor.companyId };

    const file = await this.db.withTenant(actor.companyId, (tx) =>
      this.fileRepo.findByIdTx(actor.companyId, fileId, tx),
    );
    if (!file) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: file not found");
    // Chống IDOR: chỉ được gắn avatar bằng file DO CHÍNH MÌNH upload (ownerUserId set ở FileService.upload).
    if (file.ownerUserId !== actor.id) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: file does not belong to the caller");
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

    // Replace semantics: gỡ (soft-delete) link avatar CŨ của employee này TRƯỚC khi tạo link mới.
    await this.unlinkStaleAvatarLinks(requestUser, employeeId);

    await this.files.link(requestUser, {
      fileId,
      moduleCode: ME_MODULE_CODE,
      entityType: ME_AVATAR_ENTITY_TYPE,
      entityId: employeeId,
      linkType: "Avatar",
      accessScope: "Owner",
      isPrimary: true,
    });

    await this.hrWrite.updateOwnAvatar(requestUser, employeeId, fileId);

    const { url, expiresAt } = await this.files.getDownloadUrl(requestUser, fileId);
    return { fileId, downloadUrl: url, expiresAt };
  }

  /** DELETE /me/avatar — gỡ link hiện có (soft-delete `file_links`) + clear `avatar_url`. Idempotent (không avatar → no-op). */
  async removeAvatar(actor: Actor): Promise<void> {
    const employeeId = await this.resolveOwnEmployeeIdOrThrow(actor);
    const requestUser = { id: actor.id, companyId: actor.companyId };

    await this.unlinkStaleAvatarLinks(requestUser, employeeId);
    await this.hrWrite.updateOwnAvatar(requestUser, employeeId, null);
  }

  private async resolveOwnEmployeeIdOrThrow(actor: Actor): Promise<string> {
    const person = await this.currentPerson.resolve(actor);
    if (person.linkStatus === "unlinked") {
      throw new ConflictException({
        code: ME_UNLINKED_EMPLOYEE_CODE,
        message: `${ME_UNLINKED_EMPLOYEE_CODE}: tài khoản chưa liên kết hồ sơ nhân viên.`,
      });
    }
    return person.employee.employeeId;
  }

  private async unlinkStaleAvatarLinks(
    requestUser: { id: string; companyId: string },
    employeeId: string,
  ): Promise<void> {
    const stale = await this.db.withTenant(requestUser.companyId, (tx) =>
      this.linkRepo.listActiveByEntityTx(
        requestUser.companyId,
        ME_MODULE_CODE,
        ME_AVATAR_ENTITY_TYPE,
        employeeId,
        tx,
      ),
    );
    for (const link of stale) {
      await this.files.unlink(requestUser, link.id);
    }
  }
}
