import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { myNotificationApi, notificationKeys, useCan } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { NotificationDropdown } from "./NotificationDropdown";
import { NOTI_ENGINE_PAIRS, NOTI_PATHS } from "@/routes/notifications/constants";

const UNREAD_COUNT_POLL_INTERVAL_MS = 30_000;

/**
 * NotificationBadge — S4-FE-NOTI-1. Chuông header dùng cho apps/app (mirror @mediaos/ui NotificationBell
 * nhưng gọi ĐÚNG route THẬT S4-NOTI-BE-1 — file cũ đã broken sau khi route legacy bị gỡ, xem ghi chú
 * blocker). Dùng GET /notifications/unread-count (NOTI-API-003, partial index) — KHÔNG gọi list() chỉ để
 * đếm. Poll {@link UNREAD_COUNT_POLL_INTERVAL_MS} để badge tự cập nhật khi có thông báo mới.
 *
 * Gate = read:notification (Own) — mirror route-level `NOTI.NOTIFICATION.VIEW_OWN` (đã map
 * PERMISSION_CODE_TO_PAIR → "read:notification"); thiếu quyền ⇒ ẩn HOÀN TOÀN (KHÔNG hiện chuông rỗng).
 */
export function NotificationBadge() {
  const { t } = useTranslation("notifications");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const canRead = useCan(NOTI_ENGINE_PAIRS.READ.action, NOTI_ENGINE_PAIRS.READ.resourceType);

  const { data, isError } = useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => myNotificationApi.unreadCount(),
    enabled: canRead,
    refetchInterval: UNREAD_COUNT_POLL_INTERVAL_MS,
  });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!canRead) return null;

  const count = isError ? 0 : (data?.unread_count ?? 0);

  function closeAndGoToList() {
    setOpen(false);
    void navigate({ to: NOTI_PATHS.LIST as "/" });
  }

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="relative"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("badge.ariaLabel")}
      >
        <Bell className="size-4" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Button>

      {open && <NotificationDropdown onNavigate={closeAndGoToList} />}
    </div>
  );
}
