/**
 * S16-SOCIAL-FE-2D (FULL gate lượt 1, G6) — trần đính kèm dạng HIỂN THỊ, MỘT nguồn cho mọi câu chữ: khay
 * (`ComposerAttachmentTray` — `{{max}}` của lý do từ chối) và dải lỗi 422 (`ActionErrorBanner` — câu
 * `actionError.reason.attachmentRejected`). Bản đầu chép cứng «10 ảnh · 1 video · 20 MB» vào bản dịch ⇒ đổi
 * trần ở contracts thì khay nói số mới còn dải lỗi nói số cũ, không cổng nào bắt.
 *
 * ⚠️ CHỈ import contracts: `ActionErrorBanner` (dùng ở mọi màn SOCIAL) import file này — kéo web-core vào
 * đây là bắt mọi spec mock web-core TOÀN PHẦN phải khai thêm export.
 */
import {
  FEED_MAX_ATTACHMENT_BYTES,
  FEED_MAX_ATTACHMENTS,
  FEED_MAX_IMAGES_PER_POST,
  FEED_MAX_VIDEOS_PER_POST,
} from "@mediaos/contracts";

const BYTES_PER_MB = 1024 * 1024;

/** Tham số nội suy i18n — tên khoá khớp `{{images}}` · `{{videos}}` · `{{files}}` · `{{maxSize}}`. */
export const ATTACHMENT_LIMIT_PARAMS = {
  images: FEED_MAX_IMAGES_PER_POST,
  videos: FEED_MAX_VIDEOS_PER_POST,
  files: FEED_MAX_ATTACHMENTS,
  /** «20 MB», không «20971520 byte». */
  maxSize: `${FEED_MAX_ATTACHMENT_BYTES / BYTES_PER_MB} MB`,
} as const;
