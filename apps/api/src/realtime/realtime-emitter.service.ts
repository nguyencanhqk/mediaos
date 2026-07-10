import { Injectable, Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import {
  WS_EVENTS,
  wsNotificationEventSchema,
  wsNotificationReadEventSchema,
  type NotificationDto,
} from "@mediaos/contracts";
import { userRoomName } from "./rooms";

/**
 * RealtimeEmitterService — CỔNG DUY NHẤT để module khác (NotificationsService, …) đẩy sự kiện
 * server→client. BẤT BIẾN masking (CLAUDE.md §5): MỌI payload `.parse()` qua schema contracts
 * TRƯỚC khi emit — strip field thừa, validate shape. CẤM `io.emit` row DB thẳng.
 *
 * Server gắn bởi RealtimeGateway.afterInit (cùng instance Nest DI). Khi REALTIME_ENABLED=false hoặc gateway
 * chưa init → `server` null → emit là NO-OP (fail-soft, FE còn poll REST). KHÔNG bao giờ throw lên caller
 * (realtime là best-effort phụ trợ — lỗi emit không được làm hỏng giao dịch nghiệp vụ đã commit).
 *
 * (CLEAN-BE-1 de-media-fy: gỡ emitChatMessage cùng cụm chat — chỉ còn đường NOTI.)
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
}
