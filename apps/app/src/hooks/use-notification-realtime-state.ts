/**
 * S20-NOTI-LIVETOAST-1 — trạng thái nối `/ws` cho chuông thông báo, và nhịp poll suy ra từ đó.
 *
 * Socket nối ⇒ `notification:new`/`notification:read` đã đẩy số mới, poll chỉ là lưới an toàn (120 giây).
 * Socket mất ⇒ poll là nguồn duy nhất (30 giây — nhịp cũ của chuông).
 */
import { create } from "zustand";

export const UNREAD_POLL_CONNECTED_MS = 120_000;
export const UNREAD_POLL_DISCONNECTED_MS = 30_000;

interface NotificationSocketState {
  readonly connected: boolean;
  readonly setConnected: (connected: boolean) => void;
}

export const useNotificationSocketState = create<NotificationSocketState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));

export function useUnreadPollInterval(): number {
  const connected = useNotificationSocketState((s) => s.connected);
  return connected ? UNREAD_POLL_CONNECTED_MS : UNREAD_POLL_DISCONNECTED_MS;
}
