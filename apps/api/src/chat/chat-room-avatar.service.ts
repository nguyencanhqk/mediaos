import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
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
import { ProjectMembershipService, type ProjectRole } from "../tasks/project-membership.service";
import { ChatAccessService, type ChatRoomAccess } from "./chat-access.service";
import {
  CHAT_ROOM_AVATAR_ENTITY_TYPE,
  CHAT_ROOM_AVATAR_LINK_TYPE,
  isImageMimeType,
} from "./chat-file.constants";
import { ChatRoomAvatarRepository, type ChatRoomAvatarRow } from "./chat-room-avatar.repository";
import { CHAT_AUDIT, CHAT_ERR, CHAT_MODULE_CODE } from "./chat.errors";
import type { ChatActor } from "./chat-rooms.service";

/**
 * Cặp quyền cho phép đặt avatar phòng **PHÒNG BAN**.
 *
 * TRÙNG NGUYÊN VĂN cặp mà `OrgController.updateOrgUnit` đang gate (`org.controller.ts:100`) — luật là
 * "ai sửa được phòng ban thì đổi được bộ mặt phòng chat của nó". CỐ Ý **không** thêm ràng buộc
 * `data_scope` ở đây: `OrgController` cũng không có, và siết một bên mà không siết bên kia đẻ ra role
 * "đổi tên được mà đổi ảnh không được" — đúng lớp lệch mà `read-path-gate-pair-must-match-download-pair`
 * cảnh báo.
 *
 * ⚠️ `org_unit` **gạch DƯỚI**. `docs/plans/S8-CHAT-UX-WAVE.md §3` viết `'org-unit'` (gạch ngang) — cặp
 * đó KHÔNG TỒN TẠI trong catalog (`0030:19` seed `'org_unit'`), và `PermissionService.can` fail-closed
 * ⇒ dùng chính tả kia là **403 vĩnh viễn cho MỌI phòng ban**, không lỗi nào nổ lúc build.
 */
const ORG_UNIT_WRITE_PAIR = { action: "update", resourceType: "org_unit" } as const;

/**
 * Vai trò dự án được đổi avatar phòng dự án (CHAT-DEC-016 — "quản lý dự án").
 *
 * Khai `readonly ProjectRole[]` (KHÔNG `as const`): `as const` làm `.includes()` chỉ nhận đúng hai
 * literal đó, nên thêm role thứ ba vào enum sẽ vỡ ở đây thay vì ở nơi thực sự phải quyết định.
 */
const PROJECT_AVATAR_ROLES: readonly ProjectRole[] = ["Owner", "Manager"];

/** Response của đường ghi — CHỈ `fileId`, xem docstring `setRoomAvatar`. */
export interface ChatRoomAvatarResult {
  fileId: string;
}

/**
 * S8-CHAT-UX-BE-2 — avatar phòng chat (`CHAT-DEC-016` · SPEC-15 §11 · mig `0543` khối B).
 *
 * Sao khuôn `HrEmployeeAvatarService` (S5-HR-AVATAR-1, đã qua FULL gate): gate `*:foundation-file` nằm
 * ở `FilesController`, **`FileService` KHÔNG gate** ⇒ một controller có gate RIÊNG gọi thẳng
 * `FileService.upload/confirmUpload` là hợp lệ — KHÔNG cấp cặp quyền mới, KHÔNG migration quyền. Đo
 * 05/08: `('upload','foundation-file')` chỉ có ở SA · company-admin · quản lý cấp cao, nên bắt người
 * dùng đi đường FOUNDATION là tái tạo đúng lỗ đã vá ở `S7-CHAT-BE-8`.
 *
 * ┌─ HAI LỚP QUYỀN, CẢ HAI PHẢI CÙNG ĐÚNG ────────────────────────────────────────────────────────┐
 * │ 1. **Cổng module** — `@RequirePermission('update','chat-room')` ở controller (cặp đã seed `0538`, │
 * │    grant cho cả 4 role canonical @Company).                                                      │
 * │ 2. **Ranh giới dữ liệu** — `assertMember` (404 hằng cho người ngoài phòng) rồi `assertAuthority`  │
 * │    theo `room_type`. CHAT không dùng thang data_scope: ranh giới ở đây là THÀNH VIÊN PHÒNG.       │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ THỨ TỰ 404-TRƯỚC-403 là bất biến chống dò: `assertMember` chạy TRƯỚC mọi kiểm tra tư cách, nên
 * người ngoài phòng luôn nhận `CHAT-ERR-001` (404) và không phân biệt được "phòng không có" với "phòng
 * có mà tôi không được đổi ảnh". Đảo hai bước là biến `roomId` thành oracle dò phòng.
 */
