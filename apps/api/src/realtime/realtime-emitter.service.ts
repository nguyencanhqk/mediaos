import { Injectable, Logger } from "@nestjs/common";
import type { Namespace, Server } from "socket.io";
import {
  CHAT_CALL_OUTBOUND_EVENTS,
  chatCallPeerSchema,
  WS_EVENTS,
  wsChatMessageEventSchema,
  wsChatMessagePinnedEventSchema,
  wsChatMessageRecalledEventSchema,
  wsChatPresenceEventSchema,
  wsChatReactionEventSchema,
  wsChatCallEventSchema,
  wsChatReadEventSchema,
  wsChatRoomEventSchema,
  wsChatTypingEventSchema,
  wsNotificationEventSchema,
  wsNotificationReadEventSchema,
  wsFeedPostCreatedEventSchema,
  wsFeedCommentCreatedEventSchema,
  wsFeedReactionChangedEventSchema,
  type ChatMessageDto,
  type NotificationDto,
  type WsChatMessagePinnedEvent,
  type WsChatMessageRecalledEvent,
  type WsChatPresenceEvent,
  type WsChatCallEvent,
  type WsChatReactionEvent,
  type WsChatReadEvent,
  type WsChatRoomEvent,
  type WsChatTypingEvent,
  type WsFeedPostCreatedEvent,
  type WsFeedCommentCreatedEvent,
  type WsFeedReactionChangedEvent,
} from "@mediaos/contracts";
import {
  callRoomName,
  callUserRoomName,
  chatRoomName,
  chatUserRoomName,
  feedGroupRoomName,
  feedRoomName,
  userRoomName,
} from "./rooms";
import { RealtimeRoomOps } from "./realtime-room-ops";

/**
 * RealtimeEmitterService — CỔNG DUY NHẤT để module khác (NotificationsService, …) đẩy sự kiện
 * server→client. BẤT BIẾN masking (CLAUDE.md §5): MỌI payload `.parse()` qua schema contracts
 * TRƯỚC khi emit — strip field thừa, validate shape. CẤM `io.emit` row DB thẳng.
 *
 * Server gắn bởi RealtimeGateway.afterInit (cùng instance Nest DI). Khi REALTIME_ENABLED=false hoặc gateway
 * chưa init → `server` null → emit là NO-OP (fail-soft, FE còn poll REST). KHÔNG bao giờ throw lên caller
 * (realtime là best-effort phụ trợ — lỗi emit không được làm hỏng giao dịch nghiệp vụ đã commit).
 *
 * S7-CHAT-RT-1 thêm lại cụm CHAT theo mô hình MỚI (một chiều, CHAT-DEC-005) — KHÔNG khôi phục bản cũ
 * đã gỡ ở CLEAN-BE-1: không `@SubscribeMessage`, không ack, danh sách phòng do SERVER tra.
 *
 * ⚠️ MỌI method ở đây phải được gọi **SAU KHI transaction đã COMMIT**. Gọi bên trong `withTenant` là
 * phát sự kiện cho một sự thật có thể bị rollback ngay sau đó — client hiển thị tin không tồn tại và
 * không có sự kiện nào đính chính. Ca test rollback (§4 ca 9) gác điều này cho từng method.
 *
 * Room-op (`syncRoomMembership` · `syncFeedGroupMembership` · `evictFromCallRoom`) không phát payload; thân
 * ở `realtime-room-ops.ts` (S17-CHAT-EMITTERSPLIT-1), ở đây chỉ còn method ỦY QUYỀN cùng chữ ký. Ngoại lệ
 * thời điểm gọi (trong tx) của chúng ghi ở docblock từng method bên đó.
 */
@Injectable()
export class RealtimeEmitterService {
  private readonly logger = new Logger(RealtimeEmitterService.name);
  private server: Server | null = null;
  private callServer: Namespace | null = null;
  /**
   * Room-op (S17-CHAT-EMITTERSPLIT-1) — đọc `server`/`callServer` QUA GETTER lúc gọi, KHÔNG giữ bản sao
   * (gateway gắn namespace SAU khi service được dựng). Dùng chung `logger` ⇒ context log không đổi.
   */
  private readonly roomOps = new RealtimeRoomOps(
    { server: () => this.server, callServer: () => this.callServer },
    this.logger,
  );

