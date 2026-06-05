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
