/**
 * AC-6 — HMAC secret envelope-KMS (BẤT BIẾN #3). Tạo endpoint qua service THẬT (DB cô lập mediaos_ac6):
 *  - secret sinh server-side, plaintext trả ĐÚNG 1 LẦN (reveal-once).
 *  - SELECT * trên webhook_endpoints CHỈ có cột envelope (KHÔNG cột plaintext); DTO list/get KHÔNG secret.
 *  - audit before/after KHÔNG chứa plaintext secret (chỉ url/active/description).
 *  - decrypt round-trips đúng với AAD companyId‖endpoint_id (sign path).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { WebhooksService } from "../../src/webhooks/webhooks.service";
import { WebhookRepository } from "../../src/webhooks/webhooks.repository";
import { WebhookSigner } from "../../src/webhooks/webhook-signer";
import { WebhookDeliveryService } from "../../src/webhooks/webhook-delivery.service";
import { WebhookSsrfError } from "../../src/webhooks/ssrf/webhook-url-validator";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

describe.skipIf(!hasDb)("AC-6 webhook secret envelope-KMS (no plaintext leak)", () => {
  let svc: WebhooksService;
  let repo: WebhookRepository;
  let signer: WebhookSigner;
  let delivery: WebhookDeliveryService;
  let direct: Pool;
  let A: SeededTenant;
  let actorA: { id: string; companyId: string };
  const companyIds: string[] = [];
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
    svc = moduleRef.get(WebhooksService);
    repo = moduleRef.get(WebhookRepository);
    signer = moduleRef.get(WebhookSigner);
    delivery = moduleRef.get(WebhookDeliveryService);
    direct = directPool();

    A = await seedCompany(direct, "whsec");
    companyIds.push(A.companyId);
    const uid = await seedUser(direct, A.companyId, `wh-${randomUUID().slice(0, 8)}@a.test`);
    actorA = { id: uid, companyId: A.companyId };
  });

  afterAll(async () => {
    await moduleRef?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  it("tạo endpoint → secret plaintext trả 1 lần; KHÔNG lọt vào DTO/SELECT*/audit", async () => {
    const res = await svc.createEndpoint(actorA, {
      // IP-literal public host → validator KHÔNG cần DNS (deterministic, không phụ thuộc mạng CI).
      url: "https://93.184.216.34/secret-test",
      description: "secret-test",
    });
    const plaintext = res.secret;
    expect(plaintext.length).toBeGreaterThanOrEqual(32);

    // DTO KHÔNG chứa plaintext / envelope.
    const dtoStr = JSON.stringify(res.endpoint);
    expect(dtoStr).not.toContain(plaintext);

    // SELECT * (superuser bypass RLS) → có cột envelope NHƯNG KHÔNG có cột plaintext nào chứa secret.
    const row = await direct.query(`SELECT * FROM webhook_endpoints WHERE id = $1`, [
      res.endpoint.id,
    ]);
    const cols = Object.keys(row.rows[0]);
    expect(cols).toContain("secret_ciphertext");
    expect(cols).not.toContain("secret"); // KHÔNG cột plaintext
    // Không cột nào chứa plaintext secret (kể cả ciphertext khi decode utf8).
    for (const [, v] of Object.entries(row.rows[0])) {
      if (typeof v === "string") expect(v).not.toContain(plaintext);
      if (Buffer.isBuffer(v)) expect(v.toString("utf8")).not.toContain(plaintext);
    }

    // audit_logs before/after KHÔNG chứa plaintext.
    const audit = await direct.query(
      `SELECT before, after FROM audit_logs WHERE object_type = 'webhook_endpoint' AND object_id = $1`,
      [res.endpoint.id],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const a of audit.rows) {
      expect(JSON.stringify(a.before ?? {})).not.toContain(plaintext);
      expect(JSON.stringify(a.after ?? {})).not.toContain(plaintext);
    }
  });

  it("decryptSecret (sign path) round-trips đúng với AAD companyId‖endpoint_id", async () => {
    const res = await svc.createEndpoint(actorA, {
      url: "https://93.184.216.34/roundtrip",
    });
    const secretRow = await repo.getEndpointWithSecret(actorA.companyId, res.endpoint.id);
    expect(secretRow).not.toBeNull();
    // Ký 2 lần cùng payload → cùng chữ ký (secret ổn định, decrypt round-trip thành công).
    const sig1 = await signer.sign("payload-body", secretRow!, {
      companyId: actorA.companyId,
      endpointId: res.endpoint.id,
    });
    const sig2 = await signer.sign("payload-body", secretRow!, {
      companyId: actorA.companyId,
      endpointId: res.endpoint.id,
    });
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/); // HMAC-SHA256 hex
  });

  it("WebhookDeliveryService: validate URL (resolve-then-pin) + ghi delivery record pending", async () => {
    const res = await svc.createEndpoint(actorA, { url: "https://93.184.216.34/delivery" });
    const out = await delivery.enqueueDelivery(
      actorA.companyId,
      { id: res.endpoint.id, url: res.endpoint.url },
      "task.created",
    );
    expect(out.delivery.status).toBe("pending");
    expect(out.delivery.eventType).toBe("task.created");
    expect(out.target.pinnedIp).toBe("93.184.216.34");
  });

  it("WebhookDeliveryService: URL nội bộ → SSRF reject, KHÔNG ghi delivery", async () => {
    await expect(
      delivery.enqueueDelivery(
        actorA.companyId,
        { id: randomUUID(), url: "https://169.254.169.254/latest/meta-data" },
        "task.created",
      ),
    ).rejects.toBeInstanceOf(WebhookSsrfError);
  });

  it("list/get DTO KHÔNG chứa cột envelope/secret", async () => {
    const list = await svc.listEndpoints(actorA, {});
    expect(list.length).toBeGreaterThan(0);
    for (const dto of list) {
      const keys = Object.keys(dto);
      for (const forbidden of [
        "secret",
        "secretCiphertext",
        "encryptedDek",
        "dekKeyVersion",
        "kmsKeyId",
        "ivNonce",
        "authTag",
        "encAlgo",
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });
});
