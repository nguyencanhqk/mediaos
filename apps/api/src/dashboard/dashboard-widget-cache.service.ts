import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { DASH_WIDGET_MIN_REFRESH_MS } from "./dashboard-widget-data.const";
import type { WidgetCacheIdentity } from "./dashboard-widget-data.types";

/** 1 dòng cache active (deleted_at IS NULL) đọc lại từ dashboard_widget_cache. */
interface CacheRow {
  data: Record<string, unknown>;
  status: string;
  generatedAt: Date;
  expiresAt: Date;
}

/** Tham số ghi cache (đã mask + trong-scope — trách nhiệm ép ở handler/runner, KHÔNG ở tầng này). */
export interface CacheWriteInput {
  companyId: string;
  widgetId: string;
  dashboardType: string;
  cacheKey: string;
  identity: WidgetCacheIdentity;
  userId: string | null;
  data: Record<string, unknown>;
  generatedAt: Date;
}

/**
 * S4-DASH-BE-2 — DashboardWidgetCacheService: đọc/ghi dashboard_widget_cache (DB-07 §8.3, mig 0482).
 *
 * BẤT BIẾN #1: mọi thao tác đi qua db.withTenant(companyId) (RLS+FORCE) — company_id vẫn tường minh trong
 *   WHERE/INSERT (belt-and-suspenders). BẤT BIẾN #2: ghi = INSERT/UPDATE upsert (uq company_id,cache_key active),
 *   TUYỆT ĐỐI KHÔNG DELETE — invalidation = UPDATE deleted_at (app role KHÔNG có quyền DELETE, mig 0482).
 *
 * cache_key = company + dashboard_type + widget_code + (userId khi per-user) + discriminator (§8.3 rule 3).
 * Việc quyết định key kèm userId hay không (chống rò chéo người xem) do handler (WidgetCacheIdentity.shareScope)
 * — tầng này chỉ COMPOSE key + đọc-tươi/ghi. Cache CHỈ chứa data ĐÃ MASK + TRONG-SCOPE (mig 0482 header §29-30
 * chuyển nghĩa vụ sang service; BACKEND-10 §9.7 step6). Re-verify permission người đọc do runner làm TRƯỚC serve.
 */
