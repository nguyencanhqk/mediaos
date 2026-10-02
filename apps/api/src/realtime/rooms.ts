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

/**
 * S7-CALL-RT-1 — room riêng cho 1 user **TRONG NAMESPACE `/ws-call`**: đích của relay SDP/ICE tới đúng
 * một người (nhiều thiết bị của họ đều nhận).
 *
 * ⚠️ Namespace `/ws-call` và `/ws` là hai không gian room TÁCH BIỆT ở tầng Socket.IO — một tên trùng
 * cũng không đụng nhau. Vẫn đặt tiền tố khác (`calluser` chứ không `user`) để đọc log là biết ngay khung
 * đang đi kênh nào, và để `severUserSessions` không bao giờ nhắm nhầm room.
 *
 * ⚠️ **Ở TRONG ROOM KHÔNG PHẢI LÀ QUYỀN.** Socket join room này ngay sau cổng quyền ở handshake, nhưng
 * mọi khung vẫn phải kiểm lại tư cách tham gia cuộc gọi từ DB (`ChatCallSignalService`) — room chỉ là
 * ĐÍCH fan-out (bài học `ws-permission-gate-needs-its-own-room`).
 */
export function callUserRoomName(companyId: string, userId: string): string {
  return `co:${companyId}:calluser:${userId}`;
}

/**
 * S7-CALL-RT-1 — phiên signalling của MỘT cuộc gọi (namespace `/ws-call`). Đích của `call:media-state`,
 * `call:screen-state`, `call:peer-joined/left`.
 *
 * Socket chỉ vào đây SAU khi `call:join` đã kiểm DB thành công — nhưng cũng như trên, việc ở trong room
 * không miễn cho khung kế tiếp một lần kiểm lại.
 */
export function callRoomName(companyId: string, callId: string): string {
  return `co:${companyId}:call:${callId}`;
}

/**
 * S16-SOCIAL-BE-1 — bảng tin nội bộ của MỘT công ty. Mọi socket đã qua cổng `view:feed` join room này.
 *
 * ⚠️ **CHỈ bài `audience='company'` được phát vào đây.** Room này chứa cả công ty, nên một bài
 * `audience='org_unit'` hay `'group'` bắn vào nó là phát đúng nội dung mà REST trả 404 cho chính những
 * người đó — cổng quyền bị đi vòng qua kênh phụ. Bài nhóm đi room RIÊNG `feedGroupRoomName` (S16-SOCIAL-
 * BE-2C — cổng membership); **không có room nào cho `org_unit`** (Q-ORG). Lưới hai tầng:
 * `buildWsPostCreatedEvent` (nguồn) + `.parse()` rồi mới chọn room ở `emitFeedPostCreated` (memory
 * `ws-permission-gate-needs-its-own-room`).
 *
 * ⚠️ **Ở TRONG ROOM KHÔNG PHẢI LÀ QUYỀN.** Socket join ngay sau cổng quyền ở handshake, nhưng cổng đó
 * chỉ có tác dụng ĐÚNG MỘT LẦN lúc connect: người bị thu hồi `view:feed` giữa phiên vẫn ở lại room
 * tới khi họ ngắt kết nối. Đó là lý do payload WS phải HẸP HƠN DTO REST và không mang URL presign.
 */
export function feedRoomName(companyId: string): string {
  return `co:${companyId}:feed`;
}

/**
 * S16-SOCIAL-BE-2C (D-OWNER-2, owner chốt 22/09/2026) — room riêng cho 1 user **TRONG PHẠM VI BẢNG
 * TIN**. Đây là room **ĐÁNH DẤU**, KHÔNG phải đích phát sự kiện nào: socket chỉ join khi **đã qua cổng
 * quyền `view:feed`** ở `RealtimeGateway.handleConnection`, còn `userRoomName` thì MỌI socket đã xác
 * thực đều join để nhận `notification:new`.
 *
 * Nó tồn tại cho ĐÚNG MỘT chỗ dùng: **bộ chọn socket của `syncFeedGroupMembership('join')`** (lệnh
 * `in(feedUserRoomName).socketsJoin(feedGroupRoomName)`). Cùng lập luận với `chatUserRoomName` ở trên:
 * ép join qua `userRoomName` sẽ kéo cả socket đã TRƯỢT cổng `view:feed` vào room nhóm — cổng chỉ có tác
 * dụng đúng một lần lúc connect, rồi lần đổi thành viên kế tiếp (`038` duyệt, `035` vào nhóm mở) mở lại
 * cửa. Đo thật (plan BE-2C M2 a′): `in(user:B).socketsJoin(...)` kéo socket B trượt cổng vào room nhóm.
 *
 * Nhánh `leave` CỐ Ý vẫn quét theo `userRoomName` (rộng hơn): rời nhầm là fail-safe, sót lại là rò.
 */
export function feedUserRoomName(companyId: string, userId: string): string {
  return `co:${companyId}:feeduser:${userId}`;
}

/**
 * S16-SOCIAL-BE-2C — room của MỘT nhóm bảng tin: đích `feed:post.created` của bài `audience='group'`
 * (API-19 §7). Chỉ chứa socket thoả CẢ HAI: (a) đã qua cổng `view:feed` lúc connect, và (b) của thành
 * viên `status='active'` của nhóm CÒN SỐNG (`deleted_at IS NULL`), cùng `company_id` — kể cả nhóm
 * `public` (người ngoài đọc được bài nhóm public qua REST, nhưng KHÔNG có room: feed chính loại bài nhóm
 * và WS một chiều không cho client tự xin room).
 *
 * ⚠️ **Ở TRONG ROOM KHÔNG PHẢI LÀ QUYỀN.** Thu hồi `view:feed` giữa phiên KHÔNG đá socket ra (cùng giới
 * hạn của `feedRoomName` ở trên) — payload WS vì thế phải HẸP hơn DTO REST và không mang URL presign.
 */
export function feedGroupRoomName(companyId: string, groupId: string): string {
  return `co:${companyId}:feedgroup:${groupId}`;
}
