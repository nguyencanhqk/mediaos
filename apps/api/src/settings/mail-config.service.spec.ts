/**
 * CS-8 MailConfigService — unit specs (no DB; repo/secrets/transport mocked).
 *
 * 🔴 Bất biến secret: password KHÔNG ra DTO/GET; PUT vắng password GIỮ envelope cũ (không re-encrypt) CHỈ
 * khi đích khớp hàng; tạo mới mà vắng password → 400; test decrypt JIT từ envelope khi body vắng password
 * và CHỈ tới đích của hàng (S19-SEC-MAILCREDEXFIL-1 — đổi đích vắng password ⇒ 400, không decrypt).
 */
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MailConfigService } from "./mail-config.service";
import { MailDestinationNotPersistedError, MailPasswordRequiredError } from "./mail-destination";

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

function makeService(
  over: {
    repo?: Record<string, unknown>;
    secrets?: Record<string, unknown>;
    transport?: Record<string, unknown>;
  } = {},
) {
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
  const svc = new MailConfigService(
    repo as never,
    secrets as never,
    transport as never,
    audit as never,
  );
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

/** Hợp đồng dây (FE bắt theo `error.code`) — ghim LITERAL: hằng mất thì ca phải đỏ, không `undefined === undefined`. */
const MAIL_PASSWORD_REQUIRED = "FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED";

/** Đích của `row()` mặc định — gửi lại nguyên bộ này = "không đổi đích". */
const STORED_DEST = {
  host: "smtp.example.com",
  port: 587,
  username: "noreply@example.com",
  secure: true,
};

/** Mỗi trường đích lệch MỘT MÌNH (S19-SEC-MAILCREDEXFIL-1): đủ để mật khẩu đã lưu tới tay người khác. */
const DEST_DRIFTS: Array<[string, Record<string, unknown>]> = [
  ["host khác", { host: "smtp.attacker.example" }],
  ["port khác", { port: 2525 }],
  ["username khác", { username: "other@example.com" }],
  ["secure khác", { secure: false }],
];

async function errorCodeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { code?: unknown }).code;
  }
  throw new Error("kỳ vọng BadRequestException, nhưng promise resolve");
}

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
    // S19-SEC-MAILAADBIND-1 (B1): ngữ cảnh gắn bộ năm (id hàng SẼ ghi, host, port, username, secure) — dựng
    // LITERAL ở đây, KHÔNG gọi helper (so helper với chính nó là tautology). secure vắng ⇒ true.
    const ctx = secrets.encryptSecret.mock.calls[0][1];
    expect(ctx.recordId).toBe(JSON.stringify([recordId, "smtp.x", 465, "u", true]));
    expect(ctx).toEqual({
      companyId: COMPANY,
      recordId: JSON.stringify([recordId, "smtp.x", 465, "u", true]),
      purpose: "smtp_password",
    });
  });

  it("VẮNG password + đích KHỚP hàng đã lưu, chỉ đổi from → GIỮ envelope cũ (envelope=null cho repo)", async () => {
    const { svc, secrets, repo } = makeService();
    await svc.upsert(
      COMPANY,
      { ...STORED_DEST, fromName: "Khác", fromEmail: "khac@example.com" },
      ACTOR,
    );
    expect(secrets.encryptSecret).not.toHaveBeenCalled();
    const [, , fields, envArg] = repo.upsert.mock.calls[0];
    expect(envArg).toBeNull();
    expect(fields).toMatchObject({ fromName: "Khác", fromEmail: "khac@example.com" });
  });

  it.each(DEST_DRIFTS)(
    "VẮNG password + %s → 400 MAIL-PASSWORD-REQUIRED, KHÔNG ghi (envelope cũ không gắn đích mới)",
    async (_label, drift) => {
      const { svc, repo, secrets } = makeService();
      const code = await errorCodeOf(
        svc.upsert(COMPANY, { ...STORED_DEST, ...drift, fromEmail: "f@x.com" }, ACTOR),
      );
      expect(code).toBe(MAIL_PASSWORD_REQUIRED);
      expect(repo.upsert).not.toHaveBeenCalled();
      expect(secrets.encryptSecret).not.toHaveBeenCalled();
    },
  );

  it("VẮNG password + secure VẮNG (⇒ true) trong khi hàng lưu secure=false → 400", async () => {
    const { svc, repo } = makeService({
      repo: { findByScope: vi.fn().mockResolvedValue(row({ secure: false })) },
    });
    const { secure: _omit, ...withoutSecure } = STORED_DEST;
    const code = await errorCodeOf(
      svc.upsert(COMPANY, { ...withoutSecure, fromEmail: "f@x.com" }, ACTOR),
    );
    expect(code).toBe(MAIL_PASSWORD_REQUIRED);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("VẮNG password + tạo MỚI (chưa tồn tại) → 400 cùng mã, KHÔNG ghi", async () => {
    const { svc, repo } = makeService({
      repo: { findByScope: vi.fn().mockResolvedValue(undefined) },
    });
    const code = await errorCodeOf(
      svc.upsert(
        COMPANY,
        { host: "smtp.x", port: 587, username: "u", fromEmail: "f@x.com" },
        ACTOR,
      ),
    );
    expect(code).toBe(MAIL_PASSWORD_REQUIRED);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("repo ném MailPasswordRequiredError (thua đua trong tx) → 400 cùng mã, KHÔNG 500", async () => {
    const raced = new MailPasswordRequiredError();
    const { svc } = makeService({ repo: { upsert: vi.fn().mockRejectedValue(raced) } });
    const code = await errorCodeOf(
      svc.upsert(COMPANY, { ...STORED_DEST, fromEmail: "f@x.com" }, ACTOR),
    );
    expect(code).toBe(MAIL_PASSWORD_REQUIRED);
  });

  it("repo ném MailDestinationNotPersistedError (đích PG lưu ≠ đích đã gắn vào ngữ cảnh) → 400 KHÔNG mã module (filter ⇒ VALIDATION-ERR-001)", async () => {
    const { svc } = makeService({
      repo: { upsert: vi.fn().mockRejectedValue(new MailDestinationNotPersistedError()) },
    });
    const err = await svc
      .upsert(COMPANY, { ...STORED_DEST, fromEmail: "f@x.com", password: "p" }, ACTOR)
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(((err as BadRequestException).getResponse() as { code?: unknown }).code).toBeUndefined();
    expect((err as BadRequestException).message).toBe(
      "Máy chủ hoặc tên đăng nhập SMTP chứa ký tự không hợp lệ.",
    );
  });

  it("repo ném lỗi LẬP TRÌNH (recordId lệch id PG lưu) ⇒ ném NGUYÊN (500 qua filter), KHÔNG gói thành 400", async () => {
    const programmerError = new Error("Mail config: recordId không khớp id PG lưu");
    const { svc } = makeService({ repo: { upsert: vi.fn().mockRejectedValue(programmerError) } });

    await expect(
      svc.upsert(COMPANY, { ...STORED_DEST, fromEmail: "f@x.com", password: "p" }, ACTOR),
    ).rejects.toBe(programmerError);
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

describe("MailConfigService.testConnection — mật khẩu đã lưu CHỈ tới đích của chính hàng chứa nó", () => {
  it("body CÓ password → dùng trực tiếp (KHÔNG decrypt), tới đích trong body", async () => {
    const { svc, secrets, transport } = makeService();
    await svc.testConnection(
      COMPANY,
      {
        host: "smtp.x",
        port: 587,
        username: "u",
        password: "typed-pw",
      },
      ACTOR,
    );
    expect(secrets.decryptSecret).not.toHaveBeenCalled();
    expect(transport.test).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.x", password: "typed-pw" }),
    );
  });

  it("body VẮNG password + đích KHỚP → decrypt JIT, transport nhận ĐÚNG đích của hàng", async () => {
    const { svc, secrets, transport } = makeService();
    await svc.testConnection(COMPANY, STORED_DEST, ACTOR);
    expect(secrets.decryptSecret).toHaveBeenCalledOnce();
    expect(transport.test).toHaveBeenCalledWith({ ...STORED_DEST, password: "decrypted-pw" });
    // S19-SEC-MAILAADBIND-1 (B1): ngữ cảnh giải mã = bộ năm của HÀNG (dựng LITERAL, không gọi helper).
    const [envelopeArg, ctx] = secrets.decryptSecret.mock.calls[0];
    expect(ctx.recordId).toBe(
      JSON.stringify([row().id, "smtp.example.com", 587, "noreply@example.com", true]),
    );
    expect(ctx).toEqual({
      companyId: COMPANY,
      recordId: JSON.stringify([row().id, "smtp.example.com", 587, "noreply@example.com", true]),
      purpose: "smtp_password",
    });
    expect(envelopeArg).toEqual(row());
  });

  it.each(DEST_DRIFTS)(
    "body VẮNG password + %s → 400 MAIL-PASSWORD-REQUIRED, KHÔNG decrypt, KHÔNG kết nối",
    async (_label, drift) => {
      const { svc, secrets, transport } = makeService();
      const code = await errorCodeOf(
        svc.testConnection(COMPANY, { ...STORED_DEST, ...drift }, ACTOR),
      );
      expect(code).toBe(MAIL_PASSWORD_REQUIRED);
      expect(secrets.decryptSecret).not.toHaveBeenCalled();
      expect(transport.test).not.toHaveBeenCalled();
    },
  );

  it("body VẮNG password + chưa có config → 400 cùng mã", async () => {
    const { svc } = makeService({ repo: { findByScope: vi.fn().mockResolvedValue(undefined) } });
    const code = await errorCodeOf(
      svc.testConnection(COMPANY, { host: "smtp.x", port: 587, username: "u" }, ACTOR),
    );
    expect(code).toBe(MAIL_PASSWORD_REQUIRED);
  });

  it("decrypt thất bại (đích khớp) → { ok:false } câu cố định bảo nhập lại mật khẩu (owner D2), KHÔNG lộ crypto", async () => {
    const { svc, transport } = makeService({
      secrets: { decryptSecret: vi.fn().mockRejectedValue(new Error("decrypt failed")) },
    });
    const res = await svc.testConnection(COMPANY, STORED_DEST, ACTOR);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toBe(
      "Không dùng được mật khẩu đã lưu — vui lòng nhập lại mật khẩu SMTP rồi bấm Lưu.",
    );
    expect(transport.test).not.toHaveBeenCalled();
  });
});

/**
 * Dấu vết khi từ chối — FULL gate silent-failure M-2: route test không ghi audit, nên `logger.warn` là cơ chế
 * phát hiện DUY NHẤT của một lần thử dẫn mật khẩu công ty đi nơi khác. Gỡ log ⇒ các ca này phải đỏ.
 */
describe("MailConfigService — log khi từ chối / thất bại (ghim nội dung)", () => {
  function spyWarn(svc: MailConfigService) {
    const logger = (svc as unknown as { logger: { warn: (message: string) => void } }).logger;
    return vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  }
  /** Spy RIÊNG mức `error` — ghim MỨC log (owner D3), không chỉ chữ. */
  function spyError(svc: MailConfigService) {
    const logger = (svc as unknown as { logger: { error: (message: string) => void } }).logger;
    return vi.spyOn(logger, "error").mockImplementation(() => undefined).mockName("logger.error");
  }
  const lineOf = (warn: ReturnType<typeof spyWarn>): string => String(warn.mock.calls[0]?.[0] ?? "");

  it("test vắng password, đích lệch ⇒ đúng 1 dòng: route=test · actor · changed=<tên trường> · đích yêu cầu; KHÔNG mật khẩu", async () => {
    const { svc } = makeService();
    const warn = spyWarn(svc);

    await svc.testConnection(COMPANY, { ...STORED_DEST, host: "smtp.attacker.example" }, ACTOR).catch(() => undefined);

    expect(warn).toHaveBeenCalledOnce();
    const line = lineOf(warn);
    expect(line).toContain("route=test");
    expect(line).toContain(`company=${COMPANY}`);
    expect(line).toContain(`actor=${ACTOR}`);
    expect(line).toContain("changed=host ");
    expect(line).toContain('requestedHost="smtp.attacker.example"');
    expect(line).not.toContain("decrypted-pw");
  });

  it("PUT vắng password, đổi port + secure ⇒ route=put · changed=port,secure", async () => {
    const { svc } = makeService();
    const warn = spyWarn(svc);

    await svc
      .upsert(COMPANY, { ...STORED_DEST, port: 2525, secure: false, fromEmail: "f@x.com" }, ACTOR)
      .catch(() => undefined);

    expect(warn).toHaveBeenCalledOnce();
    expect(lineOf(warn)).toContain("route=put");
    expect(lineOf(warn)).toContain("changed=port,secure ");
    expect(lineOf(warn)).toContain("requestedPort=2525");
  });

  it("host chứa xuống dòng + ký tự bidi ⇒ log ASCII-hoá (không giả được dòng log)", async () => {
    // Dựng ký tự bằng mã (không viết literal): U+202E RIGHT-TO-LEFT OVERRIDE · U+2028 LINE SEPARATOR.
    const RLO = String.fromCharCode(0x202e);
    const LINE_SEP = String.fromCharCode(0x2028);
    const BACKSLASH = String.fromCharCode(0x5c);
    const { svc } = makeService();
    const warn = spyWarn(svc);

    await svc
      .testConnection(COMPANY, { ...STORED_DEST, host: `evil.example${RLO}\nFAKE level=info${LINE_SEP}` }, ACTOR)
      .catch(() => undefined);

    const line = lineOf(warn);
    for (const raw of ["\n", "\r", RLO, LINE_SEP]) expect(line).not.toContain(raw);
    expect(line).toContain(`${BACKSLASH}u202e`);
    expect(line).toContain(`${BACKSLASH}n`);
    expect(line).toContain(`${BACKSLASH}u2028`);
  });

  it("giải mã mật khẩu đã lưu thất bại ⇒ ĐÚNG 1 dòng `error` (thẻ smtp-envelope-unusable · company · config=<id>), KHÔNG warn (owner D3)", async () => {
    // S19-SEC-MAILAADBIND-1: đích gắn vào ngữ cảnh ⇒ giải mã hỏng = vi phạm toàn vẹn (đích bị đổi ngoài app,
    // envelope hỏng / định dạng cũ, mất KEK) — không bao giờ là chuyện thường ⇒ mức `error`, thẻ cố định.
    const { svc } = makeService({
      secrets: { decryptSecret: vi.fn().mockRejectedValue(new Error("decrypt failed")) },
    });
    const warn = spyWarn(svc).mockName("logger.warn");
    const error = spyError(svc);

    await svc.testConnection(COMPANY, STORED_DEST, ACTOR);

    expect(error).toHaveBeenCalledOnce();
    const line = lineOf(error);
    expect(line).toContain("smtp-envelope-unusable");
    expect(line).toContain(`company=${COMPANY}`);
    expect(line).toContain(`config=${row().id}`);
    expect(line).not.toContain("decrypt failed");
    expect(line).not.toContain("decrypted-pw");
    expect(warn).not.toHaveBeenCalled();
  });

  it("repo báo 0 hàng (thua đua) ⇒ warn + 400 mang câu đúng cho CẢ 'hàng vừa bị thay' lẫn 'đích lệch'", async () => {
    const { svc } = makeService({
      repo: { upsert: vi.fn().mockRejectedValue(new MailPasswordRequiredError()) },
    });
    const warn = spyWarn(svc);

    const err = await svc
      .upsert(COMPANY, { ...STORED_DEST, fromEmail: "f@x.com" }, ACTOR)
      .then(() => null, (e: unknown) => e);

    expect(warn).toHaveBeenCalledOnce();
    expect(lineOf(warn)).toContain(`actor=${ACTOR}`);
    expect(((err as BadRequestException).getResponse() as { message: string }).message).toMatch(
      /thay đổi ở nơi khác hoặc đích không khớp/,
    );
  });

  it("lỗi repo KHÔNG thuộc miền (DB sập, 23505, 42501…) ⇒ ném NGUYÊN lỗi, KHÔNG đổi thành 400 'cần mật khẩu'", async () => {
    const dbDown = new Error("connection terminated unexpectedly");
    const { svc } = makeService({ repo: { upsert: vi.fn().mockRejectedValue(dbDown) } });

    await expect(svc.upsert(COMPANY, { ...STORED_DEST, fromEmail: "f@x.com" }, ACTOR)).rejects.toBe(dbDown);
  });
});
