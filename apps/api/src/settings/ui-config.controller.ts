import { Body, Controller, Get, Put, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { UiConfigService } from "./ui-config.service";
import { PutI18nOverridesDto, PutUiNavigationDto, UpdateBrandingDto } from "./ui-config.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * UiConfigController (AC-4) — TENANT self-service branding/navigation/i18n. companyId LẤY TỪ JWT
 * (req.user.companyId) — KHÔNG nhận :companyId path operator (chống escape RLS qua param).
 *
 * Permission is_sensitive=FALSE (PRD §5.y): logo/menu/i18n KHÔNG nhạy cảm ⇒ company-admin grant tường
 * minh là ĐỦ. ⚠️ TUYỆT ĐỐI KHÔNG requiresReauth (cặp isSensitive&&requiresReauth bật reveal-class →
 * đòi per-object grant → deny company-admin). Chỉ {isSensitive:false}.
 */
@Controller("settings")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class UiConfigController {
  constructor(private readonly uiConfig: UiConfigService) {}

  // ── Branding ──────────────────────────────────────────────────────────────────

  @Get("branding")
  @RequirePermission("view", "branding", { isSensitive: false })
  getBranding(@Req() req: AuthenticatedRequest) {
    return this.uiConfig.getBranding({ id: req.user.id, companyId: req.user.companyId });
  }

  @Put("branding")
  @RequirePermission("manage", "branding", { isSensitive: false })
  updateBranding(@Req() req: AuthenticatedRequest, @Body() dto: UpdateBrandingDto) {
    return this.uiConfig.updateBranding(
      { id: req.user.id, companyId: req.user.companyId },
      dto,
    );
  }

  // ── Navigation ──────────────────────────────────────────────────────────────────

  /**
   * GET /settings/ui-navigation — `?effective=true` trả menu HIỆU LỰC (lọc isVisible + module-gate);
   * mặc định trả cấu hình raw (admin sửa). Đọc dùng manage:ui-navigation (KHÔNG perm view riêng — menu
   * là cấu hình admin, không có read-role tách bạch). is_sensitive=false.
   */
  @Get("ui-navigation")
  @RequirePermission("manage", "ui-navigation", { isSensitive: false })
  getNavigation(@Req() req: AuthenticatedRequest, @Query("effective") effective?: string) {
    const actor = { id: req.user.id, companyId: req.user.companyId };
    return effective === "true"
      ? this.uiConfig.getEffectiveNavigation(actor)
      : this.uiConfig.getNavigationConfig(actor);
  }

  @Put("ui-navigation")
  @RequirePermission("manage", "ui-navigation", { isSensitive: false })
  updateNavigation(@Req() req: AuthenticatedRequest, @Body() dto: PutUiNavigationDto) {
    return this.uiConfig.updateNavigation(
      { id: req.user.id, companyId: req.user.companyId },
      dto,
    );
  }

  // ── i18n overrides ──────────────────────────────────────────────────────────────

  @Get("i18n-overrides")
  @RequirePermission("manage", "i18n-override", { isSensitive: false })
  getI18nOverrides(@Req() req: AuthenticatedRequest) {
    return this.uiConfig.getI18nOverrides({ id: req.user.id, companyId: req.user.companyId });
  }

  @Put("i18n-overrides")
  @RequirePermission("manage", "i18n-override", { isSensitive: false })
  updateI18nOverrides(@Req() req: AuthenticatedRequest, @Body() dto: PutI18nOverridesDto) {
    return this.uiConfig.updateI18nOverrides(
      { id: req.user.id, companyId: req.user.companyId },
      dto,
    );
  }
}
