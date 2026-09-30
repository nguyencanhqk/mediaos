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
export const ACTION_ERROR_KINDS = [
  "reaction",
  "save",
  "moderate",
  "delete",
  "comment",
  "commentDelete",
  "post",
  "ack",
  // S16-SOCIAL-FE-2 — chữ trung tính, xem `actionError.generic.vote` (plan §8 M6).
  "vote",
  "pollClose",
  "ideaReview",
  // S16-SOCIAL-FE-2B — màn Nhóm.
  "groupJoin",
  "groupLeave",
  "groupCreate",
  "groupUpdate",
  "groupDelete",
  "memberDecide",
  "memberRole",
  "memberRemove",
] as const;
export type ActionErrorKind = (typeof ACTION_ERROR_KINDS)[number];

/**
 * S16-SOCIAL-FE-2B — lý do CỤ THỂ đọc được từ lỗi (`groups/lib/group-errors.ts`; S16-SOCIAL-FE-2C thêm
 * `kudos/lib/kudos-errors.ts`). Có `reason` thì câu chữ nói ĐÚNG lý do (vd «phải còn một chủ nhóm»)
 * thay cho câu forbidden/generic — done_when #1 của FE-2B: 409 ERR-015 phải hiện lý do, không phải
 * «vui lòng thử lại» (thử lại là vô ích).
 */
export const ACTION_ERROR_REASONS = [
  "lastOwner",
  "alreadyMember",
  "stateChanged",
  "groupGone",
  "nameTaken",
  // S16-SOCIAL-FE-2C — lời vinh danh (mã `SOCIAL-ERR-KUDOS-*` · `022`).
  "kudosCreateDenied",
  "kudosOfficialDenied",
  "kudosSelf",
  "kudosRecipientLimit",
  "kudosRecipientInvalid",
  "kudosBadgeInvalid",
] as const;
export type ActionErrorReason = (typeof ACTION_ERROR_REASONS)[number];

export interface ActionErrorBannerProps {
  kind: ActionErrorKind;
  /** 403 — người dùng cần đi hỏi quản trị, thử lại là vô ích. */
  forbidden: boolean;
  /** Thắng `forbidden`: render `actionError.reason.<reason>`. */
  reason?: ActionErrorReason | null;
  onDismiss?: () => void;
  className?: string;
}

export function ActionErrorBanner({
  kind,
  forbidden,
  reason,
  onDismiss,
  className,
}: ActionErrorBannerProps): React.ReactElement {
  const { t } = useTranslation("social");
  const group = forbidden ? "forbidden" : "generic";
  const text = reason ? t(`actionError.reason.${reason}`) : t(`actionError.${group}.${kind}`);

  return (
    <div
      role="alert"
      data-testid="feed-action-error"
      data-kind={kind}
      data-reason={reason ?? undefined}
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2",
        className,
      )}
    >
      <p className="text-sm text-destructive">{text}</p>
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
