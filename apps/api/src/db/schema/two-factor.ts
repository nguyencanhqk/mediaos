import {
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
import { users } from "./users";

/**
 * bytea — cột nhị phân (drizzle pg-core không export sẵn). node-postgres trả/nhận Buffer cho bytea.
 * Mirror `media.ts` (envelope encryption G6-2). Dùng cho secret TOTP (envelope-encrypt, BẤT BIẾN #3).
 */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * user_totp — secret TOTP (RFC 6238) cho 2FA (G16-1, AUTH-003). 1 dòng / user (`user_id` UNIQUE).
 * Secret KHÔNG plaintext (BẤT BIẾN #3): envelope-encrypt phía app (purpose='totp_secret', recordId=userId)
 * — 7 cột envelope giống `platform_accounts`. `enabled_at` NULL = đã enroll nhưng CHƯA xác nhận (chưa bật);
 * set khi user nhập đúng mã lần đầu. DDL/RLS ở migration 0120. RLS theo company_id + FORCE.
 */
export const userTotp = pgTable(
  "user_totp",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // 🔒 ENVELOPE columns (mirror platform_accounts §2.1) — secret TOTP base32 được seal.
    secretCiphertext: bytea("secret_ciphertext").notNull(),
    encryptedDek: bytea("encrypted_dek").notNull(),
    dekKeyVersion: integer("dek_key_version").notNull(),
    kmsKeyId: text("kms_key_id").notNull(),
    ivNonce: bytea("iv_nonce").notNull(),
    authTag: bytea("auth_tag").notNull(),
    encAlgo: text("enc_algo").notNull().default("AES-256-GCM"),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_totp_user_uq").on(t.userId)],
);

export type UserTotp = typeof userTotp.$inferSelect;
export type NewUserTotp = typeof userTotp.$inferInsert;

/**
 * user_recovery_codes — mã khôi phục 2FA (dùng 1 lần). Chỉ lưu HASH (SHA-256) — KHÔNG plaintext. Sinh
 * cùng lúc enroll; mỗi mã `used_at` khi tiêu thụ (append-update used_at, không xoá để giữ vết). DDL/RLS 0120.
 */
export const userRecoveryCodes = pgTable(
  "user_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_recovery_codes_hash_uq").on(t.codeHash),
    index("user_recovery_codes_user_idx").on(t.companyId, t.userId),
  ],
);

export type UserRecoveryCode = typeof userRecoveryCodes.$inferSelect;
export type NewUserRecoveryCode = typeof userRecoveryCodes.$inferInsert;
