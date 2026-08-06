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
  chatRoomFileSchema,
  type ChatRoomFileDto,
  chatSearchResponseSchema,
  type ChatSearchResponseDto,
  type ChatSearchQuery,
  chatOversightAuditResponseSchema,
  type ChatOversightAuditResponseDto,
  type ChatOversightAuditQuery,
  chatOversightMessageSchema,
  type ChatOversightMessageDto,
  type ChatOversightMessagesQuery,
  chatOversightRoomDetailSchema,
  type ChatOversightRoomDetailDto,
  chatOversightRoomListSchema,
  type ChatOversightRoomListDto,
  type ChatOversightRoomQuery,
  chatUnreadCountSchema,
  type ChatUnreadCountDto,
  type AddChatMemberRequest,
  type ChatMarkReadRequest,
  type ChatMuteRoomRequest,
  type CreateChatRoomRequest,
  type ListChatMessagesQuery,
  type ListChatRoomFilesQuery,
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
 * ⚠️ CHAT-API-015 (`/chat/search`) và CHAT-API-017 (`/chat/rooms/:id/files`) **đã mirror ở cuối file**
 * (`S7-CHAT-FE-4`) — hai đường này có hình dạng phản hồi KHÁC NHAU, xem docblock từng hàm.
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

  // ── CHAT-API-024a/b · 025 · 020 (S8-CHAT-UX-BE-1) — tuỳ chọn per-phòng CỦA CHÍNH MÌNH ──────────
  //
  // Cả bốn trả về `ChatRoomDto` ĐẦY ĐỦ (không phải `{ok:true}`): call-site thay nguyên phòng trong
  // cache React Query bằng phản hồi, khỏi phải tự vá từng khoá — và khỏi lệch khi server chuẩn hoá giá
  // trị khác với thứ vừa gửi lên (xem `muteRoom`).
  //
  // ⚠️ Cả bốn dùng cặp `('view','chat-room')` ở server: đây là TUỲ CHỌN CÁ NHÂN, không phải quản trị
  // phòng. FE **không** được bọc chúng trong `<PermissionGate action="update">`.

  /**
   * PUT /chat/rooms/:id/pin (CHAT-API-024a) — ghim hội thoại, trần **10/người**.
   *
   * Vượt trần ⇒ **409** `CHAT-ERR-021`; UI phải nêu rõ con số trần, không nuốt thành lỗi chung chung.
   * Ghim lại phòng đang ghim ⇒ 200, không tiêu thêm suất.
   */
  pinRoom: (roomId: string): Promise<ChatRoomDto> =>
    apiFetch(`/chat/rooms/${roomId}/pin`, chatRoomSchema, { method: "PUT" }),

  /** DELETE /chat/rooms/:id/pin (CHAT-API-024b) — bỏ ghim. Phòng chưa ghim vẫn 200 (idempotent). */
  unpinRoom: (roomId: string): Promise<ChatRoomDto> =>
    apiFetch(`/chat/rooms/${roomId}/pin`, chatRoomSchema, { method: "DELETE" }),

  /**
   * PUT /chat/rooms/:id/mute (CHAT-API-025) — tắt thông báo tới `mutedUntil`; `null` = **bật lại**.
   *
   * ⚠️ HAI điều FE phải biết, cả hai đều làm hỏng biểu tượng chuông-gạch nếu bỏ qua:
   *  1. Server **chuẩn hoá mốc đã qua về `null`** ⇒ phản hồi có thể khác thứ vừa gửi. Dùng phòng trả về
   *     làm nguồn sự thật, đừng ghi lại giá trị local.
   *  2. "Đang tắt" = `mutedUntil !== null` **VÀ** `mutedUntil > now`. Chỉ kiểm khác-null là vẽ
   *     chuông-gạch cho một phòng đã hết hạn tắt trong lúc dữ liệu nằm trong cache.
   */
  muteRoom: (roomId: string, body: ChatMuteRoomRequest): Promise<ChatRoomDto> =>
    apiFetch(`/chat/rooms/${roomId}/mute`, chatRoomSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  /**
   * POST /chat/rooms/:id/unread (CHAT-API-020) — đánh dấu chưa đọc thủ công.
   *
   * ⚠️ `unreadCount` trong phản hồi **KHÔNG đổi** — đúng thiết kế: con trỏ `last_read_seq` là chỉ-tiến
   * (SPEC-15 §13.2) và không bị lùi để làm tính năng này. Dòng phòng hiện đậm theo `markedUnreadAt`,
   * KHÔNG theo badge. Cờ tự tắt ở lần `markRead` kế tiếp (mở phòng).
   */
  markRoomUnread: (roomId: string): Promise<ChatRoomDto> =>
    apiFetch(`/chat/rooms/${roomId}/unread`, chatRoomSchema, { method: "POST" }),

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

  // ── S7-CHAT-FE-4 — CHAT-API-015 + 017 (tìm kiếm & tab Tệp) ────────────────────────────────────

  /**
   * GET /chat/search (CHAT-API-015) — tìm toàn văn trong CÁC PHÒNG MÌNH LÀ THÀNH VIÊN (SPEC-15 §13.7).
   *
   * ⚠️ Phản hồi là **OBJECT keyset** `{ data, nextCursor }`, KHÔNG phải mảng trần như mọi endpoint danh
   * sách khác của module này (chúng không đi qua `paginated()` của repo — khối `Pagination` dùng chung là
   * page/offset, không dùng được cho keyset). Truyền `z.array(...)` vào đây là `ZodError` runtime DÙ HTTP
   * 200 (memory `apifetch-drops-pagination-bare-array`). `nextCursor: null` = trang cuối.
   *
   * ⚠️ `q` gửi **NGUYÊN VĂN**. Bỏ dấu ở client là làm HỎNG: server so bằng
   * `websearch_to_tsquery('simple', f_unaccent($q))` — chính nó lo cả hai chiều có dấu/không dấu, còn
   * một bản luật thứ hai ở FE chỉ tạo ra hai kết quả khác nhau cho cùng một câu.
   *
   * Vị từ membership nằm ở SERVER (JOIN `chat_room_members` với `left_at IS NULL`) — **không** có đường
   * tìm kiếm toàn công ty cho bất kỳ role nào, kể cả Super Admin (SPEC-15 §3.3).
   */
  search: (query: ChatSearchQuery): Promise<ChatSearchResponseDto> =>
    apiFetch(`/chat/search${buildQueryString(query)}`, chatSearchResponseSchema),

  /**
   * GET /chat/rooms/:id/files (CHAT-API-017) — tệp đã gửi trong phòng, kèm URL ký hạn ngắn.
   *
   * MẢNG TRẦN (khác `search` ngay bên trên — đừng chép nhầm schema).
   *
   * ⚠️ Con trỏ trang kế = `min(roomSeq)` của trang này, và **KHÔNG** suy được "còn trang sau" từ
   * `rows.length === limit`: server gọi `trimToMessageBoundary` để không chẻ đôi nhóm tệp của một tin,
   * nên trang có thể NGẮN hơn `limit` dù còn dữ liệu (và dài hơn `limit` khi một tin có nhiều tệp hơn
   * `limit`). Chỉ một trang RỖNG mới chứng minh đã hết.
   */
  listRoomFiles: (
    roomId: string,
    query?: Partial<ListChatRoomFilesQuery>,
  ): Promise<ChatRoomFileDto[]> =>
    apiFetch(
      `/chat/rooms/${roomId}/files${buildQueryString(query ?? {})}`,
      z.array(chatRoomFileSchema),
    ),
};

