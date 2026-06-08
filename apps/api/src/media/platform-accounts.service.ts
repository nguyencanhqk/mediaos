import { Injectable } from '@nestjs/common';

/** Caller identity (mirror media services' RequestUser). */
export interface RequestUser {
  id: string;
  companyId: string;
}

/** Step-up factor presented to `reauth` (password and/or TOTP). 2e refines via contracts. */
export interface ReauthFactor {
  password?: string;
  otp?: string;
}

/** Per-reveal context: the re-auth window + request metadata for audit. */
export interface RevealCtx {
  reauthValidUntil?: Date | null;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Masked projection returned by list/detail — the allowlist the RED 7 serialize test enforces.
 * NEVER contains secret_ciphertext / encrypted_dek / iv_nonce / auth_tag NOR the PII hints
 * recovery_email / recovery_phone / two_factor_note (any role). Final shape lives in contracts (2e).
 */
export interface SafePlatformAccountDto {
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
}

export interface CreatePlatformAccountInput {
  platformId: string;
  secret: string;
  accountName?: string;
  accountEmail?: string;
  accountIdentifier?: string;
  ownerUserId?: string;
  securityLevel?: string;
  recoveryEmail?: string;
  recoveryPhone?: string;
  twoFactorNote?: string;
}

export interface UpdateSecretInput {
  secret: string;
}

export interface ListPlatformAccountsFilter {
  platformId?: string;
  status?: string;
  q?: string;
}

/**
 * PlatformAccountsService — 🔒 crown-jewel reveal/edit flow for platform_accounts (plan §6c).
 *
 * ⚠️ SKELETON (G6-2b RED phase): every method throws so RED tests fail on BEHAVIOR, not on missing
 * modules. Do NOT implement reveal/crypto/audit logic here during 2b — that is 2e (after 2c crypto +
 * 2e0 guard-forward). The constructor is intentionally omitted; 2e wires
 * (DatabaseService, AuditService, SecretEncryptionService, PermissionService, ValkeyService).
 *
 * Behaviour pinned by RED tests (§6e):
 *   reauth        — mint a per-(userId, accountId) re-auth window (scope B) with short TTL.
 *   revealSecret  — object-tier permission (per-account grant REQUIRED, company-level NOT enough, F2) +
 *                   valid re-auth window → decrypt JIT → audit 'secret_revealed' (or 'secret_reveal_failed'
 *                   on tamper) in the SAME tx. Returns plaintext ONCE.
 *   listAccounts/getAccount — masked projection (SafePlatformAccountDto), any role.
 *   createAccount — app-gen uuid BEFORE encrypt (AAD bind) → encryptSecret → INSERT → audit 'secret_created'.
 *   updateSecret  — needs 'edit-platform-account' (sensitive); new DEK+nonce → audit 'secret_updated'.
 */
@Injectable()
export class PlatformAccountsService {
  reauth(_user: RequestUser, _accountId: string, _factor: ReauthFactor): Promise<{ reauthValidUntil: Date }> {
    throw new Error('NOT_IMPLEMENTED:2e — PlatformAccountsService.reauth');
  }

  revealSecret(_user: RequestUser, _accountId: string, _ctx: RevealCtx): Promise<{ secret: string }> {
    throw new Error('NOT_IMPLEMENTED:2e — PlatformAccountsService.revealSecret');
  }

  listAccounts(_user: RequestUser, _filter?: ListPlatformAccountsFilter): Promise<SafePlatformAccountDto[]> {
    throw new Error('NOT_IMPLEMENTED:2e — PlatformAccountsService.listAccounts');
  }

  getAccount(_user: RequestUser, _accountId: string): Promise<SafePlatformAccountDto> {
    throw new Error('NOT_IMPLEMENTED:2e — PlatformAccountsService.getAccount');
  }

  createAccount(_user: RequestUser, _input: CreatePlatformAccountInput): Promise<SafePlatformAccountDto> {
    throw new Error('NOT_IMPLEMENTED:2e — PlatformAccountsService.createAccount');
  }

  updateSecret(_user: RequestUser, _accountId: string, _input: UpdateSecretInput): Promise<SafePlatformAccountDto> {
    throw new Error('NOT_IMPLEMENTED:2e — PlatformAccountsService.updateSecret');
  }
}
