import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { myNotificationApi, notificationInvalidation, notificationKeys } from "@mediaos/web-core";
import type { MyNotificationDropdownItem } from "@mediaos/contracts";
import { MarkAllReadButton } from "./MarkAllReadButton";
import { NotificationTargetLink, isSafeInternalTarget } from "./NotificationTargetLink";
import { NOTI_DROPDOWN_LIMIT, NOTI_STATUS } from "@/routes/notifications/constants";

interface NotificationDropdownProps {
  /** Gọi khi user chọn 1 dòng / bấm "Xem tất cả" — panel cha (NotificationBadge) đóng dropdown. */
  onNavigate: () => void;
}

function DropdownRow({
  item,
  onNavigate,
}: {
  item: MyNotificationDropdownItem;
  onNavigate: () => void;
}) {
  const { t } = useTranslation("notifications");
  const queryClient = useQueryClient();
  const isUnread = item.status === NOTI_STATUS.UNREAD;

  const markRead = useMutation({
    mutationFn: () => myNotificationApi.markRead(item.notification_id),
    onSuccess: () => {
      for (const key of notificationInvalidation.markRead(item.notification_id)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  return (
    <li className={isUnread ? "bg-primary/5" : ""}>
      <NotificationTargetLink
        targetUrl={item.target_url}
        onBeforeNavigate={() => {
          if (isUnread) markRead.mutate();
          onNavigate();
        }}
        className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-muted/50"
      >
        <span className="flex items-center gap-2">
          {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
          <span className="text-sm font-medium leading-snug">{item.title}</span>
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{item.short_content}</span>
        <span className="text-[11px] text-muted-foreground">
          {new Date(item.created_at).toLocaleString("vi-VN", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </span>
      </NotificationTargetLink>
      {!isSafeInternalTarget(item.target_url) && isUnread && (
        <button
          type="button"
          className="ml-4 mb-2 text-xs text-primary hover:underline"
          onClick={() => markRead.mutate()}
        >
          {t("actions.markRead")}
        </button>
      )}
    </li>
  );
}

/**
 * NotificationDropdown — S4-FE-NOTI-1. Dùng GET /notifications/dropdown (NOTI-API-002, latest N)
 * — KHÔNG load cả danh sách (đó là việc của NotificationListPage). Chỉ fetch khi mounted (caller gate
 * bằng `open` qua unmount/mount, KHÔNG bằng `enabled` — panel nhỏ, không cần giữ cache lâu khi đóng).
 */
export function NotificationDropdown({ onNavigate }: NotificationDropdownProps) {
  const { t } = useTranslation("notifications");

  const { data, isLoading, isError } = useQuery({
    queryKey: notificationKeys.dropdown({ limit: NOTI_DROPDOWN_LIMIT }),
    queryFn: () => myNotificationApi.dropdown({ limit: NOTI_DROPDOWN_LIMIT }),
    staleTime: 15_000,
  });

  const items = data?.items ?? [];

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-background shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold">{t("dropdown.title")}</span>
        <MarkAllReadButton disabled={(data?.unread_count ?? 0) === 0} size="sm" />
      </div>

      <ul className="max-h-80 overflow-y-auto divide-y divide-border">
        {isLoading && <li className="px-4 py-6 text-center text-sm text-muted-foreground">…</li>}
        {isError && (
          <li className="px-4 py-6 text-center text-sm text-destructive">
            {t("dropdown.loadError")}
          </li>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t("dropdown.empty")}
          </li>
        )}
        {!isLoading &&
          !isError &&
          items.map((item) => (
            <DropdownRow key={item.notification_id} item={item} onNavigate={onNavigate} />
          ))}
      </ul>

      <div className="border-t border-border px-4 py-2 text-center">
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={onNavigate}
        >
          {t("dropdown.viewAll")}
        </button>
      </div>
    </div>
  );
}
