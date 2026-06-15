import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { BonusPenaltyService } from "./bonus-penalty.service";
import { CreateBonusPenaltyDto, DecideBonusPenaltyDto } from "./payroll.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * Bonus/Penalty (G12-3) — CROWN JEWEL. Thưởng/phạt = số tiền per-person nhạy cảm (ADR-0010):
 *  - MỖI route @RequirePermission isSensitive:true (PermissionGuard fail-closed). KHÔNG kế thừa wildcard.
 *  - view = view-bonus-penalty (đọc/list). manage = manage-bonus-penalty (tạo/xoá-mềm draft).
 *    approve = approve-bonus-penalty (duyệt/từ chối). Self-approve chặn ở service.
 *  - KHÔNG có route sửa field tiền sau tạo (đóng băng sau duyệt; sửa draft = xoá+tạo lại — YAGNI ở G12-3).
 */
@Controller("bonus-penalties")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class BonusPenaltyController {
  constructor(private readonly bonusPenalties: BonusPenaltyService) {}

  @Get()
  @RequirePermission("view-bonus-penalty", "bonus_penalty", { isSensitive: true })
  list(
    @Req() req: AuthenticatedRequest,
    @Query("userId") userId?: string,
    @Query("status") status?: string,
    @Query("periodMonth") periodMonth?: string,
    @Query("kind") kind?: string,
  ) {
    return this.bonusPenalties.list(req.user, {
      userId,
      status: status as "draft" | "approved" | "rejected" | undefined,
      periodMonth,
      kind: kind as "bonus" | "penalty" | undefined,
    });
  }

  @Post()
  @RequirePermission("manage-bonus-penalty", "bonus_penalty", { isSensitive: true })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateBonusPenaltyDto) {
    return this.bonusPenalties.create(req.user, dto);
  }

  @Get(":id")
  @RequirePermission("view-bonus-penalty", "bonus_penalty", { isSensitive: true })
  getOne(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.bonusPenalties.getOne(req.user, id);
  }

  @Post(":id/approve")
  @RequirePermission("approve-bonus-penalty", "bonus_penalty", { isSensitive: true })
  approve(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.bonusPenalties.approve(req.user, id);
  }

  @Post(":id/reject")
  @RequirePermission("approve-bonus-penalty", "bonus_penalty", { isSensitive: true })
  reject(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: DecideBonusPenaltyDto,
  ) {
    return this.bonusPenalties.reject(req.user, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("manage-bonus-penalty", "bonus_penalty", { isSensitive: true })
  remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.bonusPenalties.remove(req.user, id);
  }
}
