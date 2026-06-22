/**
 * Helper tên Socket.IO room — KHÔNG string-concat rải rác (1 nguồn sự thật, tránh lệch tiền tố giữa
 * gateway/emitter). Quy ước ADR-0013: prefix `co:{companyId}:` ép cô lập tenant ở tầng room —
 * socket công ty B không bao giờ ở cùng room với công ty A dù đoán đúng roomId/userId.
 */

/** Room cho 1 phòng chat: mọi member online join room này để nhận `chat:message`/`chat:typing`.
 *  (de-media-fy: gateway chat handlers đã gỡ ở CLEAN-DECOUPLE-1; helper còn dùng bởi emitChatMessage —
 *   ChatService consume tới khi cụm chat gỡ ở CLEAN-BE-1.) */
export function chatRoomName(companyId: string, roomId: string): string {
  return `co:${companyId}:chat:${roomId}`;
}

/** Room riêng cho 1 user: đích của `notification:new` (đa thiết bị — mọi socket của user join room này). */
export function userRoomName(companyId: string, userId: string): string {
  return `co:${companyId}:user:${userId}`;
}
