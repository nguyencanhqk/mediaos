/**
 * S7-CHAT-FE-3 — hàm THUẦN của badge tổng chưa đọc (SPEC-15 §9 CHAT-SCREEN-006).
 *
 * Tách khỏi component để test bằng gọi hàm. Không có `useQuery`, không có poll: CHAT **không có** route
 * `GET /chat/unread-count` (soát toàn bộ `apps/api/src/chat/*.controller.ts`), và store FE-1 đã đóng đinh
 * hướng này trong docblock `applyIncomingMessage` — badge tổng CỘNG DỒN `unreadCount` từng phòng.
 *
 * Realtime tự có mà không cần listener mới: `chat:message` cộng vào `unreadCount` của phòng,
 * `chat:read` trừ ra (`applyReadEvent`), cả hai đã chạy sẵn ở `useChatRealtime` trên app shell.
 */
import type { ChatRoomDto } from "@mediaos/contracts";

/** Trên ngưỡng này thì hiện "99+" — con số 3 chữ số làm vỡ ô badge tròn. */
export const UNREAD_BADGE_MAX = 99;

/**
 * Tổng tin chưa đọc của MỌI phòng đang hoạt động.
 *
 * ⚠️ Phòng **đã lưu trữ** bị LOẠI, và đây không phải chi tiết vụn vặt. `roomsById` chỉ chứa phòng đã lưu
 * trữ khi người dùng từng bấm "Xem phòng đã lưu trữ" ở `RoomListPanel` (rổ đó hỏi riêng bằng
 * `listRooms({archived:true})`; `listRooms()` mặc định bị service ép `archived:false`). Cộng cả rổ đó thì
 * badge đổi số vì người dùng GHÉ THĂM MỘT TAB chứ không phải vì có tin mới — và phần dôi ra trỏ tới
 * phòng mà dropdown lẫn danh sách mặc định đều không hiện, nên người ta thấy số rồi tìm mãi không ra.
 */
export function totalUnreadCount(roomsById: Readonly<Record<string, ChatRoomDto>>): number {
  let total = 0;
  for (const room of Object.values(roomsById)) {
    if (room.isArchived === true) continue;
    total += room.unreadCount ?? 0;
  }
  return total;
}

/** Nhãn hiển thị trên badge. `>99` ⇒ "99+". Số ≤ 0 ⇒ chuỗi rỗng (call-site không vẽ badge). */
export function formatUnreadBadge(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(count);
}
