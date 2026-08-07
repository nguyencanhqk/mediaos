import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bo test cho route SSO — trong tam la DIEU HUONG KHI DUNG SAU PROXY.
 *
 * Bug that (06/08/2026): fbpost chay sau Cloudflare tunnel, cloudflared chuyen tiep toi
 * `http://localhost:3500` nen Next thay `Host: localhost:3500`. Code cu dung
 * `new URL("/", request.nextUrl.origin)` ⇒ dang nhap XONG bi day toi `https://localhost:3500/`,
 * mot dia chi khong ton tai tren may nguoi dung. Cookie dat dung ma van khong vao duoc.
 *
 * Bo smoke luc do bao 8/8 PASS vi no chi kiem CO cookie, khong kiem cookie do dan di dau —
 * mot bai hoc rieng: "dat duoc phien" khong dong nghia "vao duoc ung dung".
 */

const SECRET = "example-sso-secret-".padEnd(40, "x");

let dataDir: string;

function makeToken(secret = SECRET): string {
  const payload = {
    sub: "user-1",
    email: "a@example.com",
    name: "Nguoi Dung",
    iat: Date.now(),
    exp: Date.now() + 60_000,
    jti: randomUUID(),
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

/** Yeu cau ĐÚNG NHU cloudflared chuyen tiep: Host noi bo, con URL cong khai o header X-Forwarded-*. */
function proxiedRequest(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3500${path}`), {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "dangfb.funtimemediacorp.com",
    },
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "fbpost-ssoroute-"));
  writeFileSync(join(dataDir, "kek.bin"), randomBytes(32));
  process.env.SOCIAL_DATA_DIR = dataDir;
  process.env.SOCIAL_KEK_PATH = join(dataDir, "kek.bin");
  process.env.MEDIAOS_SSO_SECRET = SECRET;
  process.env.SOCIAL_SESSION_SECRET = SECRET;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  delete process.env.MEDIAOS_SSO_SECRET;
  delete process.env.SOCIAL_SESSION_SECRET;
  vi.resetModules();
});

describe("GET /api/auth/sso — dieu huong sau proxy", () => {
  it("dang nhap THANH CONG dieu huong TUONG DOI, khong chua host noi bo", async () => {
    const { GET } = await import("./route");
    const res = await GET(proxiedRequest(`/api/auth/sso?token=${encodeURIComponent(makeToken())}`));

    const location = res.headers.get("location") ?? "";
    // Day la ca da hong that: truoc khi va, gia tri o day la "https://localhost:3500/".
    expect(location).not.toContain("localhost");
    expect(location).toBe("/");
    // Van phai cap cookie — sua dieu huong khong duoc lam mat phien.
    expect(res.headers.get("set-cookie") ?? "").toContain("fbpost_session=");
  });

  it("token hong dieu huong TUONG DOI ve /login, khong chua host noi bo", async () => {
    const { GET } = await import("./route");
    const res = await GET(proxiedRequest("/api/auth/sso?token=rac"));

    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("localhost");
    expect(location).toBe("/login?error=invalid-token");
  });

  it("thieu token dieu huong TUONG DOI ve /login", async () => {
    const { GET } = await import("./route");
    const res = await GET(proxiedRequest("/api/auth/sso"));

    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("localhost");
    expect(location).toBe("/login?error=missing-token");
  });

  it("KHONG lo ly do token hong ra URL — ba ly do deu cho cung mot thong bao", async () => {
    // Phan biet duoc "sai chu ky" / "het han" / "da dung roi" la mot kenh ro thong tin cho ke
    // dang thu token. Nguoi dung that chi can biet "quay lai MediaOS bam lai".
    const { GET } = await import("./route");
    const token = makeToken();

    // Lan 1 thanh cong, lan 2 la phat lai.
    await GET(proxiedRequest(`/api/auth/sso?token=${encodeURIComponent(token)}`));
    const replay = await GET(proxiedRequest(`/api/auth/sso?token=${encodeURIComponent(token)}`));
    const wrongSig = await GET(
      proxiedRequest(
        `/api/auth/sso?token=${encodeURIComponent(makeToken("example-secret-KHAC-".padEnd(40, "y")))}`,
      ),
    );

    expect(replay.headers.get("location")).toBe("/login?error=invalid-token");
    expect(wrongSig.headers.get("location")).toBe(replay.headers.get("location"));
  });
});
