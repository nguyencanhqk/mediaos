import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bo test cho duong Facebook goi nguoc ve — trong tam la NOI NGUOI DUNG BI DAY TOI sau do.
 *
 * Cung ho voi bug cua route SSO: dung `new URL("/settings", request.nextUrl.origin)` thi sau tunnel
 * moi ket thuc (thanh cong lan that bai) deu day nguoi dung toi `https://localhost:3500/settings`.
 * Cac ca o day khong cham mang Facebook — chung chi kiem header `Location`.
 */

let dataDir: string;

function proxiedRequest(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3500${path}`), {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "dangfb.funtimemediacorp.com",
      ...(cookie ? { cookie } : {}),
    },
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "fbpost-fbcb-"));
  writeFileSync(join(dataDir, "kek.bin"), randomBytes(32));
  process.env.SOCIAL_DATA_DIR = dataDir;
  process.env.SOCIAL_KEK_PATH = join(dataDir, "kek.bin");
  process.env.SOCIAL_BASE_URL = "https://dangfb.funtimemediacorp.com";
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  delete process.env.SOCIAL_BASE_URL;
  vi.resetModules();
});

describe("GET /api/auth/facebook/callback — dieu huong sau proxy", () => {
  it("state khong khop: dieu huong TUONG DOI ve /settings, khong chua host noi bo", async () => {
    const { GET } = await import("./route");

    const res = await GET(
      proxiedRequest("/api/auth/facebook/callback?code=abc&state=lac", "fbpost_oauth_state=khac"),
    );
    const location = res.headers.get("location") ?? "";

    expect(location).not.toContain("localhost");
    expect(location.startsWith("/settings?loginError=")).toBe(true);
  });

  it("Facebook tu choi: thong bao cua Facebook di kem, van la duong dan tuong doi", async () => {
    const { GET } = await import("./route");

    const res = await GET(
      proxiedRequest("/api/auth/facebook/callback?error=access_denied&error_description=Nguoi+dung+huy"),
    );
    const location = res.headers.get("location") ?? "";
    const message = new URLSearchParams(location.split("?")[1]).get("loginError") ?? "";

    expect(location).not.toContain("localhost");
    expect(message).toContain("Nguoi dung huy");
  });

  it("thieu code: khong bao gio tra JSON tho ra man hinh", async () => {
    const { GET } = await import("./route");

    const res = await GET(proxiedRequest("/api/auth/facebook/callback"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location") ?? "").toMatch(/^\/settings\?loginError=/);
  });
});
