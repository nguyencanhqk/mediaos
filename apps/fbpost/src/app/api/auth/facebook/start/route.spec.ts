import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bo test cho route mo cua so dang nhap Facebook — trong tam la DIA CHI TRA VE gui cho Facebook.
 *
 * Bug that (06/08/2026): route dung redirect_uri tu `request.nextUrl.origin`. Chay sau Cloudflare
 * tunnel, Next thay `Host: localhost:3500` nen Facebook duoc bao "xong thi tra ve
 * https://localhost:3500/..." — va no lam dung nhu vay ⇒ nguoi dung nhan ERR_SSL_PROTOCOL_ERROR
 * (cong 3500 khong co TLS). Test nay chay voi request y het cloudflared chuyen tiep.
 */

const PUBLIC_ORIGIN = "https://dangfb.funtimemediacorp.com";
const APP_ID = "1234567890123456";
const APP_SECRET = "example-app-secret-".padEnd(40, "x");

let dataDir: string;

/** Yeu cau ĐÚNG NHU cloudflared chuyen tiep: Host noi bo, URL cong khai chi con o header. */
function proxiedRequest(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3500${path}`), {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "dangfb.funtimemediacorp.com",
    },
  });
}

async function seedLoginApp(): Promise<void> {
  const { saveSettings } = await import("@/lib/repo/settings-repo");
  saveSettings({ appId: APP_ID, appSecret: APP_SECRET });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "fbpost-fbstart-"));
  writeFileSync(join(dataDir, "kek.bin"), randomBytes(32));
  process.env.SOCIAL_DATA_DIR = dataDir;
  process.env.SOCIAL_KEK_PATH = join(dataDir, "kek.bin");
  process.env.SOCIAL_BASE_URL = PUBLIC_ORIGIN;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  delete process.env.SOCIAL_BASE_URL;
  vi.resetModules();
});

describe("GET /api/auth/facebook/start — dia chi tra ve khi dung sau proxy", () => {
  it("bao Facebook tra ve DOMAIN CONG KHAI, khong phai host noi bo", async () => {
    await seedLoginApp();
    const { GET } = await import("./route");

    const res = await GET(proxiedRequest("/api/auth/facebook/start"));
    const target = new URL(res.headers.get("location") ?? "");

    expect(target.origin).toBe("https://www.facebook.com");
    const redirectUri = target.searchParams.get("redirect_uri") ?? "";
    // Truoc khi va: "https://localhost:3500/api/auth/facebook/callback".
    expect(redirectUri).not.toContain("localhost");
    expect(redirectUri).toBe(`${PUBLIC_ORIGIN}/api/auth/facebook/callback`);
  });

  it("van cap cookie state chong CSRF", async () => {
    await seedLoginApp();
    const { GET } = await import("./route");

    const res = await GET(proxiedRequest("/api/auth/facebook/start"));
    const state = new URL(res.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const cookie = res.headers.get("set-cookie") ?? "";

    expect(state).not.toBe("");
    expect(cookie).toContain(`fbpost_oauth_state=${state}`);
    expect(cookie).toContain("HttpOnly");
  });

  it("kieu desktop van dung dia chi danh san cua Facebook", async () => {
    await seedLoginApp();
    const { GET } = await import("./route");

    const res = await GET(proxiedRequest("/api/auth/facebook/start?mode=desktop"));
    const redirectUri =
      new URL(res.headers.get("location") ?? "").searchParams.get("redirect_uri") ?? "";

    expect(redirectUri).toBe("https://www.facebook.com/connect/login_success.html");
  });

  it("chua cau hinh App ID/Secret: dieu huong TUONG DOI ve /settings, khong chua host noi bo", async () => {
    const { GET } = await import("./route");

    const res = await GET(proxiedRequest("/api/auth/facebook/start"));
    const location = res.headers.get("location") ?? "";

    expect(location).not.toContain("localhost");
    expect(location.startsWith("/settings?loginError=")).toBe(true);
  });

  it("SOCIAL_BASE_URL sai dinh dang: bao loi doc duoc, KHONG lang le gui localhost cho Facebook", async () => {
    process.env.SOCIAL_BASE_URL = "dangfb.funtimemediacorp.com";
    await seedLoginApp();
    const { GET } = await import("./route");

    const res = await GET(proxiedRequest("/api/auth/facebook/start"));
    const location = res.headers.get("location") ?? "";

    expect(location).not.toContain("facebook.com");
    expect(decodeURIComponent(location)).toContain("SOCIAL_BASE_URL");
  });
});