@Injectable()
export class ChatRoomAvatarService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly repo: ChatRoomAvatarRepository,
    private readonly dataScope: DataScopeService,
    private readonly projectMembership: ProjectMembershipService,
    private readonly files: FileService,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
    private readonly accessLog: FileAccessLogService,
    private readonly audit: AuditService,
  ) {}

  /**
   * `POST /chat/rooms/:id/avatar/upload-url` — đăng ký ảnh `Private` owned-by-actor + cấp presigned-PUT.
   *
   * Tư cách kiểm **TRƯỚC** khi register: thiếu vế này thì ai cũng bơm được file rác vào kho dưới danh
   * nghĩa "chuẩn bị đổi avatar phòng", dù bước gắn sau đó chắc chắn 403.
   *
   * Ép `image/*` ngay ở MIME KHAI BÁO (khác `ChatFilesService` cố ý không ép — chat đính kèm cả tài
   * liệu). Đây là chặn SỚM cho trải nghiệm; chốt thật nằm ở `mime_type` đo được sau khi upload, kiểm
   * lại ở `setRoomAvatar`.
   */
  async createUploadUrl(
    actor: ChatActor,
    roomId: string,
    input: MeAvatarUploadUrlInput,
  ): Promise<MeAvatarUploadUrlResponse> {
    await this.db.withTenant(actor.companyId, (tx) => this.assertCanSetAvatarTx(tx, actor, roomId));

    if (!isImageMimeType(input.declaredMimeType)) {
      throw new UnsupportedMediaTypeException({
        code: FOUNDATION_FILE_ERROR_CODES.MIME,
        message: `${FOUNDATION_FILE_ERROR_CODES.MIME}: ảnh đại diện phải là ảnh (mime khai báo: ${input.declaredMimeType}).`,
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
   * `POST /chat/rooms/:id/avatar` — gắn ảnh làm avatar phòng (confirm-if-pending gộp vào đây).
   *
   * Response CHỈ `{fileId}` — CỐ Ý **không** ký URL trả về: đường đọc đi qua
   * `ChatRoomAvatarPresignService` (một lô cho cả danh sách phòng, `CHAT-DEC-019`). Ký thêm một URL lẻ
   * ở đây là đường ký thứ hai với vòng đời khác — và là chỗ đầu tiên người ta sẽ persist nó.
   *
   * Ba pha, CỐ Ý tách: (1) tư cách — tx ngắn; (2) validate + confirm file — **NGOÀI** tx vì
   * `confirmUpload` mở tx riêng và đọc bytes từ storage, lồng nó trong `FOR UPDATE` là giữ khoá phòng
   * qua I/O mạng ⇒ pool-starve; (3) atomic pure-DB.
   */
  async setRoomAvatar(
    actor: ChatActor,
    roomId: string,
    fileId: string,
  ): Promise<ChatRoomAvatarResult> {
    await this.db.withTenant(actor.companyId, (tx) => this.assertCanSetAvatarTx(tx, actor, roomId));
    await this.confirmAndValidateOwnImageTx(actor, fileId);

    return this.db.withTenant(actor.companyId, async (tx) => {
      // Kiểm LẠI trong tx atomic: giữa pha (1) và (3) phòng có thể đã bị lưu trữ, hoặc actor đã bị gỡ
      // khỏi phòng/khỏi dự án. Khoá `FOR UPDATE` bắt đầu từ đây.
      const room = await this.assertCanSetAvatarTx(tx, actor, roomId);

      await this.unlinkStaleAvatarLinksTx(tx, actor, roomId);
      await this.insertAvatarLinkOrThrowTx(tx, actor, roomId, fileId);

      const before = room.avatarFileId;
      await this.repo.updateAvatarFileIdTx(tx, actor.companyId, roomId, fileId, actor.id);
      await this.audit.record(tx, {
        action: CHAT_AUDIT.ROOM_AVATAR_UPDATED,
        objectType: "chat_room",
        objectId: roomId,
        actorUserId: actor.id,
        // CHỈ tham chiếu UUID — KHÔNG `storage_path`, KHÔNG tên tệp gốc (BẤT BIẾN #3).
        before: { avatarFileId: before },
        after: { avatarFileId: fileId },
      });

      return { fileId };
    });
  }

  /** `DELETE /chat/rooms/:id/avatar` — gỡ avatar (idempotent: chưa có avatar vẫn 204, KHÔNG audit rác). */
  async removeRoomAvatar(actor: ChatActor, roomId: string): Promise<void> {
    await this.db.withTenant(actor.companyId, async (tx) => {
      const room = await this.assertCanSetAvatarTx(tx, actor, roomId);

      // Gỡ link TRƯỚC nhánh no-op: một hàng `file_links` sống mà cột đã NULL (do đua/lỗi cũ) là grant
      // tải vô hình — dọn nó là việc đúng kể cả khi không còn gì để audit.
      await this.unlinkStaleAvatarLinksTx(tx, actor, roomId);

      const before = room.avatarFileId;
      if (before === null) return; // Idempotent thật (client retry) — không ghi dòng audit rỗng nghĩa.

      await this.repo.updateAvatarFileIdTx(tx, actor.companyId, roomId, null, actor.id);
      await this.audit.record(tx, {
        action: CHAT_AUDIT.ROOM_AVATAR_REMOVED,
        objectType: "chat_room",
        objectId: roomId,
        actorUserId: actor.id,
        before: { avatarFileId: before },
        after: { avatarFileId: null },
      });
    });
  }

  // ─── tư cách (CHAT-DEC-016) ────────────────────────────────────────────────────

  /**
   * `assertMember` (404 hằng) → phòng chưa lưu trữ → tư cách theo `room_type`. Trả hàng phòng đã KHOÁ.
   *
   * ⚠️ `assertMember` phải là câu ĐẦU TIÊN. Xem docstring lớp: đảo thứ tự là mở oracle dò phòng.
   */
  private async assertCanSetAvatarTx(
    tx: TenantTx,
    actor: ChatActor,
    roomId: string,
  ): Promise<ChatRoomAvatarRow> {
    const access = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
    const room = await this.repo.findRoomForAvatarTx(tx, actor.companyId, roomId);
    // Không thể xảy ra sau `assertMember` (cùng tx, cùng khoá tenant) — nhưng fail-closed thay vì `!`.
    if (!room) throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FORBIDDEN);

    // Phòng lưu trữ CHỈ ĐỌC — cùng luật `updateRoom`/`sendMessage`, không nới cho avatar.
    if (room.isArchived) throw new ConflictException(CHAT_ERR.ROOM_ARCHIVED);

    await this.assertAvatarAuthorityTx(tx, actor, access, room);
    return room;
  }

  /**
   * Bốn nhánh của `CHAT-DEC-016`. Mỗi nhánh hỏi ĐÚNG nguồn quyền của loại phòng đó — vì `department`
   * và `project` **không có admin phòng** (đo `S8-CHAT-UX-WAVE §1`: `chat-derived-rooms-sync.service`
   * không gán `role='admin'` lần nào), nên luật "admin phòng đặt" sẽ làm avatar VĨNH VIỄN không đặt
   * được ở đúng hai loại phòng owner vừa yêu cầu.
   *
   * `switch` **vét cạn** trên `ChatRoomType`: thêm loại phòng mới mà quên nhánh sẽ rơi vào `default`
   * → từ chối (fail-closed), không im lặng cho qua.
   */
  private async assertAvatarAuthorityTx(
    tx: TenantTx,
    actor: ChatActor,
    access: ChatRoomAccess,
    room: ChatRoomAvatarRow,
  ): Promise<void> {
    switch (room.roomType) {
      case "direct":
        // Avatar DẪN XUẤT từ người đối thoại — không có cột để ghi (`0543:101` là đai thứ hai ở DB).
        throw new UnprocessableEntityException(CHAT_ERR.ROOM_AVATAR_DIRECT);

      case "group":
        // Dùng vị từ THUẦN `isRoomAdmin` (không phải `requireRoomAdmin`) để ném mã của WO này —
        // `requireRoomAdmin` ném `CHAT-ERR-001`, còn §11b đòi `CHAT-ERR-023`. Vị từ vẫn là MỘT bản.
        if (!this.access.isRoomAdmin(access)) {
          throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FORBIDDEN);
        }
        return;

      case "department": {
        // Neo phòng ban là `org_unit_id`, KHÔNG phải `ref_id` (`chk_chat_rooms_type_anchor`). Vắng neo
        // = dữ liệu hỏng ⇒ từ chối, không "coi như cho qua".
        if (!room.orgUnitId) throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FORBIDDEN);
        await this.assertOrgUnitWriteTx(actor, room.orgUnitId);
        return;
      }

      case "project": {
        if (!room.refId) throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FORBIDDEN);
        const membership = await this.projectMembership.getMembershipForUserTx(
          tx,
          actor.companyId,
          room.refId,
          actor.id,
        );
        if (!membership || !PROJECT_AVATAR_ROLES.includes(membership.role)) {
          throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FORBIDDEN);
        }
        return;
      }

      default:
        throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FORBIDDEN);
    }
  }

  /**
   * SPEC-15 §11b vế `department`: có `('update','org_unit')` **VỚI ĐƠN VỊ NEO CỦA PHÒNG** — không phải
   * "có cặp là xong".
   *
   * `data_scope` là per-(permission, role), nên cùng một cặp có thể là `Company` với người này và
   * `Department` với người kia. Bỏ vế scope đi thì một trưởng phòng có `update:org_unit@Department`
   * sẽ đổi được bộ mặt phòng chat của **mọi** phòng ban trong công ty — leo thang im lặng, allow-path
   * test vẫn xanh.
   *
   * | scope | quyết định |
   * | --- | --- |
   * | `Company` · `System` | cho qua |
   * | `Department` | chỉ khi `orgUnitId` ∈ (đơn vị của mình ∪ đơn vị mình làm trưởng) |
   * | `Own` · `Team` · không grant | **từ chối** — hai bậc đó nói về NGƯỜI, không có nghĩa trên một đơn vị tổ chức; fail-closed |
   *
   * Dùng `resolveOrNull` (không ném) để "không có grant" trả về **thông điệp của CHAT**
   * (`CHAT-ERR-023`) chứ không phải `AUTH-ERR-FORBIDDEN` chung — ba loại phòng phải không phân biệt
   * được với nhau, nếu không thông điệp lỗi lại vẽ ra bản đồ quyền.
   */
  private async assertOrgUnitWriteTx(actor: ChatActor, orgUnitId: string): Promise<void> {
    const scope = await this.dataScope.resolveOrNull(
      actor.id,
      actor.companyId,
      ORG_UNIT_WRITE_PAIR.action,
      ORG_UNIT_WRITE_PAIR.resourceType,
    );
    if (scope === "Company" || scope === "System") return;
    if (scope === "Department") {
      const ctx = await this.dataScope.resolveContext(actor.id, actor.companyId);
      // Rỗng ⇒ `includes` false ⇒ từ chối. Department KHÔNG BAO GIỜ được fail thành match-all.
      if (this.dataScope.departmentOrgUnitIds(ctx).includes(orgUnitId)) return;
    }
    throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FORBIDDEN);
  }

  // ─── tệp ───────────────────────────────────────────────────────────────────────

  /**
   * Chống IDOR + trạng thái, NGOÀI tx atomic. Bốn vế, MỘT thông điệp (`ROOM_AVATAR_FILE_INVALID`) để
   * `fileId` không thành oracle dò tệp:
   *   • `owner_user_id === actor` — chỉ gắn ảnh DO CHÍNH MÌNH tải lên. Thiếu vế này, người giữ
   *     `update:chat-room` gắn được ảnh CCCD/hợp đồng của người khác làm avatar một phòng, rồi **cả
   *     phòng tải được** qua resolver.
   *   • confirm-if-pending → `Uploaded` (kích thước/checksum đã verify thật).
   *   • non-`Infected`.
   *   • `mime_type` ĐO ĐƯỢC là `image/*` — không tin `declaredMimeType` của client.
   */
  private async confirmAndValidateOwnImageTx(actor: ChatActor, fileId: string): Promise<void> {
    let file = await this.db.withTenant(actor.companyId, (tx) =>
      this.fileRepo.findByIdTx(actor.companyId, fileId, tx),
    );
    if (!file || file.ownerUserId !== actor.id) {
      throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FILE_INVALID);
    }
    if (file.uploadStatus === "Pending") {
      await this.files.confirmUpload({ id: actor.id, companyId: actor.companyId }, fileId, {});
      const refreshed = await this.db.withTenant(actor.companyId, (tx) =>
        this.fileRepo.findByIdTx(actor.companyId, fileId, tx),
      );
      if (!refreshed) throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FILE_INVALID);
      file = refreshed;
    }
    if (file.uploadStatus !== "Uploaded" || file.scanStatus === "Infected") {
      throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FILE_INVALID);
    }
    if (!isImageMimeType(file.mimeType)) {
      throw new ForbiddenException(CHAT_ERR.ROOM_AVATAR_FILE_INVALID);
    }
  }

  /**
   * Soft-delete MỌI link avatar sống của phòng + access-log `Unlink` (mirror `FileService.unlink`).
   *
   * Chạy TRƯỚC insert link mới: `uq_file_links_primary_per_entity_type` sẽ 23505 nếu để hai hàng
   * `is_primary` cùng tồn tại.
   */
  private async unlinkStaleAvatarLinksTx(
    tx: TenantTx,
    actor: ChatActor,
    roomId: string,
  ): Promise<void> {
    const stale = await this.linkRepo.listActiveByEntityTx(
      actor.companyId,
      CHAT_MODULE_CODE,
      CHAT_ROOM_AVATAR_ENTITY_TYPE,
      roomId,
      tx,
    );
    for (const link of stale) {
      const affected = await this.linkRepo.softDeleteTx(actor.companyId, link.id, actor.id, tx);
      if (affected === 0) continue; // Đã gỡ song song — KHÔNG log trùng.
      await this.accessLog.record(tx, {
        fileId: link.fileId,
        action: "Unlink",
        accessGranted: true,
        actorUserId: actor.id,
        fileLinkId: link.id,
        moduleCode: CHAT_MODULE_CODE,
        entityType: CHAT_ROOM_AVATAR_ENTITY_TYPE,
        entityId: roomId,
        permissionCode: "FOUNDATION.FILE.UNLINK",
      });
    }
  }

  /** Insert link mới, bọc 23505 → 409 (mirror `FileService.insertLinkOrThrow`). */
  private async insertAvatarLinkOrThrowTx(
    tx: TenantTx,
    actor: ChatActor,
    roomId: string,
    fileId: string,
  ): Promise<void> {
    try {
      const created = await this.linkRepo.insertTx(
        {
          companyId: actor.companyId,
          fileId,
          moduleCode: CHAT_MODULE_CODE,
          entityType: CHAT_ROOM_AVATAR_ENTITY_TYPE,
          entityId: roomId,
          linkType: CHAT_ROOM_AVATAR_LINK_TYPE,
          accessScope: "Company",
          isPrimary: true,
          createdBy: actor.id,
        },
        tx,
      );
      await this.accessLog.record(tx, {
        fileId,
        action: "Link",
        accessGranted: true,
        actorUserId: actor.id,
        fileLinkId: created.id,
        moduleCode: CHAT_MODULE_CODE,
        entityType: CHAT_ROOM_AVATAR_ENTITY_TYPE,
        entityId: roomId,
        permissionCode: "FOUNDATION.FILE.LINK",
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: FOUNDATION_FILE_ERROR_CODES.DUP_LINK,
          message: `${FOUNDATION_FILE_ERROR_CODES.DUP_LINK}: không đặt được ảnh đại diện (đụng ràng buộc trùng lặp — thử lại).`,
        });
      }
      throw err;
    }
  }
}
