import {
  confirmUploadResponseSchema,
  registerFileResponseSchema,
  type ConfirmUploadResponse,
  type FeedAttachmentDto,
  type RegisterFileResponse,
  type SocialFileUploadUrlInput,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { DEFAULT_UPLOAD_MIME, putBytesToStorage } from "./storage-upload";

/**
 * S16-SOCIAL-FE-2D (plan §4 A2) — client tải đính kèm SOCIAL: `SOCIAL-API-054 POST /social/files/upload-url`
 * → PUT bytes lên storage → `SOCIAL-API-055 POST /social/files/{id}/confirm`. Khuôn `uploadChatAttachment`
 * (`apps/app/src/components/chat/chat-upload.ts`), KHÁC ở hai chỗ:
 *  - body CẢ HAI pha mang `target` (`'post'|'comment'`) — `055` hỏi lại ĐÚNG cặp `create:*` mà `054` đã hỏi
 *    (contracts `socialFileConfirmInputSchema`, khác chat `{}`);
 *  - `signal` đi vào CẢ BA pha ⇒ gỡ tệp / rời ô soạn huỷ được cả lúc đang chờ API lẫn lúc đang PUT.
 *
 * Response = hình dạng FOUNDATION (`RegisterFileResponse`/`ConfirmUploadResponse`) — route SOCIAL bọc
 * `FileService`, không khai schema riêng. Tenant + chủ sở hữu do SERVER lấy từ token, FE không gửi.
 *
 * KHÔNG khai `moduleCode`/`entityId`: bài/bình luận CHƯA tồn tại; liên kết tệp ↔ bài do `002`/`015` tạo
 * trong CÙNG transaction (kiểm «tệp của chính người gửi, đã `Uploaded`, chưa gắn đâu»).
 */

export type SocialFileTarget = SocialFileUploadUrlInput["target"];
export type SocialAttachmentKind = FeedAttachmentDto["kind"];

export interface SocialAttachmentUpload {
  fileId: string;
  /** Loại theo MIME đã khai — CÙNG luật `kindOf` của BE (xem `socialAttachmentKindOf`). */
  kind: SocialAttachmentKind;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

/**
 * Loại đính kèm theo MIME — MIRROR `kindOf` của BE (`apps/api/src/social/social-attachments.service.ts`):
 * tiền tố `image/` | `video/` sau khi hạ chữ thường, còn lại là `file`. Trần «10 ảnh / 1 video» của BE
 * đếm theo luật này, nên FE đếm lệch luật là chặn nhầm hoặc cho lọt 422.
 */
export function socialAttachmentKindOf(mimeType: string): SocialAttachmentKind {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

interface SocialFilesRequestOptions {
  signal?: AbortSignal;
}

export const socialFilesApi = {
  /** `054` — gác SÀN `view:feed` + `create:feed-post`/`create:feed-comment` @Company theo `target`. */
  requestUploadUrl: (
    input: SocialFileUploadUrlInput,
    options?: SocialFilesRequestOptions,
  ): Promise<RegisterFileResponse> =>
    apiFetch("/social/files/upload-url", registerFileResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      signal: options?.signal,
    }),

  /** `055` — `Pending → Uploaded`; body `{target}` BẮT BUỘC (`.strict()`). */
  confirm: (
    fileId: string,
    target: SocialFileTarget,
    options?: SocialFilesRequestOptions,
  ): Promise<ConfirmUploadResponse> =>
    apiFetch(`/social/files/${fileId}/confirm`, confirmUploadResponseSchema, {
      method: "POST",
      body: JSON.stringify({ target }),
      signal: options?.signal,
    }),
};

/**
 * Ba pha: `054` → PUT → `055`. Pha nào lỗi ⇒ NÉM NGUYÊN lỗi đó và DỪNG (không confirm, không trả `fileId`).
 *
 * 🔴 KHÔNG `try/catch` quanh pha nào, KHÔNG bọc lại lỗi: `putBytesToStorage` đã gom mọi lỗi mạng thành
 * một `Error` chung, nên một `catch` «đi tiếp» sẽ confirm một tệp chưa có bytes; còn bọc lỗi `054` lại là
 * mất `ApiError.code` (`FOUNDATION-FILE-ERR-MIME`, `SOCIAL-ERR-FILE-TARGET-*`) mà khay đính kèm cần để nói
 * ĐÚNG lý do. Ca W2–W4 + mutant mA9–mA11 ghim điều này.
 */
export async function uploadSocialAttachment(
  file: File,
  target: SocialFileTarget,
  options?: SocialFilesRequestOptions,
): Promise<SocialAttachmentUpload> {
  const declaredMimeType = file.type || DEFAULT_UPLOAD_MIME;

  const registered = await socialFilesApi.requestUploadUrl(
    { target, originalName: file.name, declaredMimeType, sizeBytes: file.size },
    options,
  );

  // `contentType` PHẢI khớp `declaredMimeType` — presign PUT ký KÈM ContentType + ContentLength.
  await putBytesToStorage(registered.uploadUrl, file, declaredMimeType, options?.signal);

  await socialFilesApi.confirm(registered.fileId, target, options);

  return {
    fileId: registered.fileId,
    kind: socialAttachmentKindOf(declaredMimeType),
    name: file.name,
    sizeBytes: file.size,
    mimeType: declaredMimeType,
  };
}
