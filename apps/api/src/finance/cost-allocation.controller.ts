import {
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
import type { Request } from "express";
import { allocateCostSchema } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { CostAllocationService } from "./cost-allocation.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
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
    @Req() req: AuthenticatedRequest,
    @Param("id") costRecordId: string,
    @Body() body: unknown,
  ) {
    const dto = allocateCostSchema.parse(body);
    const { id, companyId } = req.user;
    return this.allocation.allocate(companyId, id, costRecordId, dto);
  }
}
