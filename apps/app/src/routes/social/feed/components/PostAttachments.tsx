/**
 * S16-SOCIAL-FE-2D (plan §4 A8) — vẽ đính kèm của bài · bình luận · tin: lưới ảnh · video · link tệp.
 *
 * ┌─ 🔴 BA LUẬT ──────────────────────────────────────────────────────────────────────────────────┐
 * │ 1. `url:null` (presign bị từ chối cho NGƯỜI XEM này) hoặc URL không phải `http(s)` ⇒ KHÔNG vẽ gì   │
 * │    cho tệp đó — ảnh, video lẫn tệp (owner ký D4 (a)); một ô «có mà không xem được» là rò sự tồn   │
 * │    tại. Luật sống ở `splitAttachments` (một vị từ cho cả ba).                                     │
 * │ 2. URL ký GET sống 300 s (`S3_PRESIGN_TTL_SEC`): ảnh `lazy` cuộn tới / video tua sau đó ⇒ lỗi tải │
 * │    ⇒ ô TRUNG TÍNH thay icon vỡ (`onError`). Gốc là TTL/refetch-on-error ở BE (nợ G6). Ô media GIỮ  │
 * │    URL đầu suốt vòng đời và chỉ đổi URL khi URL đang dùng đã lỗi — `useSignedMediaUrl`.           │
 * │ 3. Link tệp `target=_blank rel="noopener noreferrer"` — bytes do người dùng tải lên, KHÔNG tin.   │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ BẤT BIẾN về cách MỞ tệp (plan `S16-SOCIAL-FE-2D` §12 H1 · §13):
 *  - Tệp KHÔNG phải ảnh / video luôn là LINK TẢI: server trả các loại đó dưới dạng tải xuống, nên bấm link là tệp
 *    về máy chứ không mở trong trình duyệt — link mang icon tải + chữ ẩn «tải xuống».
 *  - Ảnh / video CHỈ được vẽ tại chỗ qua `<img>` / `<video>`, với URL đã qua `isSafeAttachmentUrl`.
 *  - KHÔNG thêm cách nào khác để mở URL storage (lightbox, link quanh ảnh / video, khung nhúng…): mọi đường mới
 *    phải qua review an ninh trước khi vào mã.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, ImageOff, VideoOff } from "lucide-react";
import { cn } from "@mediaos/ui";
import { FEED_MAX_IMAGES_PER_POST, type FeedAttachmentDto } from "@mediaos/contracts";
import { formatFileSize } from "@/components/chat/chat-format";
import { IMAGE_GRID_MAX, splitAttachments } from "../lib/feed-format";

interface PostAttachmentsProps {
  attachments: readonly FeedAttachmentDto[];
  /** Bình luận / hàng tin: ô nhỏ hơn. */
  compact?: boolean;
  /**
   * Trang chi tiết bài: vẽ ĐỦ ảnh (tới trần ảnh mỗi bài của contracts) thay vì 4 ô + «+N». Ô ảnh thêm vẫn là
   * `<img>` tại chỗ như mọi ô khác — xem bất biến về cách MỞ tệp ở đầu file.
   */
  showAllImages?: boolean;
  testId?: string;
  className?: string;
}

function UnavailableCell({
  testId,
  label,
  Icon,
}: {
  testId: string;
  label: string;
  Icon: typeof ImageOff;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex h-full min-h-20 w-full items-center justify-center gap-2 rounded-md bg-muted p-3 text-center text-xs text-muted-foreground"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </div>
  );
}

/**
 * URL ký GET của MỘT ô media (FULL gate lượt 1 — G2 · G3).
 *
 * Mỗi lần refetch server ký URL MỚI (`getSignedUrl` không ghim `signingDate`), và `invalidatePostLists`
 * chạy sau thả cảm xúc · lưu · bình luận ⇒ để `src` đi theo prop là bắt trình duyệt NẠP LẠI media: video về
 * 0:00 giữa lúc xem, ảnh tải lại toàn bộ. Nên:
 *  - GIỮ URL đầu tiên suốt vòng đời ô (`key = fileId`);
 *  - URL đang dùng LỖI (hết hạn) ⇒ `url: null` (ô trung tính) — và hễ prop mang URL KHÁC (server đã ký lại,
 *    trước hay sau lúc lỗi) ⇒ nhận URL đó, vẽ lại media. Bản đầu dùng cờ `failed` dính tới khi remount.
 */