// ═══════════ S7-CHAT-FE-5 🔒 — ĐỌC-VƯỢT MEMBERSHIP (CHAT-API-018a/b/c + 019) ═══════════

/**
 * Client của đường ĐỌC-VƯỢT — CHAT-SCREEN-007/008 (SPEC-15 §3.3 · §9 · API-13 §5.3).
 *
 * ⚠️ **ĐỐI TƯỢNG RIÊNG, CỐ Ý KHÔNG nhét vào `chatApi`.** Backend tách hẳn controller · service ·
 * repository · mapper cho đường này để câu "mọi đường đọc thường gọi `assertMember` VÔ ĐIỀU KIỆN" còn
 * chứng minh được bằng một lời grep. Trộn 4 hàm dưới đây vào `chatApi` là phá vế đó ở tầng client: mọi
 * call-site đang cầm `chatApi` (trang `/chat`, panel nổi, store) tự nhiên có trong tay đường đọc-vượt
 * chỉ bằng cách gõ dấu chấm, và bản review sau sẽ phải đọc từng call-site thay vì đọc từng import.
 *
 * ⚠️ Bốn route đều `GET`. KHÔNG có hàm gửi/ghim/thu hồi/sửa thành viên ở đây, và cũng KHÔNG có
 * `search` — `/chat/oversight/search` KHÔNG TỒN TẠI (ràng buộc 5 của API-13 §5.3, không phải thiếu sót).
 * Muốn tìm toàn văn thì vẫn là `chatApi.search`, vốn giữ nguyên vị từ membership cho MỌI role.
 *
 * ⚠️ Mọi lời gọi ở đây để lại dấu vết trong `audit_logs` (`action = 'chat.oversight.read'`) — kể cả lần
 * BỊ TỪ CHỐI (guard ghi `Denied` ở transaction riêng ĐÃ COMMIT rồi mới 403). UI vì thế không được gọi
 * "thăm dò" trước khi người dùng thật sự quyết định (xem hộp thoại xác nhận ở CHAT-SCREEN-007).
 */
