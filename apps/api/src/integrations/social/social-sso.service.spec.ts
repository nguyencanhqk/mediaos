import { createHmac } from "node:crypto";
import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../../db/db.service";
import type { AuditService } from "../../events/audit.service";
import { SocialSsoService, type SocialSsoMintUser } from "./social-sso.service";

// Ghép chuỗi + KHÔNG dùng literal hex/high-entropy → tránh trip gitleaks generic-api-key (CLAUDE.md §5).
const SECRET = ["test-social-sso-secret", "unit-test-only-not-a-real-secret-padding"].join("-");
const BASE_URL = "https://social.example.com";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY_ID = "22222222-2222-4222-8222-222222222222";

const USER: SocialSsoMintUser = {
  id: "u-1",
  companyId: COMPANY_ID,
  email: "User@Example.com",
  fullName: "Người Dùng",
};

function decodeToken(url: string) {
  const token = decodeURIComponent(new URL(url).searchParams.get("token") ?? "");
  const [payloadB64, sigB64] = token.split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
    sub: string;
    email: string;
    name: string;
    iat: number;
    exp: number;
    jti: string;
  };
  return { payloadB64, sigB64, payload };
}

describe("SocialSsoService", () => {
  const saved = {
    secret: process.env.SOCIAL_SSO_SECRET,
    base: process.env.SOCIAL_BASE_URL,
    company: process.env.SOCIAL_COMPANY_ID,
  };

  /** Stub cho test THUẦN buildSsoUrl — không chạm DB, mock không bao giờ được gọi. */
  const dbStub = { withTenant: vi.fn() } as unknown as DatabaseService;
  const auditStub = { record: vi.fn() } as unknown as AuditService;
  const pureSvc = (): SocialSsoService => new SocialSsoService(dbStub, auditStub);

  beforeEach(() => {
    process.env.SOCIAL_SSO_SECRET = SECRET;
    process.env.SOCIAL_BASE_URL = `${BASE_URL}/`; // service phải tự cắt "/" thừa
    process.env.SOCIAL_COMPANY_ID = COMPANY_ID;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.SOCIAL_SSO_SECRET = saved.secret;
    process.env.SOCIAL_BASE_URL = saved.base;
    process.env.SOCIAL_COMPANY_ID = saved.company;
  });

  it("phát URL đúng gốc fbpost với token HMAC verify được bằng shared secret", () => {
    const { url } = pureSvc().buildSsoUrl(USER);

    expect(url.startsWith(`${BASE_URL}/api/auth/sso?token=`)).toBe(true);
    const { payloadB64, sigB64, payload } = decodeToken(url);
    expect(sigB64).toBe(createHmac("sha256", SECRET).update(payloadB64).digest("base64url"));
    expect(payload.email).toBe("user@example.com"); // chuẩn hoá lowercase
    expect(payload.sub).toBe("u-1");
  });

  it("TTL đúng 60 giây và mỗi lần mint có jti KHÁC nhau", () => {
    const svc = pureSvc();
    const now = 1_700_000_000_000;
    const first = decodeToken(svc.buildSsoUrl(USER, now).url);
    expect(first.payload.exp - first.payload.iat).toBe(60_000);

    const second = decodeToken(svc.buildSsoUrl(USER, now).url);
    expect(second.payload.jti).not.toBe(first.payload.jti);
  });

  // ── CỔNG CÔNG TY — điểm khác biệt so với LmsSsoService (DECISIONS-08 SOCIAL-DEC-002) ──
  describe("cổng công ty", () => {
    it("công ty KHÁC SOCIAL_COMPANY_ID KHÔNG mint được (BẤT BIẾN #1 giữ ở cầu)", () => {
      expect(() => pureSvc().buildSsoUrl({ ...USER, companyId: OTHER_COMPANY_ID })).toThrow(
        ForbiddenException,
      );
    });

    it("THIẾU SOCIAL_COMPANY_ID → 503, KHÔNG phải 'cho mọi công ty'", () => {
      // Vắng cấu hình phải fail-closed. Nếu chỗ này nới thành cho-qua thì mọi tenant dùng chung
      // một kho token Facebook — vỡ bất biến #1 theo cách im lặng nhất.
      delete process.env.SOCIAL_COMPANY_ID;
      expect(() => pureSvc().buildSsoUrl(USER)).toThrow(ServiceUnavailableException);
    });

    it("cổng công ty chặn TRƯỚC khi sinh bất kỳ chất liệu token nào", async () => {
      // Sai công ty thì KHÔNG được chạm DB, KHÔNG được ghi audit — nếu không thì công ty ngoài
      // phạm vi vẫn để lại vết mint trong audit của chính họ.
      const svc = pureSvc();
      await expect(svc.mintSsoLink({ ...USER, companyId: OTHER_COMPANY_ID })).rejects.toThrow(
        ForbiddenException,
      );
      expect(dbStub.withTenant).not.toHaveBeenCalled();
      expect(auditStub.record).not.toHaveBeenCalled();
    });
  });

  describe("thiếu cấu hình", () => {
    it("thiếu secret → 503 và KHÔNG chặn boot", () => {
      delete process.env.SOCIAL_SSO_SECRET;
      expect(pureSvc().isEnabled()).toBe(false);
      expect(() => pureSvc().buildSsoUrl(USER)).toThrow(ServiceUnavailableException);
    });

    it("thiếu base URL → 503", () => {
      delete process.env.SOCIAL_BASE_URL;
      expect(() => pureSvc().buildSsoUrl(USER)).toThrow(ServiceUnavailableException);
    });
  });

  describe("audit fail-closed", () => {
    it("audit ghi TRƯỚC khi trả url, với objectType social_sso + objectId = jti", async () => {
      const record = vi.fn().mockResolvedValue(undefined);
      const withTenant = vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      );
      const svc = new SocialSsoService(
        { withTenant } as unknown as DatabaseService,
        { record } as unknown as AuditService,
      );

      const { url } = await svc.mintSsoLink(USER);

      expect(withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
      const entry = record.mock.calls[0][1];
      expect(entry.objectType).toBe("social_sso");
      expect(entry.action).toBe("sso_link_minted");
      expect(entry.objectId).toBe(decodeToken(url).payload.jti);
    });

    it("audit VỠ → KHÔNG trả url (token không rò ra ngoài)", async () => {
      const withTenant = vi.fn(async () => {
        throw new Error("audit vo");
      });
      const svc = new SocialSsoService(
        { withTenant } as unknown as DatabaseService,
        { record: vi.fn() } as unknown as AuditService,
      );

      await expect(svc.mintSsoLink(USER)).rejects.toThrow("audit vo");
    });

    it("KHÔNG đưa token/chữ ký/email vào payload audit (BẤT BIẾN #3)", async () => {
      const record = vi.fn().mockResolvedValue(undefined);
      const withTenant = vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({}));
      const svc = new SocialSsoService(
        { withTenant } as unknown as DatabaseService,
        { record } as unknown as AuditService,
      );

      const { url } = await svc.mintSsoLink(USER);
      const token = decodeURIComponent(new URL(url).searchParams.get("token") ?? "");
      const serialised = JSON.stringify(record.mock.calls[0][1]);

      expect(serialised).not.toContain(token);
      expect(serialised).not.toContain(USER.email.toLowerCase());
      expect(serialised).not.toContain(SECRET);
    });
  });
});
