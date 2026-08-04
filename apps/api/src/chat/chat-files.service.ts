import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ChatFileUploadUrlInput,
  ConfirmUploadResponse,
  RegisterFileResponse,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { FileRepository } from "../foundation/files/file.repository";
import { FileService } from "../foundation/files/files.service";
import type { ChatActor } from "./chat-rooms.service";

/**
 * S7-CHAT-BE-8 — bước 1-2 của SPEC-15 §13.5 cho NGƯỜI DÙNG THƯỜNG (CHAT-FUNC-007).
 *
 * ┌─ VÌ SAO FILE NÀY TỒN TẠI ────────────────────────────────────────────────────────────────────┐
 * │ `S7-CHAT-BE-3` dựng xong TOÀN BỘ đường ĐỌC tệp (link · resolver · presign · tab Tệp), nhưng   │
 * │ đường GHI duy nhất là `POST /foundation/files/upload` + `/confirm`, cả hai gate                │
 * │ `('upload','foundation-file')`. Đo trên DB: cặp đó chỉ có ở `SA` · `company-admin` ·           │
 * │ `QUẢN LÝ CẤP CAO` (mig `0435:376` cấp `foundation-%` cho mỗi role company-admin; 0 migration   │
 * │ nào khác chạm) ⇒ `employee`/`hr`/`manager` **không đính kèm được gì** dù mọi thứ khác đã sẵn.  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * **Cách đóng — sao khuôn `MeAvatarService` (S5-ME-BE-4, đã qua FULL gate):** gate `*:foundation-file`
 * nằm ở `FilesController`, **`FileService` KHÔNG gate**. Vì vậy một controller own-scope có gate RIÊNG
 * (`send:chat-message`) gọi thẳng `FileService.upload/confirmUpload` là hợp lệ — KHÔNG cấp cặp quyền mới,
 * KHÔNG migration.
 *
 * ⚠️ **FILE NÀY KHÔNG ĐƯỢC NỚI GÌ CẢ.** Ba ranh giới phải giữ nguyên:
 *   1. Vế `owner_user_id` trong `ChatAttachmentsRepository.findOwnedFiles` (SQL) là chốt chặn tại nguồn
 *      của §13.5 — "không mượn kênh chat phát tán tệp người khác". Wrapper này không đụng tới nó, và
 *      `FileService.upload` luôn set `owner_user_id = actor` nên tệp đi qua đây LUÔN thoả vế đó.
 *   2. KHÔNG tạo `file_links`. Link do `ChatMessagesService` tạo trong CÙNG transaction với INSERT tin
 *      (§13.5 bước 3). Cho client gắn tay là bỏ qua bước kiểm "tệp thuộc người gửi".
 *   3. KHÔNG chạm `FilePolicyService`/resolver. Đường đọc giữ nguyên 100%.
 *
 * Tệp vừa register là **inert**: 0 link ⇒ `ChatAttachmentPresignService.signOne` chặn ngay ở
 * `links.length === 0`, còn `GET /foundation/files/:id/download` vẫn đòi `download:foundation-file` mà
 * người dùng thường không có. Nó chỉ trở nên tải-được sau khi được gắn vào một tin trong phòng mình gửi.
 */
@Injectable()
export class ChatFilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly fileRepo: FileRepository,
    private readonly files: FileService,
  ) {}

  /**
   * `POST /chat/files/upload-url` — đăng ký metadata (`Pending`) + cấp presigned-PUT.
   *
   * KHÔNG kèm `moduleCode`/`entityType`/`entityId`: tin nhắn CHƯA TỒN TẠI ở bước này (nó chỉ ra đời ở
   * `POST /chat/rooms/:id/messages`), nên khai bừa một entity chỉ để "cho có" là ghi sai vào `audit_logs`
   * và `file_access_logs` — hai bảng append-only phục vụ điều tra, không sửa lại được.
   *
   * `visibility: 'Private'` SERVER-SET, không nhận từ client (xem `chatFileUploadUrlInputSchema`).
   *
   * CỐ Ý **KHÔNG** ép `image/*` (khác `MeAvatarService`): CHAT đính kèm cả tài liệu. Allowlist MIME ·
   * trần dung lượng · blocklist extension · nhất quán extension↔MIME đều do `FileService.upload` ép từ
   * `system_settings` — thêm một tầng luật thứ hai ở đây là thêm một chỗ để trôi.
   */
  createUploadUrl(actor: ChatActor, input: ChatFileUploadUrlInput): Promise<RegisterFileResponse> {
    return this.files.upload(
      { id: actor.id, companyId: actor.companyId },
      {
        originalName: input.originalName,
        declaredMimeType: input.declaredMimeType,
        sizeBytes: input.sizeBytes,
        visibility: "Private",
      },
    );
  }

  /**
   * `POST /chat/files/:id/confirm` — flip `Pending → Uploaded` sau khi client PUT bytes.
   *
   * ⚠️ **OWNER-CHECK CHẠY TRƯỚC** `FileService.confirmUpload` (mirror `MeAvatarService.confirmOwnUpload`).
   * Thiếu vế này thì bất kỳ ai có `send:chat-message` cũng confirm hộ tệp người khác — tức là đẩy tệp của
   * người khác qua bước verify size/checksum và đưa nó vào trạng thái gắn-được, ngay trước mũi vế
   * `owner_user_id` mà `findOwnedFiles` đang gác.
   *
   * `!file` → 404 TRƯỚC owner-check: oracle 404-vs-403 chấp nhận được vì `fileId` là UUID không đoán, và
   * đồng nhất với `MeAvatarService`. `confirmUpload` idempotent (đã `Uploaded` → 200).
   */
  async confirmOwnUpload(actor: ChatActor, fileId: string): Promise<ConfirmUploadResponse> {
    const file = await this.db.withTenant(actor.companyId, (tx) =>
      this.fileRepo.findByIdTx(actor.companyId, fileId, tx),
    );
    if (!file) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: file not found");
    if (file.ownerUserId !== actor.id) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: file does not belong to the caller");
    }
    return this.files.confirmUpload({ id: actor.id, companyId: actor.companyId }, fileId, {});
  }
}
