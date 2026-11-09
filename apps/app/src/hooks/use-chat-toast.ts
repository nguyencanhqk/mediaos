/**
 * S20-NOTI-LIVETOAST-1 — toast «Trả lời» cho tin riêng / @nhắc tôi, ở mọi trang (US-CHAT-NV-09).
 *
 * Tách khỏi `useChatRealtime` (hook đó không biết gì về router). Mount một lần ở `ProtectedShell`, gate
 * `view:chat-room`. Chỉ gắn/gỡ handler của mình trên socket dùng chung.
 *
 * Luật toast (tin của người KHÁC, chưa thu hồi): phòng riêng HOẶC nhắc tôi; phòng không tắt tiếng; không
 * đang mở đúng phòng đó (trang `/chat/<id>` hoặc drawer); tuỳ chọn «Toast tin nhắn» bật. Tin nhóm không
 * nhắc tôi chỉ tăng badge. Gộp cùng phòng trong {@link CHAT_TOAST_MERGE_MS}; thu hồi ⇒ gỡ toast.
 * Thân tin chỉ lấy từ payload ĐÃ NHẬN và chỉ khi bật «Xem trước nội dung» — không gọi API thêm.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getAppSocket, useAuthStore, useCan } from "@mediaos/web-core";
import {
  WS_EVENTS,
  wsChatMessageEventSchema,
  wsChatMessageRecalledEventSchema,
} from "@mediaos/contracts";
import { toast } from "@mediaos/ui";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "@/components/chat/chat-dock.store";
import { useChatRoomLinkOpener } from "@/components/notifications/use-chat-room-link-opener";
import { CHAT_PAIRS, CHAT_PATH } from "@/routes/chat/constants";
import { readToastPrefs } from "@/lib/toast-prefs";

export const CHAT_TOAST_MERGE_MS = 15_000;
const CHAT_TOAST_KEY_PREFIX = "chat-room:";

interface RoomToastInfo {
  roomId: string;
  sender: string;
  isDirect: boolean;
  roomName: string | null;
  preview: boolean;
}
interface RoomToast extends RoomToastInfo {
  toastId: string;
  lastAt: number;
  /** id tin còn hiệu lực → thân tin đã nhận (chỉ để dựng lại toast sau thu hồi). */
  bodies: Map<string, string | null>;
}

/** Đang xem đúng phòng này: trang `/chat/<id>` hoặc drawer đang mở đúng phòng. */
function isRoomOnScreen(roomId: string): boolean {
  if (window.location.pathname === `${CHAT_PATH}/${roomId}`) return true;
  const dock = useChatDockStore.getState();
  return dock.isOpen && dock.openRoomIds.includes(roomId);
}

export function useChatToast(): void {
  const { t } = useTranslation("notifications");
  const canView = useCan(CHAT_PAIRS.VIEW_ROOM.action, CHAT_PAIRS.VIEW_ROOM.resourceType);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openChatRoom = useChatRoomLinkOpener();

  const latest = useRef({ t, openChatRoom });
  latest.current = { t, openChatRoom };
  const active = canView && isAuthenticated && userId !== null;

  useEffect(() => {
    if (!active || userId === null) return;
    const socket = getAppSocket();
    if (!socket) return;
    const byRoom = new Map<string, RoomToast>();

    const showRoomToast = (info: RoomToastInfo, bodies: Map<string, string | null>): string => {
      const { t: tr, openChatRoom: open } = latest.current;
      const { roomId, sender } = info;
      const lastBody = [...bodies.values()].at(-1) ?? null;
      let message: string;
      if (bodies.size > 1) {
        message = tr("liveToast.multi", { count: bodies.size, sender });
      } else if (info.preview && lastBody) {
        message = `${sender}: ${lastBody}`;
      } else if (info.isDirect) {
        message = tr("liveToast.direct", { sender });
      } else {
        message = tr("liveToast.mention", { sender, room: info.roomName ?? tr("liveToast.unknownRoom") });
      }
      return toast.success(message, {
        key: `${CHAT_TOAST_KEY_PREFIX}${roomId}`,
        action: { label: tr("liveToast.reply"), onClick: () => open({ roomId, messageId: null }) },
      });
    };

    const onMessage = (payload: unknown): void => {
      const parsed = wsChatMessageEventSchema.safeParse(payload);
      if (!parsed.success) return; // `useChatRealtime` đã báo payload sai — không lặp lại ở đây
      const m = parsed.data;
      if (!useAuthStore.getState().isAuthenticated) return;
      if (m.senderId === userId || m.recalledAt !== null || m.messageType === "system") return;
      const prefs = readToastPrefs(userId);
      if (!prefs.messages) return;
      const room = useChatStore.getState().roomsById[m.roomId];
      if (room?.mutedUntil && Date.parse(room.mutedUntil) > Date.now()) return;
      const isDirect = room?.roomType === "direct";
      const mentionsMe = m.mentions.includes(userId);
      if (!isDirect && !mentionsMe) return;
      if (isRoomOnScreen(m.roomId)) return;

      const sender = m.senderName ?? latest.current.t("liveToast.unknownSender");
      const now = Date.now();
      const prev = byRoom.get(m.roomId);
      const merge = prev !== undefined && now - prev.lastAt <= CHAT_TOAST_MERGE_MS;
      const bodies = new Map(merge ? prev.bodies : []).set(m.id, m.body);
      if (prev) toast.dismiss(prev.toastId); // thay thế — không để số lần của toast tự cộng thêm lần nữa
      const info = { roomId: m.roomId, sender, isDirect, roomName: room?.name ?? null, preview: prefs.preview };
      byRoom.set(m.roomId, { ...info, toastId: showRoomToast(info, bodies), lastAt: now, bodies });
    };

    const onRecalled = (payload: unknown): void => {
      const parsed = wsChatMessageRecalledEventSchema.safeParse(payload);
      if (!parsed.success) return;
      const entry = byRoom.get(parsed.data.roomId);
      if (!entry?.bodies.has(parsed.data.messageId)) return;
      const bodies = new Map(entry.bodies);
      bodies.delete(parsed.data.messageId);
      if (bodies.size === 0) {
        toast.dismiss(entry.toastId);
        byRoom.delete(parsed.data.roomId);
      } else {
        // Dựng lại toast với số đếm mới (hoặc về dạng đơn) — chữ «N tin» cũ không được lệch thực tế.
        toast.dismiss(entry.toastId);
        byRoom.set(parsed.data.roomId, { ...entry, toastId: showRoomToast(entry, bodies), bodies });
      }
    };

    socket.on(WS_EVENTS.CHAT_MESSAGE, onMessage);
    socket.on(WS_EVENTS.CHAT_MESSAGE_RECALLED, onRecalled);
    return () => {
      socket.off(WS_EVENTS.CHAT_MESSAGE, onMessage);
      socket.off(WS_EVENTS.CHAT_MESSAGE_RECALLED, onRecalled);
    };
  }, [active, userId]);
}
