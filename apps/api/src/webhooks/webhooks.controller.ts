import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import {
  createWebhookEndpointSchema,
  createWebhookSubscriptionSchema,
  updateWebhookEndpointSchema,
  type CreateWebhookEndpointRequest,
  type CreateWebhookSubscriptionRequest,
  type UpdateWebhookEndpointRequest,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { WebhooksService } from "./webhooks.service";

/** Request sau khi JwtAuthGuard + CompanyGuard set req.user. companyId LẤY TỪ JWT (KHÔNG param/body). */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

const RESOURCE = "webhook";

/**
 * WebhooksController (AC-6 🔒, TENANT self-service) — endpoint CRUD + subscribe + delivery log.
 *   manage:webhook (is_sensitive — khai ở CẢ decorator lẫn seed, chống *:* wildcard bypass) cho mutate.
 *   view:webhook cho đọc. companyId LẤY TỪ req.user (JWT) — body/param companyId BỎ QUA (không cross-tenant).
 *   KHÔNG requiresReauth (tenant self-service, không cross-tenant reveal — tránh trap G12-4/AC-7).
 *
 * BẤT BIẾN #3: POST endpoint trả secret plaintext ĐÚNG 1 LẦN; list/get KHÔNG trả secret material.
 */
@Controller("webhooks")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  // ── Endpoints ──────────────────────────────────────────────────────────────

  /** Tạo endpoint — trả { secret, endpoint }. secret chỉ hiển thị 1 lần (client tự lưu). */
  @Post("endpoints")
  @RequirePermission("manage", RESOURCE, { isSensitive: true })
  createEndpoint(@Req() req: AuthenticatedRequest, @Body() dto: CreateWebhookEndpointRequest) {
    const body = createWebhookEndpointSchema.parse(dto);
    return this.webhooks.createEndpoint(req.user, body);
  }

  /** Danh sách endpoint của tenant (DTO an toàn — KHÔNG secret/envelope). Pagination. */
  @Get("endpoints")
  @RequirePermission("view", RESOURCE, { isSensitive: true })
  listEndpoints(
    @Req() req: AuthenticatedRequest,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.webhooks.listEndpoints(req.user, {
      limit: parsePositiveInt(limit),
      offset: parsePositiveInt(offset),
    });
  }

  @Get("endpoints/:id")
  @RequirePermission("view", RESOURCE, { isSensitive: true })
  getEndpoint(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.webhooks.getEndpoint(req.user, id);
  }

  @Put("endpoints/:id")
  @RequirePermission("manage", RESOURCE, { isSensitive: true })
  updateEndpoint(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookEndpointRequest,
  ) {
    const body = updateWebhookEndpointSchema.parse(dto);
    return this.webhooks.updateEndpoint(req.user, id, body);
  }

  @Delete("endpoints/:id")
  @HttpCode(204)
  @RequirePermission("manage", RESOURCE, { isSensitive: true })
  async deleteEndpoint(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    await this.webhooks.deleteEndpoint(req.user, id);
  }

  // ── Subscriptions ────────────────────────────────────────────────────────

  @Post("endpoints/:id/subscriptions")
  @RequirePermission("manage", RESOURCE, { isSensitive: true })
  subscribe(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateWebhookSubscriptionRequest,
  ) {
    const body = createWebhookSubscriptionSchema.parse(dto);
    return this.webhooks.subscribe(req.user, id, body);
  }

  @Get("endpoints/:id/subscriptions")
  @RequirePermission("view", RESOURCE, { isSensitive: true })
  listSubscriptions(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.webhooks.listSubscriptions(req.user, id);
  }

  @Delete("subscriptions/:id")
  @HttpCode(204)
  @RequirePermission("manage", RESOURCE, { isSensitive: true })
  async unsubscribe(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    await this.webhooks.unsubscribe(req.user, id);
  }

  // ── Deliveries (log) ─────────────────────────────────────────────────────

  @Get("endpoints/:id/deliveries")
  @RequirePermission("view", RESOURCE, { isSensitive: true })
  listDeliveries(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.webhooks.listDeliveries(req.user, id, {
      limit: parsePositiveInt(limit),
      offset: parsePositiveInt(offset),
    });
  }
}

/** Parse query int >0, undefined nếu vắng/không hợp lệ (service tự clamp/default). */
function parsePositiveInt(v?: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