  /** Gateway `/ws` gọi 1 lần khi server Socket.IO sẵn sàng. */
  setServer(server: Server): void {
    this.server = server;
  }

  /**
   * S7-CALL-RT-1 — `CallSignallingGateway` (`/ws-call`) gọi 1 lần.
   *
   * ⚠️ **TRƯỜNG RIÊNG, KHÔNG dùng chung `setServer`.** Hai namespace là hai đối tượng khác nhau; gateway
   * `/ws-call` mà gọi `setServer` sẽ ghi đè namespace `/ws` ⇒ `notification:new` + TOÀN BỘ cụm CHAT bắn
   * vào một namespace không ai ở trong. Hỏng IM LẶNG toàn hệ, và không test nào của CHAT/NOTI bắt được
   * vì chúng không dựng gateway thứ hai.
   *
   * Kênh này KHÔNG có method emit nghiệp vụ nào — nó tồn tại đúng để `severUserSessions` với tới được.
   */
  setCallServer(server: Namespace): void {
    this.callServer = server;
  }

  /** Đẩy notification tới room riêng của user (mọi thiết bị). Dùng bởi NotificationsService sau insert. */
  emitNotification(companyId: string, userId: string, notification: NotificationDto): void {
    if (!this.server) return;
    try {
      const payload = wsNotificationEventSchema.parse(notification);
      this.server.to(userRoomName(companyId, userId)).emit(WS_EVENTS.NOTIFICATION_NEW, payload);
    } catch (err) {
      this.logger.warn("emitNotification failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * S4-NOTI-BE-1 — đẩy unread_count mới sau mark-read/mark-all-read/xoá mềm (My-Notification API) để
   * DASH/header badge invalidate mà không cần refetch full row (chuẩn bị INT với DASH — chưa consume ở
   * lane này). Payload CHỈ số đếm — KHÔNG rò nội dung thông báo qua kênh phụ.
   */
  emitNotificationRead(companyId: string, userId: string, unreadCount: number): void {
    if (!this.server) return;
    try {
      const payload = wsNotificationReadEventSchema.parse({ unreadCount });
      this.server.to(userRoomName(companyId, userId)).emit(WS_EVENTS.NOTIFICATION_READ, payload);
    } catch (err) {
      this.logger.warn("emitNotificationRead failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── S7-CHAT-RT-1 — cụm CHAT (server → client, một chiều) ──────────────────────

  /** `chat:message` — tin mới tới MỌI thành viên đang online của phòng. Gọi SAU commit. */
  emitChatMessage(companyId: string, roomId: string, message: ChatMessageDto): void {
    this.emitToRoom(
      companyId,
      roomId,
      WS_EVENTS.CHAT_MESSAGE,
      () => wsChatMessageEventSchema.parse(message),
      "emitChatMessage",
    );
  }

  /** `chat:message-recalled` — payload KHÔNG kèm `body` (schema chỉ có 3 khoá). Gọi SAU commit. */
  emitChatMessageRecalled(
    companyId: string,
    roomId: string,
    payload: WsChatMessageRecalledEvent,
  ): void {
    this.emitToRoom(
      companyId,
      roomId,
      WS_EVENTS.CHAT_MESSAGE_RECALLED,
      () => wsChatMessageRecalledEventSchema.parse(payload),
      "emitChatMessageRecalled",
    );
  }

  /** `chat:message-pinned` — ghim/bỏ ghim (S20-CHAT-MENTIONPIN-1). KHÔNG kèm nội dung tin. Gọi SAU commit. */
  emitChatMessagePinned(
    companyId: string,
    roomId: string,
    payload: WsChatMessagePinnedEvent,
  ): void {
    this.emitToRoom(
      companyId,
      roomId,
      WS_EVENTS.CHAT_MESSAGE_PINNED,
      () => wsChatMessagePinnedEventSchema.parse(payload),
      "emitChatMessagePinned",
    );
  }

  /** `chat:read` — con trỏ đã đọc của một người đổi (dựng "đã xem bởi"). Gọi SAU commit. */
  emitChatRead(companyId: string, roomId: string, payload: WsChatReadEvent): void {
    this.emitToRoom(
      companyId,
      roomId,
      WS_EVENTS.CHAT_READ,
      () => wsChatReadEventSchema.parse(payload),
      "emitChatRead",
    );
  }

  /**
   * `chat:room` — siêu dữ liệu phòng đổi. Gọi SAU commit.
   *
   * Hai nhóm đích, hợp lại (Socket.IO `to(Room[])` tự UNION — socket ở cả hai chỉ nhận MỘT bản):
   *   • `chatRoomName`     — thành viên đang ở sẵn trong phòng (`updated`/`archived`/…);
   *   • `chatUserRoomName` của từng `affectedUserIds` — người vừa được THÊM vào một phòng họ CHƯA join,
   *     hoặc phòng vừa được TẠO (lúc đó `chatRoomName` còn rỗng, bắn vào đó là bắn vào phòng không ai).
   *
   * ⚠️ Đích thứ hai PHẢI là `chatUserRoomName`, KHÔNG phải `userRoomName` — xem jsdoc của hàm đó: dùng
   * `userRoomName` là để người đã bị thu hồi cặp `view:chat-room` vẫn nhận sự kiện chat.
   */
  emitChatRoom(
    companyId: string,
    roomId: string,
    payload: WsChatRoomEvent,
    affectedUserIds: readonly string[],
  ): void {
    if (!this.server) return;
    try {
      const parsed = wsChatRoomEventSchema.parse(payload);
      const targets = [
        chatRoomName(companyId, roomId),
        ...affectedUserIds.map((uid) => chatUserRoomName(companyId, uid)),
      ];
      this.server.to(targets).emit(WS_EVENTS.CHAT_ROOM, parsed);
    } catch (err) {
      this.logger.warn("emitChatRoom failed", {
        roomId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * `chat:typing` (S8 · CHAT-API-023) — "đang gõ" tới cả phòng.
   *
   * KHÁC ba emit trên ở đúng một điểm: KHÔNG có transaction nào để "gọi sau commit", vì CHAT-API-023 **không
   * ghi gì cả** (0 DB, 0 audit). Tiết lưu nằm ở `ChatTypingService` — emitter vẫn là cổng câm, chỉ parse rồi
   * phát; nhét throttle vào đây sẽ khiến mọi caller tương lai chịu chung một cửa sổ mà không ai thấy.
   */
  emitChatTyping(companyId: string, roomId: string, payload: WsChatTypingEvent): void {
    this.emitToRoom(
      companyId,
      roomId,
      WS_EVENTS.CHAT_TYPING,
      () => wsChatTypingEventSchema.parse(payload),
      "emitChatTyping",
    );
  }

  /**
   * `chat:reaction` (S8 · CHAT-API-022a/b) — tổng hợp cảm xúc mới của một tin, phát cho cả phòng.
   *
   * Gọi SAU commit (`ChatReactionsService`), và chỉ khi số đếm THỰC SỰ đổi.
   *
   * ⚠️ `wsChatReactionEventSchema` **không có `mine`** — đó không phải sơ suất mà là lớp chặn: `mine`
   * là trạng thái PER-USER, phát nó cho cả phòng làm mọi client vẽ dấu tích của người vừa bấm. Caller
   * đã bỏ khoá đó tại nguồn; `.parse()` ở đây là đai thứ hai (cùng khuôn `wsChatRoomEventSchema` strip
   * `unreadCount`).
   */
  emitChatReaction(companyId: string, roomId: string, payload: WsChatReactionEvent): void {
    this.emitToRoom(
      companyId,
      roomId,
      WS_EVENTS.CHAT_REACTION,
      () => wsChatReactionEventSchema.parse(payload),
      "emitChatReaction",
    );
  }

  /**
   * `chat:presence` (S8 · CHAT-FUNC-021) — một người vừa online/offline, báo cho các peer DM của họ.
   *
   * ⚠️ Đích là `chatUserRoomName` của TỪNG peer — **KHÔNG** `userRoomName`. Cùng lập luận với `emitChatRoom`
   * và jsdoc `rooms.ts`: `userRoomName` chứa mọi socket đã xác thực, kể cả của người đã bị **thu hồi** cặp
   * `view:chat-room`; bắn vào đó là đi vòng qua cổng quyền WS. Bảng API-13 §7 ghi lỏng `co:{co}:user:{uid}`
   * cho cả sự kiện này lẫn `chat:room` — code (đã qua FULL gate S7) là bản đúng, doc đã sửa theo ở RT-1.
   *
   * `peerUserIds` rỗng ⇒ KHÔNG gọi `.to([])`: Socket.IO coi danh sách room rỗng là **phát cho cả namespace**,
   * tức là mọi socket của MỌI công ty. Đó là rò xuyên tenant chỉ vì một người chưa có cuộc trò chuyện nào.
   */
  emitChatPresence(
    companyId: string,
    payload: WsChatPresenceEvent,
    peerUserIds: readonly string[],
  ): void {
    if (!this.server) return;
    if (peerUserIds.length === 0) return;
    try {
      const parsed = wsChatPresenceEventSchema.parse(payload);
      const targets = peerUserIds.map((uid) => chatUserRoomName(companyId, uid));
      this.server.to(targets).emit(WS_EVENTS.CHAT_PRESENCE, parsed);
    } catch (err) {
      this.logger.warn("emitChatPresence failed", {
        userId: payload.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * `chat:call` (S7-CALL-RT-1 · CHAT-DEC-020 R4) — một mốc vòng đời cuộc gọi. Gọi **SAU commit**.
   *
   * ┌─ VÌ SAO SỰ KIỆN NÀY Ở `/ws` CHỨ KHÔNG Ở `/ws-call` ─────────────────────────────────────────────┐
   * │ Người được gọi chưa biết có cuộc gọi thì chưa nối `/ws-call`. `/ws-call` là kênh của người ĐÃ ở │
   * │ trong cuộc gọi; chuông phải đi kênh mà mọi người vốn đã nối. Đây là quan hệ nhân quả, không phải │
   * │ lựa chọn kiến trúc — và nó KHÔNG nới `CHAT-DEC-005`: vẫn là chiều server→client.                │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * Đích là `chatUserRoomName` của TỪNG người tham gia:
   *  • KHÔNG `chatRoomName` — thành viên phòng không được mời vào cuộc gọi này không cần biết nó tồn tại;
   *  • KHÔNG `userRoomName` — room đó chứa cả socket đã bị THU HỒI cặp `view:chat-room` (xem `rooms.ts`),
   *    bắn vào đó là đi vòng qua cổng quyền WS.
   *
   * ⚠️ Hệ quả của việc dùng `chatUserRoomName`: ai có `('call','chat-room')` mà thiếu `('view','chat-room')`
   * sẽ KHÔNG bao giờ đổ chuông (socket của họ không vào room đó lúc nối `/ws`). Hai cặp luôn được seed
   * cùng nhau cho 4 role canonical nên không xảy ra trong thực tế — nhưng đó là một RÀNG BUỘC, không
   * phải một sự trùng hợp may mắn.
   *
   * `participantUserIds` rỗng ⇒ KHÔNG gọi `.to([])`: Socket.IO coi danh sách room rỗng là phát cho **cả
   * namespace**, tức mọi socket của MỌI công ty (cùng bẫy đã ghi ở `emitChatPresence`).
   */
  emitChatCall(
    companyId: string,
    participantUserIds: readonly string[],
    payload: WsChatCallEvent,
  ): void {
    // ⚠️ **NGOẠI LỆ của "fail-soft, FE còn poll REST" ở docblock class.** Lý do fail-soft đó dựa vào việc
    // FE có đường REST bù (`afterSeq` cho tin nhắn). CALL **KHÔNG có đường đó**: `chat-calls.controller.ts`
    // chỉ có 4 route `@Post` vòng đời, không có route ĐỌC nào để poll "có ai đang gọi mình không". Kênh
    // này là kênh DUY NHẤT báo chuông ⇒ mất một sự kiện = giao dịch REST đã commit nhưng người được gọi
    // KHÔNG BAO GIỜ đổ chuông. Vì thế ERROR, không phải no-op câm: mất chuông phải để lại dấu vết đủ để
    // trả lời một khiếu nại "tôi không nhận được cuộc gọi nào".
    if (!this.server) {
      this.logger.error(
        `emitChatCall BỎ QUA — gateway /ws chưa sẵn sàng; KHÔNG có fallback REST cho chuông ` +
          `(callId=${payload.callId} action=${payload.action})`,
      );
      return;
    }
    if (participantUserIds.length === 0) return;
    try {
      const parsed = wsChatCallEventSchema.parse(payload);
      const targets = participantUserIds.map((uid) => chatUserRoomName(companyId, uid));
      this.server.to(targets).emit(WS_EVENTS.CHAT_CALL, parsed);
    } catch (err) {
      this.logger.error("emitChatCall failed — người được gọi có thể KHÔNG đổ chuông", {
        callId: payload.callId,
        action: payload.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Room-op (ép socket vào/ra room — KHÔNG phát payload) ────────────────────────
  //
  // S17-CHAT-EMITTERSPLIT-1: thân + toàn bộ lập luận an ninh (bộ chọn BẤT ĐỐI XỨNG join/leave · vế `leave`
  // CỤC BỘ trước lệnh toàn cụm · thời điểm gọi trong/sau tx) ở `realtime-room-ops.ts`. Các method dưới (và
  // `evictFromCallRoom`) chỉ ỦY QUYỀN — caller ngoài `realtime/**` giữ nguyên chữ ký và vẫn chỉ phụ thuộc
  // cổng LÁ này.

  /** Ép socket của MỘT user vào/ra phòng chat — xem `RealtimeRoomOps.syncRoomMembership`. */
  syncRoomMembership(
    companyId: string,
    roomId: string,
    userId: string,
    action: "join" | "leave",
  ): void {
    this.roomOps.syncRoomMembership(companyId, roomId, userId, action);
  }

  /**
   * Ép socket của MỘT user vào/ra room của MỘT nhóm bảng tin — xem
   * `RealtimeRoomOps.syncFeedGroupMembership`. ⚠️ `leave` gọi CẢ trong tx lẫn sau commit (Q-LEAVE (a)).
   */
  syncFeedGroupMembership(
    companyId: string,
    groupId: string,
    userId: string,
    action: "join" | "leave",
  ): void {
    this.roomOps.syncFeedGroupMembership(companyId, groupId, userId, action);
  }

  /**
   * CẮT MỌI phiên WS đang mở của một user (SPEC-15 §18) — gọi khi thu hồi phiên ở tầng AUTH.
   *
   * ══ VÌ SAO CẦN: cổng quyền WS chỉ chạy MỘT LẦN ══
   * `RealtimeGateway` verify JWT ở middleware handshake và kiểm cặp `view:chat-room` ở
   * `handleConnection` — cả hai chỉ chạy lúc NỐI. Socket.IO không tái xác thực trên kết nối đang mở và
   * không có tick nào soi `exp`, nên `ACCESS_TOKEN_TTL_SEC` (~15 phút) chỉ chặn lần RECONNECT. Một tab
   * mở liên tục giữ phiên sống nhiều ngày. Trước RT-1 điều đó chỉ ảnh hưởng NOTI; từ khi RT-1 đẩy **nội
   * dung tin nhắn** lên WS thì đó là đường rò nội dung với cửa sổ KHÔNG GIỚI HẠN — không phải "≤15 phút"
   * như plan RT-1 từng ghi (FULL gate S7-CHAT-BE-GATE-3, L2).
   *
   * Nhắm `userRoomName` (RỘNG NHẤT — mọi socket đã xác thực của user), KHÔNG phải `chatUserRoomName`:
   * cùng lập luận bất đối xứng của nhánh `leave` ở `syncRoomMembership` — cắt nhầm chỉ làm mất realtime
   * tới lần reconnect (fail-safe), sót lại một socket là RÒ.
   *
   * Gọi TRONG tx của caller là CÓ CHỦ ĐÍCH: rollback sau khi đã cắt ⇒ client chỉ reconnect lại và đi
   * qua cổng quyền lần nữa — chiều an toàn. Đặt sau commit thì có cửa sổ mà phiên đã bị thu hồi ở DB
   * nhưng socket vẫn đang nhận tin.
   */
  severUserSessions(companyId: string, userId: string): void {
    // ⚠️ HAI try/catch RIÊNG, không gộp: nếu lệnh cắt `/ws` ném, một khối chung sẽ bỏ qua luôn lệnh cắt
    // `/ws-call` — đúng kịch bản mà chính chú thích dưới đây cảnh báo (socket gọi của người bị khoá sống
    // sót). Cắt hai kênh là hai nghĩa vụ độc lập.
    try {
      this.server?.in(userRoomName(companyId, userId)).disconnectSockets(true);
    } catch (err) {
      this.logger.error(
        `severUserSessions(/ws) THẤT BẠI cho user=${userId} — phiên CHAT/NOTI có thể còn sống: ` +
          (err instanceof Error ? err.message : String(err)),
        err instanceof Error ? err.stack : undefined,
      );
    }
    try {
      // ⚠️ S7-CALL-RT-1 — vế `/ws-call` KHÔNG phải "cho đủ bộ". Khoá tài khoản không xoá
      // `chat_room_members` cũng không xoá `chat_call_participants`, nên một socket `/ws-call` sống sót
      // tiếp tục relay SDP/ICE **vô thời hạn** — và ở chiều NHẬN nó còn không phát khung nào để bị kiểm
      // lại. Bỏ dòng này là để `/ws-call` nằm NGOÀI đường thu hồi phiên, tức thụt lùi một tính chất an
      // ninh mà `/ws` đang có.
      this.callServer?.in(callUserRoomName(companyId, userId)).disconnectSockets(true);
    } catch (err) {
      // Nhánh này nói RÕ namespace nào hỏng — "severUserSessions thất bại" chung chung không cho biết
      // kênh nào còn sống, mà hai kênh có hậu quả khác nhau (rò tin vs relay media).
      // KHÔNG throw lên caller: thu hồi phiên ở DB là việc chính và đã xong; cắt socket là lớp bồi.
      // Nhưng phải KÊU — im lặng ở đây nghĩa là phiên WS sống sót sau khi tài khoản đã bị khoá.
      this.logger.error(
        `severUserSessions(/ws-call) THẤT BẠI cho user=${userId} — phiên GỌI có thể còn relay sau thu hồi: ` +
          (err instanceof Error ? err.message : String(err)),
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /**
   * Kéo mọi socket `/ws-call` của một người RA KHỎI room cuộc gọi — thân ở
   * `RealtimeRoomOps.evictFromCallRoom` (`realtime-room-ops.ts`).
   *
   * ⚠️ GỌI HAI LẦN mỗi thao tác rời phòng (TRONG tx + SAU commit) — ngoại lệ có chủ đích của luật «gọi sau
   * commit» ở docblock lớp; cặp số đóng đinh ở `chat-realtime-after-commit.spec.ts`. `/ws-call` chưa sẵn
   * sàng ⇒ `error`, KHÔNG im lặng (vế AN NINH).
   */
  evictFromCallRoom(companyId: string, callId: string, userId: string): void {
    this.roomOps.evictFromCallRoom(companyId, callId, userId);
  }

  /**
   * S7-CALL-RT-FIX-2 (B4 vế THÔNG BÁO) — `call:peer-left` cho người CÒN LẠI khi một người bị gỡ/tự rời
   * khỏi phòng giữa cuộc gọi. **Gọi SAU COMMIT.**
   *
   * ⚠️ Ngược hoàn toàn với `evictFromCallRoom` ở trên, và sự bất đối xứng đó là CÓ CHỦ ĐÍCH: phát trước
   * commit rồi rollback là **nói dối** — FE người còn lại phá `RTCPeerConnection` cho một người chưa hề
   * rời, và không có sự kiện nào đính chính. Đây là dữ liệu nghiệp vụ, không phải hàng rào.
   *
   * Phát cho CẢ room, KHÔNG `.except()` — y hệt `handleDisconnect` của gateway. Một khuôn, một ngữ nghĩa;
   * FE lọc theo `callId` sẵn. (Nạn nhân vừa bị `socketsLeave` nên trên thực tế không nhận được.)
   *
   * ⚠️ Đây là **người phát THỨ HAI** vào namespace `/ws-call` — người thứ nhất là helper `relay` của
   * `CallSignallingGateway`. Nghĩa vụ `.parse()` trước `.emit(` áp y nguyên (masking là cấu trúc, không
   * phải kỷ luật); ratchet `chat-realtime-structure.spec.ts` đo cả call site này.
   */
  emitCallPeerLeft(companyId: string, callId: string, userId: string): void {
    if (!this.callServer) {
      this.logger.error(
        `emitCallPeerLeft BỎ QUA — gateway /ws-call chưa sẵn sàng; người còn lại có thể treo một peer ma ` +
          `(callId=${callId} userId=${userId})`,
      );
      return;
    }
    try {
      this.callServer
        .to(callRoomName(companyId, callId))
        .emit(CHAT_CALL_OUTBOUND_EVENTS.PEER_LEFT, chatCallPeerSchema.parse({ callId, userId }));
    } catch (err) {
      this.logger.error(
        `emitCallPeerLeft THẤT BẠI (callId=${callId} userId=${userId}) — người còn lại có thể treo một ` +
          `peer ma: ` +
          (err instanceof Error ? err.message : String(err)),
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  // ═══════════ S16-SOCIAL-BE-1/BE-2C — 3 sự kiện bảng tin ═══════════
  //
  // ⚠️ **CHỈ GỌI SAU KHI TRANSACTION ĐÃ COMMIT** — như mọi method của lớp này (xem docblock đầu file).
  //
  // ⚠️ Hai room đích (API-19 §7): `co:{c}:feed` (cả công ty — bài `company`) và
  // `co:{c}:feedgroup:{groupId}` (thành viên `active` của nhóm — bài `group`, S16-SOCIAL-BE-2C). KHÔNG có
  // room cho `org_unit` (D21/Q-ORG). Lưới thứ nhất ở SERVICE (`buildWsPostCreatedEvent` —
  // chỉ tầng đó biết hàng DB); lưới thứ hai là `.parse()` ở đây: union theo `audience` từ chối
  // `org_unit` và mọi tổ hợp vô nghĩa, và **đích suy từ payload ĐÃ PARSE** — không bao giờ từ tham số
  // caller, không bao giờ cả hai room, không bao giờ `.to([])`.
  //
  // `feed:comment.created`/`feed:reaction.changed` vẫn CHỈ room công ty, bài company (owner ký Q-CR (a)
  // — nợ `S16-SOCIAL-RTGROUPCR-1`); lưới ở `SocialCommentsService`/`SocialReactionsService`.

  /**
   * `feed:post.created` — `.parse()` TRƯỚC, rồi mới chọn room từ `audience` của kết quả parse.
   *
   * ⚠️ KHÁC `emitToFeed`: ở đó `.to(feedRoomName)` chạy TRƯỚC khi `build()` (chứa `.parse`) được tính
   * (plan M27) — vô hại khi đích cố định, nhưng là lỗ khi đích SUY TỪ payload. Ở đây parse ném ⇒ KHÔNG
   * chạm `.to()` nào (bất biến 7), nuốt (hợp đồng «không ném lên caller» giữ nguyên) + `error`.
   *
   * `error` kèm `postId`/`audience`/`groupId` (FULL gate lượt 1, silent-failure-hunter): builder
   * `buildWsPostCreatedEvent` dựng payload ĐỂ parse được, nên parse ném ở đây = hợp đồng builder ↔ union
   * đã TRÔI (vd một khoá bắt buộc mới của DTO) — mọi bài cùng dạng mất fan-out. Một dòng `warn` không bài,
   * không audience thì không phân biệt nổi với nhiễu.
   */
  emitFeedPostCreated(companyId: string, payload: WsFeedPostCreatedEvent): void {
    if (!this.server) return;
    try {
      const parsed = wsFeedPostCreatedEventSchema.parse(payload);
      this.server.to(feedPostRoomName(companyId, parsed)).emit(WS_EVENTS.FEED_POST_CREATED, parsed);
    } catch (err) {
      this.logger.error("emitFeedPostCreated failed", {
        companyId,
        postId: payload.id,
        audience: payload.audience,
        groupId: payload.groupId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  emitFeedCommentCreated(companyId: string, payload: WsFeedCommentCreatedEvent): void {
    this.emitToFeed(
      companyId,
      WS_EVENTS.FEED_COMMENT_CREATED,
      () => wsFeedCommentCreatedEventSchema.parse(payload),
      "emitFeedCommentCreated",
    );
  }

  emitFeedReactionChanged(companyId: string, payload: WsFeedReactionChangedEvent): void {
    this.emitToFeed(
      companyId,
      WS_EVENTS.FEED_REACTION_CHANGED,
      () => wsFeedReactionChangedEventSchema.parse(payload),
      "emitFeedReactionChanged",
    );
  }

  /**
   * Khuôn chung của 2 emit bảng tin CÒN LẠI (bình luận · cảm xúc — chỉ bài company, Q-CR). Cùng hợp đồng
   * `emitToRoom` (no-op khi chưa có server · `.parse()` TRƯỚC emit · KHÔNG BAO GIỜ throw lên caller) nhưng
   * nhắm `feedRoomName` thay vì `chatRoomName` — `emitToRoom` hard-code phòng chat nên không dùng lại được.
   * ⚠️ Đích CỐ ĐỊNH nên thứ tự `.to()` trước `build()` vô hại ở đây; sự kiện có đích SUY TỪ payload
   * (như `feed:post.created`) KHÔNG được đi qua khuôn này.
   */
  private emitToFeed(companyId: string, event: string, build: () => unknown, label: string): void {
    if (!this.server) return;
    try {
      this.server.to(feedRoomName(companyId)).emit(event, build());
    } catch (err) {
      this.logger.warn(`${label} failed`, {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Khuôn chung của 3 emit tới phòng: no-op khi chưa có server · `.parse()` TRƯỚC emit (masking) ·
   * KHÔNG BAO GIỜ throw lên caller (realtime là phụ trợ; giao dịch nghiệp vụ đã commit rồi).
   */
  private emitToRoom(
    companyId: string,
    roomId: string,
    event: string,
    build: () => unknown,
    label: string,
  ): void {
    if (!this.server) return;
    try {
      this.server.to(chatRoomName(companyId, roomId)).emit(event, build());
    } catch (err) {
      this.logger.warn(`${label} failed`, {
        roomId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * S16-SOCIAL-BE-2C — room đích của `feed:post.created`, suy từ payload ĐÃ PARSE. `switch` vét cạn trên
 * union `audience`: thêm một option vào schema mà quên định tuyến là ĐỎ lúc BIÊN DỊCH (thiếu `return`),
 * không phải một nhánh `else` lặng lẽ đưa bài ra room cả công ty. Luôn MỘT chuỗi room cụ thể — không
 * bao giờ mảng (mảng rỗng = phát cả namespace).
 */
function feedPostRoomName(companyId: string, ev: WsFeedPostCreatedEvent): string {
  switch (ev.audience) {
    case "company":
      return feedRoomName(companyId);
    case "group":
      return feedGroupRoomName(companyId, ev.groupId);
  }
}
