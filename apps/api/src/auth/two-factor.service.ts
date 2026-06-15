import { randomBytes } from "node:crypto";
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { roles, userRecoveryCodes, userRoles, users, userTotp } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { SecretEncryptionService } from "../crypto/secret-encryption.service";
import type { EncryptedColumns } from "../crypto/secret-encryption.types";
import { TokenService } from "./token.service";
import { TotpService } from "./totp.service";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 8; // ~11 ký tự base64url (64-bit) — đủ cho mã 1-lần có rate-limit
const TOTP_PURPOSE = "totp_secret" as const;

export interface EnrollResult {
  /** otpauth:// URI để FE render QR. Chứa secret — trả 1 lần cho chính user, KHÔNG log/lưu plaintext. */
  otpauthUri: string;
  /** Mã khôi phục plaintext — hiển thị 1 LẦN duy nhất; server chỉ giữ hash. */
  recoveryCodes: string[];
}

/**
 * TwoFactorService — orchestrate 2FA TOTP (G16-1, AUTH-003). CROWN-JEWEL: secret TOTP là secret
 * (BẤT BIẾN #3) → envelope-encrypt phía app (purpose='totp_secret', recordId=userId), KHÔNG plaintext vào
 * DB/DTO/log. Mọi data-access qua `withTenant` (BẤT BIẾN #1). Hành động quan trọng đều audit (objectType='auth').
 *
 * Trạng thái: enroll (sinh secret + recovery codes, enabled_at=NULL) → confirmEnable (verify mã → enabled_at)
 * → verifyChallenge (login bước 2) / disable. Re-enroll khi đã bật phải disable trước (chống tự khoá).
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly dbsvc: DatabaseService,
    private readonly secrets: SecretEncryptionService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  // ── login-path helpers (chạy TRONG tx của login để cùng 1 transaction) ────────────────────────

  /** Đã BẬT 2FA chưa (enabled_at != null). Dùng trong tx login. */
  async isEnabledTx(tx: TenantTx, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ enabledAt: userTotp.enabledAt })
      .from(userTotp)
      .where(eq(userTotp.userId, userId))
      .limit(1);
    return row?.enabledAt != null;
  }

  /** User giữ ÍT NHẤT 1 role còn hiệu lực có `requires_two_factor` → bị ép 2FA. Dùng trong tx login. */
  async requiresTwoFactorTx(tx: TenantTx, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ one: sql<number>`1` })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(roles.requiresTwoFactor, true),
          isNull(roles.deletedAt),
          or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, new Date())),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  // ── controller-facing (mở withTenant riêng) ───────────────────────────────────────────────────

  async isEnabled(userId: string, companyId: string): Promise<boolean> {
    return this.dbsvc.withTenant(companyId, (tx) => this.isEnabledTx(tx, userId));
  }

  async requiresTwoFactor(userId: string, companyId: string): Promise<boolean> {
    return this.dbsvc.withTenant(companyId, (tx) => this.requiresTwoFactorTx(tx, userId));
  }

  /** Trạng thái cho FE: đã bật + có bị ép không. */
  async status(userId: string, companyId: string): Promise<{ enabled: boolean; required: boolean }> {
    return this.dbsvc.withTenant(companyId, async (tx) => ({
      enabled: await this.isEnabledTx(tx, userId),
      required: await this.requiresTwoFactorTx(tx, userId),
    }));
  }

  /**
   * Enroll: sinh secret + recovery codes, lưu user_totp (enabled_at=NULL, CHƯA bật). Đã BẬT rồi → 409
   * (phải disable trước, chống tự khoá). Trả otpauthUri + recoveryCodes plaintext (hiển thị 1 lần).
   */
  async enroll(userId: string, companyId: string): Promise<EnrollResult> {
    const secret = this.totp.generateSecret();
    const enc = await this.secrets.encryptSecret(secret, {
      companyId,
      recordId: userId,
      purpose: TOTP_PURPOSE,
    });
    const recoveryCodes = this.generateRecoveryCodes();
    const recoveryHashes = recoveryCodes.map((c) => this.tokens.hashToken(c));

    const accountName = await this.dbsvc.withTenant(companyId, async (tx) => {
      const [existing] = await tx
        .select({ enabledAt: userTotp.enabledAt })
        .from(userTotp)
        .where(eq(userTotp.userId, userId))
        .limit(1);
      if (existing?.enabledAt != null) {
        throw new ConflictException("2FA đã được bật. Hãy tắt trước khi đăng ký lại.");
      }
      // Reset mọi enrollment pending cũ + recovery codes cũ (re-enroll = bộ secret/codes mới).
      await tx.delete(userTotp).where(eq(userTotp.userId, userId));
      await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
      await tx.insert(userTotp).values({ userId, ...this.toColumns(enc) });
      await tx
        .insert(userRecoveryCodes)
        .values(recoveryHashes.map((codeHash) => ({ userId, codeHash })));
      const [u] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      await this.audit.record(tx, {
        action: "auth.2fa_enrolled",
        objectType: "auth",
        actorUserId: userId,
        objectId: userId,
      });
      return u?.email ?? userId;
    });

    return { otpauthUri: this.totp.keyUri(accountName, secret), recoveryCodes };
  }

  /** Xác nhận bật: verify mã TOTP với secret đã enroll → set enabled_at. Mã sai → 401 (deny-path). */
  async confirmEnable(userId: string, companyId: string, token: string): Promise<void> {
    await this.dbsvc.withTenant(companyId, async (tx) => {
      const row = await this.loadTotp(tx, userId);
      if (!row) throw new UnauthorizedException("Chưa đăng ký 2FA.");
      const secret = await this.decryptSecret(row, companyId, userId);
      if (!this.totp.verify(token, secret)) {
        throw new UnauthorizedException("Mã xác thực không đúng.");
      }
      await tx
        .update(userTotp)
        .set({ enabledAt: new Date(), updatedAt: new Date() })
        .where(eq(userTotp.userId, userId));
      await this.audit.record(tx, {
        action: "auth.2fa_enabled",
        objectType: "auth",
        actorUserId: userId,
        objectId: userId,
      });
    });
  }

  /** Tắt 2FA: xoá sạch secret + recovery codes. Controller PHẢI re-auth (password) trước khi gọi. */
  async disable(userId: string, companyId: string): Promise<void> {
    await this.dbsvc.withTenant(companyId, async (tx) => {
      const deleted = await tx
        .delete(userTotp)
        .where(eq(userTotp.userId, userId))
        .returning({ id: userTotp.id });
      await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
      if (deleted.length > 0) {
        await this.audit.record(tx, {
          action: "auth.2fa_disabled",
          objectType: "auth",
          actorUserId: userId,
          objectId: userId,
        });
      }
    });
  }

  /**
   * Bước 2 login: verify mã TOTP HOẶC recovery code. TOTP đúng → true. Sai → thử recovery code (hash +
   * tìm bản unused, đánh dấu used_at 1-lần). Đều sai → false + audit fail. Không bật 2FA → false (caller
   * không nên gọi). KHÔNG log code/secret.
   */
  async verifyChallenge(userId: string, companyId: string, code: string): Promise<boolean> {
    return this.dbsvc.withTenant(companyId, async (tx) => {
      const row = await this.loadTotp(tx, userId);
      if (!row || row.enabledAt == null) return false;
      const secret = await this.decryptSecret(row, companyId, userId);

      if (this.totp.verify(code, secret)) {
        await this.audit.record(tx, {
          action: "auth.2fa_verified",
          objectType: "auth",
          actorUserId: userId,
          objectId: userId,
        });
        return true;
      }

      // Recovery code: hash input, tìm bản CHƯA dùng, đánh dấu used (1-lần, append used_at).
      const codeHash = this.tokens.hashToken(code);
      const consumed = await tx
        .update(userRecoveryCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(userRecoveryCodes.userId, userId),
            eq(userRecoveryCodes.codeHash, codeHash),
            isNull(userRecoveryCodes.usedAt),
          ),
        )
        .returning({ id: userRecoveryCodes.id });
      if (consumed.length > 0) {
        await this.audit.record(tx, {
          action: "auth.2fa_recovery_used",
          objectType: "auth",
          actorUserId: userId,
          objectId: userId,
        });
        return true;
      }

      await this.audit.record(tx, {
        action: "auth.2fa_verify_failed",
        objectType: "auth",
        actorUserId: userId,
        objectId: userId,
      });
      return false;
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────

  private async loadTotp(tx: TenantTx, userId: string) {
    const [row] = await tx.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
    return row ?? null;
  }

  private decryptSecret(
    row: typeof userTotp.$inferSelect,
    companyId: string,
    userId: string,
  ): Promise<string> {
    return this.secrets.decryptSecret(this.fromColumns(row), {
      companyId,
      recordId: userId,
      purpose: TOTP_PURPOSE,
    });
  }

  private toColumns(enc: EncryptedColumns) {
    return {
      secretCiphertext: enc.secretCiphertext,
      encryptedDek: enc.encryptedDek,
      dekKeyVersion: enc.dekKeyVersion,
      kmsKeyId: enc.kmsKeyId,
      ivNonce: enc.ivNonce,
      authTag: enc.authTag,
      encAlgo: enc.encAlgo,
    };
  }

  private fromColumns(row: typeof userTotp.$inferSelect): EncryptedColumns {
    return {
      secretCiphertext: row.secretCiphertext,
      encryptedDek: row.encryptedDek,
      dekKeyVersion: row.dekKeyVersion,
      kmsKeyId: row.kmsKeyId,
      ivNonce: row.ivNonce,
      authTag: row.authTag,
      encAlgo: row.encAlgo,
    };
  }

  private generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
    return Array.from({ length: count }, () => randomBytes(RECOVERY_CODE_BYTES).toString("base64url"));
  }
}
