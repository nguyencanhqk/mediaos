import { BadRequestException, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { usageQuerySchema, type TenantUsageResponse, type UsageQuery } from "@mediaos/contracts";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { UsageService } from "./usage.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

function parseQueryOr400(input: unknown): UsageQuery {
  try {
    return usageQuerySchema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) throw new BadRequestException(err.errors);
    throw err;
  }
}

/**
 * CS-7 UsageController — GET /tenant/usage (tenant self, RLS enforced).
 *
 * Guard: view:usage (resource_type='company', is_sensitive=false — mig 0370).
 * companyId LẤY TỪ JWT (req.user.companyId — KHÔNG từ client, không cross-tenant).
 * is_sensitive=false: không cần step-up, không require wildcard override — company-admin đủ.
 */
@Controller()
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get("tenant/usage")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "usage")
  async getTenantUsage(
    @Req() req: AuthenticatedRequest,
    @Query() rawQuery: unknown,
  ): Promise<TenantUsageResponse> {
    const query = parseQueryOr400(rawQuery);
    return this.usage.getTenantUsage(req.user.companyId, query);
  }
}
