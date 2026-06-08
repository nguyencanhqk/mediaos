import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db/db.service';
import { users } from '../db/schema';
import { AuditService } from '../events/audit.service';
import { PermissionService } from '../permission/permission.service';
import { ValkeyService } from '../permission/valkey.service';
import { PasswordService } from '../auth/password.service';
import { SecretEncryptionService } from '../crypto/secret-encryption.service';
import { PlatformAccountsRepository, type SafePlatformAccountRow } from './platform-accounts.repository';

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

// ── Permission + crypto constants ─────────────────────────────────────────────
const ACTION_REVEAL = 'reveal-secret';
const ACTION_EDIT = 'edit-platform-account';
const ACTION_CREATE = 'create';
const RESOURCE_TYPE = 'platform-account';
const SECRET_PURPOSE = 'platform_account' as const;
/** Re-auth window TTL (plan §6c: ~5 phút). Per-account scope keyed (userId, accountId). */
const REAUTH_TTL_SEC = 300;

/** Valkey key for the per-account re-auth window (scope B). reauth(A) cannot authorize reveal(B). */
function reauthKey(userId: string, accountId: string): string {
  return `reauth:${userId}:${accountId}`;
}

/**
 * PlatformAccountsService — 🔒 crown-jewel reveal/edit flow for platform_accounts (plan §6c).
 *
 * Enforcement lives HERE (not only in the HTTP guard) because the reveal/edit deny paths are called
 * directly at the service layer (RED int-spec). The HTTP controller (2e-B) adds @RequirePermission +
 * ReauthGuard on top; list/get are masked at the query-projection and read-gated only at the controller.
 *
 * Invariants (pinned by RED §6e — do NOT relax):
 *   reveal — object-grant per-account REQUIRED (F2), valid re-auth window, JIT decrypt; audit
 *            'secret_revealed' or 'secret_reveal_failed' COMMITS even on tamper before a generic throw.
 *   create/update — app-gen uuid BEFORE encrypt (AAD bind); fresh DEK+nonce every write; audit-in-tx.
 *   never logs plaintext/DEK/tag; secret + recovery hints never leave via list/detail.
 */
@Injectable()
export class PlatformAccountsService {
  private readonly logger = new Logger(PlatformAccountsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PlatformAccountsRepository,
    private readonly secrets: SecretEncryptionService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly valkey: ValkeyService,
    private readonly password: PasswordService,
  ) {}

  // ── Re-auth (step-up) ────────────────────────────────────────────────────────

  /**
   * Verify the caller's password and mint a per-(userId, accountId) re-auth window (scope B).
   * The window is stored in Valkey for the HTTP ReauthGuard to read on the follow-up reveal request.
   */
  async reauth(user: RequestUser, accountId: string, factor: ReauthFactor): Promise<{ reauthValidUntil: Date }> {
    if (!factor.password) {
      throw new UnauthorizedException('Re-authentication requires a password.');
    }
    const verified = await this.db.withTenant(user.companyId, async (tx) => {
      const [row] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (!row) return false;
      return this.password.verify(row.passwordHash, factor.password as string);
    });
    if (!verified) {
      throw new UnauthorizedException('Re-authentication failed.');
    }
    const reauthValidUntil = new Date(Date.now() + REAUTH_TTL_SEC * 1000);
    await this.valkey.set(reauthKey(user.id, accountId), String(reauthValidUntil.getTime()), REAUTH_TTL_SEC);
    return { reauthValidUntil };
  }

  // ── Reveal (sensitive + object-grant + re-auth + audit each view) ──────────────

  async revealSecret(user: RequestUser, accountId: string, ctx: RevealCtx): Promise<{ secret: string }> {
    const decision = await this.permissions.can({
      userId: user.id,
      companyId: user.companyId,
      action: ACTION_REVEAL,
      resourceType: RESOURCE_TYPE,
      resourceId: accountId, // F2: per-account object grant required — company-level ALLOW is not enough.
      isSensitive: true,
      requiresReauth: true,
      ctx: { reauthValidUntil: ctx.reauthValidUntil ?? null, requestId: ctx.requestId },
    });
    if (!decision.allow) {
      if (decision.auditRequired) {
        await this.recordDenyAudit(user, accountId, 'platform_account.secret_reveal_denied', decision.reason, ctx);
      }
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }

    // Allow → decrypt JIT inside the tenant tx so the audit row commits/rolls back with the read.
    // On decrypt failure we must STILL commit a 'secret_reveal_failed' row (tamper is auditable), so we
    // record it and return a sentinel — the tx COMMITS — then throw a generic error OUTSIDE the tx (RED 8).
    const outcome = await this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findEnvelopeByIdTx(tx, user.companyId, accountId);
      if (!row) return { kind: 'not_found' as const };
      try {
        const secret = await this.secrets.decryptSecret(row, {
          companyId: user.companyId,
          recordId: accountId,
          purpose: SECRET_PURPOSE,
        });
        await this.audit.record(tx, {
          action: 'platform_account.secret_revealed',
          objectType: 'platform_account',
          objectId: accountId,
          actorUserId: user.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return { kind: 'ok' as const, secret };
      } catch {
        await this.audit.record(tx, {
          action: 'platform_account.secret_reveal_failed',
          objectType: 'platform_account',
          objectId: accountId,
          actorUserId: user.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          after: { reason: 'decrypt_error' },
        });
        return { kind: 'decrypt_failed' as const };
      }
    });

    if (outcome.kind === 'not_found') throw new NotFoundException('Platform account not found.');
    if (outcome.kind === 'decrypt_failed') throw new Error('Secret reveal failed.');
    return { secret: outcome.secret };
  }

