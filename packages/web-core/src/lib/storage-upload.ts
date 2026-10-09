/**
 * storage-upload.ts — PUT bytes trực tiếp lên presigned URL của storage (S3/MinIO).
 *
 * TÁCH RA từ me-api.ts (S5-BRAND-FE-1) để branding dùng chung — cùng một hợp đồng ký/upload, KHÔNG nhân
 * bản hàm thứ hai rồi trôi (vd quên `credentials:'omit'` ⇒ rò cookie sang host storage).
 *
 * KHÔNG qua apiFetch: đích là storage, KHÔNG phải API của ta (không gắn Bearer/cookie/X-Request-Id).
 */

/** MIME mặc định khi trình duyệt không suy ra được `file.type` (vd kéo-thả từ nguồn lạ). */
export const DEFAULT_UPLOAD_MIME = "application/octet-stream";

/**
 * S16-SOCIAL-FE-2D (plan §4 A1) — lượt PUT bị HUỶ chủ động qua `signal` (người dùng gỡ tệp, rời ô soạn).
 * Tách khỏi câu «lỗi mạng» chung để caller phân biệt được «tôi huỷ» với «mạng hỏng»; `name` theo quy ước
 * DOM (`AbortError`).
 */
export class StorageUploadAbortedError extends Error {
  constructor() {
    super("Đã huỷ tải tệp lên storage.");
    this.name = "AbortError";
  }
}

/**
 * PUT `file` lên `url` presigned.
 *
 * `contentType` PHẢI khớp `declaredMimeType` đã khai lúc xin upload-url — server ký PutObject KÈM
 * ContentType, lệch ⇒ 403 SignatureDoesNotMatch. Lỗi mạng/HTTP → ném NGAY (KHÔNG nuốt): caller phải dừng
 * flow chứ không được confirm/set một file rỗng (silent-failure).
 *
 * `credentials:'omit'` TƯỜNG MINH — không gửi cookie/Bearer tới host storage. Mặc định 'same-origin' đã
 * chặn cross-origin, nhưng 'omit' giữ bất biến này đúng kể cả khi storage được proxy same-origin về sau.
 *
 * `signal` (tuỳ chọn, tham số CUỐI — 4 call-site cũ không đổi, `init` của chúng không có khoá `signal`):
 * huỷ ⇒ ném `StorageUploadAbortedError`, không nuốt.
 */
export async function putBytesToStorage(
  url: string,
  file: File,
  contentType: string,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
      credentials: "omit",
      ...(signal ? { signal } : {}),
    });
  } catch {
    if (signal?.aborted) throw new StorageUploadAbortedError();
    throw new Error("Tải tệp lên storage thất bại do lỗi mạng.");
  }
  if (!res.ok) throw new Error(`Tải tệp lên storage thất bại (HTTP ${res.status}).`);
}
