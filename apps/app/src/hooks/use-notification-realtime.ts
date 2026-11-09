/**
 * S20-NOTI-LIVETOAST-1 — thông báo đến qua `/ws` ⇒ làm mới chuông + toast «Mở» ở MỌI trang.
 *
 * Mount MỘT lần ở `ProtectedShell`, gate `read:notification` (tách khỏi `useChatRealtime`, vốn chỉ chạy khi
 * có `view:chat-room`). Dùng socket singleton của `getAppSocket()`; CHỈ gắn/gỡ đúng handler của mình, KHÔNG
 * `disconnect()`/`reconnection()` — socket chat dùng chung.
 *
 * Toast: WS chỉ mang thân thông báo cũ (không có tiêu đề/đích) ⇒ lấy dòng tương ứng từ `GET
 * /notifications/dropdown` (cùng khoá cache với chuông, nên là chính lần làm mới sau `notification:new`).
 * Đích phòng chat KHÔNG toast ở đây: toast tin nhắn (`use-chat-toast`) là nguồn DUY NHẤT cho DM/@nhắc (X-06).
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAppSocket,
  myNotificationApi,
  notificationKeys,
  useAuthStore,
  useCan,
} from "@mediaos/web-core";
import { WS_EVENTS, wsNotificationEventSchema } from "@mediaos/contracts";
import { toast } from "@mediaos/ui";
import {
  isSafeInternalTarget,
  useOpenNotificationTarget,
} from "@/components/notifications/NotificationTargetLink";
import { NOTI_DROPDOWN_LIMIT, NOTI_ENGINE_PAIRS } from "@/routes/notifications/constants";
import { chatRoomTargetFromUrl } from "@/routes/chat/chat-room-link";
import { readToastPrefs } from "@/lib/toast-prefs";
import { useNotificationSocketState } from "./use-notification-realtime-state";

const NOTI_TOAST_KEY_PREFIX = "noti:";

export function useNotificationRealtime(): void {
  const { t } = useTranslation("notifications");
  const queryClient = useQueryClient();
  const canRead = useCan(NOTI_ENGINE_PAIRS.READ.action, NOTI_ENGINE_PAIRS.READ.resourceType);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openTarget = useOpenNotificationTarget();

  // Handler đọc giá trị MỚI NHẤT qua ref: effect không phải gắn lại socket mỗi lần `t`/router đổi.
  const latest = useRef({ t, openTarget });
  latest.current = { t, openTarget };

  const active = canRead && isAuthenticated && userId !== null;

  useEffect(() => {
    if (!active || userId === null) return;
    const socket = getAppSocket();
    if (!socket) return;
    const setConnected = useNotificationSocketState.getState().setConnected;
    let warned = false;
    let dropped = false;

    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
      void queryClient.invalidateQueries({ queryKey: [...notificationKeys.all, "dropdown"] });
      void queryClient.invalidateQueries({ queryKey: [...notificationKeys.all, "list"] });
    };

    const stillAllowed = (): boolean => useAuthStore.getState().isAuthenticated;

    const showToast = async (notificationId: string): Promise<void> => {
      if (!readToastPrefs(userId).notifications) return;
      const res = await queryClient.fetchQuery({
        queryKey: notificationKeys.dropdown({ limit: NOTI_DROPDOWN_LIMIT }),
        queryFn: () => myNotificationApi.dropdown({ limit: NOTI_DROPDOWN_LIMIT }),
        staleTime: 0,
      });
      // Phiên hết hạn / đổi tuỳ chọn trong lúc chờ ⇒ không còn toast.
      if (!stillAllowed() || !readToastPrefs(userId).notifications) return;
      const item = res.items.find((i) => i.notification_id === notificationId);
      if (!item) return;
      if (chatRoomTargetFromUrl(item.target_url ?? "") !== null) return; // toast tin nhắn lo
      const target = item.target_url;
      toast.success(item.title, {
        key: `${NOTI_TOAST_KEY_PREFIX}${notificationId}`,
        action: isSafeInternalTarget(target)
          ? {
              label: latest.current.t("toast.open"),
              onClick: () => latest.current.openTarget(target),
            }
          : undefined,
      });
    };

    const onNew = (payload: unknown): void => {
      const parsed = wsNotificationEventSchema.safeParse(payload);
      refresh();
      if (!parsed.success) {
        if (!warned) {
          warned = true;
          console.warn("[noti] payload notification:new sai hợp đồng — bỏ qua toast");
        }
        return;
      }
      if (!stillAllowed()) return;
      showToast(parsed.data.id).catch(() => {
        // Không tải được dòng thông báo ⇒ không toast (chuông vẫn cập nhật qua refresh/poll).
      });
    };
    const onRead = (): void => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
    };
    const onConnect = (): void => {
      setConnected(true);
      if (dropped) refresh(); // chỉ bù khi từng đứt — lần bắt tay đầu không cần
      dropped = false;
    };
    const onDown = (): void => {
      dropped = true;
      setConnected(false);
    };

    setConnected(socket.connected === true);
    socket.on(WS_EVENTS.NOTIFICATION_NEW, onNew);
    socket.on(WS_EVENTS.NOTIFICATION_READ, onRead);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDown);
    socket.on("connect_error", onDown);
    return () => {
      socket.off(WS_EVENTS.NOTIFICATION_NEW, onNew);
      socket.off(WS_EVENTS.NOTIFICATION_READ, onRead);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDown);
      socket.off("connect_error", onDown);
      setConnected(false);
    };
  }, [active, userId, queryClient]);
}
