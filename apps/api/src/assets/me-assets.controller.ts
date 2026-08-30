import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { MeAssetsQueryDto } from "./assets.dto";
import { AssetsService } from "./assets.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S11-ASSET-BE-1 — GET /me/assets (ASSET-API-023 · SPEC-13 §9 ASSET-SCREEN-005). Controller RIÊNG (mirror
 * `MeGoalsController`): chủ thể LUÔN là employee của actor từ token — `MeAssetsQueryDto` không khai `employeeId`
 * ⇒ zod strip; service cũng không đọc. Cặp gate = chính `('view','asset')` @Own (permission-matrix §9d — không
 * tách cặp đọc, bài học `read-path-gate-pair-must-match-download-pair`).
 */
@Controller()
export class MeAssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get("me/assets")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "asset")
  @UsePipes(ZodValidationPipe)
  myAssets(@Req() req: AuthenticatedRequest, @Query() query: MeAssetsQueryDto) {
    return this.assets.listMine(req.user, query);
  }
}
