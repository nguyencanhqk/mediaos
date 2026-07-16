import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { FOUNDATION_FILE_ERROR_CODES, type MeAvatar } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { FileLinkRepository } from "../foundation/files/file-link.repository";
import { FileRepository } from "../foundation/files/file.repository";
import { FileService } from "../foundation/files/files.service";
import { HrWriteService } from "../employees/hr-write.service";
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
  constructor(
    private readonly db: DatabaseService,
    private readonly currentPerson: MeCurrentPersonResolver,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
    private readonly files: FileService,
    private readonly hrWrite: HrWriteService,
  ) {}

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
