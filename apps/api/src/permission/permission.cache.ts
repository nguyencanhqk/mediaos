import { Injectable, Logger } from "@nestjs/common";
import { permCapKey, permObjKey } from "../common/valkey/valkey-key";
import type {
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  ObjectGrant,
  ObjectGrantBatch,
  PermissionCatalogEntry,
} from "./permission.types";
import { ValkeyService } from "./valkey.service";
import { bumpGrantSnapshotEpoch, GrantSnapshotMemo } from "./grant-snapshot-memo";

const CACHE_TTL_SEC = 300; // 5 minutes (plan §3b)

type SerializedGrant = Omit<CompanyRoleGrant, "expiresAt"> & { expiresAt: string | null };

/**
 * CachedPermissionRepository — transparent Valkey cache layer over IPermissionRepository.
 *
 * Cache keys (plan §7 permission-matrix-spec.md) — dựng qua `common/valkey/valkey-key.ts`, KHÔNG tại chỗ:
 *   permCapKey → perm:{envScope}:cap:{companyId}:{userId}        → CompanyRoleGrant[] (expiresAt ISO)
 *   permObjKey → perm:{envScope}:obj:{companyId}:{userId}:{type}:{id} → ObjectGrant[]
 * `envScope` (S10-FND-VALKEYSCOPE-1) tách PROD khỏi dev-online: hai môi trường dùng chung một Valkey và
 * dev-online là bản clone CÙNG companyId/userId, nên khoá không mang môi trường sẽ trùng bit-by-bit —
 * đây là cache QUYẾT ĐỊNH QUYỀN, không phải cache hiển thị.
 *
 * The service still re-checks expiresAt per can() call — cache just avoids repeated DB queries.
 * Invalidation via invalidateUser() is called when permission.changed event fires (<100ms target).
 *
 * S16-SOCIAL-PERMMEMO-1 (ADR `DECISIONS-15`) — tầng THỨ HAI, riêng cho `getCompanyRoleGrantsWithScope`:
 * memo ảnh chụp grant-kèm-scope THEO REQUEST (AsyncLocalStorage mở bởi `grantMemoMiddleware`, trần tuổi
 * 2000ms, epoch toàn tiến trình bump ở dòng đầu `invalidateUser`). Không phải cache Valkey, không sống qua
 * request. Tham số `memo` OPTIONAL để spec dựng 2 đối số vẫn chạy (mặc định = memo thật).
 */
@Injectable()
export class CachedPermissionRepository implements IPermissionRepository {
  private readonly logger = new Logger(CachedPermissionRepository.name);

  constructor(
    private readonly inner: IPermissionRepository,
    private readonly valkey: ValkeyService,
    private readonly memo: GrantSnapshotMemo = new GrantSnapshotMemo(),
  ) {}

  private capKey(companyId: string, userId: string): string {
    return permCapKey(companyId, userId);
  }

  private objKey(
    companyId: string,
    userId: string,
    resourceType: string,
    resourceId: string,
  ): string {
    return permObjKey(companyId, userId, resourceType, resourceId);
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
   * S16-SOCIAL-PERMMEMO-1 (ADR `DECISIONS-15`) — KHÔNG cache GIỮA các request (không Valkey, không khoá
   * chia sẻ); TRONG một request HTTP được memo qua `GrantSnapshotMemo`: lượt đầu mỗi (companyId, userId)
   * đọc DB, các lượt sau trong <`GRANT_MEMO_MAX_AGE_MS` (2000ms, tính từ TRƯỚC `load()`) dùng lại ảnh chụp
   * (bản clone). Vô hiệu ngay khi `invalidateUser` CHẠY (epoch toàn tiến trình) — nhưng handler outbox chạy
   * 0–`OUTBOX_POLL_MS` sau commit, nên biên thu hồi CHÍNH là trần tuổi (ADR-15 §4). Ngoài request
   * (job/outbox/WS/bootstrap) = passthrough.
   * RLS vẫn ép ở inner (`withTenant`) — memo chỉ gom số lượt đọc, không bỏ qua lượt đọc đầu.
   * D3 (owner ký): `getCompanyRoleGrants` (đường `can()`) KHÔNG đi qua memo này.
   * (Lịch sử: S2-AUTH-BE-1 để hàm này passthrough vì «ít gọi»; tiền đề đó đã sai — xem ADR-15 §1.)
   */
  async getCompanyRoleGrantsWithScope(
    userId: string,
    companyId: string,
  ): Promise<CompanyRoleGrantWithScope[]> {
    return this.memo.read(companyId, userId, () =>
      this.inner.getCompanyRoleGrantsWithScope(userId, companyId),
    );
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
   *
   * ⚠️ DEL đi qua ĐÚNG `this.capKey()` mà đường GHI (`getCompanyRoleGrants`) dùng — lệch một chữ giữa hai
   * đường là grant CŨ sống tới hết TTL 300s, im lặng (không log, không exception) = leo thang quyền.
   *
   * S10-FND-VALKEYSCOPE-2 (19/08/2026) — vế DEL kèm hình dạng khoá CŨ đã GỠ: nó chỉ đóng cửa sổ quanh
   * mốc deploy 18/08 (rollback trong TTL 300s dựng lại grant trước-thu-hồi), và số đo trên Valkey PROD
   * `--scan --pattern 'perm:cap:*'` = 0 dòng cho thấy cửa sổ đó đã qua. Còn đúng MỘT khoá.
   */
  async invalidateUser(companyId: string, userId: string): Promise<void> {
    // ADR-15 D6 — DÒNG ĐẦU, trước DEL (DEL có thể ném bên dưới): memo request phải bị vô hiệu kể cả khi
    // Valkey lỗi. Handler outbox chạy NGOÀI request ⇒ chỉ epoch toàn tiến trình với tới được memo.
    bumpGrantSnapshotEpoch();
    const ok = await this.valkey.del(this.capKey(companyId, userId));
    if (!ok) {
      throw new Error(
        `Valkey DEL failed for permission cache key — stale cache possible for up to ${300}s`,
      );
    }
  }
}
