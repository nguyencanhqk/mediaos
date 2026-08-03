/**
 * Helper tên Socket.IO room — KHÔNG string-concat rải rác (1 nguồn sự thật, tránh lệch tiền tố giữa
 * gateway/emitter). Quy ước ADR-0013: prefix `co:{companyId}:` ép cô lập tenant ở tầng room —
 * socket công ty B không bao giờ ở cùng room với công ty A dù đoán đúng roomId/userId.
 */

/** Room riêng cho 1 user: đích của `notification:new` (đa thiết bị — mọi socket của user join room này). */
export function userRoomName(companyId: string, userId: string): string {
  return `co:${companyId}:user:${userId}`;
}

/** S7-CHAT-RT-1 — một phòng chat. Mọi socket của thành viên ĐANG hoạt động join room này. */
export function chatRoomName(companyId: string, roomId: string): string {
  return `co:${companyId}:chatroom:${roomId}`;
}

/**
 * S7-CHAT-RT-1 — room riêng cho 1 user **TRONG PHẠM VI CHAT**. Khác `userRoomName` ở đúng một điểm, và
 * điểm đó là cả lý do nó tồn tại: socket chỉ join room này khi **đã qua cổng quyền `view:chat-room`**
 * (`RealtimeGateway.handleConnection`), còn `userRoomName` thì MỌI socket đã xác thực đều join để nhận
 * `notification:new`.
 *
 * Tách ra vì hai chỗ dùng đều hỏng nếu dùng chung `userRoomName`:
 *
 *  1. **Đích của `chat:room`.** Sự kiện `chat:room{created}` phải tới người vừa được thêm vào một phòng
 *     mà họ CHƯA join (`chatRoomName` lúc đó rỗng với họ). Nếu bắn qua `userRoomName`, người đã bị THU
 *     HỒI cặp `view:chat-room` vẫn nhận — vì họ luôn ở trong `userRoomName`. Cổng quyền ở lúc connect
 *     coi như bị đi vòng, và ca test "thiếu cặp quyền ⇒ 0 sự kiện chat" sẽ đỏ.
 *  2. **Bộ chọn socket của `syncRoomMembership('join')`.** Ép join qua `userRoomName` sẽ kéo cả socket
 *     đã TRƯỢT cổng quyền vào phòng chat — cổng chỉ có tác dụng đúng một lần lúc connect, rồi lần thay
 *     đổi thành viên kế tiếp mở lại cửa.
 *
 * Nhánh `leave` CỐ Ý vẫn quét theo `userRoomName` (rộng hơn): rời nhầm là fail-safe, sót lại là rò.
 */
export function chatUserRoomName(companyId: string, userId: string): string {
  return `co:${companyId}:chatuser:${userId}`;
}
