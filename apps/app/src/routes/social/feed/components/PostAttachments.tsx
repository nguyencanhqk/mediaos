/**
 * S16-SOCIAL-FE-2D (plan §4 A8) — vẽ đính kèm của bài · bình luận · tin: lưới ảnh · video · link tệp.
 *
 * ┌─ 🔴 BA LUẬT ──────────────────────────────────────────────────────────────────────────────────┐
 * │ 1. `url:null` (presign bị từ chối cho NGƯỜI XEM này) hoặc URL không phải `http(s)` ⇒ KHÔNG vẽ gì   │
 * │    cho tệp đó — ảnh, video lẫn tệp (owner ký D4 (a)); một ô «có mà không xem được» là rò sự tồn   │
 * │    tại. Luật sống ở `splitAttachments` (một vị từ cho cả ba).                                     │
 * │ 2. URL ký GET sống 300 s (`S3_PRESIGN_TTL_SEC`): ảnh `lazy` cuộn tới / video tua sau đó ⇒ lỗi tải │
 * │    ⇒ ô TRUNG TÍNH thay icon vỡ (`onError`). Gốc là TTL/refetch-on-error ở BE (nợ G6).            │
 * │ 3. Link tệp `target=_blank rel="noopener noreferrer"` — bytes do người dùng tải lên, KHÔNG tin.   │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { FileText, ImageOff, VideoOff } from "lucide-react";
import { cn } from "@mediaos/ui";
import type { FeedAttachmentDto } from "@mediaos/contracts";
import { formatFileSize } from "@/components/chat/chat-format";
import { splitAttachments } from "../lib/feed-format";

interface PostAttachmentsProps {
  attachments: readonly FeedAttachmentDto[];
  /** Bình luận / hàng tin: ô nhỏ hơn. */
  compact?: boolean;
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

function AttachmentImage({ src, alt }: { src: string; alt: string }): React.ReactElement {
  const { t } = useTranslation("social");
  const [failed, setFailed] = React.useState(false);
  if (failed) {
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
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

function AttachmentVideo({ src, compact }: { src: string; compact: boolean }): React.ReactElement {
  const { t } = useTranslation("social");
  const [failed, setFailed] = React.useState(false);
  if (failed) {
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
      src={src}
      controls
      preload="metadata"
      onError={() => setFailed(true)}
      className={cn("w-full rounded-md bg-muted", compact ? "max-h-48" : "max-h-96")}
    />
  );
}

export function PostAttachments({
  attachments,
  compact = false,
  testId = "post-attachments",
  className,
}: PostAttachmentsProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  const { grid, videos, files } = React.useMemo(() => splitAttachments(attachments), [attachments]);

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
        <AttachmentVideo key={v.fileId} src={v.url} compact={compact} />
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
                <span className="truncate">{f.fileName ?? t("attachment.unnamed")}</span>
                {f.sizeBytes !== null && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatFileSize(f.sizeBytes)}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
