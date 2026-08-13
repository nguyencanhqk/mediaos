import { Injectable, Logger } from "@nestjs/common";
import type { Namespace, Server } from "socket.io";
import {
  CHAT_CALL_OUTBOUND_EVENTS,
  chatCallPeerSchema,
  WS_EVENTS,
  wsChatMessageEventSchema,
  wsChatMessageRecalledEventSchema,
  wsChatPresenceEventSchema,
  wsChatReactionEventSchema,
  wsChatCallEventSchema,
  wsChatReadEventSchema,
  wsChatRoomEventSchema,
  wsChatTypingEventSchema,
  wsNotificationEventSchema,
  wsNotificationReadEventSchema,
  type ChatMessageDto,
  type NotificationDto,
  type WsChatMessageRecalledEvent,
  type WsChatPresenceEvent,
  type WsChatCallEvent,
  type WsChatReactionEvent,
  type WsChatReadEvent,
  type WsChatRoomEvent,
  type WsChatTypingEvent,
} from "@mediaos/contracts";
import {
  callRoomName,
  callUserRoomName,
  chatRoomName,
  chatUserRoomName,
  userRoomName,
} from "./rooms";

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
 */
@Injectable()
export class RealtimeEmitterService {
  private readonly logger = new Logger(RealtimeEmitterService.name);
  private server: Server | null = null;
  private callServer: Namespace | null = null;

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

