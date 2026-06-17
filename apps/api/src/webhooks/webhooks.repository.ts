import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import {
  webhookDeliveries,
  webhookEndpoints,
  webhookEventSubscriptions,
} from "../db/schema";
import { AuditService } from "../events/audit.service";
import type { EncryptedColumns } from "../crypto/secret-encryption.types";

/** Vết audit ghi CÙNG tx với mutation (rollback-safe). KHÔNG secret/envelope material. */
export interface WebhookAuditMeta {
  audit: AuditService;
  actorUserId: string;
  action: string;
}

/**
 * Hàng endpoint ở tầng service — chia 2 view:
 *   • WebhookEndpointRow: an toàn (KHÔNG cột envelope) — dùng dựng DTO.
 *   • WebhookEndpointSecretRow: + cột envelope — CHỈ trả cho đường ký (signer), KHÔNG ra DTO/response/log.
 */
export interface WebhookEndpointRow {
  id: string;
  companyId: string;
  url: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
}

export interface WebhookEndpointSecretRow extends WebhookEndpointRow, EncryptedColumns {}

export interface WebhookSubscriptionRow {
  id: string;
  endpointId: string;
  eventType: string;
  createdAt: Date;
}

export interface WebhookDeliveryRow {
  id: string;
  endpointId: string;
  eventType: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  scheduledAt: Date;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface InsertEndpointInput {
  /** App-gen UUID TRƯỚC INSERT để bind AAD (companyId‖endpoint_id) — KHÔNG dùng DB default. */
  id: string;
  url: string;
  description: string | null;
  active: boolean;
  envelope: EncryptedColumns;
}

/**
 * WebhookRepository (AC-6) — mọi data-access qua withTenant(actor.companyId) (RLS). KHÔNG SELECT * ở
 * đường DTO (chống rò cột envelope). Audit-in-tx (CÙNG commit/rollback). object_type webhook_endpoint/delivery.
 */
@Injectable()
export class WebhookRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Cột AN TOÀN cho DTO (KHÔNG envelope) — explicit projection, KHÔNG select(). */
  private readonly safeCols = {
    id: webhookEndpoints.id,
    companyId: webhookEndpoints.companyId,
    url: webhookEndpoints.url,
    description: webhookEndpoints.description,
    active: webhookEndpoints.active,
    createdAt: webhookEndpoints.createdAt,
  };

