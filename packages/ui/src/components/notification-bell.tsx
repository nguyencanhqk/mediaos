import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { notificationApi } from "@mediaos/web-core";
import { Button } from "./ui/button";

/**
 * Chuông thông báo — chrome dùng chung mọi app (FS-5). Tiêu thụ `notificationApi` của @mediaos/web-core
 * (Bearer + credentials + refresh-on-401) và namespace i18n `notifications` (nhúng sẵn ở web-core core
 * resources → mọi app có, kể cả people/console không có feature chat). Mỗi app gắn nó vào slot
 * `notifications` của AppShell + header trang chủ launcher.
 *
 * ⚠️ LEGACY/BROKEN (S4-FE-NOTI-CONSOLE-BELL-1, 2026-07): `notificationApi` mà component này gọi trỏ
 * route BE đã bị GỠ ở PR #133 (xem ghi chú trong `notification-api.ts`). KHÔNG còn app nào mount
 * component này trong app tree hiện tại (apps/console đã gỡ — xem apps/console/src/routes/root-layout.tsx
 * + home.tsx). KHÔNG dùng lại cho app mới — apps/app dùng `NotificationBadge`/`NotificationDropdown`
 * (apps/app/src/components/notifications) tiêu thụ `myNotificationApi` thật. Giữ file để không phá
 * `export *` ở packages/ui/src/index.ts — chờ quyết định xoá hẳn (ngoài phạm vi lane console-bell).
 */
export function NotificationBell() {
  const { t } = useTranslation("notifications");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: unread } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => notificationApi.unreadCount(),
    refetchInterval: 30_000,
  });

  const { data: list } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => notificationApi.list(),
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Đóng khi click bên ngoài
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const count = unread?.count ?? 0;

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="relative"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("ariaLabel")}
      >
        <Bell className="size-4" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">{t("title")}</span>
            {count > 0 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => markAllRead.mutate()}
              >
                {t("markAllRead")}
              </button>
            )}
          </div>

          <ul className="max-h-80 overflow-y-auto divide-y divide-border">
            {!list || list.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</li>
            ) : (
              list.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 ${
                    !n.isRead ? "bg-primary/5" : ""
                  }`}
                  onClick={() => {
                    if (!n.isRead) markRead.mutate(n.id);
                  }}
                >
                  <div
                    className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary opacity-0 data-[unread=true]:opacity-100"
                    data-unread={!n.isRead}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t(`types.${n.type}`, { defaultValue: n.type })}
                    </p>
                    <p className="mt-0.5 text-sm leading-snug">{n.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString("vi-VN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
