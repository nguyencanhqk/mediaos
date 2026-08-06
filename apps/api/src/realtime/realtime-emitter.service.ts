import { Injectable, Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import {
  WS_EVENTS,
  wsChatMessageEventSchema,
  wsChatMessageRecalledEventSchema,
  wsChatPresenceEventSchema,
  wsChatReadEventSchema,
  wsChatRoomEventSchema,
  wsChatTypingEventSchema,
  wsNotificationEventSchema,
  wsNotificationReadEventSchema,
  type ChatMessageDto,
  type NotificationDto,
  type WsChatMessageRecalledEvent,
  type WsChatPresenceEvent,
  type WsChatReadEvent,
  type WsChatRoomEvent,
  type WsChatTypingEvent,
} from "@mediaos/contracts";
import { chatRoomName, chatUserRoomName, userRoomName } from "./rooms";

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

  /** Gateway gọi 1 lần khi server Socket.IO sẵn sàng. */
  setServer(server: Server): void {
    this.server = server;
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
    if (!this.server) return;
    try {
      this.server.in(userRoomName(companyId, userId)).disconnectSockets(true);
    } catch (err) {
      // KHÔNG throw lên caller: thu hồi phiên ở DB là việc chính và đã xong; cắt socket là lớp bồi.
      // Nhưng phải KÊU — im lặng ở đây nghĩa là phiên WS sống sót sau khi tài khoản đã bị khoá.
      this.logger.error(
        `severUserSessions THẤT BẠI cho user=${userId} — phiên WS có thể còn sống sau khi thu hồi: ` +
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
