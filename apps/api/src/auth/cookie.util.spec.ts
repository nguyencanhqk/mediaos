import { describe, it, expect } from "vitest";
import {
  clearCookie,
  csrfTokensMatch,
  generateCsrfToken,
  parseCookies,
  serializeCookie,
} from "./cookie.util";

/**
 * FS-1a — tiện ích cookie SSO (pure). Phủ: parse raw header, serialize đủ flag bảo mật (HttpOnly/Secure/
 * Domain/SameSite/Max-Age), clear (Max-Age=0), CSRF compare hằng-thời-gian. KHÔNG cần DB.
 */
describe("cookie.util — parseCookies", () => {
  it("parse nhiều cookie + trim khoảng trắng", () => {
    const out = parseCookies("mediaos_rt=abc; mediaos_csrf=xyz");
    expect(out.mediaos_rt).toBe("abc");
    expect(out.mediaos_csrf).toBe("xyz");
  });

  it("percent-decode giá trị (đối xứng serialize)", () => {
    expect(parseCookies("k=a%20b%3Dc").k).toBe("a b=c");
  });

  it("bỏ nháy kép bao quanh (RFC6265)", () => {
    expect(parseCookies('k="quoted"').k).toBe("quoted");
  });

  it("header rỗng/undefined → object rỗng (không throw)", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("bỏ phần không có dấu '=' (đầu vào rác không làm hỏng parse)", () => {
    const out = parseCookies("garbage; k=v");
    expect(out.k).toBe("v");
    expect(Object.keys(out)).toEqual(["k"]);
  });

  it("giá trị percent không hợp lệ → giữ nguyên (không nuốt lỗi câm)", () => {
    expect(parseCookies("k=%E0%A4%A").k).toBe("%E0%A4%A");
  });
});

describe("cookie.util — serializeCookie", () => {
  it("gắn đủ flag refresh cookie: HttpOnly + Secure + Domain + SameSite=Strict + Max-Age + Path", () => {
    const c = serializeCookie("mediaos_rt", "tok", {
      httpOnly: true,
      secure: true,
      domain: ".mediaos.example",
      sameSite: "Strict",
      maxAgeSec: 3600,
    });
    expect(c).toContain("mediaos_rt=tok");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("Domain=.mediaos.example");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Max-Age=3600");
    expect(c).toContain("Path=/");
  });

  it("KHÔNG có Domain khi domain rỗng (host-only dev)", () => {
    expect(serializeCookie("k", "v", { domain: "" })).not.toContain("Domain=");
  });

  it("CSRF cookie KHÔNG HttpOnly (client phải đọc được) nhưng vẫn Secure + Strict", () => {
    const c = serializeCookie("mediaos_csrf", "csrf", { secure: true, httpOnly: false });
    expect(c).not.toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Strict");
  });

  it("encode value (ký tự đặc biệt không phá header)", () => {
    expect(serializeCookie("k", "a b;c").split(";")[0]).toBe("k=a%20b%3Bc");
  });

  it("SameSite mặc định Strict khi không truyền", () => {
    expect(serializeCookie("k", "v")).toContain("SameSite=Strict");
  });

  it("Max-Age âm bị clamp về 0", () => {
    expect(serializeCookie("k", "v", { maxAgeSec: -5 })).toContain("Max-Age=0");
  });
});

describe("cookie.util — clearCookie", () => {
  it("Max-Age=0 + value rỗng, GIỮ Domain/Path để xoá đúng cookie", () => {
    const c = clearCookie("mediaos_rt", { domain: ".mediaos.example", httpOnly: true, secure: true });
    expect(c).toContain("mediaos_rt=;");
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("Domain=.mediaos.example");
    expect(c).toContain("HttpOnly");
  });
});

describe("cookie.util — CSRF", () => {
  it("generateCsrfToken sinh chuỗi base64url đủ dài, khác nhau mỗi lần", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).not.toBe(b);
  });

  it("csrfTokensMatch: bằng nhau → true; khác → false", () => {
    const t = generateCsrfToken();
    expect(csrfTokensMatch(t, t)).toBe(true);
    expect(csrfTokensMatch(t, generateCsrfToken())).toBe(false);
  });

  it("thiếu một trong hai HOẶC khác độ dài → false (không throw)", () => {
    expect(csrfTokensMatch(undefined, "x")).toBe(false);
    expect(csrfTokensMatch("x", undefined)).toBe(false);
    expect(csrfTokensMatch("", "")).toBe(false);
    expect(csrfTokensMatch("short", "muchlongervalue")).toBe(false);
  });
});
