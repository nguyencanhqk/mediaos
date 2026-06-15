import {
  Body,
  Controller,
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
import {
  createCostSchema,
  adjustCostSchema,
  voidFinanceRecordSchema,
  listCostQuerySchema,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { CostService } from "./cost.service";
import { mapReplacesUniqueToConflict } from "./finance-conflict.helper";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * G13CTL — Cost HTTP layer. Append-only sổ cái chi phí (BẤT BIẾN #2).
 *
 * Mọi route đều @RequirePermission('create','finance') — fail-closed, không kế thừa wildcard.
 * companyId lấy từ req.user (JWT) — KHÔNG đọc từ body/param (tránh tenant-leak).
 * controller KHÔNG query DB, KHÔNG business logic — delegated 100% tới CostService.
 *
 * Conflict (409): double-adjust cùng original → unique constraint cost_records_replaces_uq
 *   → mapReplacesUniqueToConflict() ném ConflictException tại HTTP layer.
 */
@Controller("finance/cost")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class CostController {
  constructor(private readonly cost: CostService) {}

  @Get()
  @RequirePermission("create", "finance")
  list(@Req() req: AuthenticatedRequest, @Query() query: Record<string, string>) {
    const filter = listCostQuerySchema.parse(query);
    const { id, companyId } = req.user;
    return this.cost.list(companyId, id, filter);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("create", "finance")
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = createCostSchema.parse(body);
    const { id, companyId } = req.user;
    return this.cost.create(companyId, id, dto);
  }

  @Post(":id/adjust")
  @HttpCode(201)
  @RequirePermission("create", "finance")
  async adjust(
    @Req() req: AuthenticatedRequest,
    @Param("id") originalId: string,
    @Body() body: unknown,
  ) {
    const dto = adjustCostSchema.parse(body);
    const { id, companyId } = req.user;
    try {
      return await this.cost.adjust(companyId, id, originalId, {
        amount: dto.amount,
        reason: dto.description ?? "",
      });
    } catch (err) {
      mapReplacesUniqueToConflict(err);
      throw err;
    }
  }

  @Post(":id/void")
  @HttpCode(201)
  @RequirePermission("create", "finance")
  async void(
    @Req() req: AuthenticatedRequest,
    @Param("id") originalId: string,
    @Body() body: unknown,
  ) {
    const dto = voidFinanceRecordSchema.parse(body);
    const { id, companyId } = req.user;
    try {
      return await this.cost.void(companyId, id, originalId, { reason: dto.reason });
    } catch (err) {
      mapReplacesUniqueToConflict(err);
      throw err;
    }
  }
}
