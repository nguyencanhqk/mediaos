/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-01) — liên kết vào MỘT phòng chat: `/chat/<uuid>` (+ `?msg=<uuid>`).
 *
 * Template NOTI giữ nguyên `/chat/{room_id}` (không đổi DB) — file này chỉ dạy FE hiểu đích đó.
 *
 * Bất biến:
 * - Kiểm UUID TRƯỚC mọi thứ khác: đoạn đường rác không bao giờ thành lời gọi API (route con chuyển về
 *   `/chat` bằng `replace`, thông báo có đích rác đi như liên kết thường).
 * - `?msg=` rác ⇒ bỏ khoá đó, KHÔNG ném: `validateSearch` ném là màn lỗi thay cho trang chat.
 * - Membership KHÔNG xét ở đây — trang/drawer chỉ mở phòng có trong danh sách phòng của tôi, server vẫn
 *   là cổng thật.
 */
import { redirect } from "@tanstack/react-router";
import { CHAT_PATH } from "./constants";

/** Đoạn đường của route con (cha là `CHAT_PATH`). */
export const CHAT_ROOM_SEGMENT = "$roomId";

/** Đường đầy đủ của route con — dùng làm `to` khi điều hướng. */
export const CHAT_ROOM_PATH = `${CHAT_PATH}/${CHAT_ROOM_SEGMENT}` as const;

/** Tên tham số tìm kiếm «nhảy tới tin». */
export const CHAT_MESSAGE_PARAM = "msg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_ROOM_TARGET_RE = /^\/chat\/([^/?#]+)\/?(?:\?([^#]*))?$/;

export function isChatEntityId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface ChatRoomSearch {
  msg?: string;
}

/** `validateSearch` của `/chat/$roomId`: chỉ giữ `msg` khi là UUID. */
export function validateChatRoomSearch(search: Record<string, unknown>): ChatRoomSearch {
  const msg = search[CHAT_MESSAGE_PARAM];
  return isChatEntityId(msg) ? { msg } : {};
}

/** `beforeLoad` của `/chat/$roomId`: id không phải UUID ⇒ `replace` về `/chat`, chưa dựng gì cả. */
export function redirectInvalidChatRoom(roomId: string): void {
  if (isChatEntityId(roomId)) return;
  throw redirect({ to: CHAT_PATH, replace: true });
}

export interface ChatRoomTarget {
  roomId: string;
  messageId: string | null;
}

/** `/chat/<uuid>[?msg=<uuid>]` ⇒ đích phòng; mọi dạng khác (kể cả `/chat/abc`) ⇒ `null`. */
export function chatRoomTargetFromUrl(url: string): ChatRoomTarget | null {
  const match = CHAT_ROOM_TARGET_RE.exec(url);
  const roomId = match?.[1];
  if (!isChatEntityId(roomId)) return null;
  const msg = new URLSearchParams(match?.[2] ?? "").get(CHAT_MESSAGE_PARAM);
  return { roomId, messageId: isChatEntityId(msg) ? msg : null };
}

/** Đang đứng ở trang chat (`/chat` hoặc `/chat/…`) — nơi drawer KHÔNG được mở chồng. */
export function isChatPathname(pathname: string): boolean {
  return pathname === CHAT_PATH || pathname.startsWith(`${CHAT_PATH}/`);
}

/** Khoá gộp toast của mọi lần mở-theo-liên-kết bị từ chối (bấm lặp ⇒ một thông báo kèm số lần). */
export const CHAT_LINK_TOAST_KEY = "chat-room-link";