export const chatOversightApi = {
  /**
   * GET /chat/oversight/rooms (CHAT-API-018a) — tra phòng theo mã/tên/loại.
   *
   * `q` BẮT BUỘC ≥2 ký tự (server 422 nếu ngắn hơn) — UI chặn TRƯỚC khi gọi, vì một request chắc chắn
   * hỏng vẫn đốt một dòng audit.
   *
   * Phản hồi là **object** `{ data, truncated }`, KHÔNG phải mảng trần và KHÔNG có con trỏ: không lật
   * trang được thì không enumerate được toàn bộ phòng công ty. `truncated: true` = còn kết quả bị cắt ⇒
   * UI PHẢI nói ra, đọc im lặng thành "đã trả hết" là để người dùng kết luận sai về phạm vi.
   */
  searchRooms: (query: ChatOversightRoomQuery): Promise<ChatOversightRoomListDto> =>
    apiFetch(`/chat/oversight/rooms${buildQueryString(query)}`, chatOversightRoomListSchema),

  /**
   * GET /chat/oversight/rooms/:id (CHAT-API-018b) — chi tiết phòng + thành viên. Audit MỖI LẦN GỌI.
   *
   * ⚠️ **KHÔNG có `myRole`** trong `ChatOversightRoomDetailDto` (khác `chatApi.getRoom`): người đọc-vượt
   * không có hàng `chat_room_members` nào nên mọi giá trị điền vào đó đều là bịa. Vắng trường = UI
   * không có nhánh nào bật được nút quản trị.
   *
   * Phòng lạ / đã xoá mềm / tenant khác ⇒ 404 GIỐNG HỆT đường đọc thường (không phải oracle dò tồn tại).
   */
  getRoom: (roomId: string): Promise<ChatOversightRoomDetailDto> =>
    apiFetch(`/chat/oversight/rooms/${roomId}`, chatOversightRoomDetailSchema),

  /**
   * GET /chat/oversight/rooms/:id/messages (CHAT-API-018c) — MẢNG TRẦN, toàn dải `roomSeq`.
   *
   * ⚠️ Hình dạng KHÁC `listAudit` ngay bên dưới (object keyset) — chép nhầm schema là `ZodError` runtime
   * DÙ HTTP 200 (memory `apifetch-drops-pagination-bare-array`).
   *
   * ⚠️ Đính kèm trả về là **metadata thuần, 0 URL** (`chatOversightAttachmentSchema`): CHAT-DEC-004 mở
   * ranh giới MEMBERSHIP, KHÔNG mở đường tải tệp. UI render tên/cỡ/loại, tuyệt đối không dựng `href`.
   *
   * `body === null` với tin đã thu hồi — masking KHÔNG được nới ở đường này (SPEC-15 §13.6).
   */
  listMessages: (
    roomId: string,
    query?: Partial<ChatOversightMessagesQuery>,
  ): Promise<ChatOversightMessageDto[]> =>
    apiFetch(
      `/chat/oversight/rooms/${roomId}/messages${buildQueryString(query ?? {})}`,
      z.array(chatOversightMessageSchema),
    ),

  /**
   * GET /chat/oversight/audit (CHAT-API-019) — nhật ký đọc-vượt cho CHAT-SCREEN-008.
   *
   * Phản hồi **object keyset** `{ data, nextCursor }`; `nextCursor === null` = trang cuối. Con trỏ rác →
   * 400 (server KHÔNG im lặng rơi về trang đầu — rơi về trang đầu biến con trỏ hỏng thành vòng lặp vô hạn).
   *
   * ⚠️ **BỘ LỌC CHẠY Ở SERVER** (`S7-CHAT-BE-9`): `actorUserId` · `from`/`to`. **KHÔNG được lọc phía
   * client** trên các dòng đã tải — lọc trên một tập con làm người đọc kết luận "không có lần truy cập
   * nào" trong khi bằng chứng nằm ở trang chưa tải, đúng thứ SPEC-15 §18 gọi là "audit không xem được
   * thì không phải kiểm soát". Bản trước của chính docblock này dạy làm điều đó; nếu bạn định dựng lại
   * `filterAuditEntries` ở client thì đây là chỗ nói KHÔNG.
   *
   * ⚠️ `from`/`to` là **NGÀY** `YYYY-MM-DD` và server quy đổi theo `companies.timezone`. Client **không**
   * được tự đổi sang mốc UTC: làm vậy thì hai người ở hai múi giờ lọc ra hai kết quả khác nhau trên cùng
   * một câu hỏi. Gửi mốc thời gian đầy đủ → 400.
   *
   * ⚠️ Con trỏ mang **dấu vân bộ lọc**: dùng lại con trỏ của bộ lọc KHÁC → 400 `CHAT-ERR-016`. Đổi bộ lọc
   * thì phải tải lại từ trang đầu (đưa bộ lọc vào `queryKey` là đủ).
   */
  listAudit: (query?: Partial<ChatOversightAuditQuery>): Promise<ChatOversightAuditResponseDto> =>
    apiFetch(
      `/chat/oversight/audit${buildQueryString(query ?? {})}`,
      chatOversightAuditResponseSchema,
    ),
};
