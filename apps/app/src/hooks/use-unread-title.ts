/**
 * S20-NOTI-LIVETOAST-1 — «(N)» trước tiêu đề tab, N = `totalUnreadCount` (CÙNG số với badge chat ở header,
 * kể cả phòng tắt tiếng). Về 0 ⇒ trả tiêu đề gốc, không «(0)». Gỡ khi unmount.
 */
import { useEffect } from "react";
import { useChatStore } from "@/stores/chat.store";
import { totalUnreadCount } from "@/components/chat/chat-unread";

const PREFIX_RE = /^\(\d+\) /;

export function useUnreadTitle(): void {
  const total = useChatStore((s) => totalUnreadCount(s.roomsById));
  useEffect(() => {
    const base = document.title.replace(PREFIX_RE, "");
    document.title = total > 0 ? `(${total}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [total]);
}
