import { createHmac } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../../db/db.service";
import type { AuditService } from "../../events/audit.service";
import { LmsSsoService } from "./lms-sso.service";

// Ghép chuỗi + KHÔNG dùng literal hex/high-entropy → tránh trip gitleaks generic-api-key (CLAUDE.md §5).
const SECRET = ["test-lms-sso-secret", "unit-test-only-not-a-real-secret-padding"].join("-");
const BASE_URL = "https://lms.example.com";

/** Stub DB/Audit cho các test THUẦN buildSsoUrl (không chạm DB — mock không bao giờ được gọi). */
const dbStub = { withTenant: vi.fn() } as unknown as DatabaseService;
const auditStub = { record: vi.fn() } as unknown as AuditService;
const svcPure = (): LmsSsoService => new LmsSsoService(dbStub, auditStub);

function decodeToken(url: string) {
  const token = decodeURIComponent(new URL(url).searchParams.get("token") ?? "");
  const [payloadB64, sigB64] = token.split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
    email: string;
    iat: number;
    exp: number;
    jti: string;
  };
  return { payloadB64, sigB64, payload };
}

describe("LmsSsoService", () => {
  const savedEnv = { secret: process.env.LMS_SSO_SECRET, base: process.env.LMS_BASE_URL };

  beforeEach(() => {
    process.env.LMS_SSO_SECRET = SECRET;
    process.env.LMS_BASE_URL = `${BASE_URL}/`; // service phải tự cắt "/" thừa
  });

  afterEach(() => {
    process.env.LMS_SSO_SECRET = savedEnv.secret;
    process.env.LMS_BASE_URL = savedEnv.base;
  });

  it("phát URL đúng gốc LMS với token HMAC verify được bằng shared secret", () => {
    const svc = svcPure();
    const { url } = svc.buildSsoUrl("User@Example.com");

    expect(url.startsWith(`${BASE_URL}/api/auth/sso?token=`)).toBe(true);
    const { payloadB64, sigB64, payload } = decodeToken(url);
    const expectedSig = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
    expect(sigB64).toBe(expectedSig);
    expect(payload.email).toBe("user@example.com"); // email chuẩn hoá lowercase
  });

  it("token TTL 60s và jti không lặp giữa 2 lần phát (nền chống replay phía LMS)", () => {
    const svc = svcPure();
    const first = decodeToken(svc.buildSsoUrl("a@b.co").url);
    const second = decodeToken(svc.buildSsoUrl("a@b.co").url);

    expect(first.payload.exp - first.payload.iat).toBe(60_000);
    expect(first.payload.jti).not.toBe(second.payload.jti);
    expect(first.payload.jti.length).toBeGreaterThanOrEqual(8);
  });

  it("deny-path: thiếu env → 503 ServiceUnavailable, không phát token mù", () => {
    delete process.env.LMS_SSO_SECRET;
    const svc = svcPure();
    expect(() => svc.buildSsoUrl("a@b.co")).toThrow(ServiceUnavailableException);
  });

  it("deny-path: đổi 1 ký tự payload → chữ ký không còn khớp", () => {
    const svc = svcPure();
    const { payloadB64, sigB64 } = decodeToken(svc.buildSsoUrl("a@b.co").url);
    const tampered = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")),
        email: "attacker@evil.com",
      }),
      "utf8",
    ).toString("base64url");
    const recomputed = createHmac("sha256", SECRET).update(tampered).digest("base64url");
    expect(recomputed).not.toBe(sigB64);
  });
});

/**
 * mintSsoLink — audit-in-tx FAIL-CLOSED (S5-LMS-BE-2). Enum-guard + shape row THẬT phủ ở int-spec
 * (lms-sso-audit.int-spec.ts, AuditService thật). Ở đây kiểm control-flow: thứ tự, fail-closed, tenant,
 * và KHÔNG rò secret vào entry.
 */
describe("LmsSsoService.mintSsoLink — audit fail-closed", () => {
  const savedEnv = { secret: process.env.LMS_SSO_SECRET, base: process.env.LMS_BASE_URL };
  const USER = {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "22222222-2222-2222-2222-222222222222",
    email: "User@Example.com",
  };

  beforeEach(() => {
    process.env.LMS_SSO_SECRET = SECRET;
    process.env.LMS_BASE_URL = BASE_URL;
  });
  afterEach(() => {
    process.env.LMS_SSO_SECRET = savedEnv.secret;
    process.env.LMS_BASE_URL = savedEnv.base;
  });

  /** Mock DB có withTenant chạy callback với 1 tx giả (bắt entry mà audit.record nhận). */
  function makeSvc(opts: { withTenantRejects?: boolean } = {}) {
    const record = vi.fn().mockResolvedValue(undefined);
    const audit = { record } as unknown as AuditService;
    const withTenant = vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => {
      if (opts.withTenantRejects) throw new Error("tx failed (audit CHECK/FK)");
      return fn({} as unknown);
    });
    const db = { withTenant } as unknown as DatabaseService;
    return { svc: new LmsSsoService(db, audit), record, withTenant };
  }

  it("U1: mint OK → trả {url}, audit.record gọi đúng 1 lần với objectType/action/objectId(jti)/actor", async () => {
    const { svc, record, withTenant } = makeSvc();
    const { url } = await svc.mintSsoLink(USER);

    expect(url.startsWith(`${BASE_URL}/api/auth/sso?token=`)).toBe(true);
    // W1: audit ghi ĐÚNG tenant của user (bất biến #1).
    expect(withTenant).toHaveBeenCalledWith(USER.companyId, expect.any(Function));
    expect(record).toHaveBeenCalledTimes(1);

    const entry = record.mock.calls[0][1] as Record<string, unknown>;
    const jtiInUrl = decodeToken(url).payload.jti;
    expect(entry).toMatchObject({
      objectType: "lms_sso",
      action: "sso_link_minted",
      objectId: jtiInUrl,
      actorUserId: USER.id,
    });
  });

  it("U2: withTenant/audit reject → mintSsoLink reject, KHÔNG trả url (fail-closed)", async () => {
    const { svc } = makeSvc({ withTenantRejects: true });
    await expect(svc.mintSsoLink(USER)).rejects.toThrow(/tx failed/);
  });

  it("U3: thiếu env → 503 TRƯỚC mọi DB, withTenant KHÔNG được gọi (không audit)", async () => {
    delete process.env.LMS_SSO_SECRET;
    const { svc, withTenant } = makeSvc();
    await expect(svc.mintSsoLink(USER)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("U4: entry audit KHÔNG chứa token/chữ ký/secret (bất biến #3)", async () => {
    const { svc, record } = makeSvc();
    const { url } = await svc.mintSsoLink(USER);
    const token = decodeURIComponent(new URL(url).searchParams.get("token") ?? "");
    const [payloadB64, sigB64] = token.split(".");

    const serialized = JSON.stringify(record.mock.calls[0][1]);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(payloadB64);
    expect(serialized).not.toContain(sigB64);
    expect(serialized).not.toContain(SECRET);
    // objectId (jti) được phép — nó là định danh không nhạy cảm, KHÔNG phải secret material.
  });
});
