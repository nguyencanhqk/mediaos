import { Body, Controller, Delete, HttpCode, Get, Param, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import {
  upsertNotificationPreferenceSchema,
  registerDeviceSchema,
  type UpsertNotificationPreferenceDto,
  type RegisterDeviceDto,
} from "@mediaos/contracts";
import { NotificationPreferencesRepository } from "./notification-preferences.repository";
import { DeviceTokenService } from "./device-token.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * NotificationsController — device tokens (push registration) + preferences (opt-in/out per type). Danh
 * sách/unread-count/mark-read/mark-all-read đã CHUYỂN sang MyNotificationsController (S4-NOTI-BE-1, cột
 * MỚI/API spec-compliant, xem my-notifications.controller.ts) — gỡ 4 route cũ ở đây để KHÔNG va route
 * (Nest sẽ đăng ký trùng nếu 2 controller cùng khai báo `@Get() /notifications`). NotificationsService.create()
 * (dùng bởi module khác để phát notification) KHÔNG đổi — chỉ HTTP surface đọc/mark của controller này gỡ.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly prefRepo: NotificationPreferencesRepository,
    private readonly deviceTokens: DeviceTokenService,
  ) {}

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
  unregisterDevice(@Req() req: AuthenticatedRequest, @Param("token") token: string) {
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
