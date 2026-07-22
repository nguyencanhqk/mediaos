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
import { BRANDING_UPDATE_PAIR, BRANDING_VIEW_PAIR } from "./branding.constants";
import { CompanyBrandingService } from "./company-branding.service";

class BrandingUploadUrlDto extends createZodDto(brandingUploadUrlInputSchema) {}
class SetBrandingDto extends createZodDto(setBrandingInputSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-BRAND-BE-1 — HTTP surface thương hiệu công ty (logo + favicon).
 *
 *  GET    /foundation/company/branding                (view:foundation-company)
 *  POST   /foundation/company/branding/:kind/upload-url  (update:foundation-company)
 *  POST   /foundation/company/branding/:kind/confirm     (update:foundation-company)
 *  PUT    /foundation/company/branding/:kind             (update:foundation-company)
 *  DELETE /foundation/company/branding/:kind             (update:foundation-company)
 *
 * TÁI DÙNG cặp `view/update:foundation-company` (mig 0435) — WO này KHÔNG seed quyền mới.
 * `PermissionGuard` opt-in ở class (KHÔNG global) — fail-closed, mirror CompanyController.
 *
 * `:kind` validate bằng `brandingKindSchema` NGAY trong controller: `ZodValidationPipe` của nestjs-zod chỉ
 * áp cho @Body (DTO), KHÔNG cho @Param ⇒ kind lạ sẽ lọt xuống service và index `BRANDING_RULES[kind]` ra
 * undefined (500). Parse tường minh ⇒ 400 sạch.
 */
@Controller("foundation/company/branding")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class CompanyBrandingController {
  constructor(private readonly branding: CompanyBrandingService) {}

  @Get()
  @RequirePermission(BRANDING_VIEW_PAIR.action, BRANDING_VIEW_PAIR.resourceType)
  getBranding(@Req() req: AuthenticatedRequest) {
    return this.branding.getBranding(req.user);
  }

  @Post(":kind/upload-url")
  @RequirePermission(BRANDING_UPDATE_PAIR.action, BRANDING_UPDATE_PAIR.resourceType)
  createUploadUrl(
    @Req() req: AuthenticatedRequest,
    @Param("kind") kind: string,
    @Body() dto: BrandingUploadUrlDto,
  ) {
    return this.branding.createUploadUrl(req.user, parseKind(kind), dto);
  }

  @Post(":kind/confirm")
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
  @RequirePermission(BRANDING_UPDATE_PAIR.action, BRANDING_UPDATE_PAIR.resourceType)
  setAsset(
    @Req() req: AuthenticatedRequest,
    @Param("kind") kind: string,
    @Body() dto: SetBrandingDto,
  ) {
    return this.branding.setAsset(req.user, parseKind(kind), dto.fileId);
  }

  @Delete(":kind")
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