  // ── List / detail (masked projection — no secret, no recovery hints) ───────────

  async listAccounts(user: RequestUser, filter?: ListPlatformAccountsFilter): Promise<SafePlatformAccountDto[]> {
    return this.repo.listSafe(user.companyId, filter ?? {});
  }

  async getAccount(user: RequestUser, accountId: string): Promise<SafePlatformAccountDto> {
    const row = await this.repo.findSafeById(user.companyId, accountId);
    if (!row) throw new NotFoundException('Platform account not found.');
    return row;
  }

  // ── Create (app-gen uuid BEFORE encrypt → AAD bind) ────────────────────────────

  async createAccount(user: RequestUser, input: CreatePlatformAccountInput): Promise<SafePlatformAccountDto> {
    const decision = await this.permissions.can({
      userId: user.id,
      companyId: user.companyId,
      action: ACTION_CREATE,
      resourceType: RESOURCE_TYPE,
    });
    if (!decision.allow) {
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }

    // 🔴 App-generated id BEFORE encrypt — the AAD pins this id, so the DB default must NOT generate it.
    const id = randomUUID();
    const envelope = await this.secrets.encryptSecret(input.secret, {
      companyId: user.companyId,
      recordId: id,
      purpose: SECRET_PURPOSE,
    });

    const created = await this.db.withTenant(user.companyId, async (tx) => {
      const [row] = await this.repo.insert(
        user.companyId,
        {
          id,
          platformId: input.platformId,
          accountName: input.accountName,
          accountEmail: input.accountEmail,
          accountIdentifier: input.accountIdentifier,
          ownerUserId: input.ownerUserId,
          securityLevel: input.securityLevel,
          recoveryEmail: input.recoveryEmail,
          recoveryPhone: input.recoveryPhone,
          twoFactorNote: input.twoFactorNote,
          envelope,
        },
        tx,
      );
      await this.audit.record(tx, {
        action: 'platform_account.secret_created',
        objectType: 'platform_account',
        objectId: id,
        actorUserId: user.id,
      });
      return row;
    });

    if (!created) throw new Error('Failed to create platform account.');
    return created;
  }

  // ── Update secret (rotate-secret — fresh DEK+nonce, sensitive edit) ────────────

  async updateSecret(
    user: RequestUser,
    accountId: string,
    input: UpdateSecretInput,
  ): Promise<SafePlatformAccountDto> {
    const decision = await this.permissions.can({
      userId: user.id,
      companyId: user.companyId,
      action: ACTION_EDIT,
      resourceType: RESOURCE_TYPE,
      resourceId: accountId,
      isSensitive: true,
      requiresReauth: false,
    });
    if (!decision.allow) {
      if (decision.auditRequired) {
        await this.recordDenyAudit(user, accountId, 'platform_account.secret_update_denied', decision.reason);
      }
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }

    // Fresh DEK + nonce every write (CẤM tái dùng DEK). AAD re-binds the EXISTING account id.
    const envelope = await this.secrets.encryptSecret(input.secret, {
      companyId: user.companyId,
      recordId: accountId,
      purpose: SECRET_PURPOSE,
    });

    const updated = await this.db.withTenant(user.companyId, async (tx) => {
      const [row] = await this.repo.updateSecretColumns(user.companyId, accountId, envelope, tx);
      if (!row) return null;
      await this.audit.record(tx, {
        action: 'platform_account.secret_updated',
        objectType: 'platform_account',
        objectId: accountId,
        actorUserId: user.id,
      });
      return row;
    });

    if (!updated) throw new NotFoundException('Platform account not found.');
    return updated;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────

  /**
   * Best-effort deny audit (plan §6c "deny vẫn audit"). A failure to write the audit must NOT turn a
   * security DENY into a 500 — we log it (never silently swallow) and the caller still throws Forbidden.
   */
  private async recordDenyAudit(
    user: RequestUser,
    accountId: string,
    action: string,
    reason: string,
    ctx?: RevealCtx,
  ): Promise<void> {
    try {
      await this.db.withTenant(user.companyId, async (tx) => {
        await this.audit.record(tx, {
          action,
          objectType: 'platform_account',
          objectId: accountId,
          actorUserId: user.id,
          ip: ctx?.ip,
          userAgent: ctx?.userAgent,
          after: { reason },
        });
      });
    } catch (err) {
      this.logger.error('Failed to write deny audit (access still denied)', {
        userId: user.id,
        accountId,
        action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Re-export the repository's row type alias so consumers can rely on a single shape.
export type { SafePlatformAccountRow };