@Injectable()
export class DashboardWidgetCacheService {
  private readonly logger = new Logger(DashboardWidgetCacheService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Compose cache_key ổn định. per-user ⇒ kèm 'u:{userId}' (2 người khác scope ⇒ key KHÁC ⇒ KHÔNG dùng chung).
   * company-shared ⇒ 'co' (chia sẻ). discriminator (vd project_id) nối cuối. Cắt ≤255 (varchar cache_key).
   */
  buildCacheKey(
    dashboardType: string,
    widgetCode: string,
    identity: WidgetCacheIdentity,
    userId: string,
  ): string {
    const scopeSeg = identity.shareScope === "user" ? `u:${userId}` : "co";
    const disc = identity.keyDiscriminator ? `:${identity.keyDiscriminator}` : "";
    return `${dashboardType}:${widgetCode}:${scopeSeg}${disc}`.slice(0, 255);
  }

  /**
   * Có nên PHỤC VỤ cache thay vì regenerate? true khi row còn tươi (status Fresh + chưa hết hạn) VÀ
   * (không refresh HOẶC refresh nhưng trong min-interval — chống cache-busting đập source). row hết hạn ⇒ regen.
   */
  private shouldServe(row: CacheRow | null, refresh: boolean, now: number): row is CacheRow {
    if (!row) return false;
    if (row.status !== "Fresh" || row.expiresAt.getTime() <= now) return false;
    if (!refresh) return true;
    return now - row.generatedAt.getTime() < DASH_WIDGET_MIN_REFRESH_MS;
  }

  /**
   * Đọc dòng cache active (deleted_at IS NULL) theo (company, key). Trả null nếu vắng. KHÔNG lọc theo trạng
   * thái tươi ở đây (caller quyết serve/regen qua shouldServe) — nhưng có cập nhật last_accessed_at khi hit.
   */
  async readActive(companyId: string, cacheKey: string): Promise<CacheRow | null> {
    return this.db.withTenant(companyId, async (tx) => this.readActiveTx(tx, companyId, cacheKey));
  }

  private async readActiveTx(
    tx: TenantTx,
    companyId: string,
    cacheKey: string,
  ): Promise<CacheRow | null> {
    const res = await tx.execute(sql`
      SELECT data, status, generated_at, expires_at
      FROM dashboard_widget_cache
      WHERE company_id = ${companyId} AND cache_key = ${cacheKey} AND deleted_at IS NULL
      LIMIT 1
    `);
    const row = res.rows[0] as
      | { data: Record<string, unknown>; status: string; generated_at: string; expires_at: string }
      | undefined;
    if (!row) return null;
    return {
      data: row.data,
      status: row.status,
      generatedAt: new Date(row.generated_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  /**
   * Trả cache HỢP LỆ để serve (đã áp min-interval refresh) HOẶC null (caller regen). Khi hit: cập nhật
   * last_accessed_at (UPDATE, không DELETE). generatedAt/expiresAt trả về cho meta.cache + last_updated_at.
   */
  async getServable(
    companyId: string,
    cacheKey: string,
    refresh: boolean,
  ): Promise<{ data: Record<string, unknown>; generatedAt: Date; expiresAt: Date } | null> {
    return this.db.withTenant(companyId, async (tx) => {
      const row = await this.readActiveTx(tx, companyId, cacheKey);
      if (!this.shouldServe(row, refresh, Date.now())) return null;
      // touch last_accessed_at — UPDATE (append-only invariant: KHÔNG DELETE).
      await tx.execute(sql`
        UPDATE dashboard_widget_cache
        SET last_accessed_at = now()
        WHERE company_id = ${companyId} AND cache_key = ${cacheKey} AND deleted_at IS NULL
      `);
      return { data: row.data, generatedAt: row.generatedAt, expiresAt: row.expiresAt };
    });
  }

  /**
   * Upsert cache (INSERT hoặc UPDATE trên uq company_id,cache_key WHERE deleted_at IS NULL) — KHÔNG DELETE.
   * data PHẢI đã mask + trong-scope (caller đảm bảo). Trả expiresAt để runner dựng meta.cache.
   */
  async upsert(input: CacheWriteInput): Promise<{ expiresAt: Date }> {
    const expiresAt = new Date(input.generatedAt.getTime() + input.identity.ttlSeconds * 1000);
    await this.db.withTenant(input.companyId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO dashboard_widget_cache
          (company_id, widget_id, dashboard_type, user_id, cache_scope, scope_reference_id,
           cache_key, data, status, generated_at, expires_at, last_accessed_at)
        VALUES
          (${input.companyId}, ${input.widgetId}, ${input.dashboardType}, ${input.userId},
           ${input.identity.cacheScope}, ${input.identity.scopeReferenceId}, ${input.cacheKey},
           ${sql`${JSON.stringify(input.data)}::jsonb`}, 'Fresh', ${input.generatedAt.toISOString()},
           ${expiresAt.toISOString()}, now())
        ON CONFLICT (company_id, cache_key) WHERE deleted_at IS NULL
        DO UPDATE SET
          data = EXCLUDED.data,
          status = 'Fresh',
          generated_at = EXCLUDED.generated_at,
          expires_at = EXCLUDED.expires_at,
          last_accessed_at = now(),
          updated_at = now()
      `);
    });
    return { expiresAt };
  }

  /**
   * Resolve widget_id GLOBAL (company_id IS NULL) theo widget_code — catalog seed toàn cục (mig 0484). Cache
   * in-process (catalog TĨNH). RLS nullable-tenant cho ĐỌC row global trong withTenant (USING company_id=GUC OR
   * IS NULL). Thiếu ⇒ fail-loud (catalog chưa seed).
   */
  private readonly widgetIdCache = new Map<string, string>();

  async resolveWidgetId(companyId: string, widgetCode: string): Promise<string> {
    const cached = this.widgetIdCache.get(widgetCode);
    if (cached) return cached;
    const id = await this.db.withTenant(companyId, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id FROM dashboard_widgets
        WHERE widget_code = ${widgetCode} AND company_id IS NULL AND deleted_at IS NULL
        LIMIT 1
      `);
      const row = res.rows[0] as { id: string } | undefined;
      return row?.id ?? null;
    });
    if (!id) {
      this.logger.error(
        `widget catalog thiếu global widget_code=${widgetCode} (mig 0484 chưa chạy?)`,
      );
      throw new Error(`DASH widget catalog missing global widget: ${widgetCode}`);
    }
    this.widgetIdCache.set(widgetCode, id);
    return id;
  }
}
