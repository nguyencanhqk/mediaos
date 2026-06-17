import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import {
  upsertNotificationPreferenceSchema,
  registerDeviceSchema,
  type UpsertNotificationPreferenceDto,
  type RegisterDeviceDto,
} from "@mediaos/contracts";
import { NotificationsService } from "./notifications.service";
import { NotificationPreferencesRepository } from "./notification-preferences.repository";
import { DeviceTokenService } from "./device-token.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prefRepo: NotificationPreferencesRepository,
    private readonly deviceTokens: DeviceTokenService,
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

  // ─── Device tokens (push registration) ────────────────────────────────────

  /**
   * POST /notifications/devices — register a push device token.
   * Body: { token: string, platform: 'ios'|'android'|'web' }
   * Idempotent: re-registering the same token updates last_seen_at only.
   */
  @Post("devices")
  @HttpCode(201)
  registerDevice(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: RegisterDeviceDto,
  ) {
    return this.deviceTokens.register({
      companyId: req.user.companyId,
      userId: req.user.id,
      token: body.token,
      platform: body.platform,
    });
  }

  /**
   * DELETE /notifications/devices/:token — soft-delete (unregister) a device token.
   * The caller may only unregister their own tokens (userId from JWT).
   */
  @Delete("devices/:token")
  @HttpCode(204)
  unregisterDevice(
    @Req() req: AuthenticatedRequest,
    @Param("token") token: string,
  ) {
    return this.deviceTokens.unregister({
      companyId: req.user.companyId,
      token,
      userId: req.user.id,
    });
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
