/**
 * CS-8 integration suite (Postgres thật; auto-skip khi thiếu DATABASE_URL).
 *
 * Kiểm chứng trên DB thật những bất biến KHÔNG mock được:
 *   1. Envelope round-trip purpose 'smtp_password' (cần seed encryption_keys row + CHECK ở mig 0380).
 *   2. password KHÔNG bao giờ ra DTO; PUT vắng password GIỮ envelope cũ (DB không thay cột secret).
 *   3. audit 'mail_config' ghi before/after KHÔNG chứa secret/cột envelope.
 *   4. RLS 2-tenant: config công ty A KHÔNG lộ sang công ty B (FORCE RLS).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { MailConfigRepository } from "../../src/settings/mail-config.repository";
import { MailConfigService } from "../../src/settings/mail-config.service";
import { MailTransportService } from "../../src/settings/mail-transport.service";
import { SMTP_SECRET_PURPOSE } from "@mediaos/contracts";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

describe.skipIf(!hasDb)("CS-8 mail-config — envelope round-trip + audit + RLS (Postgres thật)", () => {
  const direct = directPool();
  const dbsvc = new DatabaseService();
  const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
  const audit = new AuditService();
  const repo = new MailConfigRepository(dbsvc);
  const service = new MailConfigService(repo, secrets, new MailTransportService(), audit);

  let A: SeededTenant;
  let B: SeededTenant;
  let actorA: string;
  const SECRET = "smtp-pw-" + randomUUID().slice(0, 12);

  beforeAll(async () => {
    A = await seedCompany(direct, "cs8a");
    B = await seedCompany(direct, "cs8b");
    actorA = await seedUser(direct, A.companyId, `cs8a-${randomUUID().slice(0, 6)}@t.local`);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("1. encrypt purpose 'smtp_password' → decrypt round-trip khớp (key seeded ở 0380)", async () => {
    const recordId = randomUUID();
    const env = await secrets.encryptSecret(SECRET, {
      companyId: A.companyId,
      recordId,
      purpose: SMTP_SECRET_PURPOSE,
    });
    const back = await secrets.decryptSecret(env, {
      companyId: A.companyId,
      recordId,
      purpose: SMTP_SECRET_PURPOSE,
    });
    expect(back).toBe(SECRET);
  });

  it("2. upsert + list: DTO KHÔNG có password/cột envelope; hasPassword=true", async () => {
    const dto = await service.upsert(
      A.companyId,
      { host: "smtp.a.com", port: 587, username: "ua@t.local", fromEmail: "ua@t.local", password: SECRET, secure: true },
      actorA,
    );
    expect((dto as Record<string, unknown>).password).toBeUndefined();
    expect(dto.hasPassword).toBe(true);

    const { configs } = await service.list(A.companyId);
    const serialized = JSON.stringify(configs);
    expect(serialized).not.toContain(SECRET);
    expect(serialized.toLowerCase()).not.toContain("ciphertext");
  });

  it("3. PUT vắng password → GIỮ envelope cũ (cột secret DB không đổi)", async () => {
    const before = await direct.query(
      "SELECT secret_ciphertext, encrypted_dek FROM company_mail_configs WHERE company_id=$1 AND scope='default'",
      [A.companyId],
    );
    expect(before.rows.length).toBe(1);

    await service.upsert(
      A.companyId,
      { host: "smtp.a2.com", port: 465, username: "ua@t.local", fromEmail: "ua@t.local" },
      actorA,
    );
    const after = await direct.query(
      "SELECT host, secret_ciphertext, encrypted_dek FROM company_mail_configs WHERE company_id=$1 AND scope='default'",
      [A.companyId],
    );
    expect(after.rows[0].host).toBe("smtp.a2.com"); // non-secret updated
    // envelope unchanged (giữ password cũ).
    expect(Buffer.compare(after.rows[0].secret_ciphertext, before.rows[0].secret_ciphertext)).toBe(0);
    expect(Buffer.compare(after.rows[0].encrypted_dek, before.rows[0].encrypted_dek)).toBe(0);
  });

  it("3b. đổi password → envelope mới (re-encrypt) + test-connection decrypt khớp pw mới", async () => {
    const before = await direct.query(
      "SELECT secret_ciphertext FROM company_mail_configs WHERE company_id=$1 AND scope='default'",
      [A.companyId],
    );
    const NEW = "smtp-pw2-" + randomUUID().slice(0, 8);
    await service.upsert(
      A.companyId,
      { host: "smtp.a2.com", port: 465, username: "ua@t.local", fromEmail: "ua@t.local", password: NEW },
      actorA,
    );
    const after = await direct.query(
      "SELECT secret_ciphertext FROM company_mail_configs WHERE company_id=$1 AND scope='default'",
      [A.companyId],
    );
    expect(Buffer.compare(after.rows[0].secret_ciphertext, before.rows[0].secret_ciphertext)).not.toBe(0);

    // decrypt JIT (qua testConnection path) phải trả pw mới — verify() sẽ fail (host giả) nhưng decrypt phải thành công.
    const stored = await repo.findByScope(A.companyId, "default");
    const decrypted = await secrets.decryptSecret(stored!, {
      companyId: stored!.companyId,
      recordId: stored!.id,
      purpose: SMTP_SECRET_PURPOSE,
    });
    expect(decrypted).toBe(NEW);
  });

  it("4. audit 'mail_config' ghi before/after KHÔNG chứa secret/cột envelope", async () => {
    const res = await direct.query(
      `SELECT action, object_type, before, after FROM audit_logs
       WHERE company_id=$1 AND object_type='mail_config' ORDER BY created_at DESC LIMIT 5`,
      [A.companyId],
    );
    expect(res.rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(res.rows);
    expect(serialized).not.toContain(SECRET);
    expect(serialized.toLowerCase()).not.toContain("ciphertext");
    expect(serialized).not.toContain("encrypted_dek");
    expect(serialized).not.toContain("encryptedDek");
    // before/after có hasPassword (cờ) — KHÔNG password thật.
    expect(serialized).toContain("hasPassword");
  });

  it("5. RLS 2-tenant: list công ty B KHÔNG thấy config công ty A", async () => {
    const { configs } = await service.list(B.companyId);
    expect(configs).toHaveLength(0);
  });
});
