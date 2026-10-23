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
  notificationMarkAllScope,
  type NotiListSource,
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

/** Lọc nguồn: `POST /notifications/mark-all-read` nhận `source_module` ⇒ đánh dấu ĐÚNG bộ lọc. */
function MarkFilterReadButton({ source }: { source: NotiListSource }) {
  const { t } = useTranslation("notifications");
  const queryClient = useQueryClient();
  const canMarkAllRead = useCan(
    NOTI_ENGINE_PAIRS.MARK_ALL_READ.action,
    NOTI_ENGINE_PAIRS.MARK_ALL_READ.resourceType,
  );
  const mutation = useMutation({
    mutationFn: () => myNotificationApi.markAllRead({ source_module: source }),
    onSuccess: () => invalidateAfterBulk(queryClient),
    onError: () => toast.error(t("actions.markReadFailed")),
  });

  if (!canMarkAllRead) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      <CheckCheck className="mr-1.5 h-4 w-4" />
      {t("actions.markAllReadInFilter")}
    </Button>
  );
}

/**
 * Có lọc mức ưu tiên: endpoint mark-all-read KHÔNG lọc `priority` ⇒ chỉ đánh dấu các dòng chưa đọc
 * đang hiện trong trang (mỗi dòng một `POST /notifications/:id/mark-read`, tối đa một trang).
 */
function MarkPageReadButton({ items }: { items: MyNotificationListItem[] }) {
  const { t } = useTranslation("notifications");
  const queryClient = useQueryClient();
  const canMarkRead = useCan(
    NOTI_ENGINE_PAIRS.MARK_READ.action,
    NOTI_ENGINE_PAIRS.MARK_READ.resourceType,
  );
  const unreadIds = items.filter(isUnread).map((item) => item.notification_id);
  const mutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => myNotificationApi.markRead(id)));
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("mark-read failed for some notifications");
      }
    },
    onError: () => toast.error(t("actions.markReadFailed")),
    // Một phần có thể đã thành công dù có dòng lỗi ⇒ luôn làm mới.
    onSettled: () => invalidateAfterBulk(queryClient),
  });

  if (!canMarkRead) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutation.mutate(unreadIds)}
      disabled={unreadIds.length === 0 || mutation.isPending}
    >
      <CheckCheck className="mr-1.5 h-4 w-4" />
      {t("actions.markReadInPage")}
    </Button>
  );
}

interface NotificationListMarkReadProps {
  search: NotificationListSearch;
  items: MyNotificationListItem[];
}

/** Nút «đánh dấu đã đọc» của trang danh sách — phạm vi theo `notificationMarkAllScope`. */
export function NotificationListMarkRead({ search, items }: NotificationListMarkReadProps) {
  const scope = notificationMarkAllScope(search);
  if (scope === "page") return <MarkPageReadButton items={items} />;
  if (scope === "filter" && search.source) return <MarkFilterReadButton source={search.source} />;
  return <MarkAllReadButton />;
}
