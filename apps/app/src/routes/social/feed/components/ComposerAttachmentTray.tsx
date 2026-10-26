/**
 * S16-SOCIAL-FE-2D (plan §4 A5) — khay đính kèm DÙNG CHUNG cho ô soạn bài (`composer-*`) và bình luận
 * (`comment-*`).
 *
 * ┌─ 🔴 `disabled` PHẢI chặn ở CẢ thuộc tính LẪN handler (plan §10 #1, đo M23) ──────────────────────┐
 * │ Ô soạn truyền `disabled={busy}` suốt lượt gửi: thêm tệp GIỮA lượt gửi thì lượt `resolve` sẽ dọn    │
 * │ khay và nuốt tệp mới (thành `Pending` mồ côi trên storage). Thuộc tính `disabled` chặn người dùng   │
 * │ thật (nút mở hộp chọn bị khoá), nhưng `onChange` của `<input type=file disabled>` VẪN chạy khi sự   │
 * │ kiện được bắn bằng mã — nên handler TỰ trả về sớm. Ca F8/K2c + mutant mA12/mA13 ghim cả hai vế.     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Xem trước ảnh dùng blob URL do hook tạo/thu hồi — component này KHÔNG gọi `createObjectURL`.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@mediaos/ui";
import { formatFileSize } from "@/components/chat/chat-format";
import {
  ATTACHMENT_ACCEPT,
  type AttachmentRejectReason,
  type AttachmentRejection,
} from "../lib/attachment-draft";
import { ATTACHMENT_LIMIT_PARAMS } from "../lib/attachment-limits";
import type { AttachmentUploads } from "../lib/use-attachment-uploads";

/**
 * `{{max}}` của từng lý do từ chối — CÙNG nguồn với dải lỗi 422 (`attachment-limits.ts`). `null` = lý do nói về
 * chính tệp, không về một trần (`empty`): câu của nó không có `{{max}}`.
 */
const REJECT_MAX: Readonly<Record<AttachmentRejectReason, string | number | null>> = {
  empty: null,
  tooLarge: ATTACHMENT_LIMIT_PARAMS.maxSize,
  tooManyImages: ATTACHMENT_LIMIT_PARAMS.images,
  tooManyVideos: ATTACHMENT_LIMIT_PARAMS.videos,
  tooManyFiles: ATTACHMENT_LIMIT_PARAMS.files,
};

/** Tham số nội suy của MỘT dòng từ chối — lý do không có trần thì KHÔNG mang khoá `max`. */
function rejectionParams(rejection: AttachmentRejection): { name: string; max?: string | number } {
  const max = REJECT_MAX[rejection.reason];
  return max === null ? { name: rejection.name } : { name: rejection.name, max };
}

interface ComposerAttachmentTrayProps {
  uploads: Pick<
    AttachmentUploads,
    "items" | "rejections" | "submitState" | "add" | "remove" | "retry"
  >;
  /** Suốt lượt gửi ⇒ KHOÁ cả khay (thêm · gỡ · thử lại) — xem hộp đầu file. */
  disabled: boolean;
  /** Tiền tố `data-testid`: `composer` (bài) · `comment` (bình luận). */
  testIdPrefix: "composer" | "comment";
  className?: string;
}

export function ComposerAttachmentTray({
  uploads,
  disabled,
  testIdPrefix,
  className,
}: ComposerAttachmentTrayProps): React.ReactElement {
  const { t } = useTranslation("social");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { items, rejections, submitState, add, remove, retry } = uploads;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    // Vế HANDLER của khoá — thuộc tính `disabled` không chặn được `change` bắn bằng mã (M23).
    if (disabled) return;
    const files = e.target.files;
    if (files && files.length > 0) add(Array.from(files));
    // Cho phép chọn lại ĐÚNG tệp vừa gỡ (trình duyệt không bắn `change` khi giá trị không đổi).
    e.target.value = "";
  };

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-testid={`${testIdPrefix}-attach-tray`}
    >
      {items.length > 0 && (
        <ul aria-label={t(`attachment.trayAria.${testIdPrefix}`)} className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid={`${testIdPrefix}-attach-item`}
              data-status={item.status}
              className={cn(
                "flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs",
                item.status === "error" ? "border-destructive/40" : "border-border",
              )}
            >
              {item.previewUrl !== null ? (
                <img
                  src={item.previewUrl}
                  alt={t("attachment.previewAlt", { name: item.name })}
                  className="h-10 w-10 shrink-0 rounded object-cover"
                />
              ) : (
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0 truncate text-foreground">{item.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {formatFileSize(item.sizeBytes)}
              </span>

              {(item.status === "queued" || item.status === "uploading") && (
                <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  {t("attachment.uploading")}
                </span>
              )}
              {item.status === "error" && item.error && (
                <span className="shrink-0 text-destructive">
                  {t(`attachment.error.${item.error}`)}
                </span>
              )}
              {/* Thử lại chỉ có nghĩa với lỗi TẠM (mạng/PUT/confirm) — 415/413/403 thử lại vẫn hỏng. */}
              {item.status === "error" && item.error === "uploadFailed" && (
                <button
                  type="button"
                  onClick={() => retry(item.id)}
                  disabled={disabled}
                  aria-label={t("attachment.retryNamed", { name: item.name })}
                  data-testid={`${testIdPrefix}-attach-retry`}
                  className="shrink-0 rounded px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("attachment.retry")}
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(item.id)}
                disabled={disabled}
                aria-label={t("attachment.remove", { name: item.name })}
                data-testid={`${testIdPrefix}-attach-remove`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {rejections.length > 0 && (
        <div
          role="alert"
          data-testid={`${testIdPrefix}-attach-error`}
          className="text-sm text-destructive"
        >
          <ul className="flex flex-col gap-0.5">
            {rejections.map((r, i) => (
              <li key={`${r.name}-${i}`}>
                {t(`attachment.reject.${r.reason}`, rejectionParams(r))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Vùng `role=status` LUÔN mount, chỉ đổi chữ (FULL gate lượt 1, G5d): trình đọc màn hình đọc THAY ĐỔI
          của một vùng đã có sẵn — mount cùng lúc với chữ thì câu «Đang tải tệp lên…» đầu tiên hay bị bỏ qua. */}
      <p
        role="status"
        data-testid={`${testIdPrefix}-attach-blocked`}
        className={submitState.ready ? "sr-only" : "text-xs text-muted-foreground"}
      >
        {submitState.ready ? null : t(`attachment.blocked.${submitState.reason}`)}
      </p>

      <div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          disabled={disabled}
          onChange={onPick}
          data-testid={`${testIdPrefix}-attach-input`}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-label={t("attachment.add")}
          data-testid={`${testIdPrefix}-attach-button`}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          {t("attachment.addLabel")}
        </button>
      </div>
    </div>
  );
}
