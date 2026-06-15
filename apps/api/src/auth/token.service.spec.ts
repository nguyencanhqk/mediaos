import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtSecretMissingError, TokenService } from "./token.service";

const TEST_SECRET = "x".repeat(40);

describe("TokenService", () => {
  const prev = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    process.env.JWT_SECRET = prev;
  });

  it("ký + verify access token round-trip giữ nguyên claims", () => {
    const svc = new TokenService();
    const token = svc.signAccessToken({ sub: "u1", companyId: "c1", email: "a@b.c" });
    const claims = svc.verifyAccessToken(token);
    expect(claims).toMatchObject({ sub: "u1", companyId: "c1", email: "a@b.c" });
  });

  it("verify token bị sửa → throw", () => {
    const svc = new TokenService();
    const token = svc.signAccessToken({ sub: "u1", companyId: "c1", email: "a@b.c" });
    expect(() => svc.verifyAccessToken(token + "tamper")).toThrow();
  });

  it("CHẶN token confusion: challenge 2FA (tfp:true) KHÔNG được dùng như access token", () => {
    const svc = new TokenService();
    const challenge = svc.signTwoFactorChallenge({ sub: "u1", companyId: "c1" });
    // Cùng secret/algo nên jwt.verify qua, nhưng verifyAccessToken phải từ chối (thiếu email + có tfp).
    expect(() => svc.verifyAccessToken(challenge)).toThrow();
    // Ngược lại: verifyTwoFactorChallenge KHÔNG nhận access token thường (thiếu tfp).
    const access = svc.signAccessToken({ sub: "u1", companyId: "c1", email: "a@b.c" });
    expect(() => svc.verifyTwoFactorChallenge(access)).toThrow();
    // Round-trip challenge hợp lệ.
    expect(svc.verifyTwoFactorChallenge(challenge)).toMatchObject({ sub: "u1", companyId: "c1" });
  });

  it("hashToken xác định + khác plaintext; generateOpaqueToken ngẫu nhiên", () => {
    const svc = new TokenService();
    const plain = svc.generateOpaqueToken();
    expect(svc.hashToken(plain)).toBe(svc.hashToken(plain)); // xác định
    expect(svc.hashToken(plain)).not.toContain(plain);
    expect(svc.generateOpaqueToken()).not.toBe(svc.generateOpaqueToken());
  });

  it("thiếu JWT_SECRET → JwtSecretMissingError khi ký", () => {
    delete process.env.JWT_SECRET;
    const svc = new TokenService();
    expect(() => svc.signAccessToken({ sub: "u", companyId: "c", email: "e" })).toThrow(
      JwtSecretMissingError,
    );
    process.env.JWT_SECRET = TEST_SECRET;
  });
});
