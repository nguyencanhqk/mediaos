import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import {
  PatchCompanySettingDto,
  PatchSystemSettingDto,
  PublicQueryDto,
  ResolveBodyDto,
  SystemSettingsQueryDto,
} from "./settings.dto";
import { SettingService } from "./setting.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S1-FND-SETTING-1 / S2-FND-BE-5 — HTTP surface cho settings (API-09 §10). Cổng quyền PER-METHOD
 * (KHÔNG @UseGuards(PermissionGuard) cấp lớp) — resource = 'foundation-setting' (seed mig 0435).
 *
 *  GET  /foundation/settings/public        (Authenticated) — S2-FND-BE-5: KHÔNG cần view:foundation-setting.
 *       CHỈ đi qua guard GLOBAL (JwtAuthGuard → CompanyGuard) → req.user.companyId ép tenant-scoping
 *       (BẤT BIẾN #1). TUYỆT ĐỐI KHÔNG @Public (mất JWT → vỡ cô lập tenant). getPublic TỰ lọc
 *       is_public && !is_sensitive + drop secret (setting-mask.toPublicMap) — quyền-aware KHÔNG cần vì
 *       chỉ trả public-nonsensitive. Mẫu y hệt ModuleCatalogController my-apps + AuthController change-password.
 *  POST /foundation/settings/resolve       (view)   — @UseGuards(PermissionGuard) view:foundation-setting;
 *       precedence, quyền-aware mask; secret_ref KHÔNG trả.
 *  PATCH /foundation/company-settings/:key (update) — @UseGuards(PermissionGuard) update:foundation-setting;
 *       upsert override + audit CONFIG_UPDATE cùng tx.
 *
 * Global prefix 'api/v1' do app (main.ts). Route ở đây bắt đầu sau prefix.
 */
@Controller("foundation")
@UsePipes(ZodValidationPipe)
export class SettingsController {
  constructor(private readonly settings: SettingService) {}

  // Authenticated-only: KHÔNG @UseGuards(PermissionGuard), KHÔNG @RequirePermission, KHÔNG @Public. Chuỗi
  // guard GLOBAL (JwtAuthGuard → CompanyGuard) chạy → cấp req.user.companyId → getPublic withTenant(companyId)
  // ép cô lập tenant (BẤT BIẾN #1) + lọc/mask public-nonsensitive (BẤT BIẾN #3, setting-mask KHÔNG nới).
  @Get("settings/public")
  getPublic(@Req() req: AuthenticatedRequest, @Query() query: PublicQueryDto) {
    return this.settings.getPublic(req.user.companyId, {
      category: query.category,
      moduleCode: query.moduleCode,
    });
  }

  @Post("settings/resolve")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "foundation-setting")
  resolve(@Req() req: AuthenticatedRequest, @Body() body: ResolveBodyDto) {
    return this.settings.resolve(req.user, {
      keys: body.keys,
      category: body.category,
      moduleCode: body.moduleCode,
      includeMetadata: body.includeMetadata,
    });
  }

  @Patch("company-settings/:key")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "foundation-setting")
  updateCompanySetting(
    @Req() req: AuthenticatedRequest,
    @Param("key") key: string,
    @Body() dto: PatchCompanySettingDto,
  ) {
    return this.settings.updateCompanySetting(req.user, key, dto);
  }

  // ─── S2-FND-BE-8 — GLOBAL system_settings (cổng system-manage:foundation-setting, is_sensitive=TRUE) ────
  // Cặp KHÔNG seed cho role (cấp tường minh per-user); wildcard '*:*'/super-admin KHÔNG kế thừa quyền nhạy
  // cảm (permission.service sensitive gate). isSensitive: true tường minh (defense-in-depth + đồng bộ catalog).
  // System-scope: đọc/ghi TẦNG GLOBAL (mọi tenant chung 1 hàng), KHÔNG chạm company_settings.

  @Get("system-settings")
  @UseGuards(PermissionGuard)
  @RequirePermission("system-manage", "foundation-setting", { isSensitive: true })
  getSystemSettings(@Req() req: AuthenticatedRequest, @Query() query: SystemSettingsQueryDto) {
    return this.settings.getSystemSettings(req.user, {
      category: query.category,
      moduleCode: query.moduleCode,
    });
  }

  @Get("system-settings/:key")
  @UseGuards(PermissionGuard)
  @RequirePermission("system-manage", "foundation-setting", { isSensitive: true })
  getSystemSetting(@Req() req: AuthenticatedRequest, @Param("key") key: string) {
    return this.settings.getSystemSetting(req.user, key);
  }

  @Patch("system-settings/:key")
  @UseGuards(PermissionGuard)
  @RequirePermission("system-manage", "foundation-setting", { isSensitive: true })
  updateSystemSetting(
    @Req() req: AuthenticatedRequest,
    @Param("key") key: string,
    @Body() dto: PatchSystemSettingDto,
  ) {
    return this.settings.updateSystemSetting(req.user, key, dto);
  }
}
