import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/** bytea — cột nhị phân (drizzle pg-core không export sẵn). node-postgres trả/nhận Buffer cho bytea. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * CS-8 Cấu hình mail server SMTP (TENANT self-service, 🔴 SECRET). DDL/RLS/grant ở migration 0380.
 * 1 bảng per-tenant FORCE-RLS — 1 config / (company, scope). scope = 'default' | 'app:<KEY>'.
 *
 * BẤT BIẾN #1: company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy tenant_isolation.
 * BẤT BIẾN #2: SMTP password reversible → 7 cột envelope (secret_ciphertext/encrypted_dek/dek_key_version/
 *   kms_key_id/iv_nonce/auth_tag/enc_algo). KHÔNG cột plaintext. AAD = companyId‖id (recordId=id).
 * BẤT BIẾN #3: app UPDATE CHỈ cột non-secret; đổi password = DELETE+INSERT cả hàng (envelope frozen).
 */
export const companyMailConfigs = pgTable(
  "company_mail_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("default"),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    username: text("username").notNull(),
    secure: boolean("secure").notNull().default(true),
    fromName: text("from_name"),
    fromEmail: text("from_email").notNull(),
    // ── 7 cột envelope SMTP password (mirror webhook_endpoints / platform_accounts / user_totp) ──
    secretCiphertext: bytea("secret_ciphertext").notNull(),
    encryptedDek: bytea("encrypted_dek").notNull(),
    dekKeyVersion: integer("dek_key_version").notNull(),
    kmsKeyId: text("kms_key_id").notNull(),
    ivNonce: bytea("iv_nonce").notNull(),
    authTag: bytea("auth_tag").notNull(),
    encAlgo: text("enc_algo").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("company_mail_configs_company_id_idx").on(t.companyId),
    uniqueIndex("company_mail_configs_company_scope_uq").on(t.companyId, t.scope),
  ],
);

export type CompanyMailConfig = typeof companyMailConfigs.$inferSelect;
export type NewCompanyMailConfig = typeof companyMailConfigs.$inferInsert;
