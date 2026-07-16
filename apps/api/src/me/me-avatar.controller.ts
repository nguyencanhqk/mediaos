import { Body, Controller, Delete, HttpCode, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import { setMeAvatarInputSchema } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { MeAvatarService } from "./me-avatar.service";
import { ME_AVATAR_UPDATE_PAIR } from "./me.constants";

class SetMeAvatarInputDto extends createZodDto(setMeAvatarInputSchema) {}

/** Chỉ đọc từ TOKEN (JwtAuthGuard đã set req.user) — mirror MeController (SPEC-09 §14.4). */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-ME-BE-2 — MeAvatarController (SPEC-09 §14.2/§17 · §21 ME-DEC-004 · API-11 §5.1). Own-scope: avatar của
 * CHÍNH employee liên kết user hiện tại (KHÔNG @Param owner — chống IDOR §14.4/§17.1).
 *
 * Guard: class-level `PermissionGuard` (fail-closed, KHÔNG global) + `@RequirePermission('update','avatar')`
 * tuple THẬT (mig 0495, Own × 4 role) cho CẢ POST và DELETE.
 */
@Controller("me/avatar")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class MeAvatarController {
  constructor(private readonly svc: MeAvatarService) {}

  /** POST /api/v1/me/avatar — gắn avatar từ 1 file ĐÃ upload+confirm (`{fileId}`). Trả downloadUrl TƯƠI. */
  @Post()
  @RequirePermission(ME_AVATAR_UPDATE_PAIR.action, ME_AVATAR_UPDATE_PAIR.resourceType, {
    isSensitive: ME_AVATAR_UPDATE_PAIR.isSensitive,
  })
  setAvatar(@Req() req: AuthenticatedRequest, @Body() dto: SetMeAvatarInputDto) {
    return this.svc.setAvatar(req.user, dto.fileId);
  }

  /** DELETE /api/v1/me/avatar — gỡ avatar hiện có (idempotent — không có avatar vẫn 204). */
  @Delete()
  @HttpCode(204)
  @RequirePermission(ME_AVATAR_UPDATE_PAIR.action, ME_AVATAR_UPDATE_PAIR.resourceType, {
    isSensitive: ME_AVATAR_UPDATE_PAIR.isSensitive,
  })
  async removeAvatar(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.svc.removeAvatar(req.user);
  }
}
