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
import { PatchCompanySettingDto, PublicQueryDto, ResolveBodyDto } from "./settings.dto";
import { SettingService } from "./setting.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S1-FND-SETTING-1 — HTTP surface cho settings (API-09 §10). Mọi route gated PermissionGuard
 * (@RequirePermission, fail-closed). resource = 'foundation-setting' (seed mig 0435).
 *
 *  GET  /foundation/settings/public        (view)   — chỉ public-nonsensitive, KHÔNG secret_ref/secret.
 *  POST /foundation/settings/resolve       (view)   — precedence, quyền-aware mask; secret_ref KHÔNG trả.
 *  PATCH /foundation/company-settings/:key (update) — upsert override + audit CONFIG_UPDATE cùng tx.
 *
 * Global prefix 'api/v1' do app (main.ts). Route ở đây bắt đầu sau prefix.
 */
@Controller("foundation")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class SettingsController {
  constructor(private readonly settings: SettingService) {}

  @Get("settings/public")
  @RequirePermission("view", "foundation-setting")
  getPublic(@Req() req: AuthenticatedRequest, @Query() query: PublicQueryDto) {
    return this.settings.getPublic(req.user.companyId, {
      category: query.category,
      moduleCode: query.moduleCode,
    });
  }

  @Post("settings/resolve")
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
  @RequirePermission("update", "foundation-setting")
  updateCompanySetting(
    @Req() req: AuthenticatedRequest,
    @Param("key") key: string,
    @Body() dto: PatchCompanySettingDto,
  ) {
    return this.settings.updateCompanySetting(req.user, key, dto);
  }
}
