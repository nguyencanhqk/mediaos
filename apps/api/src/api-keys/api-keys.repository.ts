import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { apiKeys, apiKeyUsages } from "../db/schema";
import { AuditService } from "../events/audit.service";
import type { ApiKeyAuthLookup, ApiKeyAuthRecord } from "./guards/api-key-auth.guard";

/** Vết audit khi tạo/revoke — ghi CÙNG tx với mutation (rollback-safe). KHÔNG token material. */
export interface ApiKeyAuditMeta {
  audit: AuditService;
  actorUserId: string;
  action: string;
}

/** Hàng api_keys ở tầng service (KHÔNG token_hash — service không cần hash sau khi tạo). */
export interface ApiKeyRow {
  id: string;
  companyId: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  scopePermissionIds: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/** Input INSERT 1 PAT (hash đã tính ở service — repository KHÔNG thấy plaintext). */
export interface InsertApiKeyInput {
  userId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopePermissionIds: string[];
  expiresAt: Date | null;
}

/** Debounce touch last_used_at: chỉ UPDATE khi cách lần trước > ngưỡng (tránh UPDATE storm bảng security). */
const LAST_USED_DEBOUNCE_MS = 60_000;

/**
 * ApiKeyRepository — DB access cho AC-5 PAT. Tách rõ 2 đường:
 *   • Auth-path (ApiKeyAuthLookup): resolve theo token_hash qua SECURITY DEFINER function (KHÔNG cần tenant
 *     context — token không mang company_id). usage log + touch chạy withTenant(company_id của key).
 *   • CRUD self-service: insert/list/revoke chạy withTenant(actor.companyId) (RLS scope).
 *
 * Mọi data-access đi qua withTenant trừ findByTokenHash (escape-hatch HẸP qua function, mig 0310).
 */
@Injectable()
export class ApiKeyRepository implements ApiKeyAuthLookup {
  constructor(private readonly db: DatabaseService) {}

  // ── Auth-path (ApiKeyAuthLookup) ─────────────────────────────────────────────

  async findByTokenHash(tokenHash: string): Promise<ApiKeyAuthRecord | null> {
    // SECURITY DEFINER function: cross-tenant resolve theo token_hash (DUY NHẤT), trả ĐÚNG cột cần verify.
    // Chạy NGOÀI withTenant (không biết company trước). db pool thường (function bypass RLS, không SELECT bảng).
    const rows = await this.db.runRaw<{
      id: string;
      company_id: string;
      user_id: string;
      token_hash: string;
      scope_permission_ids: string[];
      expires_at: Date | string | null;
      revoked_at: Date | string | null;
      last_used_at: Date | string | null;
    }>(sql`SELECT * FROM resolve_api_key_by_hash(${tokenHash})`);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      companyId: r.company_id,
      tokenHash: r.token_hash,
      scopePermissionIds: r.scope_permission_ids ?? [],
      // runRaw qua function RETURNS TABLE → pg trả timestamptz dạng string (không qua type-parser của
      // drizzle column). Chuẩn hoá về Date|null để guard so .getTime() an toàn (root-cause của 500).
      expiresAt: toDate(r.expires_at),
      revokedAt: toDate(r.revoked_at),
      lastUsedAt: toDate(r.last_used_at),
    };
  }

  /** Ghi 1 dòng api_key_usages (append-only). Chạy withTenant(company của key). */
  async recordUsage(
    record: ApiKeyAuthRecord,
    route: string | null,
    ip: string | null,
  ): Promise<void> {
    await this.db.withTenant(record.companyId, async (tx) => {
      await tx.insert(apiKeyUsages).values({ apiKeyId: record.id, route, ip });
    });
  }

