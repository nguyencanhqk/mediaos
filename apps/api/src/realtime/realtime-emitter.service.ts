import { Injectable, Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import {
  WS_EVENTS,
  wsChatMessageEventSchema,
  wsChatMessageRecalledEventSchema,
  wsChatReadEventSchema,
  wsChatRoomEventSchema,
  wsNotificationEventSchema,
  wsNotificationReadEventSchema,
  type ChatMessageDto,
  type NotificationDto,
  type WsChatMessageRecalledEvent,
  type WsChatReadEvent,
  type WsChatRoomEvent,
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
