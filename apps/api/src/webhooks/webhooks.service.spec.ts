import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { WebhooksService, type WebhookActor } from "./webhooks.service";
import type { WebhookRepository, WebhookEndpointRow } from "./webhooks.repository";
import type { WebhookSigner } from "./webhook-signer";
import type { AuditService } from "../events/audit.service";

const ACTOR: WebhookActor = {
  id: "00000000-0000-0000-0000-0000000000aa",
  companyId: "00000000-0000-0000-0000-0000000000bb",
};

function endpointRow(over: Partial<WebhookEndpointRow> = {}): WebhookEndpointRow {
  return {
    id: "00000000-0000-0000-0000-0000000000c1",
    companyId: ACTOR.companyId,
    url: "https://hooks.example.com/in",
    description: "x",
    active: true,
    createdAt: new Date("2026-06-17T00:00:00.000Z"),
    ...over,
  };
}

function makeService(repo: Partial<WebhookRepository>, signer?: Partial<WebhookSigner>) {
  const sealedEnvelope = {
    secretCiphertext: Buffer.from("00", "hex"),
    encryptedDek: Buffer.from("00", "hex"),
    dekKeyVersion: 1,
    kmsKeyId: "local-dev-kek",
    ivNonce: Buffer.alloc(12),
    authTag: Buffer.alloc(16),
    encAlgo: "AES-256-GCM",
  };
  const defaultSigner: Partial<WebhookSigner> = {
    generateSecret: vi.fn(() => "plaintext-secret-revealed-once"),
    sealSecret: vi.fn(async () => sealedEnvelope),
  };
  const audit = { record: vi.fn() } as unknown as AuditService;
  return new WebhooksService(
    repo as WebhookRepository,
    { ...defaultSigner, ...signer } as WebhookSigner,
    audit,
  );
}

describe("WebhooksService — createEndpoint reveal-once + DTO an toàn (BẤT BIẾN #3)", () => {
  it("trả secret plaintext 1 lần + endpoint DTO KHÔNG chứa secret/envelope", async () => {
    const insertEndpoint = vi.fn(async () => endpointRow());
    const svc = makeService({ insertEndpoint });
    // IP-literal public host → validator KHÔNG resolve DNS (deterministic, không phụ thuộc mạng).
    const res = await svc.createEndpoint(ACTOR, { url: "https://93.184.216.34/in" });

    expect(res.secret).toBe("plaintext-secret-revealed-once");
    const dtoKeys = Object.keys(res.endpoint);
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
      expect(dtoKeys).not.toContain(forbidden);
    }
    // id sinh ở service TRƯỚC insert (bind AAD) → truyền cho repo.
    // mock suy luận 0 tham số → cast tuple qua unknown để đọc arg thứ 2 (input) an toàn.
    const [, insertArg] = insertEndpoint.mock.calls[0] as unknown as [unknown, { id: string }];
    expect(insertArg.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("REJECT url nội bộ/non-https → BadRequest (SSRF defense-in-depth lúc tạo)", async () => {
    const insertEndpoint = vi.fn(async () => endpointRow());
    const svc = makeService({ insertEndpoint });
    await expect(
      svc.createEndpoint(ACTOR, { url: "http://10.0.0.5/in" } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(insertEndpoint).not.toHaveBeenCalled();
  });
});

describe("WebhooksService — cross-tenant → 404 (không lộ tồn tại)", () => {
  it("getEndpoint vắng/chéo tenant → NotFound", async () => {
    const svc = makeService({ getEndpoint: vi.fn(async () => null) });
    await expect(svc.getEndpoint(ACTOR, "00000000-0000-0000-0000-0000000000ff")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("subscribe vào endpoint chéo tenant → NotFound", async () => {
    const svc = makeService({ getEndpoint: vi.fn(async () => null) });
    await expect(
      svc.subscribe(ACTOR, "00000000-0000-0000-0000-0000000000ff", { eventType: "task.created" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("subscribe event_type ngoài taxonomy → BadRequest", async () => {
    const svc = makeService({ getEndpoint: vi.fn(async () => endpointRow()) });
    await expect(
      svc.subscribe(ACTOR, endpointRow().id, { eventType: "evil.event" } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
