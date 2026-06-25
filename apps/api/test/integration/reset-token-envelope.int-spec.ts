/**
 * G6-2b RED integration suite — RED 12: forgotPassword reset-token must be ENVELOPED, not plaintext.
 *
 * Drives the REAL AuthService.forgotPassword (construction recipe mirrors auth.int-spec.ts) so these
 * assertions flip GREEN automatically when 2f envelopes the token — no test rewrite needed.
 *
 * RED source: auth.service.ts:213-216 writes `resetToken` PLAINTEXT into outbox_events.payload.
 * Do NOT modify auth.service.ts during 2b — the RED is precisely that it writes plaintext today.
 *
 * Target contract (plan §6d / step 2f): payload stores ONLY `resetTokenEnc` (envelope); the mail
 * consumer decrypts JIT; a one-time scrub (0028) removes pre-existing plaintext rows.
 *
 * Runs on real Postgres; auto-skip when DATABASE_URL missing.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuthService } from "../../src/auth/auth.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { SecurityAlertService } from "../../src/auth/security-alert.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import type { PermissionService } from "../../src/permission/permission.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { makeSecurityPolicyService } from "../helpers/security-policy";

// JWT_SECRET must exist before TokenService reads env in its constructor (mirror auth.int-spec.ts:15).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

describe.skipIf(!hasDb)(
  "G6-2b RED 12 — forgotPassword reset-token must be enveloped, not plaintext",
  () => {
    const direct = directPool();
    const password = new PasswordService();
    const meta = { ip: "127.0.0.1", userAgent: "vitest" };
    let A: SeededTenant;
    let auth: AuthService;
    const EMAIL = `g62rt-${randomUUID().slice(0, 8)}@test.local`;

    /** Real AuthService — recipe from auth.int-spec.ts:44-56 (forgotPassword uses dbsvc/tokens/outbox/audit). */
    function newAuth(): AuthService {
      const mockPermissions = { getCapabilities: async () => ({}), getCapabilityScopes: async () => ({}) } as unknown as PermissionService;
      const dbsvc = new DatabaseService();
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
      );
    }

    async function latestResetPayload(): Promise<Record<string, unknown>> {
      const res = await direct.query(
        `SELECT payload FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'
       ORDER BY created_at DESC LIMIT 1`,
        [A.companyId],
      );
      expect(res.rows.length).toBeGreaterThan(0); // forgotPassword must have enqueued a row (not a setup error)
      const raw = res.rows[0].payload as unknown;
      return typeof raw === "string"
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown>);
    }

    beforeAll(async () => {
      A = await seedCompany(direct, "g62rt");
      await seedUser(direct, A.companyId, EMAIL, await password.hash("Passw0rd!strong"));
      auth = newAuth();
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    });

    it("RED 12a — payload has NO plaintext resetToken key (envelope only)", async () => {
      await auth.forgotPassword({ companySlug: A.slug, email: EMAIL }, meta);
      const payload = await latestResetPayload();
      // RED now: auth.service writes payload.resetToken (plaintext). Target (2f): absent.
      expect(payload["resetToken"]).toBeUndefined();
    });

    it("RED 12b — payload carries the envelope field resetTokenEnc", async () => {
      await auth.forgotPassword({ companySlug: A.slug, email: EMAIL }, meta);
      const payload = await latestResetPayload();
      // RED now: envelope not written yet. Target (plan §6d): payload.resetTokenEnc present.
      expect(payload["resetTokenEnc"]).toBeDefined();
    });

    it("RED 12c — the scoped token never appears in plaintext anywhere in the payload (consumer must decrypt)", async () => {
      await auth.forgotPassword({ companySlug: A.slug, email: EMAIL }, meta);
      const payload = await latestResetPayload();
      const serialized = JSON.stringify(payload);
      // The scoped token is `${companyId}.<opaque>` (auth.service.scopeToken). RED now: it is embedded in
      // the payload as plaintext. Target: only `resetTokenEnc` carries it → no `${companyId}.` substring.
      expect(serialized).not.toContain(`${A.companyId}.`);
    });

    it("RED 12d — pre-existing plaintext outbox rows are scrubbed (count → 0)", async () => {
      // Simulate a durable legacy row written before the envelope migration (the scrub target, 0028/2f).
      await direct.query(
        `INSERT INTO outbox_events (company_id, event_type, payload)
       VALUES ($1, 'auth.password_reset_requested', $2::jsonb)`,
        [
          A.companyId,
          JSON.stringify({
            userId: randomUUID(),
            email: EMAIL,
            resetToken: `${A.companyId}.legacy-plaintext`,
          }),
        ],
      );
      const res = await direct.query(
        `SELECT COUNT(*)::int AS cnt FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested' AND payload ? 'resetToken'`,
        [A.companyId],
      );
      // RED now: scrub migration not run → plaintext rows remain (>0). Target: 0 after scrub.
      expect(res.rows[0].cnt as number).toBe(0);
    });
  },
);
