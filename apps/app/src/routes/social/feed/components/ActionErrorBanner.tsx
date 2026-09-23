/**
 * S16-SOCIAL-FE-1 — dải báo lỗi cho HÀNH ĐỘNG GHI của bảng tin.
 *
 * ┌─ VÌ SAO TỒN TẠI ─────────────────────────────────────────────────────────────────────────────┐
 * │ FULL gate 23/09/2026 đo được: `routes/social` có 12 `useMutation` và **0** `onError`, trong    │
 * │ khi 13 module khác của app có tổng cộng 203 chỗ. App KHÔNG có hệ toast (`grep Toaster|useToast │
 * │ |sonner` = 0) và `QueryClient` ở `main.tsx` KHÔNG khai `MutationCache.onError`. Nghĩa là mọi   │
 * │ hành động ghi hỏng đều IM LẶNG TUYỆT ĐỐI: nút nhả ra như cũ, không một ký tự nào xuất hiện.    │
 * │ Người dùng bấm lại vài lần rồi kết luận nút hỏng — hoặc tệ hơn, tin rằng việc đã xong.         │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `role="alert"` để trình đọc màn hình đọc ngay khi nó xuất hiện — người dùng bàn phím/screen reader
 * là đúng nhóm chịu thiệt nặng nhất khi một hành động hỏng mà không phát ra tín hiệu nào.
 *
 * ⚠️ Nhận `kind` + `forbidden` chứ KHÔNG nhận chuỗi dựng sẵn: chọn câu là việc của i18n, và truyền
 * chuỗi vào sẽ mở đường cho các màn tự chế câu chữ riêng rồi trôi khỏi nhau.
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@mediaos/ui";

/**
 * Rộng hơn `FeedActionKind` của `use-feed-actions`: dải này còn phục vụ các đường ghi KHÔNG đi qua
 * hook đó (đăng bài · bình luận · xác nhận đã đọc). Giữ một bộ khoá i18n duy nhất cho tất cả.
 */
export type ActionErrorKind =
  | "reaction"
  | "save"
  | "moderate"
  | "delete"
  | "comment"
  | "commentDelete"
  | "post"
  | "ack";

export interface ActionErrorBannerProps {
  kind: ActionErrorKind;
  /** 403 — người dùng cần đi hỏi quản trị, thử lại là vô ích. */
  forbidden: boolean;
  onDismiss?: () => void;
  className?: string;
}

export function ActionErrorBanner({
  kind,
  forbidden,
  onDismiss,
  className,
}: ActionErrorBannerProps): React.ReactElement {
  const { t } = useTranslation("social");
  const group = forbidden ? "forbidden" : "generic";

  return (
    <div
      role="alert"
      data-testid="feed-action-error"
      data-kind={kind}
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2",
        className,
      )}
    >
      <p className="text-sm text-destructive">{t(`actionError.${group}.${kind}`)}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("actionError.dismiss")}
          className="rounded p-0.5 text-destructive/70 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
