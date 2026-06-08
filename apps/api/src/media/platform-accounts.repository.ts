import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import { DatabaseService, type TenantTx } from '../db/db.service';
import { platformAccounts } from '../db/schema';
import type { EncryptedColumns } from '../crypto/secret-encryption.types';

/**
 * Allowlist of columns safe to expose in ANY DTO — masking happens at the query-projection layer
 * (mirror auth.service `me()`), so the secret/PII columns never leave the DB. RED 7 (serialize the
 * real response) enforces this list: it EXCLUDES the envelope columns
 * (secret_ciphertext / encrypted_dek / dek_key_version / kms_key_id / iv_nonce / auth_tag / enc_algo)
 * AND the recovery hints (recovery_email / recovery_phone / two_factor_note). deleted_at is internal.
 */
const SAFE_COLUMNS = {
  id: platformAccounts.id,
  companyId: platformAccounts.companyId,
  platformId: platformAccounts.platformId,
  accountName: platformAccounts.accountName,
  accountEmail: platformAccounts.accountEmail,
  accountIdentifier: platformAccounts.accountIdentifier,
  ownerUserId: platformAccounts.ownerUserId,
  securityLevel: platformAccounts.securityLevel,
  status: platformAccounts.status,
  lastRotatedAt: platformAccounts.lastRotatedAt,
  createdAt: platformAccounts.createdAt,
  updatedAt: platformAccounts.updatedAt,
} as const;

/** Masked row returned by list/detail/create/update — never carries secret or recovery-hint columns. */
export type SafePlatformAccountRow = {
  id: string;
  companyId: string;
  platformId: string;
  accountName: string | null;
  accountEmail: string | null;
  accountIdentifier: string | null;
  ownerUserId: string | null;
  securityLevel: string | null;
  status: string;
  lastRotatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Envelope columns read JUST-IN-TIME on the reveal path → fed straight to decryptSecret. */
export type EnvelopeRow = EncryptedColumns & { id: string; companyId: string };

/** Non-secret attributes for a new account. The id is app-generated BEFORE encrypt (AAD bind, §6a). */
export interface CreatePlatformAccountData {
  id: string;
  platformId: string;
  accountName?: string | null;
  accountEmail?: string | null;
  accountIdentifier?: string | null;
  ownerUserId?: string | null;
  securityLevel?: string | null;
  recoveryEmail?: string | null;
  recoveryPhone?: string | null;
  twoFactorNote?: string | null;
  envelope: EncryptedColumns;
}

export interface ListPlatformAccountsFilter {
  platformId?: string;
  status?: string;
  q?: string;
}

/** '' → null at the boundary so optional text columns stay NULL rather than empty string. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * PlatformAccountsRepository (🔒 G6-2) — every read path filters `deleted_at IS NULL` (§6d lifecycle).
 * Read helpers open their own withTenant; write helpers take a `tx` so the service can commit the
 * business row and its audit row in ONE transaction (audit-in-tx, §4 quyết định 4).
 */
@Injectable()
export class PlatformAccountsRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Masked list (no secret/recovery columns). Optional platform/status/q filters. */
  async listSafe(
    companyId: string,
    filter: ListPlatformAccountsFilter = {},
  ): Promise<SafePlatformAccountRow[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [eq(platformAccounts.companyId, companyId), isNull(platformAccounts.deletedAt)];
      if (filter.platformId) conds.push(eq(platformAccounts.platformId, filter.platformId));
      if (filter.status) conds.push(eq(platformAccounts.status, filter.status));
      if (filter.q) conds.push(ilike(platformAccounts.accountName, `%${filter.q}%`));

      return tx
        .select(SAFE_COLUMNS)
        .from(platformAccounts)
        .where(and(...conds))
        .orderBy(desc(platformAccounts.createdAt));
    });
  }

  /** Masked single row, or null when absent / soft-deleted / cross-tenant (RLS). */
  async findSafeById(companyId: string, id: string): Promise<SafePlatformAccountRow | null> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select(SAFE_COLUMNS)
        .from(platformAccounts)
        .where(
          and(
            eq(platformAccounts.companyId, companyId),
            eq(platformAccounts.id, id),
            isNull(platformAccounts.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * Reads the envelope columns for the reveal path. Runs INSIDE the caller's tx so the subsequent
   * audit row commits/rolls back atomically with the read. Returns null when absent/soft-deleted.
   */
  async findEnvelopeByIdTx(tx: TenantTx, companyId: string, id: string): Promise<EnvelopeRow | null> {
    const [row] = await tx
      .select({
        id: platformAccounts.id,
        companyId: platformAccounts.companyId,
        secretCiphertext: platformAccounts.secretCiphertext,
        encryptedDek: platformAccounts.encryptedDek,
        dekKeyVersion: platformAccounts.dekKeyVersion,
        kmsKeyId: platformAccounts.kmsKeyId,
        ivNonce: platformAccounts.ivNonce,
        authTag: platformAccounts.authTag,
        encAlgo: platformAccounts.encAlgo,
      })
      .from(platformAccounts)
      .where(
        and(
          eq(platformAccounts.companyId, companyId),
          eq(platformAccounts.id, id),
          isNull(platformAccounts.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** INSERT a new account with its app-generated id + envelope columns. Returns the masked row. */
  insert(companyId: string, data: CreatePlatformAccountData, tx: TenantTx) {
    return tx
      .insert(platformAccounts)
      .values({
        id: data.id,
        companyId,
        platformId: data.platformId,
        accountName: normalizeOptional(data.accountName),
        accountEmail: normalizeOptional(data.accountEmail),
        accountIdentifier: normalizeOptional(data.accountIdentifier),
        ownerUserId: data.ownerUserId ?? null,
        securityLevel: normalizeOptional(data.securityLevel),
        recoveryEmail: normalizeOptional(data.recoveryEmail),
        recoveryPhone: normalizeOptional(data.recoveryPhone),
        twoFactorNote: normalizeOptional(data.twoFactorNote),
        secretCiphertext: data.envelope.secretCiphertext,
        encryptedDek: data.envelope.encryptedDek,
        dekKeyVersion: data.envelope.dekKeyVersion,
        kmsKeyId: data.envelope.kmsKeyId,
        ivNonce: data.envelope.ivNonce,
        authTag: data.envelope.authTag,
        encAlgo: data.envelope.encAlgo,
      })
      .returning(SAFE_COLUMNS);
  }

  /**
   * Rotate the stored secret: overwrite ALL envelope columns with a fresh DEK+nonce envelope
   * (CẤM tái dùng DEK — §6a). Filters deleted_at; returns the masked row (empty when not found).
   */
  updateSecretColumns(companyId: string, id: string, envelope: EncryptedColumns, tx: TenantTx) {
    return tx
      .update(platformAccounts)
      .set({
        secretCiphertext: envelope.secretCiphertext,
        encryptedDek: envelope.encryptedDek,
        dekKeyVersion: envelope.dekKeyVersion,
        kmsKeyId: envelope.kmsKeyId,
        ivNonce: envelope.ivNonce,
        authTag: envelope.authTag,
        encAlgo: envelope.encAlgo,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(platformAccounts.companyId, companyId),
          eq(platformAccounts.id, id),
          isNull(platformAccounts.deletedAt),
        ),
      )
      .returning(SAFE_COLUMNS);
  }
}
