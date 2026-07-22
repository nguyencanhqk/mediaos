import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import {
  BRANDING_ERROR_CODES,
  brandingKindSchema,
  brandingUploadUrlInputSchema,
  setBrandingInputSchema,
  type BrandingKind,
} from "@mediaos/contracts";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { BRANDING_UPDATE_PAIR } from "./branding.constants";
import { CompanyBrandingService } from "./company-branding.service";

class BrandingUploadUrlDto extends createZodDto(brandingUploadUrlInputSchema) {}
class SetBrandingDto extends createZodDto(setBrandingInputSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-BRAND-BE-1 — HTTP surface thương hiệu công ty (logo + favicon).
 *
 *  GET    /foundation/company/branding                   (ĐÃ ĐĂNG NHẬP — không cặp quyền, xem ghi chú dưới)
 *  POST   /foundation/company/branding/:kind/upload-url  (update:foundation-company)
 *  POST   /foundation/company/branding/:kind/confirm     (update:foundation-company)
 *  PUT    /foundation/company/branding/:kind             (update:foundation-company)
 *  DELETE /foundation/company/branding/:kind             (update:foundation-company)
 *
 * TÁI DÙNG cặp `update:foundation-company` (mig 0435) — WO này KHÔNG seed quyền mới.
 * `PermissionGuard` opt-in THEO ROUTE (KHÔNG cấp class, KHÔNG global): guard fail-closed 403 khi route
 * thiếu @RequirePermission, nên route đọc authenticated-only PHẢI nằm ngoài guard (mẫu SettingsController).
 *
 * `:kind` validate bằng `brandingKindSchema` NGAY trong controller: `ZodValidationPipe` của nestjs-zod chỉ
 * áp cho @Body (DTO), KHÔNG cho @Param ⇒ kind lạ sẽ lọt xuống service và index `BRANDING_RULES[kind]` ra
 * undefined (500). Parse tường minh ⇒ 400 sạch.
 */
@Controller("foundation/company/branding")
@UsePipes(ZodValidationPipe)
export class CompanyBrandingController {
  constructor(private readonly branding: CompanyBrandingService) {}

  /**
   * Authenticated-only: KHÔNG @UseGuards(PermissionGuard), KHÔNG @RequirePermission (mẫu
   * `SettingsController.getPublic`). Chuỗi guard GLOBAL (JwtAuthGuard → CompanyGuard) vẫn chạy ⇒ có
   * `req.user.companyId`, và service đọc qua withTenant ⇒ cô lập tenant giữ nguyên (BẤT BIẾN #1).
   *
   * VÌ SAO KHÔNG gate `view:foundation-company` (S5-BRAND-FE-2, owner chốt): DB thật chỉ cấp cặp đó cho
   * company-admin. Gate ở đây ⇒ logo trên vỏ app + favicon động chỉ chạy cho ~1 người/công ty, mọi nhân
   * viên khác nhận 403 → tính năng nhìn như xong nhưng không phải. Logo/favicon là tài sản thương hiệu
   * công khai theo bản chất (ai cũng thấy trên topbar/tab). Đường GHI bên dưới VẪN gate đầy đủ.
   */
  @Get()
  getBranding(@Req() req: AuthenticatedRequest) {
    return this.branding.getBranding(req.user);
  }

  @Post(":kind/upload-url")
  @UseGuards(PermissionGuard)
  @RequirePermission(BRANDING_UPDATE_PAIR.action, BRANDING_UPDATE_PAIR.resourceType)
  createUploadUrl(
    @Req() req: AuthenticatedRequest,
    @Param("kind") kind: string,
    @Body() dto: BrandingUploadUrlDto,
  ) {
    return this.branding.createUploadUrl(req.user, parseKind(kind), dto);
  }

  @Post(":kind/confirm")
  @UseGuards(PermissionGuard)
  @HttpCode(200)
  @RequirePermission(BRANDING_UPDATE_PAIR.action, BRANDING_UPDATE_PAIR.resourceType)
  confirmUpload(
    @Req() req: AuthenticatedRequest,
    @Param("kind") kind: string,
    @Body() dto: SetBrandingDto,
  ) {
    return this.branding.confirmUpload(req.user, parseKind(kind), dto.fileId);
  }

  @Put(":kind")
  @UseGuards(PermissionGuard)
  @RequirePermission(BRANDING_UPDATE_PAIR.action, BRANDING_UPDATE_PAIR.resourceType)
  setAsset(
    @Req() req: AuthenticatedRequest,
    @Param("kind") kind: string,
    @Body() dto: SetBrandingDto,
  ) {
    return this.branding.setAsset(req.user, parseKind(kind), dto.fileId);
  }

  @Delete(":kind")
  @UseGuards(PermissionGuard)
  @HttpCode(204)
  @RequirePermission(BRANDING_UPDATE_PAIR.action, BRANDING_UPDATE_PAIR.resourceType)
  async removeAsset(@Req() req: AuthenticatedRequest, @Param("kind") kind: string): Promise<void> {
    await this.branding.removeAsset(req.user, parseKind(kind));
  }
}

/**
 * `:kind` → BrandingKind.
 *
 * DÙNG `safeParse` + ném BadRequestException, KHÔNG `.parse()`: ZodError THÔ ném từ trong controller KHÔNG
 * đi qua ZodValidationPipe (pipe chỉ bọc @Body) nên `AllExceptionsFilter` không nhận ra ⇒ map thành
 * **500 SYSTEM-ERR-001**. Deny-path int-spec ("kind lạ → 400") bắt đúng ca này — giữ nguyên test đó làm
 * chốt hồi quy: `PUT /foundation/company/branding/banner` phải 400, không phải 500.
 */
function parseKind(raw: string): BrandingKind {
  const parsed = brandingKindSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException({
      code: BRANDING_ERROR_CODES.UNKNOWN_KIND,
      message: `${BRANDING_ERROR_CODES.UNKNOWN_KIND}: kind phải là 'logo' hoặc 'favicon' (nhận: ${raw}).`,
    });
  }
  return parsed.data;
}