  /** Map scope_permission_ids → "action:resourceType" keys (permissions catalog GLOBAL no-RLS). */
  async resolveScopeKeys(permissionIds: string[]): Promise<string[]> {
    if (permissionIds.length === 0) return [];
    const rows = await this.db.runRaw<{ action: string; resource_type: string }>(
      sql`SELECT action, resource_type FROM permissions WHERE id IN (${sql.join(
        permissionIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    return rows.map((r) => `${r.action}:${r.resource_type}`);
  }

  /** Debounced touch last_used_at — chỉ UPDATE khi cách lần dùng trước > LAST_USED_DEBOUNCE_MS. */
  async touchLastUsed(record: ApiKeyAuthRecord): Promise<void> {
    const now = Date.now();
    const last = record.lastUsedAt ? record.lastUsedAt.getTime() : 0;
    if (now - last < LAST_USED_DEBOUNCE_MS) return;
    await this.db.withTenant(record.companyId, async (tx) => {
      await tx
        .update(apiKeys)
        .set({ lastUsedAt: new Date(now) })
        .where(eq(apiKeys.id, record.id));
    });
  }

  // ── CRUD self-service (withTenant) ───────────────────────────────────────────

  /** Tập permission catalog id TỒN TẠI trong `ids` (lọc id không có trong catalog). */
  async catalogPermissionIdsExisting(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    // permissions là catalog GLOBAL (no-RLS) → đọc trực tiếp, không cần tenant context.
    const rows = await this.db.runRaw<{ id: string }>(
      sql`SELECT id FROM permissions WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    return rows.map((r) => r.id);
  }

  async insertKey(
    companyId: string,
    input: InsertApiKeyInput,
    auditMeta?: ApiKeyAuditMeta,
  ): Promise<ApiKeyRow> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .insert(apiKeys)
        .values({
          userId: input.userId,
          name: input.name,
          tokenPrefix: input.tokenPrefix,
          tokenHash: input.tokenHash,
          scopePermissionIds: input.scopePermissionIds,
          expiresAt: input.expiresAt,
        })
        .returning();
      // Audit-in-tx (CÙNG commit/rollback — CLAUDE.md §8). KHÔNG ghi token_hash/plaintext.
      if (auditMeta) {
        await auditMeta.audit.record(tx, {
          action: auditMeta.action,
          objectType: "api_key",
          objectId: row.id,
          actorUserId: auditMeta.actorUserId,
          after: {
            name: row.name,
            tokenPrefix: row.tokenPrefix,
            scopePermissionIds: row.scopePermissionIds,
            expiresAt: row.expiresAt,
          },
        });
      }
      return this.toRow(row);
    });
  }

  async listKeys(companyId: string): Promise<ApiKeyRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx.select().from(apiKeys).where(eq(apiKeys.companyId, companyId));
      return rows.map((r) => this.toRow(r));
    });
  }

  /** Set revoked_at (idempotent: giữ revoked_at cũ nếu đã revoke). Trả null nếu key vắng/chéo tenant. */
  async revokeKey(
    companyId: string,
    id: string,
    auditMeta?: ApiKeyAuditMeta,
  ): Promise<ApiKeyRow | null> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .update(apiKeys)
        .set({ revokedAt: sql`COALESCE(${apiKeys.revokedAt}, now())` })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.companyId, companyId)))
        .returning();
      if (!row) return null;
      if (auditMeta) {
        await auditMeta.audit.record(tx, {
          action: auditMeta.action,
          objectType: "api_key",
          objectId: row.id,
          actorUserId: auditMeta.actorUserId,
          after: { revokedAt: row.revokedAt },
        });
      }
      return this.toRow(row);
    });
  }

  private toRow(row: typeof apiKeys.$inferSelect): ApiKeyRow {
    return {
      id: row.id,
      companyId: row.companyId,
      userId: row.userId,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      scopePermissionIds: row.scopePermissionIds ?? [],
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    };
  }
}

/** Chuẩn hoá timestamptz (Date | ISO string | null) về Date|null. Date không hợp lệ → null (fail-safe). */
function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
