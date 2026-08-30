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
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AssetLifecycleService } from "./asset-lifecycle.service";
import { AssetMaintenanceService } from "./asset-maintenance.service";
import {
  AssetSummaryQueryDto,
  AssignAssetDto,
  CloseMaintenanceDto,
  CreateAssetDto,
  DisposeAssetDto,
  ListAssetAssignmentsQueryDto,
  ListAssetMaintenancesQueryDto,
  ListAssetsQueryDto,
  OpenMaintenanceDto,
  RecoverAssetDto,
  RevokeAssetDto,
  UpdateAssetDto,
} from "./assets.dto";
import { AssetsService } from "./assets.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S11-ASSET-BE-1 — AssetsController (ASSET-API-005..017, 024). Prefix /assets. MỎNG — chỉ định tuyến.
 *
 * ⚠️ THỨ TỰ ROUTE: `GET /assets/summary` (024) PHẢI khai TRƯỚC `GET /assets/:id` (007) — nếu không Nest nuốt
 * `summary` thành `:id` ⇒ 400 sai chỗ (bài học `goals/tree`).
 *
 * Mỗi route @UseGuards(PermissionGuard) + @RequirePermission ĐÚNG cặp seed 0550 (11 cặp §9d); pipe Zod CẤP
 * METHOD trên route ghi (KI-068); mọi `:id`/`:maintenanceId` = UUID ở biên. `@Idempotent()` trên cấp phát
 * (Idempotency-Key do FE sinh — interceptor dùng chung, TTL 15′).
 */
@Controller("assets")
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly lifecycle: AssetLifecycleService,
    private readonly maintenance: AssetMaintenanceService,
  ) {}

  /** GET /assets — danh sách theo scope (005). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListAssetsQueryDto) {
    return this.assets.list(req.user, query);
  }

  /** GET /assets/summary — thống kê trong scope (024). KHAI TRƯỚC ':id'. */
  @Get("summary")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  @UsePipes(ZodValidationPipe)
  summary(@Req() req: AuthenticatedRequest, @Query() query: AssetSummaryQueryDto) {
    return this.assets.summary(req.user, query);
  }

  /** POST /assets — tạo hồ sơ; `assetCode` sinh ở server (006). */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "asset")
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateAssetDto) {
    return this.assets.create(req.user, dto);
  }

  /** GET /assets/:id — chi tiết + currentHolder theo scope; ngoài scope ⇒ 404 (007). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.assets.get(req.user, id);
  }

  /** PATCH /assets/:id — sửa mô tả; body `.strict()` (008). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "asset")
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assets.update(req.user, id, dto);
  }

  /** DELETE /assets/:id — xoá MỀM khi In Stock + 0 lịch sử (009). */
  @Delete(":id")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("delete", "asset")
  async remove(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    await this.assets.remove(req.user, id);
  }

  // ── Cấp phát / thu hồi ─────────────────────────────────────────────────────

  /** POST /assets/:id/assign — In Stock → Assigned (010). Idempotency-Key do client sinh. */
  @Post(":id/assign")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission("assign", "asset")
  @UsePipes(ZodValidationPipe)
  assign(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssignAssetDto,
  ) {
    return this.lifecycle.assign(req.user, id, dto);
  }

  /** POST /assets/:id/revoke — lượt Active → Returned (011). */
  @Post(":id/revoke")
  @UseGuards(PermissionGuard)
  @RequirePermission("revoke", "asset")
  @UsePipes(ZodValidationPipe)
  revoke(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RevokeAssetDto,
  ) {
    return this.lifecycle.revoke(req.user, id, dto);
  }

  /** GET /assets/:id/assignments — lịch sử cấp phát lọc theo scope (012). */
  @Get(":id/assignments")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  @UsePipes(ZodValidationPipe)
  assignments(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListAssetAssignmentsQueryDto,
  ) {
    return this.lifecycle.listAssignments(req.user, id, query);
  }

  // ── Bảo trì ────────────────────────────────────────────────────────────────

  /** POST /assets/:id/maintenances — mở lượt (013). */
  @Post(":id/maintenances")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "asset-maintenance")
  @UsePipes(ZodValidationPipe)
  openMaintenance(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: OpenMaintenanceDto,
  ) {
    return this.maintenance.open(req.user, id, dto);
  }

  /** POST /assets/:id/maintenances/:maintenanceId/close — đóng lượt (014). */
  @Post(":id/maintenances/:maintenanceId/close")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "asset-maintenance")
  @UsePipes(ZodValidationPipe)
  closeMaintenance(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("maintenanceId", ParseUUIDPipe) maintenanceId: string,
    @Body() dto: CloseMaintenanceDto,
  ) {
    return this.maintenance.close(req.user, id, maintenanceId, dto);
  }

  /** GET /assets/:id/maintenances — lịch sử bảo trì (015); `cost` chỉ ở Company. */
  @Get(":id/maintenances")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  @UsePipes(ZodValidationPipe)
  maintenances(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListAssetMaintenancesQueryDto,
  ) {
    return this.maintenance.list(req.user, id, query);
  }

  // ── Thanh lý / mất / tìm thấy lại ──────────────────────────────────────────

  /** POST /assets/:id/dispose — Disposed (008 nếu còn lượt Active) / Lost (016). */
  @Post(":id/dispose")
  @UseGuards(PermissionGuard)
  @RequirePermission("dispose", "asset")
  @UsePipes(ZodValidationPipe)
  dispose(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DisposeAssetDto,
  ) {
    return this.lifecycle.dispose(req.user, id, dto);
  }

  /** POST /assets/:id/recover — Lost → In Stock (017). */
  @Post(":id/recover")
  @UseGuards(PermissionGuard)
  @RequirePermission("dispose", "asset")
  @UsePipes(ZodValidationPipe)
  recover(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RecoverAssetDto,
  ) {
    return this.lifecycle.recover(req.user, id, dto);
  }
}
