import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

/**
 * api_keys — Personal Access Token (PAT) per-tenant (AC-5). DDL/RLS/grant ở migration 0310.
 *
 * BẤT BIẾN #1: company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy tenant_isolation.
 *   PAT request CHẠY withTenant(company_id của KEY) — data-access bị RLS scope đúng tenant của key.
 * BẤT BIẾN #3 (không secret plaintext): chỉ lưu `token_hash` (sha256 hex) + `token_prefix` (vài ký tự đầu
 *   để nhận diện). Token plaintext `mok_<...>` trả client ĐÚNG 1 LẦN khi tạo — KHÔNG lưu, KHÔNG log.
 * MUTABLE cột vòng đời: app UPDATE CHỈ `last_used_at` (debounced touch) + `revoked_at` (thu hồi) — KHÔNG
 *   sửa token_hash/scope/expires_at (frozen sau khi tạo). column-grant ở migration 0310.
 *
 * `scope_permission_ids` = uuid[] trỏ permissions catalog (KHÔNG text[] tự do). Hiệu lực = scope ∩ grant
 *   THỰC của user (PermissionGuard mở rộng) — PAT KHÔNG vượt quyền user (fail-closed).
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    /** Vài ký tự đầu của plaintext (vd `mok_ab12`) — nhận diện key ở UI/log mà KHÔNG lộ token. */
    tokenPrefix: text("token_prefix").notNull(),
    /** SHA-256 hex của plaintext token (TokenService.hashToken). KHÔNG bao giờ là plaintext. */
    tokenHash: text("token_hash").notNull(),
    /** Tập permission catalog id (uuid[]) mà key được phép dùng. */
    scopePermissionIds: uuid("scope_permission_ids").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Debounced touch (chỉ UPDATE khi cách lần trước > ngưỡng) — tránh UPDATE storm bảng security. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_keys_company_id_idx").on(t.companyId),
    // Tra cứu auth-path theo prefix (ApiKeyAuthGuard) — company_id dẫn đầu để RLS scan + prefix tách nhanh.
    index("api_keys_company_prefix_idx").on(t.companyId, t.tokenPrefix),
    // Global prefix lookup ở auth-path (chạy withTenant theo company của key sau khi tra prefix→company).
    index("api_keys_token_prefix_idx").on(t.tokenPrefix),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

/**
 * api_key_usages — log dùng PAT (APPEND-ONLY, BẤT BIẾN #2: app SELECT/INSERT, KHÔNG UPDATE/DELETE).
 * Nguồn last_used an toàn (append-only) + audit dùng key. KHÔNG ghi token material. RLS+FORCE theo company_id.
 */
export const apiKeyUsages = pgTable(
  "api_key_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
    route: text("route"),
    ip: text("ip"),
  },
  (t) => [
    index("api_key_usages_company_id_idx").on(t.companyId),
    index("api_key_usages_key_idx").on(t.companyId, t.apiKeyId),
  ],
);

export type ApiKeyUsage = typeof apiKeyUsages.$inferSelect;
export type NewApiKeyUsage = typeof apiKeyUsages.$inferInsert;
