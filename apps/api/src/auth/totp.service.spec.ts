import { describe, expect, it } from "vitest";
import { TotpService } from "./totp.service";

describe("TotpService (RFC 6238 TOTP)", () => {
  const svc = new TotpService();

  it("generateSecret trả base32 KHÁC nhau mỗi lần", () => {
    const a = svc.generateSecret();
    const b = svc.generateSecret();
    expect(a).toMatch(/^[A-Z2-7]+$/); // base32
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });

  it("round-trip: mã sinh từ secret → verify true", () => {
    const secret = svc.generateSecret();
    const token = svc.generate(secret);
    expect(svc.verify(token, secret)).toBe(true);
  });

  it("mã sai → verify false (KHÔNG throw)", () => {
    const secret = svc.generateSecret();
    expect(svc.verify("000000", secret)).toBe(false);
    expect(svc.verify("not-a-code", secret)).toBe(false);
    expect(svc.verify("", secret)).toBe(false);
  });

  it("mã đúng nhưng SECRET khác → verify false (không dùng chung secret)", () => {
    const s1 = svc.generateSecret();
    const s2 = svc.generateSecret();
    const token = svc.generate(s1);
    expect(svc.verify(token, s2)).toBe(false);
  });

  it("keyUri là otpauth:// chứa issuer FUNTIME MEDIA + accountName", () => {
    const secret = svc.generateSecret();
    const uri = svc.keyUri("alice@acme.test", secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("FUNTIME%20MEDIA"); // dấu cách PHẢI được encode (otplib encodeURIComponent)
    expect(uri).not.toContain("FUNTIME MEDIA"); // space thật trong URI ⇒ vỡ new URL() parse ở int-spec
    expect(uri).toContain("alice%40acme.test"); // email URL-encoded
    expect(uri).toContain(`secret=${secret}`);
  });
});
