import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  webhookEventTypeEnum,
  type CreateWebhookEndpointRequest,
  type CreateWebhookEndpointResponse,
  type CreateWebhookSubscriptionRequest,
  type UpdateWebhookEndpointRequest,
  type WebhookDeliveryDto,
  type WebhookDeliveryStatus,
  type WebhookEndpointDto,
  type WebhookSubscriptionDto,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { validateWebhookUrl, WebhookSsrfError } from "./ssrf/webhook-url-validator";
import { WebhookSigner } from "./webhook-signer";
import {
  WebhookRepository,
  type WebhookDeliveryRow,
  type WebhookEndpointRow,
  type WebhookSubscriptionRow,
} from "./webhooks.repository";

/** Actor đã qua JwtAuthGuard + CompanyGuard + PermissionGuard. companyId LẤY TỪ JWT. */
export interface WebhookActor {
  id: string;
  companyId: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * WebhooksService (AC-6 🔒, TENANT self-service) — CRUD endpoint + subscribe event_type + xem delivery log.
 * Mọi mutation chạy withTenant(actor.companyId) qua repository (RLS) + audit-in-tx.
 *
 * BẤT BIẾN #3: tạo endpoint sinh HMAC secret server-side (WebhookSigner.generateSecret), niêm phong envelope-KMS,
 *   trả plaintext ĐÚNG 1 LẦN. toDto KHÔNG secret/envelope. Cross-tenant id → 404 (không lộ tồn tại).
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly repo: WebhookRepository,
    private readonly signer: WebhookSigner,
    private readonly audit: AuditService,
  ) {}

  async createEndpoint(
    actor: WebhookActor,
    dto: CreateWebhookEndpointRequest,
  ): Promise<CreateWebhookEndpointResponse> {
    // Defense-in-depth: validate SSRF ở tạo (chống lưu endpoint trỏ nội bộ). resolve-then-pin.
    try {
      await validateWebhookUrl(dto.url);
    } catch (err) {
      if (err instanceof WebhookSsrfError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    // App-gen id TRƯỚC INSERT để bind AAD (companyId‖endpoint_id) — KHÔNG dùng DB default gen_random_uuid().
    const endpointId = randomUUID();
    const plaintextSecret = this.signer.generateSecret();
    const envelope = await this.signer.sealSecret(plaintextSecret, {
      companyId: actor.companyId,
      endpointId,
    });

    const row = await this.repo.insertEndpoint(
      actor.companyId,
      {
        id: endpointId,
        url: dto.url,
        description: dto.description ?? null,
        active: dto.active ?? true,
        envelope,
      },
      { audit: this.audit, actorUserId: actor.id, action: "WebhookEndpointCreated" },
    );

    // Reveal-once: secret plaintext trả 1 lần, KHÔNG lưu/log/audit detail.
    return { secret: plaintextSecret, endpoint: this.toEndpointDto(row) };
  }

  async listEndpoints(
    actor: WebhookActor,
    page: { limit?: number; offset?: number },
  ): Promise<WebhookEndpointDto[]> {
    const limit = clampLimit(page.limit);
    const offset = page.offset && page.offset > 0 ? page.offset : 0;
    const rows = await this.repo.listEndpoints(actor.companyId, { limit, offset });
    return rows.map((r) => this.toEndpointDto(r));
  }

  async getEndpoint(actor: WebhookActor, id: string): Promise<WebhookEndpointDto> {
    const row = await this.repo.getEndpoint(actor.companyId, id);
    if (!row) throw new NotFoundException("Webhook endpoint không tồn tại.");
    return this.toEndpointDto(row);
  }

  async updateEndpoint(
    actor: WebhookActor,
    id: string,
    dto: UpdateWebhookEndpointRequest,
  ): Promise<WebhookEndpointDto> {
    const row = await this.repo.updateEndpoint(
      actor.companyId,
      id,
      { description: dto.description, active: dto.active },
      { audit: this.audit, actorUserId: actor.id, action: "WebhookEndpointUpdated" },
    );
    if (!row) throw new NotFoundException("Webhook endpoint không tồn tại.");
    return this.toEndpointDto(row);
  }

  async deleteEndpoint(actor: WebhookActor, id: string): Promise<void> {
    const ok = await this.repo.softDeleteEndpoint(actor.companyId, id, {
      audit: this.audit,
      actorUserId: actor.id,
      action: "WebhookEndpointDeleted",
    });
    if (!ok) throw new NotFoundException("Webhook endpoint không tồn tại.");
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  async subscribe(
    actor: WebhookActor,
    endpointId: string,
    dto: CreateWebhookSubscriptionRequest,
  ): Promise<WebhookSubscriptionDto> {
    // event_type PHẢI ∈ taxonomy (contract enum = nguồn taxonomy align outbox_events.event_type).
    if (!webhookEventTypeEnum.safeParse(dto.eventType).success) {
      throw new BadRequestException("event_type không thuộc taxonomy cho phép.");
    }
    // endpoint PHẢI tồn tại + thuộc tenant (cross-tenant → 404, không lộ tồn tại).
    const endpoint = await this.repo.getEndpoint(actor.companyId, endpointId);
    if (!endpoint) throw new NotFoundException("Webhook endpoint không tồn tại.");

    try {
      const row = await this.repo.insertSubscription(actor.companyId, endpointId, dto.eventType);
      return this.toSubscriptionDto(row);
    } catch (err) {
      // UNIQUE (company,endpoint,event) → trùng đăng ký.
      if (isUniqueViolation(err)) {
        throw new ConflictException("event_type đã được đăng ký cho endpoint này.");
      }
      throw err;
    }
  }

  async listSubscriptions(
    actor: WebhookActor,
    endpointId: string,
  ): Promise<WebhookSubscriptionDto[]> {
    const endpoint = await this.repo.getEndpoint(actor.companyId, endpointId);
    if (!endpoint) throw new NotFoundException("Webhook endpoint không tồn tại.");
    const rows = await this.repo.listSubscriptions(actor.companyId, endpointId);
    return rows.map((r) => this.toSubscriptionDto(r));
  }

  async unsubscribe(actor: WebhookActor, id: string): Promise<void> {
    const ok = await this.repo.deleteSubscription(actor.companyId, id);
    if (!ok) throw new NotFoundException("Subscription không tồn tại.");
  }

  // ── Deliveries (log) ──────────────────────────────────────────────────────

  async listDeliveries(
    actor: WebhookActor,
    endpointId: string,
    page: { limit?: number; offset?: number },
  ): Promise<WebhookDeliveryDto[]> {
    const endpoint = await this.repo.getEndpoint(actor.companyId, endpointId);
    if (!endpoint) throw new NotFoundException("Webhook endpoint không tồn tại.");
    const limit = clampLimit(page.limit);
    const offset = page.offset && page.offset > 0 ? page.offset : 0;
    const rows = await this.repo.listDeliveries(actor.companyId, endpointId, { limit, offset });
    return rows.map((r) => this.toDeliveryDto(r));
  }

  // ── DTO mappers (KHÔNG secret/envelope) ──────────────────────────────────

  private toEndpointDto(row: WebhookEndpointRow): WebhookEndpointDto {
    return {
      id: row.id,
      url: row.url,
      description: row.description,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toSubscriptionDto(row: WebhookSubscriptionRow): WebhookSubscriptionDto {
    return {
      id: row.id,
      endpointId: row.endpointId,
      eventType: row.eventType as WebhookSubscriptionDto["eventType"],
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDeliveryDto(row: WebhookDeliveryRow): WebhookDeliveryDto {
    return {
      id: row.id,
      endpointId: row.endpointId,
      eventType: row.eventType,
      status: row.status as WebhookDeliveryStatus,
      attempts: row.attempts,
      responseCode: row.responseCode,
      lastError: row.lastError,
      scheduledAt: row.scheduledAt.toISOString(),
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

/** Postgres unique violation = SQLSTATE 23505. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}
