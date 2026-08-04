/**
 * S7-CHAT-FE-2 → **S7-CHAT-BE-8** — đưa MỘT tệp lên storage rồi trả `fileId` để gắn vào tin nhắn
 * (SPEC-15 §13.5 bước 1-2).
 *
 * ⚠️ ĐỌC TRƯỚC KHI SỬA — vì sao là `/chat/files/*` chứ KHÔNG phải `/foundation/files/*`:
 * hai route FOUNDATION gate `upload:foundation-file`, mà cặp đó (đo trên DB) chỉ có ở `SA` ·
 * `company-admin` · `QUẢN LÝ CẤP CAO` — `employee`/`hr`/`manager` KHÔNG có, tức **đa số người dùng
 * không đính kèm được**. `S7-CHAT-BE-8` đóng lỗ đó bằng wrapper own-scope `POST /chat/files/upload-url`
 * + `POST /chat/files/:id/confirm`, cả hai gate `send:chat-message` — CÙNG cặp mà nút "Gửi" đã đòi.
 * Đổi ngược hai URL này về FOUNDATION là khoá lại tính năng cho gần hết công ty.
 *
 * Response giữ NGUYÊN hình dạng của FOUNDATION (`registerFileResponseSchema` /
 * `confirmUploadResponseSchema`): hai route CHAT là wrapper quanh chính `FileService`, không khai
 * schema riêng — nên phần parse dưới đây không đổi một dòng nào so với bản FE-2.
 *
 * KHÔNG khai `moduleCode`/`entityType`/`entityId` lúc register: tin nhắn CHƯA TỒN TẠI (nó chỉ ra đời ở
 * `POST /chat/rooms/:id/messages`). Link `file_links` do CHAT tạo trong CÙNG transaction với INSERT tin
 * (`chat-messages.service.ts`) — client không được tự gắn, vì gắn tay bỏ qua kiểm "tệp thuộc người gửi".
 * `visibility` cũng KHÔNG gửi: route CHAT ép `Private` ở server và bỏ qua mọi khoá lạ trong body.
 */
import {
  confirmUploadResponseSchema,
  registerFileResponseSchema,
  type RegisterFileResponse,
} from "@mediaos/contracts";
import { apiFetch, DEFAULT_UPLOAD_MIME, putBytesToStorage } from "@mediaos/web-core";

export interface ChatUploadResult {
  fileId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  isImage: boolean;
}

/**
 * 3 pha: register → PUT bytes → confirm. Bất kỳ pha nào lỗi ⇒ NÉM NGAY.
 *
 * Cấm nuốt lỗi rồi trả `fileId` của một tệp chưa lên xong: server sẽ từ chối nó ở
 * `POST /chat/rooms/:id/messages` (CHAT-ERR-015) và người dùng nhận một lỗi gửi-tin khó hiểu thay vì
 * lỗi tải-tệp đúng chỗ.
 */
export async function uploadChatAttachment(
  file: File,
  options?: { signal?: AbortSignal },
): Promise<ChatUploadResult> {
  const declaredMimeType = file.type || DEFAULT_UPLOAD_MIME;

  const registered = await apiFetch<RegisterFileResponse>(
    "/chat/files/upload-url",
    registerFileResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({
        originalName: file.name,
        declaredMimeType,
        sizeBytes: file.size,
      }),
      signal: options?.signal,
    },
  );

  // `contentType` PHẢI khớp `declaredMimeType` đã khai — server ký PutObject KÈM ContentType, lệch là
  // 403 SignatureDoesNotMatch (docblock `putBytesToStorage`).
  await putBytesToStorage(registered.uploadUrl, file, declaredMimeType);

  await apiFetch(`/chat/files/${registered.fileId}/confirm`, confirmUploadResponseSchema, {
    method: "POST",
    body: JSON.stringify({}),
    signal: options?.signal,
  });

  return {
    fileId: registered.fileId,
    name: file.name,
    sizeBytes: file.size,
    mimeType: declaredMimeType,
    // Chỉ dùng cho XEM-TRƯỚC phía client trong lúc soạn. "Có phải ảnh không" của DTO là do SERVER quyết
    // (`chatAttachmentSchema.isImage`) — không lấy giá trị này thay cho nó sau khi tin đã gửi.
    isImage: declaredMimeType.toLowerCase().startsWith("image/"),
  };
}
