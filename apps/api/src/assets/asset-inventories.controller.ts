import {
  Body,
  Controller,
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
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AssetInventoryService } from "./asset-inventory.service";
import {
  BulkMarkInventoryItemsDto,
  CloseInventoryDto,
  ListAssetInventoriesQueryDto,
  ListAssetInventoryItemsQueryDto,
  MarkInventoryItemDto,
  OpenInventoryDto,
} from "./assets.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S11-ASSET-BE-1 — AssetInventoriesController (ASSET-API-018..022). Prefix /asset-inventories.
 * Gate seed 0550: đọc `('view','asset')` (Company thấy; scope khác: danh sách rỗng / chi tiết 404),
 * ghi `('manage','asset-inventory')`. `@Idempotent()` trên mở đợt + đóng đợt (API-14 §7.5 "nên").
 */
@Controller("asset-inventories")
export class AssetInventoriesController {
  constructor(private readonly inventory: AssetInventoryService) {}

  /** GET /asset-inventories (018). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListAssetInventoriesQueryDto) {
    return this.inventory.list(req.user, query);
  }

  /** POST /asset-inventories — mở đợt + ảnh chụp (019). */
  @Post()
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "asset-inventory")
  @UsePipes(ZodValidationPipe)
  open(@Req() req: AuthenticatedRequest, @Body() dto: OpenInventoryDto) {
    return this.inventory.open(req.user, dto);
  }

  /** GET /asset-inventories/:id (020a) — Own/Department ⇒ 404. */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.inventory.get(req.user, id);
  }

  /** GET /asset-inventories/:id/items (020b). */
  @Get(":id/items")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  @UsePipes(ZodValidationPipe)
  items(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListAssetInventoryItemsQueryDto,
  ) {
    return this.inventory.listItems(req.user, id, query);
  }

  /** PATCH /asset-inventories/:id/items/:itemId — đánh dấu 1 dòng (021a). */
  @Patch(":id/items/:itemId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "asset-inventory")
  @UsePipes(ZodValidationPipe)
  async markOne(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() dto: MarkInventoryItemDto,
  ) {
    await this.inventory.markOne(req.user, id, itemId, dto);
  }

  /** POST /asset-inventories/:id/items/bulk-mark — ≤200 dòng (021b). */
  @Post(":id/items/bulk-mark")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "asset-inventory")
  @UsePipes(ZodValidationPipe)
  async markMany(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: BulkMarkInventoryItemsDto,
  ) {
    await this.inventory.markMany(req.user, id, dto);
  }

  /** POST /asset-inventories/:id/close — đóng đợt + 4 số tổng kết (022). */
  @Post(":id/close")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "asset-inventory")
  @UsePipes(ZodValidationPipe)
  close(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CloseInventoryDto,
  ) {
    return this.inventory.close(req.user, id, dto);
  }
}
