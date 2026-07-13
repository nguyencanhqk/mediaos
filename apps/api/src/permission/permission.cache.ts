import { Injectable, Logger } from "@nestjs/common";
import type {
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  ObjectGrant,
  ObjectGrantBatch,
  PermissionCatalogEntry,
} from "./permission.types";
import { ValkeyService } from "./valkey.service";

const CACHE_TTL_SEC = 300; // 5 minutes (plan §3b)

type SerializedGrant = Omit<CompanyRoleGrant, "expiresAt"> & { expiresAt: string | null };

/**
 * CachedPermissionRepository — transparent Valkey cache layer over IPermissionRepository.
 *
 * Cache keys (plan §7 permission-matrix-spec.md):
 *   perm:cap:{companyId}:{userId}        → CompanyRoleGrant[] (with expiresAt serialized as ISO)
 *   perm:obj:{companyId}:{userId}:{type}:{id} → ObjectGrant[]
 *
 * The service still re-checks expiresAt per can() call — cache just avoids repeated DB queries.
 * Invalidation via invalidateUser() is called when permission.changed event fires (<100ms target).
 */
@Injectable()
export class CachedPermissionRepository implements IPermissionRepository {
  private readonly logger = new Logger(CachedPermissionRepository.name);

  constructor(
    private readonly inner: IPermissionRepository,
    private readonly valkey: ValkeyService,
  ) {}

  private capKey(companyId: string, userId: string): string {
    return `perm:cap:${companyId}:${userId}`;
  }

  private objKey(
    companyId: string,
    userId: string,
    resourceType: string,
    resourceId: string,
  ): string {
    return `perm:obj:${companyId}:${userId}:${resourceType}:${resourceId}`;
  }

  async getCompanyRoleGrants(userId: string, companyId: string): Promise<CompanyRoleGrant[]> {
    const key = this.capKey(companyId, userId);

    let cached: string | null = null;
    try {
      cached = await this.valkey.get(key);
    } catch {
      // ValkeyService.get() should never throw, but defensively fall through to DB
      this.logger.warn("Unexpected error reading Valkey — falling back to DB", { key });
    }

    if (cached) {
      try {
        const parsed = JSON.parse(cached) as SerializedGrant[];
        return parsed.map((g) => ({
          ...g,
          expiresAt: g.expiresAt ? new Date(g.expiresAt) : null,
        }));
      } catch {
        this.logger.warn("Failed to parse cached company grants — falling back to DB", { key });
      }
    }

    const grants = await this.inner.getCompanyRoleGrants(userId, companyId);
    const serialized: SerializedGrant[] = grants.map((g) => ({
      ...g,
      expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
    }));
    try {
      await this.valkey.set(key, JSON.stringify(serialized), CACHE_TTL_SEC);
    } catch (err) {
      this.logger.warn("Failed to write company grants to cache — best-effort, ignoring", {
        key,
        error: (err as Error).message,
      });
    }
    return grants;
  }

  /**
   * S2-AUTH-BE-1 — passthrough (KHÔNG cache): scopes chỉ dùng cho /auth/me bootstrap (ít gọi, KHÔNG nằm trên
   * can() hot-path) → bỏ cache để tránh thêm khoá + vòng invalidation. RLS vẫn ép ở inner (withTenant).
   */
  async getCompanyRoleGrantsWithScope(
    userId: string,
    companyId: string,
  ): Promise<CompanyRoleGrantWithScope[]> {
    return this.inner.getCompanyRoleGrantsWithScope(userId, companyId);
  }

  async getObjectGrants(
    userId: string,
    companyId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<ObjectGrant[]> {
    const key = this.objKey(companyId, userId, resourceType, resourceId);

    let cached: string | null = null;
    try {
      cached = await this.valkey.get(key);
    } catch {
      this.logger.warn("Unexpected error reading Valkey — falling back to DB", { key });
    }

    if (cached) {
      try {
        return JSON.parse(cached) as ObjectGrant[];
      } catch {
        this.logger.warn("Failed to parse cached object grants — falling back to DB", { key });
      }
    }

    const grants = await this.inner.getObjectGrants(userId, companyId, resourceType, resourceId);
    try {
      await this.valkey.set(key, JSON.stringify(grants), CACHE_TTL_SEC);
    } catch (err) {
      this.logger.warn("Failed to write object grants to cache — best-effort, ignoring", {
        key,
        error: (err as Error).message,
      });
    }
    return grants;
  }

  /**
   * HR-PERF-1 (beBatchPermHr) — PASSTHROUGH to the inner batch: ONE DB round-trip for the whole page.
   * We deliberately do NOT fan out to N single-object cache reads (that would defeat the batch) nor
   * mget/fill-miss (extra complexity + partial-hit fan-out risk). The batch is used by list surfaces
   * that already gate + scope-filter first; the ≤2 repo reads keep the page within the ≤4-query budget.
   * RLS is enforced in the inner repo (withTenant). Never throws for cache reasons — inner owns errors.
   */
  getObjectGrantsBatch(
    userId: string,
    companyId: string,
    resourceType: string,
    resourceIds: string[],
  ): Promise<ObjectGrantBatch> {
    return this.inner.getObjectGrantsBatch(userId, companyId, resourceType, resourceIds);
  }

  /**
   * AC-5 — catalog lookup không cache (catalog nhỏ, đọc lúc tạo PAT — không hot-path). Delegate inner repo.
   */
  getPermissionsByIds(permissionIds: string[]): Promise<PermissionCatalogEntry[]> {
    return this.inner.getPermissionsByIds(permissionIds);
  }

  getAllPermissions(): Promise<PermissionCatalogEntry[]> {
    return this.inner.getAllPermissions();
  }

  /**
   * Called when permission.changed event fires — DEL cap key (object grants expire via TTL).
   * Throws if Valkey DEL fails so the event handler can dead-letter / alert.
   */
  async invalidateUser(companyId: string, userId: string): Promise<void> {
    const ok = await this.valkey.del(this.capKey(companyId, userId));
    if (!ok) {
      throw new Error(
        `Valkey DEL failed for permission cache key — stale cache possible for up to ${300}s`,
      );
    }
  }
}