function useSignedMediaUrl(src: string): { url: string | null; onError: () => void } {
  const [inUse, setInUse] = React.useState(src);
  const [failed, setFailed] = React.useState<string | null>(null);
  // Chỉnh state theo prop NGAY lúc render (mẫu chuẩn của React) — điều kiện tự tắt sau một lượt.
  if (failed === inUse && src !== inUse) setInUse(src);
  return { url: failed === inUse ? null : inUse, onError: () => setFailed(inUse) };
}

function AttachmentImage({ src, alt }: { src: string; alt: string }): React.ReactElement {
  const { t } = useTranslation("social");
  const media = useSignedMediaUrl(src);
  if (media.url === null) {
    return (
      <UnavailableCell
        testId="attachment-image-unavailable"
        label={t("attachment.imageUnavailable")}
        Icon={ImageOff}
      />
    );
  }
  return (
    <img
      src={media.url}
      alt={alt}
      loading="lazy"
      onError={media.onError}
      className="h-full w-full object-cover"
    />
  );
}

function AttachmentVideo({
  src,
  label,
  compact,
}: {
  src: string;
  /** Tên truy cập được (tên tệp) — `<video controls>` không có tên thì trình đọc màn hình chỉ nói «video». */
  label: string;
  compact: boolean;
}): React.ReactElement {
  const { t } = useTranslation("social");
  const media = useSignedMediaUrl(src);
  if (media.url === null) {
    return (
      <UnavailableCell
        testId="attachment-video-unavailable"
        label={t("attachment.videoUnavailable")}
        Icon={VideoOff}
      />
    );
  }
  return (
    <video
      src={media.url}
      aria-label={label}
      controls
      preload="metadata"
      onError={media.onError}
      className={cn("w-full rounded-md bg-muted", compact ? "max-h-48" : "max-h-96")}
    />
  );
}

export function PostAttachments({
  attachments,
  compact = false,
  showAllImages = false,
  testId = "post-attachments",
  className,
}: PostAttachmentsProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  const maxImages = showAllImages ? FEED_MAX_IMAGES_PER_POST : IMAGE_GRID_MAX;
  const { grid, videos, files } = React.useMemo(
    () => splitAttachments(attachments, maxImages),
    [attachments, maxImages],
  );

  if (grid.shown.length === 0 && videos.length === 0 && files.length === 0) return null;

  return (
    <div data-testid={testId} className={cn("flex flex-col gap-2", className)}>
      {grid.shown.length > 0 && (
        <div
          data-testid="post-image-grid"
          className={cn(
            "grid gap-1",
            grid.columns === 1 ? "grid-cols-1" : "grid-cols-2",
            compact && "max-w-sm",
          )}
        >
          {grid.shown.map((att, i) => (
            <div key={att.fileId} className="relative overflow-hidden rounded-md bg-muted">
              <AttachmentImage
                src={att.url}
                alt={t("post.imageAlt", { index: i + 1, total: grid.shown.length })}
              />
              {i === grid.shown.length - 1 && grid.overflow > 0 && (
                <span className="absolute inset-0 flex items-center justify-center bg-foreground/60 text-lg font-semibold text-background">
                  {t("post.moreImages", { count: grid.overflow })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {videos.map((v) => (
        <AttachmentVideo
          key={v.fileId}
          src={v.url}
          label={v.fileName ?? t("attachment.unnamed")}
          compact={compact}
        />
      ))}

      {files.length > 0 && (
        <ul aria-label={t("attachment.filesAria")} className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f.fileId}>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-2 rounded-md border border-border px-2 py-1 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                {/* `<bdi>`: tên tệp do người dùng đặt — ký tự đảo chiều (RTLO) không lật được chữ quanh nó. */}
                <bdi className="truncate">{f.fileName ?? t("attachment.unnamed")}</bdi>
                {f.sizeBytes !== null && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatFileSize(f.sizeBytes)}
                  </span>
                )}
                {/* Bấm link tệp = TẢI XUỐNG. Chữ ẩn nối vào tên trợ năng SAU tên + cỡ tệp, ngoài `<bdi>`; KHÔNG dùng
                    `aria-label` trên `<a>` (đè mất tên tệp). Icon chỉ cho người nhìn. */}
                <span className="sr-only">{t("attachment.download")}</span>
                <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
