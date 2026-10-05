/**
 * S16-SOCIAL-FE-3 — dải báo lỗi của cụm quản trị bảng tin (plan D5).
 *
 * App không có hệ toast và `QueryClient` không khai `MutationCache.onError` ⇒ một lời gọi hỏng mà không
 * vẽ dải này là IM LẶNG tuyệt đối (bài học ở `feed/components/ActionErrorBanner.tsx`). Dải riêng, không
 * mở rộng `ActionErrorBanner`: tập lý do của cụm quản trị tra theo bảng của từng lời gọi (`admin-errors`).
 *
 * ⚠️ Chỉ nhận `reason` thuộc tập đóng — KHÔNG có prop nhận chuỗi. Câu chữ là việc của i18n
 * (`social:admin.error.<reason>`); `message` của server không có đường nào tới được đây.
 *
 * `role="alert"` để trình đọc màn hình đọc ngay khi dải xuất hiện.
 *
 * `onRetry` là TUỲ CHỌN có chủ ý: lỗi kết cục (403 · «đã có người xử lý»…) thử lại là vô ích, nơi gọi
 * không truyền thì không có nút.
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@mediaos/ui";
import type { AdminErrorReason } from "../lib/admin-errors";

export interface AdminErrorNoticeProps {
  reason: AdminErrorReason;
  /** Có ⇒ vẽ nút «Thử lại». Chỉ truyền khi thử lại CÓ thể thành công. */
  onRetry?: () => void;
  /**
   * Lượt thử lại ĐANG chạy mà dải vẫn còn trên màn (react-query giữ `status: "error"` suốt lượt đọc lại
   * khi cache đã có dữ liệu) ⇒ khoá «Thử lại» + `aria-busy`: «đang thử» không được trông như «nút không ăn».
   */
  isRetrying?: boolean;
  /** Có ⇒ vẽ nút đóng dải. */
  onDismiss?: () => void;
  className?: string;
}

export function AdminErrorNotice({
  reason,
  onRetry,
  isRetrying = false,
  onDismiss,
  className,
}: AdminErrorNoticeProps): React.ReactElement {
  const { t } = useTranslation("social");

  return (
    <div
      role="alert"
      data-testid="admin-error-notice"
      data-reason={reason}
      aria-busy={isRetrying ? true : undefined}
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2",
        className,
      )}
    >
      <p className="text-sm text-destructive">{t(`admin.error.${reason}`)}</p>
      {(onRetry || onDismiss) && (
        <div className="flex shrink-0 items-center gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="rounded px-2 py-0.5 text-sm font-medium text-destructive underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
            >
              {t("admin.notice.retry")}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label={t("admin.notice.dismiss")}
              className="rounded p-0.5 text-destructive/70 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
