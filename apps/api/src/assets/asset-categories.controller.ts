import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AssetCategoriesService } from "./asset-categories.service";
import {
  CreateAssetCategoryDto,
  ListAssetCategoriesQueryDto,
  UpdateAssetCategoryDto,
} from "./assets.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S11-ASSET-BE-1 — AssetCategoriesController (ASSET-API-001..004). Prefix /asset-categories.
 *
 * Pipeline toàn cục JwtAuthGuard → CompanyGuard chạy TRƯỚC. MỖI route @UseGuards(PermissionGuard) +
 * @RequirePermission đúng cặp seed 0550. `@UsePipes(ZodValidationPipe)` khai ở CẤP METHOD cho route ghi
 * (KI-068 — pipe cấp class không được census `body-validation` tính). Mọi `:id` = UUID ở biên (ratchet param-uuid).
 * Business logic + audit ở service.
 */
@Controller("asset-categories")
export class AssetCategoriesController {
  constructor(private readonly categories: AssetCategoriesService) {}

  /** GET /asset-categories — `includeDeleted` chỉ honour khi có manage (ngược lại bỏ qua, không 403). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListAssetCategoriesQueryDto) {
    return this.categories.list(req.user, query);
  }

  /** POST /asset-categories — tạo loại + counter cùng tx. */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "asset-category")
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateAssetCategoryDto) {
    return this.categories.create(req.user, dto);
  }

  /** PATCH /asset-categories/:id — sửa / vô hiệu / `restore: true` (đường duy nhất dùng lại prefix). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "asset-category")
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetCategoryDto,
  ) {
    return this.categories.update(req.user, id, dto);
  }

  /** DELETE /asset-categories/:id — xoá MỀM; còn tài sản chưa Disposed/Lost ⇒ 409 ASSET-ERR-010. */
  @Delete(":id")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "asset-category")
  async remove(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    await this.categories.remove(req.user, id);
  }
}