  async insertEndpoint(
    companyId: string,
    input: InsertEndpointInput,
    auditMeta?: WebhookAuditMeta,
  ): Promise<WebhookEndpointRow> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .insert(webhookEndpoints)
        .values({
          id: input.id,
          url: input.url,
          description: input.description,
          active: input.active,
          secretCiphertext: input.envelope.secretCiphertext,
          encryptedDek: input.envelope.encryptedDek,
          dekKeyVersion: input.envelope.dekKeyVersion,
          kmsKeyId: input.envelope.kmsKeyId,
          ivNonce: input.envelope.ivNonce,
          authTag: input.envelope.authTag,
          encAlgo: input.envelope.encAlgo,
        })
        .returning(this.safeCols);
      if (auditMeta) {
        await auditMeta.audit.record(tx, {
          action: auditMeta.action,
          objectType: "webhook_endpoint",
          objectId: row.id,
          actorUserId: auditMeta.actorUserId,
          // KHÔNG ghi secret/envelope — chỉ metadata công khai.
          after: { url: row.url, description: row.description, active: row.active },
        });
      }
      return this.toEndpointRow(row);
    });
  }

  async listEndpoints(
    companyId: string,
    opts: { limit: number; offset: number },
  ): Promise<WebhookEndpointRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select(this.safeCols)
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.companyId, companyId),
            sql`${webhookEndpoints.deletedAt} IS NULL`,
          ),
        )
        .orderBy(sql`${webhookEndpoints.createdAt} DESC`)
        .limit(opts.limit)
        .offset(opts.offset);
      return rows.map((r) => this.toEndpointRow(r));
    });
  }

  async getEndpoint(companyId: string, id: string): Promise<WebhookEndpointRow | null> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select(this.safeCols)
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.companyId, companyId),
            sql`${webhookEndpoints.deletedAt} IS NULL`,
          ),
        );
      return row ? this.toEndpointRow(row) : null;
    });
  }

  /** Đường KÝ ONLY — trả cột envelope. KHÔNG bao giờ dùng để dựng DTO/response. */
  async getEndpointWithSecret(
    companyId: string,
    id: string,
  ): Promise<WebhookEndpointSecretRow | null> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.companyId, companyId),
            sql`${webhookEndpoints.deletedAt} IS NULL`,
          ),
        );
      if (!row) return null;
      return {
        id: row.id,
        companyId: row.companyId,
        url: row.url,
        description: row.description,
        active: row.active,
        createdAt: row.createdAt,
        secretCiphertext: row.secretCiphertext,
        encryptedDek: row.encryptedDek,
        dekKeyVersion: row.dekKeyVersion,
        kmsKeyId: row.kmsKeyId,
        ivNonce: row.ivNonce,
        authTag: row.authTag,
        encAlgo: row.encAlgo,
      };
    });
  }

  async updateEndpoint(
    companyId: string,
    id: string,
    patch: { description?: string | null; active?: boolean },
    auditMeta?: WebhookAuditMeta,
  ): Promise<WebhookEndpointRow | null> {
    return this.db.withTenant(companyId, async (tx) => {
      const set: Record<string, unknown> = {};
      if (patch.description !== undefined) set.description = patch.description;
      if (patch.active !== undefined) set.active = patch.active;
      if (Object.keys(set).length === 0) {
        const [cur] = await tx
          .select(this.safeCols)
          .from(webhookEndpoints)
          .where(
            and(
              eq(webhookEndpoints.id, id),
              eq(webhookEndpoints.companyId, companyId),
              sql`${webhookEndpoints.deletedAt} IS NULL`,
            ),
          );
        return cur ? this.toEndpointRow(cur) : null;
      }
      const [row] = await tx
        .update(webhookEndpoints)
        .set(set)
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.companyId, companyId),
            sql`${webhookEndpoints.deletedAt} IS NULL`,
          ),
        )
        .returning(this.safeCols);
      if (!row) return null;
      if (auditMeta) {
        await auditMeta.audit.record(tx, {
          action: auditMeta.action,
          objectType: "webhook_endpoint",
          objectId: row.id,
          actorUserId: auditMeta.actorUserId,
          after: { url: row.url, description: row.description, active: row.active },
        });
      }
      return this.toEndpointRow(row);
    });
  }

  /** Soft-delete (deleted_at). Trả null nếu vắng/chéo tenant. */
  async softDeleteEndpoint(
    companyId: string,
    id: string,
    auditMeta?: WebhookAuditMeta,
  ): Promise<boolean> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .update(webhookEndpoints)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.companyId, companyId),
            sql`${webhookEndpoints.deletedAt} IS NULL`,
          ),
        )
        .returning({ id: webhookEndpoints.id });
      if (!row) return false;
      if (auditMeta) {
        await auditMeta.audit.record(tx, {
          action: auditMeta.action,
          objectType: "webhook_endpoint",
          objectId: row.id,
          actorUserId: auditMeta.actorUserId,
          after: { deleted: true },
        });
      }
      return true;
    });
  }

  // ── Subscriptions ────────────────────────────────────────────────────────────

  async insertSubscription(
    companyId: string,
    endpointId: string,
    eventType: string,
  ): Promise<WebhookSubscriptionRow> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .insert(webhookEventSubscriptions)
        .values({ endpointId, eventType })
        .returning({
          id: webhookEventSubscriptions.id,
          endpointId: webhookEventSubscriptions.endpointId,
          eventType: webhookEventSubscriptions.eventType,
          createdAt: webhookEventSubscriptions.createdAt,
        });
      return row;
    });
  }

  async listSubscriptions(
    companyId: string,
    endpointId: string,
  ): Promise<WebhookSubscriptionRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      return tx
        .select({
          id: webhookEventSubscriptions.id,
          endpointId: webhookEventSubscriptions.endpointId,
          eventType: webhookEventSubscriptions.eventType,
          createdAt: webhookEventSubscriptions.createdAt,
        })
        .from(webhookEventSubscriptions)
        .where(
          and(
            eq(webhookEventSubscriptions.companyId, companyId),
            eq(webhookEventSubscriptions.endpointId, endpointId),
          ),
        );
    });
  }

  async deleteSubscription(companyId: string, id: string): Promise<boolean> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .delete(webhookEventSubscriptions)
        .where(
          and(
            eq(webhookEventSubscriptions.id, id),
            eq(webhookEventSubscriptions.companyId, companyId),
          ),
        )
        .returning({ id: webhookEventSubscriptions.id });
      return Boolean(row);
    });
  }

  // ── Deliveries ────────────────────────────────────────────────────────────────

  async insertDelivery(
    companyId: string,
    endpointId: string,
    eventType: string,
  ): Promise<WebhookDeliveryRow> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .insert(webhookDeliveries)
        .values({ endpointId, eventType, status: "pending" })
        .returning(this.deliveryCols());
      return row;
    });
  }

  async listDeliveries(
    companyId: string,
    endpointId: string,
    opts: { limit: number; offset: number },
  ): Promise<WebhookDeliveryRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      return tx
        .select(this.deliveryCols())
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.companyId, companyId),
            eq(webhookDeliveries.endpointId, endpointId),
          ),
        )
        .orderBy(sql`${webhookDeliveries.createdAt} DESC`)
        .limit(opts.limit)
        .offset(opts.offset);
    });
  }

  private deliveryCols() {
    return {
      id: webhookDeliveries.id,
      endpointId: webhookDeliveries.endpointId,
      eventType: webhookDeliveries.eventType,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      responseCode: webhookDeliveries.responseCode,
      lastError: webhookDeliveries.lastError,
      scheduledAt: webhookDeliveries.scheduledAt,
      deliveredAt: webhookDeliveries.deliveredAt,
      createdAt: webhookDeliveries.createdAt,
    };
  }

  private toEndpointRow(row: {
    id: string;
    companyId: string;
    url: string;
    description: string | null;
    active: boolean;
    createdAt: Date;
  }): WebhookEndpointRow {
    return {
      id: row.id,
      companyId: row.companyId,
      url: row.url,
      description: row.description,
      active: row.active,
      createdAt: row.createdAt,
    };
  }
}
