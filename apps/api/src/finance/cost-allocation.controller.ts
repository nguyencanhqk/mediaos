import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { ZodError } from "zod";
import { allocateCostSchema } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import type { AuthRequest } from "../permission/guards/jwt-auth.guard";
import { CostAllocationService } from "./cost-allocation.service";

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
 * G13CTL — Cost Allocation HTTP layer. POST :id/allocate (re-allocate trong service).
 *
 * Prefix 'finance/cost' (cùng prefix với CostController, route khác nên không xung đột).
 * @RequirePermission('create','finance') — fail-closed. companyId từ JWT.
 * Trả {allocationRunId, allocations, warnings} theo allocationResultSchema.
 */
@Controller("finance/cost")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class CostAllocationController {
  constructor(private readonly allocation: CostAllocationService) {}

  @Post(":id/allocate")
  @HttpCode(201)
  @RequirePermission("create", "finance")
  async allocate(
    @Req() req: AuthRequest,
    @Param("id") costRecordId: string,
    @Body() body: unknown,
  ) {
    const dto = parseOr400(allocateCostSchema, body);
    const { id, companyId } = req.user;
    return this.allocation.allocate(companyId, id, costRecordId, dto);
  }
}
