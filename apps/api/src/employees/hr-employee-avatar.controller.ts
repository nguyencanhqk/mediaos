import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { HrEmployeeAvatarService } from "./hr-employee-avatar.service";

class HrAvatarUploadUrlDto extends createZodDto(meAvatarUploadUrlInputSchema) {}
class SetHrAvatarDto extends createZodDto(setMeAvatarInputSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-HR-AVATAR-1 — HrEmployeeAvatarController. HR/admin (holder `update:employee`) đặt/gỡ avatar của MỘT
 * NHÂN VIÊN KHÁC (directory-class). Sits alongside `HrWriteController` under `@Controller("hr")`.
 *
 * MỌI route gate `@RequirePermission('update','employee')` (SEEDED pair — mirror HrWriteController — a
 * denied caller writes NOTHING). `:id` là `@Param` NHƯNG KHÔNG IDOR: `HrEmployeeAvatarService.
 * assertWriteScope` (Company/System fail-closed) + RLS (company_id mọi query) khoá tenant/scope —
 * business logic + authorization ở SERVICE, controller CHỈ forward req.user + :id (CLAUDE.md §5).
 */
@Controller("hr")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class HrEmployeeAvatarController {
  constructor(private readonly svc: HrEmployeeAvatarService) {}

  /**
   * POST /api/v1/hr/employees/:id/avatar/upload-url — đăng ký file ẢNH Private owned-by-HR → presigned-PUT
   * `{fileId, uploadUrl, expiresAt}`. Client PUT bytes rồi gọi `POST .../avatar` (confirm+link+set fold).
   */
  @Post("employees/:id/avatar/upload-url")
  @RequirePermission("update", "employee")
  createUploadUrl(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: HrAvatarUploadUrlDto,
  ) {
    return this.svc.createUploadUrl(req.user, id, dto);
  }

  /**
   * POST /api/v1/hr/employees/:id/avatar — gắn avatar từ 1 file (confirm-if-pending fold vào đây — endpoint
   * MỚI, không shipped-regression). Trả `{fileId}` (FE refetch employee detail để lấy downloadUrl đã ký).
   */
  @Post("employees/:id/avatar")
  @RequirePermission("update", "employee")
  setEmployeeAvatar(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetHrAvatarDto,
  ) {
    return this.svc.setEmployeeAvatar(req.user, id, dto.fileId);
  }

  /** DELETE /api/v1/hr/employees/:id/avatar — gỡ avatar hiện có (idempotent — không có avatar vẫn 204). */
  @Delete("employees/:id/avatar")
  @HttpCode(204)
  @RequirePermission("update", "employee")
  async removeEmployeeAvatar(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.svc.removeEmployeeAvatar(req.user, id);
  }
}
