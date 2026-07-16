import { Body, Controller, Get, Patch, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import { mePreferencesAppearancePatchSchema, mePreferencesPatchSchema } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { MePreferencesService } from "./me-preferences.service";
import { ME_PREFERENCE_UPDATE_PAIR, ME_PREFERENCE_VIEW_PAIR } from "./me.constants";

class MePreferencesPatchDto extends createZodDto(mePreferencesPatchSchema) {}
class MePreferencesAppearancePatchDto extends createZodDto(mePreferencesAppearancePatchSchema) {}

/** Chỉ đọc từ TOKEN (JwtAuthGuard đã set req.user) — mirror MeController (SPEC-09 §14.4). */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-ME-BE-2 — MePreferencesController (SPEC-09 §15.2 · §10.8 · API-11 §5.1). Own-scope: `user_preferences`
 * khoá theo `userId` token-resolved (KHÔNG @Param owner — chống IDOR §14.4/§17.1).
 *
 * Guard: class-level `PermissionGuard` (fail-closed, KHÔNG global) + `@RequirePermission` cặp tuple THẬT
 * (mig 0495): GET = `('view','user-preference')`; PATCH (+ `/appearance`) = `('update','user-preference')`.
 * `ME.ACCESS` KHÔNG re-gate ở đây — API-11 §5.1 mỗi route ME có pair riêng.
 */
@Controller("me/preferences")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class MePreferencesController {
  constructor(private readonly svc: MePreferencesService) {}

  /** GET /api/v1/me/preferences — đọc personal preference hiện tại (own). */
  @Get()
  @RequirePermission(ME_PREFERENCE_VIEW_PAIR.action, ME_PREFERENCE_VIEW_PAIR.resourceType, {
    isSensitive: ME_PREFERENCE_VIEW_PAIR.isSensitive,
  })
  get(@Req() req: AuthenticatedRequest) {
    return this.svc.getPreferences(req.user);
  }

  /** PATCH /api/v1/me/preferences — cập nhật preference tổng hợp (upsert own-scope). */
  @Patch()
  @RequirePermission(ME_PREFERENCE_UPDATE_PAIR.action, ME_PREFERENCE_UPDATE_PAIR.resourceType, {
    isSensitive: ME_PREFERENCE_UPDATE_PAIR.isSensitive,
  })
  patch(@Req() req: AuthenticatedRequest, @Body() dto: MePreferencesPatchDto) {
    return this.svc.patchPreferences(req.user, dto);
  }

  /** PATCH /api/v1/me/preferences/appearance — subset giao diện (theme/locale/timezone/format/density). */
  @Patch("appearance")
  @RequirePermission(ME_PREFERENCE_UPDATE_PAIR.action, ME_PREFERENCE_UPDATE_PAIR.resourceType, {
    isSensitive: ME_PREFERENCE_UPDATE_PAIR.isSensitive,
  })
  patchAppearance(@Req() req: AuthenticatedRequest, @Body() dto: MePreferencesAppearancePatchDto) {
    return this.svc.patchAppearance(req.user, dto);
  }
}
