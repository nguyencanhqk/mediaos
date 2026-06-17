import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { ZodError } from "zod";
import { listCompaniesQuerySchema } from "@mediaos/contracts";
import type { Request } from "express";
import { OperatorOnly } from "../auth/operator-only.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { PlatformCompanyService } from "./platform-company.service";
import { CreateCompanyDto, PlatformSetSubscriptionDto, UpdateCompanyDto } from "./platform.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

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
 * Platform workspace/company management (G16-3) — tầng PLATFORM-admin (cao hơn company-admin). ADR-0017.
 * Mọi route gated PermissionGuard + quyền `*:platform-company`/`platform-subscription` (is_sensitive) ⇒
 * CHỈ role platform-admin (grant tường minh non-wildcard) qua được. KHÔNG hard-delete (suspend = status).
 */
@Controller("admin/platform/companies")
@OperatorOnly()
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class PlatformCompanyController {
  constructor(private readonly companies: PlatformCompanyService) {}

  /** List mọi workspace (escape-hatch — thao tác duy nhất chéo tenant). */
  @Get()
  @RequirePermission("view", "platform-company", { isSensitive: true })
  list(@Query() query: Record<string, string>) {
    return this.companies.list(parseOr400(listCompaniesQuerySchema, query));
  }

  @Get(":id")
  @RequirePermission("view", "platform-company", { isSensitive: true })
  getOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.companies.getOne(id);
  }

  /** Tạo workspace mới (+ provision template + gán gói) — ATOMIC 1 tx. */
  @Post()
  @RequirePermission("manage", "platform-company", { isSensitive: true })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCompanyDto) {
    return this.companies.create(req.user, dto);
  }

  /** Đình chỉ workspace (status='suspended'; KHÔNG xoá cứng). */
  @Post(":id/suspend")
  @RequirePermission("manage", "platform-company", { isSensitive: true })
  suspend(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.companies.suspend(req.user, id);
  }

  /** Cấu hình workspace (name/timezone/currency/language/logo). */
  @Patch(":id")
  @RequirePermission("manage", "platform-company", { isSensitive: true })
  configure(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.configure(req.user, id, dto);
  }

  /** Đặt gói cho 1 công ty (cross-tenant, withTenant target). */
  @Put(":id/subscription")
  @RequirePermission("manage", "platform-subscription", { isSensitive: true })
  setSubscription(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PlatformSetSubscriptionDto,
  ) {
    return this.companies.setSubscription(req.user, id, dto);
  }
}
