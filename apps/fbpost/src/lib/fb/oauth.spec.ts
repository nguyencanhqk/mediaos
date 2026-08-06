import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DESKTOP_REDIRECT_URI,
  OAUTH_CALLBACK_PATH,
  PUBLIC_ORIGIN_ENV,
  resolvePublicOrigin,
  resolveRedirectUri,
} from "./oauth";

/**
 * Trong tam: DIA CHI TRA VE gui cho Facebook khi chay sau proxy.
 *
 * Bug that (06/08/2026): dia chi do duoc dung tu `request.nextUrl.origin`. Sau Cloudflare tunnel,
 * Next thay `Host: localhost:3500` ⇒ redirect_uri = `https://localhost:3500/...` ⇒ dang nhap xong
 * Facebook day trinh duyet ve localhost:3500 qua HTTPS, cong do khong co TLS ⇒ ERR_SSL_PROTOCOL_ERROR.
 * Facebook KHONG chan vi app dang o che do Development (localhost duoc mien) — loi chi lo ra tren
 * man hinh nguoi dung.
 */

/** Chinh la goc ma Next nhin thay sau tunnel — khong phai goc nguoi dung go tren trinh duyet. */
const INTERNAL_ORIGIN = "https://localhost:3500";
const PUBLIC_ORIGIN = "https://dangfb.funtimemediacorp.com";

beforeEach(() => {
  delete process.env[PUBLIC_ORIGIN_ENV];
});

afterEach(() => {
  delete process.env[PUBLIC_ORIGIN_ENV];
});

describe("resolveRedirectUri", () => {
  it("dung goc CONG KHAI tu env, khong dung host noi bo cua request", () => {
    process.env[PUBLIC_ORIGIN_ENV] = PUBLIC_ORIGIN;

    const uri = resolveRedirectUri("local", INTERNAL_ORIGIN);

    // Truoc khi va, gia tri o day la "https://localhost:3500/api/auth/facebook/callback".
    expect(uri).not.toContain("localhost");
    expect(uri).toBe(`${PUBLIC_ORIGIN}${OAUTH_CALLBACK_PATH}`);
  });

  it("chua dat env thi lui ve goc cua request — may dev chay next dev", () => {
    expect(resolveRedirectUri("local", "http://localhost:3000")).toBe(
      `http://localhost:3000${OAUTH_CALLBACK_PATH}`,
    );
  });

  it("kieu desktop khong dinh env — van la dia chi danh san cua Facebook", () => {
    process.env[PUBLIC_ORIGIN_ENV] = PUBLIC_ORIGIN;
    expect(resolveRedirectUri("desktop", INTERNAL_ORIGIN)).toBe(DESKTOP_REDIRECT_URI);
  });
});

describe("resolvePublicOrigin", () => {
  it("bo duong dan va dau gach cuoi — chuoi phai khop TUNG KY TU voi khai bao ben Facebook", () => {
    process.env[PUBLIC_ORIGIN_ENV] = `${PUBLIC_ORIGIN}/`;
    expect(resolvePublicOrigin(INTERNAL_ORIGIN)).toBe(PUBLIC_ORIGIN);

    process.env[PUBLIC_ORIGIN_ENV] = `${PUBLIC_ORIGIN}/settings`;
    expect(resolvePublicOrigin(INTERNAL_ORIGIN)).toBe(PUBLIC_ORIGIN);
  });

  it("khoang trang thua trong file env khong lam hong dia chi", () => {
    process.env[PUBLIC_ORIGIN_ENV] = `  ${PUBLIC_ORIGIN}  `;
    expect(resolvePublicOrigin(INTERNAL_ORIGIN)).toBe(PUBLIC_ORIGIN);
  });

  it("env sai dinh dang thi BAO LOI, khong am tham lui ve localhost", () => {
    // Lui im lang o day = tai dung bug cu, va lan nay khong ai biet vi sao.
    process.env[PUBLIC_ORIGIN_ENV] = "dangfb.funtimemediacorp.com";
    expect(() => resolvePublicOrigin(INTERNAL_ORIGIN)).toThrow(PUBLIC_ORIGIN_ENV);
  });
});
