import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import {
  upsertNotificationPreferenceSchema,
  type UpsertNotificationPreferenceDto,
} from "@mediaos/contracts";
import { NotificationsService } from "./notifications.service";
import { NotificationPreferencesRepository } from "./notification-preferences.repository";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prefRepo: NotificationPreferencesRepository,
  ) {}

  /** GET /notifications — danh sách thông báo; ?is_read=false để chỉ lấy chưa đọc */
  @Get()
  list(@Req() req: AuthenticatedRequest, @Query("is_read") isRead?: string) {
    const filterRead =
      isRead === "true" ? true : isRead === "false" ? false : undefined;
    return this.notifications.listForUser(req.user.companyId, req.user.id, filterRead);
  }

  /** GET /notifications/unread-count */
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

  // ─── Preferences ───────────────────────────────────────────────────────────

  /** GET /notifications/preferences — danh sách preference của user */
  @Get("preferences")
  listPreferences(@Req() req: AuthenticatedRequest) {
    return this.prefRepo.findByUser(req.user.companyId, req.user.id);
  }

  /**
   * PUT /notifications/preferences — upsert 1 preference (opt-in / opt-out).
   * Body: { notificationType, enabled }
   */
  @Put("preferences")
  @HttpCode(200)
  upsertPreference(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(upsertNotificationPreferenceSchema))
    body: UpsertNotificationPreferenceDto,
  ) {
    return this.prefRepo.upsert(
      req.user.companyId,
      req.user.id,
      body.notificationType,
      body.enabled,
    );
  }
}
