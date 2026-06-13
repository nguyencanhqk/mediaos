import { Injectable, Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import {
  WS_EVENTS,
  wsChatMessageEventSchema,
  wsNotificationEventSchema,
  type ChatMessageDto,
  type NotificationDto,
} from "@mediaos/contracts";
import { chatRoomName, userRoomName } from "./rooms";

/**
 * RealtimeEmitterService — CỔNG DUY NHẤT để module khác (ChatService, NotificationsService, …) đẩy
 * sự kiện server→client. BẤT BIẾN masking (CLAUDE.md §5): MỌI payload `.parse()` qua schema contracts
 * TRƯỚC khi emit — strip field thừa, validate shape. CẤM `io.emit` row DB thẳng.
 *
 * Server gắn bởi RealtimeGateway.afterInit (cùng instance Nest DI). Khi REALTIME_ENABLED=false hoặc gateway
 * chưa init → `server` null → emit là NO-OP (fail-soft, FE còn poll REST). KHÔNG bao giờ throw lên caller
 * (realtime là best-effort phụ trợ — lỗi emit không được làm hỏng giao dịch nghiệp vụ đã commit).
 */
@Injectable()
export class RealtimeEmitterService {
  private readonly logger = new Logger(RealtimeEmitterService.name);
  private server: Server | null = null;

  /** Gateway gọi 1 lần khi server Socket.IO sẵn sàng. */
  setServer(server: Server): void {
    this.server = server;
  }

  /** Đẩy tin nhắn mới tới mọi socket đang ở room chat (đã join + membership-checked tại join). */
  emitChatMessage(companyId: string, roomId: string, message: ChatMessageDto): void {
    if (!this.server) return;
    try {
      const payload = wsChatMessageEventSchema.parse(message);
      this.server.to(chatRoomName(companyId, roomId)).emit(WS_EVENTS.CHAT_MESSAGE, payload);
    } catch (err) {
      this.logger.warn("emitChatMessage failed", {
        roomId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
}
