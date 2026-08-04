import { z } from "zod";
import {
  chatLeaveRoomResultSchema,
  type ChatLeaveRoomResultDto,
  chatMarkReadResultSchema,
  type ChatMarkReadResultDto,
  chatMessageSchema,
  type ChatMessageDto,
  chatRemoveMemberResultSchema,
  type ChatRemoveMemberResultDto,
  chatRoomDetailSchema,
  type ChatRoomDetailDto,
  chatRoomMemberSchema,
  type ChatRoomMemberDto,
  chatRoomSchema,
  type ChatRoomDto,
  chatUnreadCountSchema,
  type ChatUnreadCountDto,
  type AddChatMemberRequest,
  type ChatMarkReadRequest,
  type CreateChatRoomRequest,
  type ListChatMessagesQuery,
  type ListChatRoomsQuery,
  type OpenDirectRoomRequest,
  type SendMessageRequest,
  type UpdateChatMemberRequest,
  type UpdateChatRoomRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * S7-CHAT-FE-1 — CHAT API client (SPEC-15 · API-13 §5.1). MIRROR BE `ChatRoomsController`
 * (CHAT-API-001..008) + `ChatMessagesController` (CHAT-API-009..014, 016).
 *
 * MẢNG TRẦN: mọi endpoint đọc danh sách trả `Dto[]` — KHÔNG `{data,meta}`. `apiFetch` gỡ envelope chuẩn
 * `{success,data,error}` rồi parse, nên schema truyền vào là `z.array(itemSchema)`; đưa schema envelope
 * vào đây là `ZodError` runtime DÙ HTTP 200 (memory `apifetch-drops-pagination-bare-array`).
 *
 * `company_id`, data-scope, masking và membership (`assertMember` → 404 cho phòng lạ VÀ phòng không
 * thuộc, GIỐNG HỆT nhau) đều là việc của SERVER. Client chỉ gửi filter/id.
 *
 * ⚠️ **`leaveRoom` và `removeMember` KHÔNG trả phòng** — parse chúng bằng `chatRoomSchema` là bug đã
 * biết trước, không phải lỗi phát hiện sau: xem `chatLeaveRoomResultSchema`/`chatRemoveMemberResultSchema`.
 *
 * ⚠️ CHAT-API-015 (`/chat/search`) và CHAT-API-017 (`/chat/rooms/:id/files`) **CỐ Ý chưa mirror ở đây** —
 * chúng phục vụ CHAT-SCREEN-005 + tab "Tệp", thuộc `S7-CHAT-FE-4`. WO nền tảng này không dựng hàm cho
 * màn hình chưa tồn tại (`chatSearchResponseSchema`/`chatRoomFileSchema` đã có sẵn trong contracts để
 * FE-4 append thẳng vào file này).
 */
export const chatApi = {
  // ── CHAT-API-001..008 — phòng & thành viên (ChatRoomsController) ───────────────────────────────

  /**
   * GET /chat/rooms (CHAT-API-001) — danh sách phòng CỦA TÔI, kèm `unreadCount` per-room.
   *
   * `unreadCount` do SERVER tính (`lastMessageSeq − lastReadSeq`, cả hai trong hệ `room_seq`) — client
   * TUYỆT ĐỐI không tự suy: `chat_messages.seq` là identity cấp bảng, phép trừ trên nó cho ra lưu lượng
   * toàn công ty (SPEC-15 §13.1).
   */
  listRooms: (query?: Partial<ListChatRoomsQuery>): Promise<ChatRoomDto[]> =>
    apiFetch(`/chat/rooms${buildQueryString(query ?? {})}`, z.array(chatRoomSchema)),

  /** POST /chat/rooms (CHAT-API-002) — chỉ tạo được phòng NHÓM; người tạo thành `admin` phòng. */
  createRoom: (body: CreateChatRoomRequest): Promise<ChatRoomDto> =>
    apiFetch("/chat/rooms", chatRoomSchema, { method: "POST", body: JSON.stringify(body) }),

  /**
   * POST /chat/rooms/direct (CHAT-API-003) — mở DM 1-1, IDEMPOTENT theo `direct_key`.
   *
   * Server trả 200 cho CẢ lần tạo đầu (không 201) — gọi lại cho kết quả giống hệt, client không phải
   * phân biệt hai lần gọi như nhau.
   */
  openDirect: (body: OpenDirectRoomRequest): Promise<ChatRoomDto> =>
    apiFetch("/chat/rooms/direct", chatRoomSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * GET /chat/rooms/:id (CHAT-API-004) — phòng + `members[]` + `myRole` CỦA TÔI.
   *
   * Shape RỘNG HƠN `chatRoomSchema` (`ChatRoomDetailDto`). Store chat chỉ giữ phần phòng — call-site
   * chịu trách nhiệm thu hẹp (`chatRoomSchema.parse`) trước khi `hydrateRooms`, chứ KHÔNG nhét cả
   * `members[]` vào store nền tảng.
   */
  getRoom: (roomId: string): Promise<ChatRoomDetailDto> =>
    apiFetch(`/chat/rooms/${roomId}`, chatRoomDetailSchema),

  /** PATCH /chat/rooms/:id (CHAT-API-005) — chỉ `name`/`description`, chỉ phòng `group`, chỉ admin phòng. */
  updateRoom: (roomId: string, body: UpdateChatRoomRequest): Promise<ChatRoomDto> =>
    apiFetch(`/chat/rooms/${roomId}`, chatRoomSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /chat/rooms/:id/archive (CHAT-API-006) — sau khi lưu trữ, phòng CHỈ ĐỌC. */
  archiveRoom: (roomId: string): Promise<ChatRoomDto> =>
    apiFetch(`/chat/rooms/${roomId}/archive`, chatRoomSchema, { method: "POST" }),

  /**
   * POST /chat/rooms/:id/leave (CHAT-API-008) — rời phòng.
   *
   * ⚠️ Trả `{ left: true }`, KHÔNG phải phòng — xem docblock đầu file.
   */
  leaveRoom: (roomId: string): Promise<ChatLeaveRoomResultDto> =>
    apiFetch(`/chat/rooms/${roomId}/leave`, chatLeaveRoomResultSchema, { method: "POST" }),

  /** GET /chat/rooms/:id/members (CHAT-API-007a) — kèm `userName` + `lastReadSeq` (dựng "đã xem bởi"). */
  listMembers: (roomId: string): Promise<ChatRoomMemberDto[]> =>
    apiFetch(`/chat/rooms/${roomId}/members`, z.array(chatRoomMemberSchema)),

  /** POST /chat/rooms/:id/members (CHAT-API-007b) — chặn trên phòng dẫn xuất (CHAT-ERR-012). */
  addMember: (roomId: string, body: AddChatMemberRequest): Promise<ChatRoomMemberDto> =>
    apiFetch(`/chat/rooms/${roomId}/members`, chatRoomMemberSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /chat/rooms/:id/members/:userId (CHAT-API-007c) — phong/hạ vai trò trong phòng. */
  updateMember: (
    roomId: string,
    userId: string,
    body: UpdateChatMemberRequest,
  ): Promise<ChatRoomMemberDto> =>
    apiFetch(`/chat/rooms/${roomId}/members/${userId}`, chatRoomMemberSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * DELETE /chat/rooms/:id/members/:userId (CHAT-API-007d) — bớt thành viên (SET `left_at`, KHÔNG xoá hàng).
   *
   * ⚠️ Trả `{ removed: true }`, KHÔNG phải phòng — xem docblock đầu file.
   */
  removeMember: (roomId: string, userId: string): Promise<ChatRemoveMemberResultDto> =>
    apiFetch(`/chat/rooms/${roomId}/members/${userId}`, chatRemoveMemberResultSchema, {
      method: "DELETE",
    }),

  // ── CHAT-API-009..014, 016 — tin nhắn (ChatMessagesController) ─────────────────────────────────

  /**
   * GET /chat/rooms/:id/messages (CHAT-API-009) — một trang tin theo CON TRỎ.
   *
   * `beforeSeq` (cuộn ngược) và `afterSeq` (bù sau khi mất kết nối) LOẠI TRỪ NHAU — gửi cả hai → 422
   * CHAT-ERR-016. Đơn vị là `room_seq`, cấm `offset` (kết quả trôi khi có tin chèn vào giữa lúc cuộn).
   */
  getMessages: (
    roomId: string,
    query?: Partial<ListChatMessagesQuery>,
  ): Promise<ChatMessageDto[]> =>
    apiFetch(
      `/chat/rooms/${roomId}/messages${buildQueryString(query ?? {})}`,
      z.array(chatMessageSchema),
    ),

  /**
   * POST /chat/rooms/:id/messages (CHAT-API-010) — gửi tin, IDEMPOTENT theo `clientMessageId`.
   *
   * ⚠️ `clientMessageId` phải sinh **MỘT LẦN lúc bắt đầu soạn** và tái dùng nguyên vẹn khi bấm "gửi
   * lại". Sinh mới trong thân hàm gửi ⇒ khoá ngẫu nhiên mỗi lần ⇒ không chống trùng gì cả
   * (memory `idempotency-key-must-be-content-derived`). Vì thế hàm này KHÔNG tự sinh khoá hộ caller.
   */
  sendMessage: (roomId: string, body: SendMessageRequest): Promise<ChatMessageDto> =>
    apiFetch(`/chat/rooms/${roomId}/messages`, chatMessageSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** GET /chat/rooms/:id/pinned (CHAT-API-013) — tin ghim của phòng (trần 20/phòng ở server). */
  getPinned: (roomId: string): Promise<ChatMessageDto[]> =>
    apiFetch(`/chat/rooms/${roomId}/pinned`, z.array(chatMessageSchema)),

  /**
   * POST /chat/rooms/:id/read (CHAT-API-014) — con trỏ đã đọc, CHỈ TIẾN.
   *
   * Gửi số nhỏ hơn giá trị hiện có → server bỏ qua IM LẶNG và vẫn trả 200 (CHAT-ERR-018): nhiều thiết
   * bị cùng mở, thiết bị chậm không được kéo lùi trạng thái của thiết bị nhanh.
   */
  markRead: (roomId: string, body: ChatMarkReadRequest): Promise<ChatMarkReadResultDto> =>
    apiFetch(`/chat/rooms/${roomId}/read`, chatMarkReadResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** GET /chat/unread-count (CHAT-API-016) — badge tổng. Tự-bound theo actor, KHÔNG nhận roomId. */
  getUnreadCount: (): Promise<ChatUnreadCountDto> =>
    apiFetch("/chat/unread-count", chatUnreadCountSchema),

  /** POST /chat/messages/:id/recall (CHAT-API-011) — người gửi ≤15 phút hoặc admin phòng nhóm. */
  recallMessage: (messageId: string): Promise<ChatMessageDto> =>
    apiFetch(`/chat/messages/${messageId}/recall`, chatMessageSchema, { method: "POST" }),

  /** POST /chat/messages/:id/pin (CHAT-API-012a). */
  pinMessage: (messageId: string): Promise<ChatMessageDto> =>
    apiFetch(`/chat/messages/${messageId}/pin`, chatMessageSchema, { method: "POST" }),

  /** DELETE /chat/messages/:id/pin (CHAT-API-012b). */
  unpinMessage: (messageId: string): Promise<ChatMessageDto> =>
    apiFetch(`/chat/messages/${messageId}/pin`, chatMessageSchema, { method: "DELETE" }),
};
