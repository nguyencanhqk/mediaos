import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import type { MyNotificationListItem } from "@mediaos/contracts";
import { myNotificationApi, notificationInvalidation, useCan } from "@mediaos/web-core";
import { Button, toast } from "@mediaos/ui";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";
import { NotificationTargetLink } from "@/components/notifications/NotificationTargetLink";
import { NOTI_ENGINE_PAIRS, NOTI_STATUS } from "./constants";
import {
  notificationMarkAllBody,
  notificationMarkAllScope,
  type NotificationListSearch,
} from "./notification-list-search";

function invalidateAfterBulk(queryClient: QueryClient) {
  for (const key of notificationInvalidation.markAllRead()) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

function isUnread(item: MyNotificationListItem): boolean {
  return item.status === NOTI_STATUS.UNREAD;
}

interface NotificationRowLinkProps {
  item: MyNotificationListItem;
  onView: (id: string) => void;
}

/**
 * S20-NOTI-LISTNAV-1 (US-X-13) — ô tiêu đề của một dòng: bấm ⇒ đánh dấu đã đọc (nếu chưa đọc và có
 * quyền) rồi đi thẳng `target_url` qua `NotificationTargetLink` (đích việc ⇒ drawer `?task=` tại chỗ).
 * Đích rỗng/không an toàn ⇒ trang chi tiết như cũ. mark-read chạy nền, KHÔNG chặn điều hướng; lỗi ⇒
 * không làm mới cache nên dòng vẫn hiện chưa đọc.
 */
export function NotificationRowLink({ item, onView }: NotificationRowLinkProps) {
  const queryClient = useQueryClient();
  const canMarkRead = useCan(
    NOTI_ENGINE_PAIRS.MARK_READ.action,
    NOTI_ENGINE_PAIRS.MARK_READ.resourceType,
  );
  const markRead = useMutation({
    mutationFn: () => myNotificationApi.markRead(item.notification_id),
    onSuccess: () => {
      for (const key of notificationInvalidation.markRead(item.notification_id)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  return (
    <NotificationTargetLink
      targetUrl={item.target_url}
      onBeforeNavigate={() => {
        if (canMarkRead && isUnread(item)) markRead.mutate();
      }}
      onUnsafeTarget={() => onView(item.notification_id)}
      className="block max-w-md text-left"
    >
      <span className={`text-sm ${item.is_read ? "" : "font-semibold"}`}>{item.title}</span>
      <span className="block truncate text-xs text-muted-foreground">{item.short_content}</span>
    </NotificationTargetLink>
  );
}

/**
 * Có lọc nguồn và/hoặc mức ưu tiên: MỘT `POST /notifications/mark-all-read` mang đủ `source_module` +
 * `priority` + `created_before` (= `created_at` mới nhất đang hiện, đồng hồ server) ⇒ server đánh dấu ĐÚNG bộ lọc, không loop từng dòng.
 */
function MarkFilterReadButton({
  search,
  watermark,
}: {
  search: NotificationListSearch;
  watermark: Date | null;
}) {
  const { t } = useTranslation("notifications");
  const queryClient = useQueryClient();
  const canMarkAllRead = useCan(
    NOTI_ENGINE_PAIRS.MARK_ALL_READ.action,
    NOTI_ENGINE_PAIRS.MARK_ALL_READ.resourceType,
  );
  const mutation = useMutation({
    mutationFn: () =>
      watermark ? myNotificationApi.markAllRead(notificationMarkAllBody(search, watermark)) : Promise.resolve(null),
    onSuccess: () => invalidateAfterBulk(queryClient),
    onError: () => toast.error(t("actions.markReadFailed")),
  });

  if (!canMarkAllRead) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending || watermark === null}
    >
      <CheckCheck className="mr-1.5 h-4 w-4" />
      {t("actions.markAllReadInFilter")}
    </Button>
  );
}

interface NotificationListMarkReadProps {
  search: NotificationListSearch;
  /** Mốc `created_at` mới nhất đang hiện (server) — `listWatermark`; null ⇒ chưa có dòng. */
  watermark: Date | null;
}

/** Nút «đánh dấu đã đọc» của trang danh sách — phạm vi theo `notificationMarkAllScope`. */
export function NotificationListMarkRead({ search, watermark }: NotificationListMarkReadProps) {
  if (notificationMarkAllScope(search) === "filter") {
    return <MarkFilterReadButton search={search} watermark={watermark} />;
  }
  return <MarkAllReadButton />;
}
