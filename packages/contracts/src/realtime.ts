import { z } from "zod";
import { chatMessageReactionSchema, chatMessageSchema, chatRoomSchema } from "./chat";
import { notificationSchema } from "./notification";

/**
 * Realtime (G10-1) — hợp đồng WS giữa api ↔ web (Socket.IO namespace `/ws`).
 *
 * BẤT BIẾN (CLAUDE.md §5): payload server→client PHẢI là output của `.parse()` các schema dưới đây
 * (cùng DTO/masking layer như REST) — CẤM `io.emit` thẳng row DB. Schema Zod mặc định strip key thừa,
 * nên parse-trước-emit vừa validate vừa mask.
 */

export const WS_NAMESPACE = "ws";

/**
 * Tên event WS — dùng chung 2 phía, không hard-code chuỗi rải rác.
 *
 * ⚠️ **WS MỘT CHIỀU (CHAT-DEC-005).** KHÔNG có event client → server nào. Client muốn ghi thì gọi REST;
 * WS chỉ để server ĐẨY. `S7-CHAT-RT-1` đã xoá 7 key hai-chiều (`chat:join`/`chat:leave`/`chat:send`/
 * `chat:typing`/`chat:presence:list` + 2 event typing/presence) — chúng được khai từ trước
 * CLEAN-DECOUPLE-1 nhưng **0 nơi dùng**, và mâu thuẫn trực tiếp với CHAT-DEC-005. Thêm lại một key
 * client→server ở đây là mở lại đúng bề mặt đã đóng: tham số do client kiểm soát quyết định server làm
 * gì, trong khi mô hình hiện tại là server tự tra DB.
 *
 * ══ S8-CHAT-UX-RT-1 — typing/presence QUAY LẠI, nhưng CHỈ chiều server→client ══
 * Ghi chú cũ ở đây ("SPEC-15 chốt đo nhu cầu thật SAU v1") đã bị **CHAT-DEC-017 đảo** ngày 05/08/2026:
 * hai tính năng vào phạm vi, `API-13 §4.2` gạch dòng ngoài-phạm-vi tương ứng. Điều **không** đổi là
 * chiều: `chat:typing` do **REST** `CHAT-API-023` (`POST /chat/rooms/:id/typing`) kích hoạt, `chat:presence`
 * do **vòng đời kết nối** (`handleConnection`/`handleDisconnect`) kích hoạt. Cả hai vẫn là server → client,
 * nên ratchet 0 `@SubscribeMessage` (`chat-realtime-structure.spec.ts`) giữ nguyên hiệu lực.
 * ⇒ Hai key dưới đây KHÔNG phải cửa cho client gửi lên. Đặt một handler inbound cho chúng là phá
 * CHAT-DEC-005 lẫn hàng rào R1 của DECISIONS-07.
 */
export const WS_EVENTS = {
  // server → client — CHỈ một chiều này tồn tại.
  CHAT_MESSAGE: "chat:message",
  CHAT_MESSAGE_RECALLED: "chat:message-recalled",
  CHAT_READ: "chat:read",
  CHAT_ROOM: "chat:room",
  // S8-CHAT-UX-RT-1 (additive) — xem khối ⚠️ ở trên: kích hoạt bởi REST / vòng đời kết nối, KHÔNG phải
  // bởi event từ client.
  CHAT_TYPING: "chat:typing",
  CHAT_PRESENCE: "chat:presence",
  // S8-CHAT-UX-BE-3 (additive) — phát SAU commit của PUT/DELETE reactions (REST), không phải event từ client.
  CHAT_REACTION: "chat:reaction",
  NOTIFICATION_NEW: "notification:new",
  // S4-NOTI-BE-1 (additive): phát sau mark-read/mark-all-read/xoá mềm — payload CHỈ unread_count (không
  // row) để DASH/header badge invalidate mà không rò nội dung thông báo qua kênh phụ.
  NOTIFICATION_READ: "notification:read",
} as const;
export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

// ─── server → client payloads (masking layer) ───────────────────────────────

