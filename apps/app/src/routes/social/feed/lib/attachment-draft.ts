/**
 * S16-SOCIAL-FE-2D (plan §4 A3) — luật THUẦN của khay đính kèm (bài + bình luận).
 *
 * ┌─ TRẦN CLIENT = TRẦN SERVER, chỉ đọc hằng contracts ───────────────────────────────────────────┐
 * │ Server đếm trên TẬP TỆP MỚI của lượt (`social-attachments.service.ts`, đo M9): tệp > 20 MB, ảnh  │
 * │ > 10, video > 1 ⇒ 422 `SOCIAL-ERR-007`. Tổng > 11 thì Zod `createFeedPostSchema` từ chối trước —  │
 * │ **400 VÔ DANH** (đo M10), không có mã nào để nói lý do ⇒ FE PHẢI chặn tổng ở đây.               │
 * │ Loại tệp: `attachmentKindOf` = `socialAttachmentKindOf` của web-core (mirror `kindOf` BE).        │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `accept` của ô chọn tệp = allowlist MIME MẶC ĐỊNH của FOUNDATION (owner ký D2 (b), đo M14 —
 * `setting-defaults.ts` `file.allowed_mime_types`): KHÔNG có `video/*` — trần «1 video» vẫn kiểm ở client
 * cho công ty tự mở allowlist (`S16-SOCIAL-VIDEOMIME-1`). `accept` chỉ là GỢI Ý cho hộp chọn tệp, không
 * phải cổng (người dùng chọn «Tất cả tệp» được; `fireEvent.change` cũng không bị `accept` lọc — đo M16):
 * cổng thật là `054` (415 `FOUNDATION-FILE-ERR-MIME`).
 */
import {
  FEED_MAX_ATTACHMENT_BYTES,
  FEED_MAX_ATTACHMENTS,
  FEED_MAX_IMAGES_PER_POST,
  FEED_MAX_VIDEOS_PER_POST,
  FOUNDATION_FILE_ERROR_CODES,
  SOCIAL_ERROR_CODES,
} from "@mediaos/contracts";
import { ApiError, socialAttachmentKindOf, type SocialAttachmentKind } from "@mediaos/web-core";
import type { ActionErrorReason } from "../components/ActionErrorBanner";

export type AttachmentKind = SocialAttachmentKind;

/** Loại tệp theo MIME — CÙNG luật với `kindOf` của BE (một hàm duy nhất, ở web-core). */
export const attachmentKindOf: (mimeType: string) => AttachmentKind = socialAttachmentKindOf;

/** Gợi ý hộp chọn tệp — xem docblock đầu file (D2 (b)). */
export const ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
].join(",");

/** Lý do tệp bị từ chối TRƯỚC khi tải (không tốn một byte băng thông). */
export type AttachmentRejectReason =
  | "tooLarge"
  | "tooManyImages"
  | "tooManyVideos"
  | "tooManyFiles";

/** Lý do một ô tải HỎNG — đọc theo `ApiError.code`, không theo câu chữ. */
export type AttachmentUploadErrorReason =
  | "unsupportedType"
  | "tooLargeServer"
  | "attachDenied"
  | "uploadFailed";

export type AttachmentStatus = "queued" | "uploading" | "done" | "error";

/** Một ô trong khay. `id` là khoá CỤC BỘ (ổn định suốt vòng đời ô), `fileId` chỉ có khi đã xong. */
export interface AttachmentItem {
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  kind: AttachmentKind;
  status: AttachmentStatus;
  fileId: string | null;
  /** Blob URL xem trước (chỉ ảnh) — tạo/thu hồi DUY NHẤT ở `useAttachmentPreviews`. */
  previewUrl: string | null;
  error: AttachmentUploadErrorReason | null;
}

export interface AttachmentRejection {
  name: string;
  reason: AttachmentRejectReason;
}

export interface AttachmentAddPlan {
  accepted: File[];
  rejected: AttachmentRejection[];
}

/**
 * Tách lượt chọn tệp thành nhận / từ chối. Đếm trên các ô CHƯA lỗi (ô lỗi người dùng sẽ gỡ hoặc thử lại;
 * tính nó vào trần là chặn oan). Luật theo thứ tự: dung lượng → trần ảnh → trần video → trần tổng.
 */
