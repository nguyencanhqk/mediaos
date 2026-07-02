/**
 * S2-AUTH-BE-8 (LANE e_tests) — ATOMICITY: security-event + mutation gốc CÙNG commit/rollback.
 *
 * BẤT BIẾN cốt lõi của writer (SPEC-02 §22.2): SecurityEventWriter.record(tx, …) ghi vào CHÍNH `tx` của
 * withTenant tại mọi emit-site — KHÔNG mở transaction mới. ⇒ nếu mutation nghiệp vụ (đổi mật khẩu, khoá
 * user, gán quyền…) THẤT BẠI, event bảo mật KHÔNG được để mồ côi (orphan) trong bảng append-only.
 *
 * RED-trước (nếu writer mở withTenant riêng): row event sẽ commit dù tx gốc rollback ⇒ count > 0 ⇒ ĐỎ.
 * Hiện thực đúng (dùng chung tx): rollback tx gốc cuốn theo event ⇒ count = 0 ⇒ GREEN.
 *
 * Phủ:
 *   R1 [raw]     writer.record trong withTenant rồi tx throw → 0 orphan row cho user đó (rollback nguyên tử).
 *   R2 [service] AuthService.changePassword với writer NÉM SAU khi record (mô phỏng mutation-downstream fail)
 *      → changePassword reject; 0 orphan user_security_events; password_hash GIỮ NGUYÊN (mutation cũng rollback).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). skipIf(!runDb) ⇒ inert ở unit-run.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService, type TenantTx } from "../../src/db/db.service";
import { AuthService } from "../../src/auth/auth.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { SecurityAlertService } from "../../src/auth/security-alert.service";
import { SecurityEventWriter } from "../../src/auth/security-event-writer.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { makeSecurityPolicyService } from "../helpers/security-policy";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

// JWT_SECRET phải có TRƯỚC khi TokenService đọc env (constructor) — mirror auth.int-spec.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane. */
const runDb = hasDb && Boolean(process.env.LANE_DB);

const LOGIN_PW = "Passw0rd!test99";
const NEW_PW = "N3wPass!word2026";
const TAG = randomUUID().slice(0, 8);

/**
 * Writer NÉM SAU khi record — mô phỏng "mutation gốc throw SAU writer.record" (bước downstream của tx thất
 * bại). super.record() ĐÃ INSERT vào tx; throw sau đó ⇒ tx abort ⇒ row event bị rollback (chứng minh nguyên tử).
 */
class ThrowAfterRecordWriter extends SecurityEventWriter {
  override async record(
    tx: TenantTx,
    entry: Parameters<SecurityEventWriter["record"]>[1],
  ): Promise<void> {
    await super.record(tx, entry);
    throw new Error("simulated downstream mutation failure after security-event write");
  }
}

describe.skipIf(!runDb)("S2-AUTH-BE-8 security-event atomicity (rollback → 0 orphan)", () => {
  const direct = directPool();
  const password = new PasswordService();
  let A: SeededTenant;
  const companyIds: string[] = [];

  beforeAll(async () => {
    A = await seedCompany(direct, "sea");
    companyIds.push(A.companyId);
  });

  afterAll(async () => {
    if (companyIds.length) await cleanupTenants(direct, companyIds);
    await direct.end();
  });

  /** Dựng AuthService bằng tay (mirror auth.int-spec.newAuth) với writer tuỳ biến (vị trí param cuối). */
  function newAuth(securityEvents: SecurityEventWriter): AuthService {
    const dbsvc = new DatabaseService();
    const mockPermissions = {
      getCapabilities: async () => ({}),
      getAllowlistedSensitiveCapabilities: async () => ({}),
      getCapabilityScopes: async () => ({}),
    } as unknown as PermissionService;
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    const replayGuard = new ReplayGuardService(new ValkeyService());
    const securityAlerts = new SecurityAlertService(dbsvc, new AuditService());
    const twoFactor = new TwoFactorService(
      dbsvc,
      secrets,
      new TotpService(),
      new TokenService(),
      new AuditService(),
      new LoginRateLimiter(),
      replayGuard,
    );
    return new AuthService(
      dbsvc,
      password,
      new TokenService(),
      new LoginRateLimiter(),
      new AuditService(),
      new OutboxService(),
      mockPermissions,
      secrets,
      twoFactor,
      replayGuard,
      securityAlerts,
      makeSecurityPolicyService(dbsvc),
      { getMyApps: async () => [] } as never,
      undefined, // resetMail (optional)
      securityEvents, // S2-AUTH-BE-8: writer (vị trí param cuối)
    );
  }

  // ── R1: raw — writer.record trong withTenant rồi tx throw → 0 orphan (rollback nguyên tử) ───────
  it("R1 — writer.record rồi tx throw → 0 orphan row user_security_events (BẤT BIẾN #2 cùng tx)", async () => {
    const subject = await seedUser(direct, A.companyId, `r1-${TAG}@a.test`);
    const writer = new SecurityEventWriter();

    await expect(
      new DatabaseService().withTenant(A.companyId, async (tx) => {
        // Ghi event append-only vào CHÍNH tx…
        await writer.record(tx, {
          eventType: "PASSWORD_CHANGED",
          userId: subject,
          actorUserId: subject,
        });
        // …rồi mutation gốc "thất bại" trong CÙNG tx ⇒ rollback cuốn theo event.
        throw new Error("simulated root mutation failure");
      }),
    ).rejects.toThrow(/simulated root mutation/);

    const { rows } = await direct.query(
      `SELECT count(*)::int AS n FROM user_security_events WHERE user_id = $1`,
      [subject],
    );
    expect(rows[0].n).toBe(0);
  });

  // ── R2: service — changePassword với writer ném sau record → reject + 0 orphan + hash giữ nguyên ─
  it("R2 — changePassword mutation-downstream fail → 0 orphan event + password_hash rollback", async () => {
    const email = `r2-${TAG}@a.test`;
    const hash = await password.hash(LOGIN_PW);
    const subject = await seedUser(direct, A.companyId, email, hash);

    // Ảnh chụp hash TRƯỚC (để chứng minh mutation cũng bị rollback, không chỉ event).
    const before = await direct.query(`SELECT password_hash FROM users WHERE id = $1`, [subject]);
    const hashBefore = before.rows[0].password_hash as string;

    const auth = newAuth(new ThrowAfterRecordWriter());
    await expect(
      auth.changePassword({ id: subject, companyId: A.companyId }, LOGIN_PW, NEW_PW),
    ).rejects.toThrow(/simulated downstream mutation failure/);

    // 0 orphan event (PASSWORD_CHANGED ghi rồi bị cuốn theo rollback).
    const ev = await direct.query(
      `SELECT count(*)::int AS n FROM user_security_events WHERE user_id = $1`,
      [subject],
    );
    expect(ev.rows[0].n).toBe(0);

    // password_hash GIỮ NGUYÊN (đổi mật khẩu cũng rollback — event + mutation ĐỒNG BỘ).
    const after = await direct.query(`SELECT password_hash FROM users WHERE id = $1`, [subject]);
    expect(after.rows[0].password_hash).toBe(hashBefore);

    // Mật khẩu CŨ vẫn verify được (mutation thật sự chưa xảy ra).
    expect(await password.verify(after.rows[0].password_hash as string, LOGIN_PW)).toBe(true);
  });
});