/**
 * Đính kèm trên kênh WS — **CỐ TÌNH KHÔNG CÓ `url`/`thumbnailUrl`**.
 *
 * ══ VÌ SAO: quyết định ký là PER-RECIPIENT, còn emit là fan-out MỘT payload cho CẢ PHÒNG ══
 * `FilePolicyService.decideForLinkedFile` là luật AND-khắt-khe-nhất trên MỌI link của tệp, tính RIÊNG
 * cho từng `userId`: cùng một tệp có thể `allow` cho người gửi và `deny` cho người nhận (tệp còn link
 * sang task/hồ sơ mà người nhận không có quyền). Đường REST vì thế ký theo đúng người gọi.
 *
 * `sendMessage` dựng DTO bằng `readMessage(actor, …)` — tức ĐÃ KÝ CHO NGƯỜI GỬI — rồi phát nguyên
 * object đó tới `chatRoomName`. Nếu payload WS mang `url`, mọi thành viên phòng nhận được **URL ký của
 * người gửi**. URL presign là **bearer capability**: ai cầm cũng tải được, không qua guard nào nữa và
 * không sinh dòng `file_access_logs` nào. Đó là đi vòng qua đúng lớp quyết định mà FilePolicy dựng ra
 * (phát hiện bởi FULL gate S7-CHAT-BE-GATE-3, hai lane độc lập cùng chỉ ra).
 *
 * ⚠️ CẤM thêm `url`/`thumbnailUrl` vào đây, kể cả `.nullable()`, kể cả "để FE khỏi gọi thêm": một khoá
 * URL trong hợp đồng WS là lời mời cho lần sửa sau điền giá trị thật vào. FE nhận sự kiện rồi gọi
 * `GET /chat/rooms/:id/messages` (hoặc đường ký riêng) để lấy URL của CHÍNH MÌNH.
 *
 * Khai LẠI thay vì `chatAttachmentSchema.omit({url, thumbnailUrl})` — cùng lý do đã ghi ở
 * `chat.ts` §DTO đọc-vượt: `.omit()` là hợp đồng ĐI THEO schema gốc, nên thêm khoá nhạy cảm vào
 * `chatAttachmentSchema` sau này sẽ tự động chảy sang kênh WS mà không ai phải duyệt.
 */
export const wsChatAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  isImage: z.boolean(),
});
export type WsChatAttachmentDto = z.infer<typeof wsChatAttachmentSchema>;

/**
 * chat:message — DTO REST TRỪ URL ký của đính kèm (xem `wsChatAttachmentSchema`).
 *
 * Zod object mặc định **strip** khoá thừa, nên `.parse()` ở `emitChatMessage` tự gỡ `url`/`thumbnailUrl`
 * kể cả khi caller truyền vào DTO đầy đủ — masking nằm ở chính bước parse, không dựa vào kỷ luật của
 * điểm gọi. Đây là lý do phải parse TRƯỚC emit chứ không emit thẳng object.
 */
export const wsChatMessageEventSchema = chatMessageSchema.extend({
  attachments: wsChatAttachmentSchema.array(),
});
export type WsChatMessageEvent = z.infer<typeof wsChatMessageEventSchema>;

/**
 * chat:message-recalled (API-13 §7) — CHỈ ba khoá.
 *
 * ⚠️ TUYỆT ĐỐI KHÔNG kèm `body`, **kể cả `body: null`** (owner chốt 02/08/2026). Tin đã thu hồi thì nội
 * dung không được đi qua kênh nào nữa; một khoá `body` trong hợp đồng là lời mời cho lần sửa sau điền
 * giá trị thật vào. Client tự xoá nội dung đang giữ khi nhận sự kiện này.
 *
 * `recalledAt` KHÔNG nullable (khác `chatMessageSchema.recalledAt`): lúc phát sự kiện này việc thu hồi
 * chắc chắn vừa xảy ra, nên luôn có mốc thời gian thật.
 */
export const wsChatMessageRecalledEventSchema = z.object({
  messageId: z.string().uuid(),
  roomId: z.string().uuid(),
  recalledAt: z.string().datetime(),
});
export type WsChatMessageRecalledEvent = z.infer<typeof wsChatMessageRecalledEventSchema>;

/** chat:read — con trỏ đã đọc của MỘT người trong phòng (hệ `room_seq` per-room, mig 0539). */
export const wsChatReadEventSchema = z.object({
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  lastReadSeq: z.number().int().nonnegative(),
});
export type WsChatReadEvent = z.infer<typeof wsChatReadEventSchema>;

