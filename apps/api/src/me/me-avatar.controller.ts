import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import { meAvatarUploadUrlInputSchema, setMeAvatarInputSchema } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { MeAvatarService } from "./me-avatar.service";
import { ME_ACCESS_PAIR, ME_AVATAR_UPDATE_PAIR } from "./me.constants";

class SetMeAvatarInputDto extends createZodDto(setMeAvatarInputSchema) {}
class MeAvatarUploadUrlDto extends createZodDto(meAvatarUploadUrlInputSchema) {}

/** Chỉ đọc từ TOKEN (JwtAuthGuard đã set req.user) — mirror MeController (SPEC-09 §14.4). */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-ME-BE-2/4 — MeAvatarController (SPEC-09 §14.2/§17 · §21 ME-DEC-004 · API-11 §5.1). Own-scope: avatar của
 * CHÍNH employee liên kết user hiện tại (KHÔNG @Param owner — chống IDOR §14.4/§17.1).
 *
 * Guard: class-level `PermissionGuard` (fail-closed, KHÔNG global). MUTATION (upload-url/confirm/POST/DELETE)
 * gate `update:avatar` Own (mig 0495, Own × 4 role); READ (GET) gate `access:me` (mig 0495 — mọi user ME có,
 * đồng nhất các READ khác của MeController, own-scope do token + resolver ép chứ không do cặp quyền).
 *
 * S5-ME-BE-4 (đóng "Nợ để lại" S5-ME-BE-2): thêm upload-url + confirm + GET để role KHÔNG có *:foundation-file
 * vẫn tự upload+confirm+hiển-thị avatar own-scope (TÁI DÙNG FileService nội bộ — gate foundation-file nằm ở
 * FilesController, service không gate). Flow FE: upload-url → PUT bytes → confirm → POST /me/avatar → GET.
 */
@Controller("me/avatar")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class MeAvatarController {
  constructor(private readonly svc: MeAvatarService) {}

  /**
   * POST /api/v1/me/avatar/upload-url — đăng ký file ảnh Private owned-by-token → presigned-PUT
   * `{fileId, uploadUrl, expiresAt}`. Client PUT bytes trực tiếp rồi gọi /me/avatar/confirm.
   */
  @Post("upload-url")
  @RequirePermission(ME_AVATAR_UPDATE_PAIR.action, ME_AVATAR_UPDATE_PAIR.resourceType, {
    isSensitive: ME_AVATAR_UPDATE_PAIR.isSensitive,
  })
  createUploadUrl(@Req() req: AuthenticatedRequest, @Body() dto: MeAvatarUploadUrlDto) {
    return this.svc.createUploadUrl(req.user, dto);
  }

  /**
   * POST /api/v1/me/avatar/confirm — xác nhận bytes đã upload (`{fileId}`) → flip Pending→Uploaded (own-scope
   * wrapper `FileService.confirmUpload`). Owner-check TRƯỚC (IDOR). 200 (idempotent nếu đã Uploaded).
   */
  @Post("confirm")
  @HttpCode(200)
  @RequirePermission(ME_AVATAR_UPDATE_PAIR.action, ME_AVATAR_UPDATE_PAIR.resourceType, {
    isSensitive: ME_AVATAR_UPDATE_PAIR.isSensitive,
  })
  confirmUpload(@Req() req: AuthenticatedRequest, @Body() dto: SetMeAvatarInputDto) {
    return this.svc.confirmOwnUpload(req.user, dto.fileId);
  }

  /**
   * GET /api/v1/me/avatar — avatar hiện tại đã ký (TTL-ngắn) hoặc `null` (fail-soft: unlinked / chưa set /
   * không tải được → null, KHÔNG lỗi cứng). Own-scope theo token. Gate `access:me` (READ).
   */
  @Get()
  @RequirePermission(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType, {
    isSensitive: ME_ACCESS_PAIR.isSensitive,
  })
  getCurrentAvatar(@Req() req: AuthenticatedRequest) {
    return this.svc.getCurrentAvatar(req.user);
  }

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