  /**
   * Ép socket của MỘT user vào/ra phòng chat NGAY khi tư cách thành viên đổi — không đợi kết nối lại.
   * Không phát payload nào (không phải sự kiện, là thao tác room-ops).
   *
   * Hai nhánh CỐ Ý dùng bộ chọn KHÁC nhau, bất đối xứng có chủ đích:
   *   • `join`  → quét `chatUserRoomName` — CHỈ socket đã qua cổng quyền `view:chat-room`. Quét rộng hơn
   *     là để lần đổi thành viên kế tiếp kéo cả socket từng bị cổng quyền từ chối vào phòng.
   *   • `leave` → quét `userRoomName` (RỘNG HƠN, mọi socket đã xác thực của user). Rời nhầm chỉ làm mất
   *     realtime tới lần reconnect (fail-safe); sót lại một socket là RÒ TIN.
   *
   * Xuyên instance nhờ `@socket.io/redis-adapter` (`addSockets`/`delSockets` implement thật) — chỉ đúng
   * khi adapter Valkey đã gắn (`S7-CHAT-RT-0`); ở chế độ in-memory chỉ đúng trong tiến trình này.
   */
  syncRoomMembership(
    companyId: string,
    roomId: string,
    userId: string,
    action: "join" | "leave",
  ): void {
    if (!this.server) return;
    try {
      const target = chatRoomName(companyId, roomId);
      if (action === "join") {
        this.server.in(chatUserRoomName(companyId, userId)).socketsJoin(target);
      } else {
        this.server.in(userRoomName(companyId, userId)).socketsLeave(target);
      }
    } catch (err) {
      this.logger.warn("syncRoomMembership failed", {
        roomId,
        userId,
        action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
   * S7-CALL-RT-FIX-2 (B4 vế AN NINH) — kéo mọi socket `/ws-call` của một người RA KHỎI room chung của
   * một cuộc gọi. Room-ops, KHÔNG phát payload nào.
   *
   * ⚠️ **GỌI HAI LẦN mỗi thao tác rời phòng: một TRONG TRANSACTION của caller, một SAU COMMIT.** Đây là
   * ngoại lệ của luật "mọi method ở service này gọi sau commit" — và là ngoại lệ ở CẢ HAI đầu, nên đừng
   * "gọn hoá" xuống một lần:
   *
   *  • **trong tx** — cùng lập luận với `severUserSessions` ngay trên: đặt SAU commit thì để hở đúng cửa
   *    sổ `media-state`/`screen-state` mà bản vá dựng ra để đóng. Rollback sau khi đã evict là chiều
   *    FAIL-SAFE (suy giảm UX), còn sót một socket là RÒ.
   *  • **sau commit** — đóng CỬA SỔ REJOIN: trong khe giữa lần evict thứ nhất và COMMIT, gateway xử một
   *    `call:join` ở tx khác đọc READ COMMITTED nên CHƯA thấy `left_at`/`outcome` mới ⇒ nó chấp nhận
   *    join và `socketsJoin` đưa socket đó TRỞ LẠI room chung. Không có lần thứ hai thì kênh mở lại tới
   *    khi socket rớt. Room-ops idempotent nên lần thừa vô hại.
   *
   * Cặp số (1 lần khi commit hỏng · 2 lần khi commit OK) được đóng đinh ở
   * `chat-realtime-after-commit.spec.ts` — dời một trong hai vế đi là ĐỎ.
   *
   * ⚠️ Phần dư CHƯA đóng: một `call:join` đọc DB trước commit nhưng chạy `socketsJoin` sau lần evict thứ
   * hai thì vẫn lọt. Đóng hẳn phải khoá hàng participant ở đường join — ngoài phạm vi S7-CALL-RT-FIX-2.
   *
   * ┌─ VÌ SAO KHÔNG ĐỦ NẾU CHỈ ĐÓNG `chat_call_participants` ────────────────────────────────────────┐
   * │ Đóng participant làm người bị gỡ rơi khỏi `activeUserIds` ⇒ `assertPeer` chặn được SDP/ICE (ba  │
   * │ sự kiện đi qua `callUserRoomName` của người NHẬN). Nhưng `call:media-state` và                  │
   * │ `call:screen-state` **broadcast thẳng vào `callRoomName`** và KHÔNG đi qua `assertPeer` — socket│
   * │ họ vẫn còn trong room chung ⇒ họ tiếp tục biết bên kia bật/tắt mic, cam, và đang chia sẻ màn    │
   * │ hình hay không. Ít hơn IP nội bộ, nhưng vẫn là "đã bị gỡ khỏi phòng mà vẫn theo dõi cuộc gọi    │
   * │ theo thời gian thực".                                                                          │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ **Hậu quả rollback ĐẦY ĐỦ** (ghi ra để `S7-CALL-QA-2` biết mà đo): rời `callRoomName` mất KHÔNG
   * CHỈ chỉ báo mic/cam mà mất cả `call:peer-left`. Nếu tx rollback, nạn nhân vẫn là thành viên hợp lệ
   * nhưng UI của họ sẽ **treo một peer ma khi bên kia gác máy**, và FE không có lệnh `call:join` lần hai
   * để tự sửa.
   *
   * ⚠️ `callServer === null` (REALTIME_ENABLED=false / gateway chưa init) **KHÔNG được im lặng.** Khuôn
   * `?.` câm của `severUserSessions` không áp được: đây là vế AN NINH, và trạng thái hậu quả là *"DB nói
   * đã rời, socket VẪN trong `callRoomName`"* = RÒ, không phải suy biến chấp nhận được. `logger.error`
   * theo đúng precedent `emitChatCall`.
   *
   * ⚠️ `try/catch` CHỈ phủ nhánh ném ĐỒNG BỘ. `socketsLeave` với adapter Valkey publish trong một promise
   * nội bộ; reject ở đó KHÔNG rơi vào `catch` mà thành `unhandledRejection`. Rủi ro này ĐÃ CÓ SẴN ở
   * `severUserSessions` — ghi ra để không ai đọc khối dưới thành "đã bọc kín".
   */
  evictFromCallRoom(companyId: string, callId: string, userId: string): void {
    if (!this.callServer) {
      this.logger.error(
        `evictFromCallRoom BỎ QUA — gateway /ws-call chưa sẵn sàng; socket của người vừa rời phòng có ` +
          `thể VẪN nhận media-state/screen-state của cuộc gọi (callId=${callId} userId=${userId})`,
      );
      return;
    }
    try {
      this.callServer
        .in(callUserRoomName(companyId, userId))
        .socketsLeave(callRoomName(companyId, callId));
    } catch (err) {
      // KHÔNG throw lên caller: ném ở đây sẽ ROLLBACK cả thao tác gỡ thành viên — lấy một sự cố realtime
      // đổi lấy một thao tác quản trị thất bại là sai chiều đánh đổi. Nhưng phải KÊU: im lặng nghĩa là
      // một người đã bị gỡ khỏi phòng vẫn đang theo dõi cuộc gọi.
      this.logger.error(
        `evictFromCallRoom THẤT BẠI (callId=${callId} userId=${userId}) — socket có thể còn trong room ` +
          `cuộc gọi: ` +
          (err instanceof Error ? err.message : String(err)),
        err instanceof Error ? err.stack : undefined,
      );
    }
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