export const wsChatRoomActionSchema = z.enum([
  "created",
  "updated",
  "archived",
  "member_added",
  "member_removed",
  "member_role_changed",
  "left",
]);
export type WsChatRoomAction = z.infer<typeof wsChatRoomActionSchema>;

/**
 * chat:room — siêu dữ liệu phòng đổi. `room` CHỈ điền cho `created`/`updated`/`archived`; với nhóm
 * action về thành viên thì để trống (client tự refetch danh sách nếu cần).
 *
 * ⚠️ `unreadCount` bị `.omit()` CÓ CHỦ Ý. Field đó là PER-MEMBER — không tồn tại giá trị đúng để phát
 * chung cho cả phòng. `toChatRoomDto` LUÔN gán một số cụ thể (`unreadCount ?? row.unreadCount ?? 0`,
 * `chat.mapper.ts`), nên tái dùng thẳng hàm đó cho payload broadcast sẽ phát "0 chưa đọc" SAI cho mọi
 * người nhận. Zod `.omit()` strip triệt để ở `.parse()` — kể cả khi code dựng payload lỡ set tay.
 *
 * ⟲ **S8-CHAT-UX-BE-2 (07/08/2026) — BỔ SUNG 4 field vào danh sách strip. Đây là VÁ RÒ, không phải dọn.**
 *
 * `S8-CHAT-UX-BE-1` thêm `pinnedAt`/`mutedUntil`/`markedUnreadAt` vào `chatRoomSchema` nhưng KHÔNG thêm
 * vào `.omit()` ở đây. Ba cột đó per-member **y hệt** `unreadCount`, và `ChatRoomsService.updateRoom`/
 * `archiveRoom` dựng payload broadcast bằng `toChatRoomDto(..., acc.membership)` — tức membership của
 * **ACTOR**. Hệ quả đo được: mỗi lần một quản trị viên đổi tên hoặc lưu trữ phòng, **cả phòng** nhận
 * `pinnedAt`/`mutedUntil` CỦA RIÊNG NGƯỜI ĐÓ ("người này đã tắt thông báo phòng tới 20:00"). Đúng lớp
 * `ws-payload-narrower-than-rest-dto` mà chính docblock trên dựng ra để chặn, chỉ khác trục.
 *
 * `avatarUrl` cũng bị strip, nhưng vì lý do KHÁC — không phải per-user (mọi thành viên đều được xem):
 * nó là URL **ký TTL ngắn**, còn sự kiện WS thì client hay giữ lại lâu. Phát nó ra là mời client cache
 * một đường tải sẽ hết hạn ⇒ ảnh vỡ. Vắng khoá (nhờ `.optional()`) làm phép trộn ở FE **giữ nguyên**
 * URL đang có thay vì ghi đè bằng `null` — đúng hành vi mong muốn. Ảnh mới lấy ở lần refetch REST.
 */
export const wsChatRoomEventSchema = z.object({
  roomId: z.string().uuid(),
  action: wsChatRoomActionSchema,
  room: chatRoomSchema
    .omit({
      unreadCount: true,
      pinnedAt: true,
      mutedUntil: true,
      markedUnreadAt: true,
      avatarUrl: true,
    })
    .optional(),
});
export type WsChatRoomEvent = z.infer<typeof wsChatRoomEventSchema>;

/**
 * chat:typing (S8 · API-13 §7 · CHAT-DEC-017) — ĐÚNG hai khoá.
 *
 * ⚠️ **KHÔNG có `body`/`preview`/`text` và không được thêm.** "Đang gõ" là tín hiệu hiện diện, không phải
 * kênh xem trước nội dung; một khoá nội dung ở đây đẩy bản nháp chưa gửi tới cả phòng — kể cả đoạn người
 * dùng gõ rồi xoá đi và không bao giờ gửi. Đó là dữ liệu chưa từng qua bất kỳ kiểm duyệt/audit nào.
 *
 * ⚠️ **KHÔNG có `isTyping`/`state`.** Server không giữ trạng thái gõ và không phát sự kiện "ngừng gõ":
 * chỉ báo tự tắt ở FE sau 5 s (CHAT-DEC-017). Thêm cờ vào đây là mời một máy trạng thái phân tán mà không
 * ai đóng được — sự kiện "stop" mất là chỉ báo kẹt vĩnh viễn.
 */
