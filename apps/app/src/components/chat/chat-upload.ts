/**
 * S7-CHAT-FE-2 — đưa MỘT tệp lên storage rồi trả `fileId` để gắn vào tin nhắn (SPEC-15 §13.5 bước 1-2).
 *
 * ⚠️ ĐỌC TRƯỚC KHI SỬA — vì sao gọi thẳng FOUNDATION chứ không có `chatApi.uploadAttachment`:
 * CHAT hôm nay KHÔNG có route upload nào (soát toàn bộ `apps/api/src/chat/*.controller.ts`). Đường duy
 * nhất là `POST /foundation/files/upload` + `POST /foundation/files/:id/confirm`, cả hai gate
 * `upload:foundation-file`. Đo trên DB dev: cặp đó chỉ có ở `SA` · `company-admin` · `QUẢN LÝ CẤP CAO`;
 * `employee`/`hr`/`manager` KHÔNG có ⇒ **đa số người dùng không đính kèm được**. Đó là lý do nút đính
 * kèm bị gate bằng chính cặp `upload:foundation-file` (xem `FOUNDATION_FILE_UPLOAD_PAIR`), và là lý do
 * WO `S7-CHAT-BE-8` tồn tại. Khi BE-8 land: đổi ĐÚNG hai lời gọi `apiFetch` dưới đây sang
 * `/chat/files/upload-url` + `/chat/files/:id/confirm` — 0 component phải sửa.
 *
 * KHÔNG khai `moduleCode`/`entityType`/`entityId` lúc register: tin nhắn CHƯA TỒN TẠI (nó chỉ ra đời ở
 * `POST /chat/rooms/:id/messages`). Link `file_links` do CHAT tạo trong CÙNG transaction với INSERT tin
 * (`chat-messages.service.ts`) — client không được tự gắn, vì gắn tay bỏ qua kiểm "tệp thuộc người gửi".
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
    "/foundation/files/upload",
    registerFileResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({
        originalName: file.name,
        declaredMimeType,
        sizeBytes: file.size,
        visibility: "Private",
      }),
      signal: options?.signal,
    },
  );

  // `contentType` PHẢI khớp `declaredMimeType` đã khai — server ký PutObject KÈM ContentType, lệch là
  // 403 SignatureDoesNotMatch (docblock `putBytesToStorage`).
  await putBytesToStorage(registered.uploadUrl, file, declaredMimeType);

  await apiFetch(`/foundation/files/${registered.fileId}/confirm`, confirmUploadResponseSchema, {
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
