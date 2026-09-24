import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ConfirmUploadResponse,
  RegisterFileResponse,
  SocialFileUploadUrlInput,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { FileRepository } from "../foundation/files/file.repository";
import { FileService } from "../foundation/files/files.service";
import { SocialAccessService } from "./social-access.service";
import { SOCIAL_ERR } from "./social.errors";
import type { SocialRequestUser, SocialTargetType } from "./social.types";

/**
 * S16-SOCIAL-BE-1C — `SOCIAL-API-054/055`: **cửa vào** của đường đính kèm bài & bình luận.
 *
 * ┌─ VÌ SAO FILE NÀY TỒN TẠI ─────────────────────────────────────────────────────────────────────┐
 * │ `S16-SOCIAL-BE-1` đã dựng TRỌN phần sau của đường đính kèm: `SocialFileResolver` (cổng quyền),  │
 * │ `SocialAttachmentsService` (ghi `file_links` trong cùng tx, ép SOC-DEC-008), và contract đã có   │
 * │ `attachmentIds` ở cả 4 schema tạo/sửa bài-bình luận. Thứ DUY NHẤT thiếu là đường GHI tệp: hôm    │
 * │ nay chỉ có `POST /foundation/files/upload` + `/confirm`, cả hai gate `*:foundation-file` — cặp   │
 * │ mà đo trên DB chỉ `SA`/`company-admin`/`QUẢN LÝ CẤP CAO` có (mig `0435:376`). Tức là             │
 * │ `employee`/`hr`/`manager` **không đính kèm được gì** dù mọi thứ khác đã sẵn.                     │
 * │ ⇒ `S16-SOCIAL-FE-1` buộc phải CẮT composer đính kèm (nợ N1 của plan đó).                        │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * **Cách đóng — khuôn `ChatFilesService`/`MeAvatarService` (đều đã qua FULL gate):** gate
 * `*:foundation-file` nằm ở `FilesController`, **`FileService` KHÔNG gate** (memory
 * `avatar-own-scope-presign-wrapper`). Nên một controller own-scope có gate RIÊNG gọi thẳng
 * `FileService.upload/confirmUpload` là hợp lệ — **KHÔNG cấp cặp quyền mới, KHÔNG migration**.
 *
 * ┌─ 🔴 `target` LÀ ĐẦU VÀO CỦA CỔNG, KHÔNG PHẢI MỘT KHẲNG ĐỊNH ĐƯỢC TIN (plan §1 D1a) ────────────┐
 * │ Nó quyết định cặp quyền nào được hỏi ở TẦNG 2 của cửa này — `create:feed-post` hay                │
 * │ `create:feed-comment` — vì `SocialFileResolver.canLinkFile` hỏi cặp KHÁC NHAU tuỳ đích, còn       │
 * │ `@RequirePermission` chỉ khai được MỘT cặp tĩnh.                                                  │
 * │                                                                                                   │
 * │ Khai `'comment'` rồi đem tệp gắn vào BÀI là chuyện client làm được. Trên đường TẠO nó vô hại, và   │
 * │ ĐÂY LÀ LÝ DO ĐÚNG (xem khối ngay dưới): route `002`/`015` đã gác CHÍNH cặp                        │
 * │ `create:feed-post`/`create:feed-comment` ở TẦNG 1, nên nói dối ở cửa tệp chỉ TỰ THU HẸP cửa của    │
 * │ mình, không mở thêm gì.                                                                           │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 🔴 CẶP `create` CỦA ĐÍCH THẬT ĐƯỢC HỎI Ở ĐÂU (đo lại 24/09/2026 — ĐỪNG suy đoán lại) ────────┐
 * │ **KHÔNG phải bởi `canLinkFile`.** Hàm đó chỉ chạy trên `POST /foundation/files/:id/links`, gate  │
 * │ `link:foundation-file` — cặp mà nhân viên thường KHÔNG có ⇒ nhánh ấy chết với người dùng thường. │
 * │ Đường gắn mà FE thật sự đi là `SocialAttachmentsService.syncLinksTx`, và nó ép cặp `create` bằng │
 * │ **hai** cơ chế khác nhau tuỳ đường:                                                              │
 * │   • TẠO `002`/`015` — tầng 1 của route (decorator) **và** `resolveActor`, cả hai cùng cặp;       │
 * │   • SỬA `004`/`016` — tham số `gate` của `syncLinksTx`, resolve NGOÀI tx bởi                     │
 * │     `SocialAccessService.resolveAttachNewGate` (S16-SOCIAL-ATTGATE-1, owner ký 24/09/2026).      │
 * │                                                                                                 │
 * │ 🔴 Bản trước của docblock này (và 3 docblock khác, kể cả `packages/contracts`) viết «lúc gắn,    │
 * │ `canLinkFile` hỏi LẠI cặp đúng của đích THẬT» — SAI, và cái sai đó tự nhân bản ra 4 chỗ. Trước   │
 * │ khi khai «cổng X sẽ hỏi lại ở bước sau», hãy LẦN CALL-CHAIN tới call-site thật của X.            │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 🔴 CHỖ SOCIAL KHÁC CHAT, VÀ VÌ SAO PHẢI KHÁC (plan §1 D1) ───────────────────────────────────┐
 * │ CHAT gate cả hai route bằng MỘT cặp `send:chat-message` — đúng cặp mà `ChatMessageFileResolver` │
 * │ .canLink hỏi lúc gắn. SOCIAL **không có một cặp như thế**: `SocialFileResolver.canLinkFile` hỏi  │
 * │ `create:feed-post` cho bài và `create:feed-comment` cho bình luận (vế 6a). Chọn bừa một trong    │
 * │ hai làm cặp tĩnh cho decorator ⇒ vai giữ cặp KIA bị 403 ngay ở cửa: viết được bình luận bằng chữ │
 * │ mà không đính kèm nổi ảnh vào chính nó — ĐÚNG lớp lỗi "tải lên được mà gắn không được" mà jsdoc  │
 * │ `ChatFilesController` cảnh báo.                                                                 │
 * │ ⇒ decorator giữ SÀN `view:feed` (cặp mà `canLinkFile` CŨNG đòi, ở vế `readScope`), và cặp thật   │
 * │ được hỏi ở TẦNG 2 theo `target`: `SocialAccessService.assertFileTarget`.                         │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **FILE NÀY KHÔNG ĐƯỢC NỚI GÌ CẢ.** Ba ranh giới, y nguyên của CHAT:
 *   1. Vế `files.owner_user_id === userId` (vế 2 của `canLinkFile`) là chốt chặn TẠI NGUỒN — "không
 *      mượn kênh bảng tin phát tán tệp người khác". Wrapper này không đụng tới nó, và `FileService
 *      .upload` luôn set `owner_user_id = actor` nên tệp đi qua đây LUÔN thoả vế đó.
 *   2. KHÔNG tạo `file_links`. Link do `SocialAttachmentsService` tạo TRONG CÙNG transaction với
 *      INSERT bài/bình luận. Cho client gắn tay là bỏ qua cả 6 vế của `canLinkFile`.
 *   3. KHÔNG chạm `FilePolicyService`/resolver. Đường đọc giữ nguyên 100%.
 *
 * Tệp vừa đăng ký là **inert**: 0 link ⇒ `SocialAttachmentsService.signOne` chặn ngay ở
 * `links.length === 0`, còn `GET /foundation/files/:id/download-url` vẫn đòi `download:foundation-file`
 * mà người dùng thường không có. Nó chỉ trở nên tải-được sau khi được gắn vào nội dung mình viết.
 */
