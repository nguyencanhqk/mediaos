/**
 * CS-8 MailConfigService — unit specs (no DB; repo/secrets/transport mocked).
 *
 * 🔴 Bất biến secret: password KHÔNG ra DTO/GET; PUT vắng password GIỮ envelope cũ (không re-encrypt);
 * tạo mới mà vắng password → 400; test decrypt JIT từ envelope khi body vắng password.
 */
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MailConfigService } from "./mail-config.service";

const COMPANY = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: COMPANY,
    scope: "default",
    host: "smtp.example.com",
    port: 587,
    username: "noreply@example.com",
    secure: true,
    fromName: "Funtime",
    fromEmail: "noreply@example.com",
    secretCiphertext: Buffer.from("aa", "hex"),
    encryptedDek: Buffer.from("bb", "hex"),
    dekKeyVersion: 1,
    kmsKeyId: "local-dev-kek",
    ivNonce: Buffer.alloc(12),
    authTag: Buffer.alloc(16),
    encAlgo: "AES-256-GCM",
    createdAt: new Date("2026-06-18T00:00:00.000Z"),
    updatedAt: new Date("2026-06-18T00:00:00.000Z"),
    ...over,
  };
}

function makeService(over: {
  repo?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  transport?: Record<string, unknown>;
} = {}) {
  const envelope = {
    secretCiphertext: Buffer.from("cc", "hex"),
    encryptedDek: Buffer.from("dd", "hex"),
    dekKeyVersion: 1,
    kmsKeyId: "local-dev-kek",
    ivNonce: Buffer.alloc(12),
    authTag: Buffer.alloc(16),
    encAlgo: "AES-256-GCM",
  };
  const repo = {
    listConfigs: vi.fn().mockResolvedValue([row()]),
    findByScope: vi.fn().mockResolvedValue(row()),
    upsert: vi.fn().mockImplementation(async (_c, _id, _f, _e) => row()),
    ...over.repo,
  };
  const secrets = {
    encryptSecret: vi.fn().mockResolvedValue(envelope),
    decryptSecret: vi.fn().mockResolvedValue("decrypted-pw"),
    ...over.secrets,
  };
  const transport = {
    test: vi.fn().mockResolvedValue({ ok: true }),
    ...over.transport,
  };
  const audit = { record: vi.fn() };
  const svc = new MailConfigService(repo as never, secrets as never, transport as never, audit as never);
  return { svc, repo, secrets, transport, envelope };
}

describe("MailConfigService.list — DTO KHÔNG chứa password / cột envelope", () => {
  it("trả hasPassword=true + KHÔNG có field secret/envelope", async () => {
    const { svc } = makeService();
    const { configs } = await svc.list(COMPANY);
    expect(configs).toHaveLength(1);
    const keys = Object.keys(configs[0]);
    for (const forbidden of [
      "password",
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
    expect(configs[0].hasPassword).toBe(true);
    expect(configs[0].fromEmail).toBe("noreply@example.com");
  });
});

describe("MailConfigService.upsert — password optional", () => {
  it("CÓ password → encrypt envelope mới + truyền envelope cho repo", async () => {
    const { svc, secrets, repo } = makeService();
    await svc.upsert(
      COMPANY,
      { host: "smtp.x", port: 465, username: "u", fromEmail: "f@x.com", password: "newpw" },
      ACTOR,
    );
    expect(secrets.encryptSecret).toHaveBeenCalledOnce();
    // recordId (arg 2) là uuid app-gen TRƯỚC encrypt; envelope (arg 4) non-null.
    const [, recordId, , envArg] = repo.upsert.mock.calls[0];
    expect(recordId).toMatch(/^[0-9a-f-]{36}$/);
    expect(envArg).not.toBeNull();
    // purpose phải là 'smtp_password'.
    expect(secrets.encryptSecret.mock.calls[0][1].purpose).toBe("smtp_password");
  });

  it("VẮNG password + config tồn tại → GIỮ envelope cũ (KHÔNG encrypt; envelope=null cho repo)", async () => {
    const { svc, secrets, repo } = makeService();
    await svc.upsert(COMPANY, { host: "smtp.x", port: 587, username: "u", fromEmail: "f@x.com" }, ACTOR);
    expect(secrets.encryptSecret).not.toHaveBeenCalled();
    const [, , , envArg] = repo.upsert.mock.calls[0];
    expect(envArg).toBeNull();
  });

  it("VẮNG password + tạo MỚI (chưa tồn tại) → BadRequest, KHÔNG ghi", async () => {
    const { svc, repo } = makeService({ repo: { findByScope: vi.fn().mockResolvedValue(undefined) } });
    await expect(
      svc.upsert(COMPANY, { host: "smtp.x", port: 587, username: "u", fromEmail: "f@x.com" }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("DTO trả về KHÔNG có password", async () => {
    const { svc } = makeService();
    const dto = await svc.upsert(
      COMPANY,
      { host: "smtp.x", port: 587, username: "u", fromEmail: "f@x.com", password: "p" },
      ACTOR,
    );
    expect((dto as Record<string, unknown>).password).toBeUndefined();
    expect(dto.hasPassword).toBe(true);
  });
});

describe("MailConfigService.testConnection — password từ body hoặc decrypt envelope", () => {
  it("body CÓ password → dùng trực tiếp (KHÔNG decrypt)", async () => {
    const { svc, secrets, transport } = makeService();
    await svc.testConnection(COMPANY, {
      host: "smtp.x",
      port: 587,
      username: "u",
      password: "typed-pw",
    });
    expect(secrets.decryptSecret).not.toHaveBeenCalled();
    expect(transport.test).toHaveBeenCalledWith(expect.objectContaining({ password: "typed-pw" }));
  });

  it("body VẮNG password → decrypt JIT từ envelope đã lưu", async () => {
    const { svc, secrets, transport } = makeService();
    await svc.testConnection(COMPANY, { host: "smtp.x", port: 587, username: "u" });
    expect(secrets.decryptSecret).toHaveBeenCalledOnce();
    expect(transport.test).toHaveBeenCalledWith(expect.objectContaining({ password: "decrypted-pw" }));
  });

  it("body VẮNG password + chưa có config → BadRequest", async () => {
    const { svc } = makeService({ repo: { findByScope: vi.fn().mockResolvedValue(undefined) } });
    await expect(
      svc.testConnection(COMPANY, { host: "smtp.x", port: 587, username: "u" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("decrypt thất bại → { ok:false } message generic (KHÔNG lộ crypto)", async () => {
    const { svc } = makeService({
      secrets: { decryptSecret: vi.fn().mockRejectedValue(new Error("decrypt failed")) },
    });
    const res = await svc.testConnection(COMPANY, { host: "smtp.x", port: 587, username: "u" });
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toBe("Không giải mã được mật khẩu đã lưu.");
  });
});