export const wsChatTypingEventSchema = z.object({
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
});
export type WsChatTypingEvent = z.infer<typeof wsChatTypingEventSchema>;

export const wsChatPresenceStatusSchema = z.enum(["online", "offline"]);
export type WsChatPresenceStatus = z.infer<typeof wsChatPresenceStatusSchema>;

/**
 * chat:presence (S8 · API-13 §7 · CHAT-FUNC-021) — ĐÚNG hai khoá.
 *
 * Chỉ `online`/`offline`. **KHÔNG** `lastSeenAt`, **KHÔNG** `deviceCount`, **KHÔNG** `idle`:
 *  - `lastSeenAt` biến presence thành **nhật ký hoạt động** của nhân viên — dữ liệu giám sát mà SPEC-15
 *    chưa cấp phép và không có cặp quyền nào gác;
 *  - `deviceCount` rò số thiết bị/tab của người khác, không phục vụ màn hình nào trong CHAT-SCREEN-*.
 *
 * Sự kiện phát tới `chatUserRoomName` của những người có chung phòng `direct` — **không** phải
 * `userRoomName` (xem `rooms.ts`: room đó chứa cả socket đã bị thu hồi cặp `view:chat-room`).
 */
export const wsChatPresenceEventSchema = z.object({
  userId: z.string().uuid(),
  status: wsChatPresenceStatusSchema,
});
export type WsChatPresenceEvent = z.infer<typeof wsChatPresenceEventSchema>;

/**
 * chat:reaction (S8 · CHAT-FUNC-019 · CHAT-DEC-018) — tổng hợp cảm xúc MỚI của một tin.
 *
 * ⚠️ **HẸP HƠN DTO REST — `mine` bị STRIP.** Sự kiện này phát tới **cả phòng**, mà `mine` chỉ đúng với
 * MỘT người; giữ nó lại là gửi trạng thái của người vừa bấm cho tất cả những người khác, và mỗi client
 * nhận được sẽ render một dấu tích sai. Đây đúng khuôn `wsChatRoomEventSchema` strip `unreadCount`
 * (per-member) — cùng một lớp lỗi, cùng một cách chặn (memory `ws-payload-narrower-than-rest-dto`).
 * Client nhận sự kiện này phải GIỮ NGUYÊN `mine` nó đang có, chỉ thay `count`.
 *
 * ⚠️ **KHÔNG có `actorUserId`.** Ai vừa thả/bỏ thả không phục vụ màn hình nào (thanh cảm xúc chỉ hiện
 * số), mà thêm vào là phát "ai phản ứng gì với tin nào" theo thời gian thực cho cả phòng — rộng hơn
 * hẳn thứ chính DTO REST cố ý không trả (`chatMessageReactionSchema` không có `userIds`).
 *
 * `reactions` RỖNG là hợp lệ và có nghĩa: người cuối cùng vừa bỏ thả ⇒ client xoá sạch thanh cảm xúc.
 */
export const wsChatReactionEventSchema = z.object({
  roomId: z.string().uuid(),
  messageId: z.string().uuid(),
  reactions: z.array(chatMessageReactionSchema.omit({ mine: true })),
});
export type WsChatReactionEvent = z.infer<typeof wsChatReactionEventSchema>;

/** notification:new — đúng DTO REST (notificationSchema). */
export const wsNotificationEventSchema = notificationSchema;
export type WsNotificationEvent = z.infer<typeof wsNotificationEventSchema>;

/** notification:read (S4-NOTI-BE-1) — unread_count mới sau mark-read/mark-all-read/xoá mềm. */
export const wsNotificationReadEventSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});
export type WsNotificationReadEvent = z.infer<typeof wsNotificationReadEventSchema>;

// KHÔNG có schema `ack` nào: ack chỉ có nghĩa cho event client → server, mà WS một chiều
// (CHAT-DEC-005) không có loại đó. `wsAckSchema`/`wsChatSendAckSchema`/`wsPresenceListAckSchema` đã bị
// `S7-CHAT-RT-1` xoá cùng cụm hai-chiều — xem ghi chú ở `WS_EVENTS`.
