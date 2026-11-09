/**
 * S20-NOTI-LIVETOAST-1 — «(N)» trước tiêu đề tab, N = `totalUnreadCount` (CÙNG số + CÙNG cổng `access:chat` với badge chat ở header,
 * kể cả phòng tắt tiếng). Về 0 ⇒ trả tiêu đề gốc, không «(0)». Gỡ khi unmount.
 */
import { useEffect } from "react";
import { useCan } from "@mediaos/web-core";
import { CHAT_PAIRS } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { totalUnreadCount } from "@/components/chat/chat-unread";

const PREFIX_RE = /^\(\d+\) /;

export function useUnreadTitle(): void {
  const unread = useChatStore((s) => totalUnreadCount(s.roomsById));
  // CÙNG cổng quyền với ChatBadge ở header — không có quyền ⇒ không «(N)».
  const canAccessChat = useCan(CHAT_PAIRS.ACCESS.action, CHAT_PAIRS.ACCESS.resourceType);
  const total = canAccessChat ? unread : 0;
  useEffect(() => {
    const base = document.title.replace(PREFIX_RE, "");
    document.title = total > 0 ? `(${total}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [total]);
}