@Injectable()
export class SocialFilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly fileRepo: FileRepository,
    private readonly files: FileService,
  ) {}

  /**
   * `054` — `POST /social/files/upload-url`: đăng ký metadata (`Pending`) + cấp presigned-PUT.
   *
   * KHÔNG kèm `moduleCode`/`entityType`/`entityId`: bài/bình luận CHƯA TỒN TẠI ở bước này, nên khai
   * bừa một entity chỉ để "cho có" là ghi SAI vào `audit_logs` và `file_access_logs` — hai bảng
   * append-only phục vụ điều tra, không sửa lại được. (Đây cũng là lý do `target` của DTO **không**
   * được chuyển xuống thành `entityType`: nó là đầu vào của cổng quyền, không phải một sự thật về
   * tệp.)
   *
   * `visibility: 'Private'` SERVER-SET, không nhận từ client (xem `socialFileUploadUrlInputSchema`).
   *
   * CỐ Ý **KHÔNG** ép `image/*` hay trần 20MB ở đây: allowlist MIME · trần dung lượng · blocklist
   * extension · nhất quán extension↔MIME đều do `FileService.upload` ép từ `system_settings`, còn
   * trần SOC-DEC-008 (≤10 ảnh · ≤1 video · ≤20MB) do `SocialAttachmentsService` ép lúc GẮN với mã
   * `SOCIAL-ERR-007`. Thêm một tầng luật thứ ba ở đây là thêm một chỗ để trôi — và tệ hơn, nó sẽ trả
   * một mã lỗi KHÁC cho cùng một luật, tuỳ người dùng bấm vào đâu.
   */
  async createUploadUrl(
    user: SocialRequestUser,
    input: SocialFileUploadUrlInput,
  ): Promise<RegisterFileResponse> {
    const actor = await this.access.resolveActor(user, "fileUploadUrl");
    await this.access.assertFileTarget(actor, input.target);

    return this.files.upload(
      { id: actor.actorUserId, companyId: actor.companyId },
      {
        originalName: input.originalName,
        declaredMimeType: input.declaredMimeType,
        sizeBytes: input.sizeBytes,
        visibility: "Private",
      },
    );
  }

  /**
   * `055` — `POST /social/files/{id}/confirm`: flip `Pending → Uploaded` sau khi client PUT bytes.
   *
   * ⚠️ **OWNER-CHECK CHẠY TRƯỚC** `FileService.confirmUpload` (mirror `ChatFilesService`/`MeAvatar
   * Service`). Thiếu vế này thì bất kỳ ai qua được cửa cũng confirm hộ tệp người khác — tức đẩy tệp
   * của người khác qua bước verify size/checksum và đưa nó vào trạng thái GẮN-ĐƯỢC, ngay trước mũi
   * vế `owner_user_id` mà `canLinkFile` đang gác.
   *
   * `!file` → 404 TRƯỚC owner-check: oracle 404-vs-403 chấp nhận được vì `fileId` là UUID không đoán
   * được, và đồng nhất với hai sibling. `confirmUpload` idempotent (đã `Uploaded` → 200) ⇒ route này
   * KHÔNG cần `@Idempotent()` (danh sách bắt buộc idempotency là danh sách CHỐT của IMPLEMENTATION-08
   * §13.2, không phải luật cho mọi POST — xem `openapi-contract.e2e-spec.ts`).
   */
  async confirmOwnUpload(
    user: SocialRequestUser,
    fileId: string,
    target: SocialTargetType,
  ): Promise<ConfirmUploadResponse> {
    const actor = await this.access.resolveActor(user, "fileConfirm");
    await this.access.assertFileTarget(actor, target);

    const file = await this.db.withTenant(actor.companyId, (tx) =>
      this.fileRepo.findByIdTx(actor.companyId, fileId, tx),
    );
    if (!file) throw new NotFoundException("RESOURCE-ERR-NOT-FOUND: file not found");
    if (file.ownerUserId !== actor.actorUserId) {
      throw new ForbiddenException(SOCIAL_ERR.FILE_NOT_OWNED);
    }
    return this.files.confirmUpload(
      { id: actor.actorUserId, companyId: actor.companyId },
      fileId,
      {},
    );
  }
}
