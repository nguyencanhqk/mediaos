import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { NotificationsService } from "./notifications.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** GET /notifications — danh sách thông báo; ?is_read=false để chỉ lấy chưa đọc */
  @Get()
  list(@Req() req: AuthenticatedRequest, @Query("is_read") isRead?: string) {
    const filterRead =
      isRead === "true" ? true : isRead === "false" ? false : undefined;
    return this.notifications.listForUser(req.user.companyId, req.user.id, filterRead);
  }

  /** GET /notifications/unread-count — số lượng chưa đọc */
  @Get("unread-count")
  unreadCount(@Req() req: AuthenticatedRequest) {
    return this.notifications.countUnread(req.user.companyId, req.user.id);
  }

  /** PATCH /notifications/:id/read — đánh dấu đã đọc */
  @Patch(":id/read")
  @HttpCode(200)
  markRead(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.notifications.markRead(req.user.companyId, id, req.user.id);
  }

  /** PATCH /notifications/read-all — đánh dấu tất cả đã đọc */
  @Patch("read-all")
  @HttpCode(200)
  markAllRead(@Req() req: AuthenticatedRequest) {
    return this.notifications.markAllRead(req.user.companyId, req.user.id);
  }
}
