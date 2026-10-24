/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-01) — hỏi lại `GET /chat/rooms` MỘT lần trước khi từ chối một phòng
 * xin mở (trang `/chat/$roomId` và bấm thông báo).
 *
 * `roomsById` có thể CŨ: vừa được thêm vào phòng mà sự kiện `chat:room` chưa tới — thông báo và sự kiện
 * phòng đi hai đường phát khác nhau, không bảo đảm thứ tự. Từ chối ngay trên store cũ là báo «không mở
 * được» cho một thông báo hợp lệ («bạn được thêm vào phòng …»).
 *
 * Bất biến giữ nguyên:
 * - Lời gọi này KHÔNG mang id của phòng xin mở — vẫn 0 lời gọi API (tin · chi tiết · ghim) của phòng đó
 *   trước khi nó có trong danh sách phòng của tôi.
 * - Kết quả vào store bằng `syncRoomList` (như `useChatRealtime`): danh sách tươi là nguồn duy nhất cho
 *   biết phòng nào là của tôi.
 * - Lỗi mạng/5xx ⇒ `false`: không xác nhận được thì KHÔNG mở — rơi về thông điệp từ chối chung.
 */
import { chatApi } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";

export async function recheckRoomListed(roomId: string): Promise<boolean> {
  try {
    const rooms = await chatApi.listRooms();
    useChatStore.getState().syncRoomList(rooms, false);
    return rooms.some((room) => room.id === roomId);
  } catch (err: unknown) {
    console.error("[chat] không hỏi lại được danh sách phòng:", err);
    return false;
  }
}
