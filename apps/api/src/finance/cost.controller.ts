import {
  BadRequestException,
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
import { ZodError } from "zod";
import {
  createCostSchema,
  adjustCostSchema,
  voidFinanceRecordSchema,
  listCostQuerySchema,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import type { AuthRequest } from "../permission/guards/jwt-auth.guard";
import { CostService } from "./cost.service";
import { mapReplacesUniqueToConflict } from "./finance-conflict.helper";

/** Bọc schema.parse: ZodError → 400 BadRequestException, mọi lỗi khác re-throw. */
function parseOr400<T>(schema: { parse: (v: unknown) => T }, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.errors);
    }
    throw err;
  }
}

/**
 * G13CTL — Cost HTTP layer. Append-only sổ cái chi phí (BẤT BIẾN #2).
 *
 * GET  (list)           — @RequirePermission('view-finance','finance'): trả số thô, cần quyền nhạy cảm.
 * POST (create/adjust/void) — @RequirePermission('create','finance'): ghi sổ cái.
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
  @RequirePermission("view-finance", "finance")
  list(@Req() req: AuthRequest, @Query() query: Record<string, string>) {
    const filter = parseOr400(listCostQuerySchema, query);
    const { id, companyId } = req.user;
    return this.cost.list(companyId, id, filter);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("create", "finance")
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    const dto = parseOr400(createCostSchema, body);
    const { id, companyId } = req.user;
    return this.cost.create(companyId, id, dto);
  }

  @Post(":id/adjust")
  @HttpCode(201)
  @RequirePermission("create", "finance")
  async adjust(
    @Req() req: AuthRequest,
    @Param("id") originalId: string,
    @Body() body: unknown,
  ) {
    const dto = parseOr400(adjustCostSchema, body);
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
    @Req() req: AuthRequest,
    @Param("id") originalId: string,
    @Body() body: unknown,
  ) {
    const dto = parseOr400(voidFinanceRecordSchema, body);
    const { id, companyId } = req.user;
    try {
      return await this.cost.void(companyId, id, originalId, { reason: dto.reason });
    } catch (err) {
      mapReplacesUniqueToConflict(err);
      throw err;
    }
  }
}
