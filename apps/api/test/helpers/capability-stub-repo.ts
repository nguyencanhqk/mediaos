/**
 * S14-SEC-CAPWILDCARD-1 — stub `IPermissionRepository` cho các spec đo `capabilities` / `scopes` ở tầng
 * CÔNG TY (ADR `DECISIONS-13`, plan §9.2).
 *
 * Hai nguồn, điều khiển độc lập:
 *   - GRANT: `getCompanyRoleGrants` và `getCompanyRoleGrantsWithScope` trả CÙNG một danh sách (kèm
 *     `dataScope`) ⇒ `getCapabilities` và `getCapabilityScopes` nhìn cùng một trạng thái grant, đúng như
 *     hai truy vấn thật đọc cùng bảng.
 *   - CATALOG: `getAllPermissions` — mảng, ném lỗi, treo vĩnh viễn, hoặc RỖNG. Đếm số lượt gọi để ca
 *     §9.2-#20 khẳng định «actor không giữ wildcard ⇒ không đọc catalog».
 *
 * Catalog là THAM SỐ của từng spec, KHÔNG phải hằng dùng chung (khác `sentinelCatalog()`): mọi ca ở đây
 * đều đo đúng cờ `is_sensitive` của cặp đích, nên mỗi ca phải thấy catalog của chính nó.
 */
import type {
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  ObjectGrant,
  PermissionCatalogEntry,
} from "../../src/permission/permission.types";

export type CatalogMode =
  | { readonly kind: "rows"; readonly rows: readonly PermissionCatalogEntry[] }
  | { readonly kind: "throw" }
  | { readonly kind: "hang" };

export class CapabilityStubRepo implements IPermissionRepository {
  private grants: readonly CompanyRoleGrantWithScope[] = [];
  private grantsFail = false;
  private catalogMode: CatalogMode = { kind: "rows", rows: [] };
  private catalogCallCount = 0;

  withGrants(grants: readonly CompanyRoleGrantWithScope[]): this {
    this.grants = grants;
    return this;
  }

  withGrantFailure(): this {
    this.grantsFail = true;
    return this;
  }

  withCatalog(rows: readonly PermissionCatalogEntry[]): this {
    this.catalogMode = { kind: "rows", rows };
    return this;
  }

  withCatalogFailure(): this {
    this.catalogMode = { kind: "throw" };
    return this;
  }

  /** Lượt nạp catalog không bao giờ xong — đo trần thời gian (§9.2-#21). */
  withHangingCatalog(): this {
    this.catalogMode = { kind: "hang" };
    return this;
  }

  get catalogCalls(): number {
    return this.catalogCallCount;
  }

  async getCompanyRoleGrants(): Promise<CompanyRoleGrant[]> {
    if (this.grantsFail) throw new Error("DB connection failed (simulated)");
    return this.grants.map((g) => ({ ...g }));
  }

  async getCompanyRoleGrantsWithScope(): Promise<CompanyRoleGrantWithScope[]> {
    if (this.grantsFail) throw new Error("DB connection failed (simulated)");
    return this.grants.map((g) => ({ ...g }));
  }

  async getObjectGrants(): Promise<ObjectGrant[]> {
    return [];
  }

  async getObjectGrantsBatch(): Promise<Map<string, ObjectGrant[]>> {
    return new Map();
  }

  async getPermissionsByIds(): Promise<PermissionCatalogEntry[]> {
    return [];
  }

  getAllPermissions(): Promise<PermissionCatalogEntry[]> {
    this.catalogCallCount += 1;
    const mode = this.catalogMode;
    if (mode.kind === "throw") {
      return Promise.reject(new Error("catalog load failed (simulated)"));
    }
    if (mode.kind === "hang") {
      return new Promise<PermissionCatalogEntry[]>(() => undefined);
    }
    return Promise.resolve(mode.rows.map((r) => ({ ...r })));
  }
}

let catalogSeq = 0;

/** Một hàng catalog. `id` tự sinh, đủ khác nhau để không va nhau trong cùng spec. */
export function pair(
  action: string,
  resourceType: string,
  isSensitive: boolean,
): PermissionCatalogEntry {
  catalogSeq += 1;
  const suffix = catalogSeq.toString(16).padStart(12, "0");
  return { id: `00000000-0000-4000-8000-${suffix}`, action, resourceType, isSensitive };
}

/** Một hàng grant tầng công ty. `isSensitive` = cờ của HÀNG GRANT (hàng `*` mang `false`, như DB thật). */
export function grant(
  action: string,
  resourceType: string,
  opts: {
    readonly effect?: "ALLOW" | "DENY";
    readonly isSensitive?: boolean;
    readonly dataScope?: string;
    readonly expiresAt?: Date | null;
  } = {},
): CompanyRoleGrantWithScope {
  return {
    action,
    resourceType,
    isSensitive: opts.isSensitive ?? false,
    effect: opts.effect ?? "ALLOW",
    expiresAt: opts.expiresAt ?? null,
    dataScope: opts.dataScope ?? "Company",
  };
}

/**
 * Catalog dùng chung cho các ca §9.2. Cờ khớp seed THẬT:
 *   view:user / update:user / view:role / view:permission / read:employee — non-sensitive (0444, 0019)
 *   view-own:adjustment (0454:45) · view:salary · view:audit-log (0340) — sensitive
 *   request-break-glass:break-glass (0200:207) — sensitive, NGOÀI allowlist
 *   reveal-secret:platform-account (0005:281) · reveal-break-glass:break-glass (0201:23) — sensitive
 *   `*:*` và `view:*` — hàng wildcard non-sensitive (PROD có hàng `*:*`, `0569:167-168`)
 */
export function companyTierCatalog(): PermissionCatalogEntry[] {
  return [
    pair("view", "user", false),
    pair("update", "user", false),
    pair("view", "role", false),
    pair("read", "employee", false),
    pair("view-own", "adjustment", true),
    pair("view", "salary", true),
    pair("view", "audit-log", true),
    pair("request-break-glass", "break-glass", true),
    pair("reveal-secret", "platform-account", true),
    pair("reveal-break-glass", "break-glass", true),
    pair("*", "*", false),
    pair("view", "*", false),
  ];
}

/** Các cặp sensitive trong `companyTierCatalog()` — wildcard KHÔNG được mở cặp nào trong số này. */
export const SENSITIVE_KEYS_IN_FIXTURE: readonly string[] = [
  "view-own:adjustment",
  "view:salary",
  "view:audit-log",
  "request-break-glass:break-glass",
  "reveal-secret:platform-account",
  "reveal-break-glass:break-glass",
];
