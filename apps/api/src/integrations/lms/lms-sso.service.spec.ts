import { createHmac } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LmsSsoService } from "./lms-sso.service";

// Ghép chuỗi + KHÔNG dùng literal hex/high-entropy → tránh trip gitleaks generic-api-key (CLAUDE.md §5).
const SECRET = ["test-lms-sso-secret", "unit-test-only-not-a-real-secret-padding"].join("-");
const BASE_URL = "https://lms.example.com";

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
    const svc = new LmsSsoService();
    const { url } = svc.buildSsoUrl("User@Example.com");

    expect(url.startsWith(`${BASE_URL}/api/auth/sso?token=`)).toBe(true);
    const { payloadB64, sigB64, payload } = decodeToken(url);
    const expectedSig = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
    expect(sigB64).toBe(expectedSig);
    expect(payload.email).toBe("user@example.com"); // email chuẩn hoá lowercase
  });

  it("token TTL 60s và jti không lặp giữa 2 lần phát (nền chống replay phía LMS)", () => {
    const svc = new LmsSsoService();
    const first = decodeToken(svc.buildSsoUrl("a@b.co").url);
    const second = decodeToken(svc.buildSsoUrl("a@b.co").url);

    expect(first.payload.exp - first.payload.iat).toBe(60_000);
    expect(first.payload.jti).not.toBe(second.payload.jti);
    expect(first.payload.jti.length).toBeGreaterThanOrEqual(8);
  });

  it("deny-path: thiếu env → 503 ServiceUnavailable, không phát token mù", () => {
    delete process.env.LMS_SSO_SECRET;
    const svc = new LmsSsoService();
    expect(() => svc.buildSsoUrl("a@b.co")).toThrow(ServiceUnavailableException);
  });

  it("deny-path: đổi 1 ký tự payload → chữ ký không còn khớp", () => {
    const svc = new LmsSsoService();
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
