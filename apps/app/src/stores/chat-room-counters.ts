/**
 * S20-CHAT-MENTIONPIN-1 — hai bộ đếm PER-USER của một phòng trên FE: `unreadCount` và `mentionUnreadCount`
 * (số tin chưa đọc NHẮC TÔI — US-CHAT-NV-07).
 *
 * Tách khỏi `chat.store.ts` (đã quá trần 800 dòng): store chỉ gọi ba hàm thuần dưới đây ở đúng ba chỗ nó
 * vốn đụng `unreadCount` — tin mới (`applyIncomingMessage`), con trỏ đọc của tôi (`applyReadEvent`), và
 * phép trộn ảnh chụp REST (`mergeServerRoom`).
 *
 * ⚠️ `mentionUnreadCount` VẮNG (`undefined`) = server cũ hoặc đường không tính số này (`GET /chat/rooms/:id`,
 * payload `chat:room` đã strip). FE KHÔNG tự khởi đếm từ vắng: tự đếm trên nền không có số gốc là bịa một
 * con số, và làm chip «Nhắc tôi» hiện ra trên server chưa có tính năng.
 */
import type { ChatRoomDto } from "@mediaos/contracts";

type RoomCounters = Pick<ChatRoomDto, "unreadCount" | "mentionUnreadCount">;

/** Phần tin cần để quyết định tăng bộ đếm — không đòi cả DTO. */
interface IncomingForCounters {
  senderId: string;
  mentions?: readonly string[];
  recalledAt?: string | null;
}

/**
 * Tin MỚI (đã qua chốt `roomSeq` của store). Tin của người KHÁC tăng badge; tin của chính mình thì không
 * (mình vừa gửi = đã đọc). Tin nhắc tôi tăng thêm «@» — chỉ khi phòng ĐÃ có số gốc từ server.
 * Badge tổng của FE-3 cộng dồn `unreadCount` từng phòng — KHÔNG gọi `GET /chat/unread-count`.
 */
export function bumpCounters(
  room: ChatRoomDto,
  message: IncomingForCounters,
  isMine: boolean,
  myUserId: string | null,
): RoomCounters {
  const unreadCount = isMine ? (room.unreadCount ?? 0) : (room.unreadCount ?? 0) + 1;
  const base = room.mentionUnreadCount;
  if (typeof base !== "number") return { unreadCount };
  const mentionsMe =
    !isMine &&
    myUserId !== null &&
    (message.recalledAt ?? null) === null &&
    (message.mentions ?? []).includes(myUserId);
  return { unreadCount, mentionUnreadCount: mentionsMe ? base + 1 : base };
}

/**
 * `chat:read` CỦA TÔI — con trỏ tiến. FE không biết tin nào trong phần vừa đọc là tin nhắc mình, nên kẹp
 * về cận trên đúng: số @ chưa đọc ≤ số chưa đọc. Đọc tới đáy (unread = 0) ⇒ «@» biến mất; đọc dở ⇒ giữ
 * tới lần nạp danh sách kế (server tính lại chính xác).
 */
export function withRead(room: ChatRoomDto, unreadCount: number): ChatRoomDto {
  const mention = room.mentionUnreadCount;
  return typeof mention === "number"
    ? { ...room, unreadCount, mentionUnreadCount: Math.min(mention, unreadCount) }
    : { ...room, unreadCount };
}

/**
 * Ảnh chụp REST KHÔNG cũ hơn thứ đang giữ ⇒ tin server — trừ khi nó VẮNG số @ (đường một phòng): khi đó
 * giữ số đang có, vì vắng khoá là «không nói gì», không phải «về 0».
 */
export function keepMention(current: ChatRoomDto, incoming: ChatRoomDto): ChatRoomDto {
  if (incoming.mentionUnreadCount !== undefined || current.mentionUnreadCount === undefined) {
    return incoming;
  }
  return { ...incoming, mentionUnreadCount: current.mentionUnreadCount };
}

/** Ảnh chụp REST CŨ hơn ⇒ giữ hai bộ đếm đang có (đã cộng tin mới qua WS); thiếu số @ thì lấy của server. */
export function olderCounters(current: ChatRoomDto, incoming: ChatRoomDto): RoomCounters {
  const mention = current.mentionUnreadCount ?? incoming.mentionUnreadCount;
  return mention === undefined
    ? { unreadCount: current.unreadCount }
    : { unreadCount: current.unreadCount, mentionUnreadCount: mention };
}