export function planAttachmentAdds(
  items: readonly Pick<AttachmentItem, "kind" | "status">[],
  files: readonly File[],
): AttachmentAddPlan {
  const live = items.filter((i) => i.status !== "error");
  let images = live.filter((i) => i.kind === "image").length;
  let videos = live.filter((i) => i.kind === "video").length;
  let total = live.length;

  const accepted: File[] = [];
  const rejected: AttachmentRejection[] = [];
  for (const file of files) {
    const kind = attachmentKindOf(file.type);
    let reason: AttachmentRejectReason | null = null;
    if (file.size > FEED_MAX_ATTACHMENT_BYTES) reason = "tooLarge";
    else if (kind === "image" && images >= FEED_MAX_IMAGES_PER_POST) reason = "tooManyImages";
    else if (kind === "video" && videos >= FEED_MAX_VIDEOS_PER_POST) reason = "tooManyVideos";
    else if (total >= FEED_MAX_ATTACHMENTS) reason = "tooManyFiles";

    if (reason) {
      rejected.push({ name: file.name, reason });
      continue;
    }
    accepted.push(file);
    total += 1;
    if (kind === "image") images += 1;
    if (kind === "video") videos += 1;
  }
  return { accepted, rejected };
}

export type AttachmentSubmitState =
  | { ready: true; ids: string[] }
  | { ready: false; reason: "uploading" | "hasErrors" };

/**
 * Gửi được chưa: MỌI ô phải xong. `ids` theo THỨ TỰ CHỌN — khoá `Idempotency-Key` của `002`/`015` suy từ
 * nội dung, đảo thứ tự là khoá khác (đo M12), nên không sắp xếp lại giữa các lượt thử.
 */
export function attachmentSubmitState(
  items: readonly Pick<AttachmentItem, "status" | "fileId">[],
): AttachmentSubmitState {
  if (items.some((i) => i.status === "queued" || i.status === "uploading")) {
    return { ready: false, reason: "uploading" };
  }
  if (items.some((i) => i.status === "error" || i.fileId === null)) {
    return { ready: false, reason: "hasErrors" };
  }
  return { ready: true, ids: items.map((i) => i.fileId as string) };
}

const UNSUPPORTED_TYPE_CODES: ReadonlySet<string> = new Set([
  FOUNDATION_FILE_ERROR_CODES.MIME,
  FOUNDATION_FILE_ERROR_CODES.EXTENSION,
  FOUNDATION_FILE_ERROR_CODES.BLOCKED,
]);

const ATTACH_DENIED_CODES: ReadonlySet<string> = new Set([
  SOCIAL_ERROR_CODES.FILE_TARGET_POST_DENIED,
  SOCIAL_ERROR_CODES.FILE_TARGET_COMMENT_DENIED,
]);

/**
 * Lý do một lượt TẢI hỏng. Chỉ đọc `ApiError.code` (mã FOUNDATION ở `error.code` của `054`; mã SOCIAL
 * lên `error.code` từ API #554 — điều kiện merge D11). 403 tầng-1 (`PermissionGuard`, câu cố định, KHÔNG
 * mã SOCIAL) và mọi lỗi khác (PUT hỏng, confirm hỏng, mạng) ⇒ `uploadFailed`.
 */
export function attachmentUploadErrorReason(err: unknown): AttachmentUploadErrorReason {
  if (!(err instanceof ApiError)) return "uploadFailed";
  if (UNSUPPORTED_TYPE_CODES.has(err.code)) return "unsupportedType";
  if (err.code === FOUNDATION_FILE_ERROR_CODES.SIZE) return "tooLargeServer";
  if (ATTACH_DENIED_CODES.has(err.code)) return "attachDenied";
  return "uploadFailed";
}

/**
 * Lý do lượt ĐĂNG bài/bình luận có tệp bị từ chối (A9). `SOCIAL-ERR-007` gộp «vượt trần» và «tệp không
 * hợp lệ» (đã link · chưa `Uploaded` · không phải của mình) — FE KHÔNG phân biệt được bằng mã (đo M9) và
 * không được so câu chữ ⇒ MỘT câu gộp (owner ký D6 (a), nợ BE `S16-SOCIAL-ATTERRSPLIT-1`). Mã khác ⇒ `null`.
 */
export function attachmentErrorReason(err: unknown): ActionErrorReason | null {
  if (!(err instanceof ApiError)) return null;
  if (err.code === SOCIAL_ERROR_CODES.ATTACHMENT_LIMIT) return "attachmentRejected";
  if (ATTACH_DENIED_CODES.has(err.code)) return "attachDenied";
  return null;
}
