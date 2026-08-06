import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

/**
 * Cong CAU HINH kho video — deny-path o RANH GIOI HTTP.
 *
 * Vi sao phai co file nay du da co `admin.spec.ts`: bai kia chi kiem HAM `isAdminEmail`. Xoa bon
 * dong guard trong route handler thi toan bo test van xanh — tuc la khong co gi giu cho cong nay
 * ton tai. Cong phai duoc chung minh o dung noi client cham vao.
 *
 * "Them mot thu muc goc" = tu mo rong pham vi file may chu duoc doc. fbpost khong co vai tro trong
 * app (phien la nhi phan), nen day la ranh gioi quyen DUY NHAT trong ca app.
 */

const SESSION_SECRET = "example-session-secret-".padEnd(40, "x");
const ADMIN = "sep@example.com";
const NHAN_VIEN = "seo@example.com";

let base: string;
let khoDir: string;

async function route() {
  return import("./route");
}

function req(method: string, body?: unknown, cookie?: string, query = ""): NextRequest {
  const r = new NextRequest(new URL(`http://localhost:3500/api/library/roots${query}`), {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (cookie) r.cookies.set(SESSION_COOKIE, cookie);
  return r;
}

async function sessionFor(email: string): Promise<string> {
  return signSession({ sub: "u-1", email, name: "Người dùng" });
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "fbpost-roots-route-"));
  khoDir = join(base, "kho-video");
  mkdirSync(khoDir, { recursive: true });
  mkdirSync(join(base, "data"), { recursive: true });
  writeFileSync(join(base, "data", "kek.bin"), randomBytes(32));

  process.env.SOCIAL_DATA_DIR = join(base, "data");
  process.env.SOCIAL_KEK_PATH = join(base, "data", "kek.bin");
  process.env.SOCIAL_SESSION_SECRET = SESSION_SECRET;
  process.env.SOCIAL_ADMIN_EMAILS = ADMIN;
  delete process.env.SOCIAL_MEDIA_LIBRARY_DIRS;
  vi.resetModules();
});

afterEach(() => {
  for (const k of [
    "SOCIAL_DATA_DIR",
    "SOCIAL_KEK_PATH",
    "SOCIAL_SESSION_SECRET",
    "SOCIAL_ADMIN_EMAILS",
    "SOCIAL_MEDIA_LIBRARY_DIRS",
  ]) {
    delete process.env[k];
  }
  vi.resetModules();
});

/** So kho dang co — dung de chung minh request bi tu choi KHONG he ghi gi. */
async function soKho(): Promise<number> {
  const { storedRoots } = await import("@/lib/library/roots-store");
  return storedRoots().length;
}

describe("POST /api/library/roots — cong ghi", () => {
  it("email NGOAI danh sach → 403 va KHONG ghi gi", async () => {
    const { POST } = await route();
    const res = await POST(
      req("POST", { label: "Lén", path: khoDir }, await sessionFor(NHAN_VIEN)),
    );

    expect(res.status).toBe(403);
    // Tra 403 ma van ghi thi cong chi la trang tri — phai do CA HAI.
    expect(await soKho()).toBe(0);
  });

  it("KHONG dat SOCIAL_ADMIN_EMAILS → 403 ke ca voi email quan tri (fail-closed)", async () => {
    delete process.env.SOCIAL_ADMIN_EMAILS;
    vi.resetModules();

    const { POST } = await route();
    const res = await POST(req("POST", { label: "Kho", path: khoDir }, await sessionFor(ADMIN)));

    expect(res.status).toBe(403);
    expect(await soKho()).toBe(0);
  });

  it("khong co cookie phien → 403, khong ghi gi", async () => {
    const { POST } = await route();
    const res = await POST(req("POST", { label: "Kho", path: khoDir }));

    expect(res.status).toBe(403);
    expect(await soKho()).toBe(0);
  });

  it("cookie ky bang bi mat KHAC → 403 (khong tu khai duoc email)", async () => {
    const that = process.env.SOCIAL_SESSION_SECRET;
    process.env.SOCIAL_SESSION_SECRET = "example-session-secret-KHAC-".padEnd(40, "y");
    const cookieGia = await signSession({ sub: "u-9", email: ADMIN, name: "Giả" });
    process.env.SOCIAL_SESSION_SECRET = that;

    const { POST } = await route();
    const res = await POST(req("POST", { label: "Kho", path: khoDir }, cookieGia));

    expect(res.status).toBe(403);
    expect(await soKho()).toBe(0);
  });

  it("email trong danh sach → them duoc", async () => {
    const { POST } = await route();
    const res = await POST(req("POST", { label: "Kho", path: khoDir }, await sessionFor(ADMIN)));

    expect(res.status).toBe(201);
    expect(await soKho()).toBe(1);
  });

  it("nhap tai khoan ma bo trong mat khau → tu choi (khong luu tai khoan rong)", async () => {
    const { POST } = await route();
    const res = await POST(
      req(
        "POST",
        { label: "Ổ mạng", path: "//MAY-A/share", username: "ADMIN", password: "" },
        await sessionFor(ADMIN),
      ),
    );

    expect(res.status).toBe(400);
    expect(await soKho()).toBe(0);
  });
});

describe("DELETE /api/library/roots — cong ghi", () => {
  it("email NGOAI danh sach → 403 va kho VAN CON", async () => {
    const { POST, DELETE } = await route();
    await POST(req("POST", { label: "Kho", path: khoDir }, await sessionFor(ADMIN)));
    expect(await soKho()).toBe(1);

    const res = await DELETE(req("DELETE", undefined, await sessionFor(NHAN_VIEN), "?key=cfg:1"));

    expect(res.status).toBe(403);
    expect(await soKho()).toBe(1);
  });
});

describe("GET /api/library/roots — duong doc", () => {
  it("nguoi KHONG duoc cau hinh: khong thay duong dan tuyet doi cua may chu", async () => {
    const { POST, GET } = await route();
    await POST(req("POST", { label: "Kho", path: khoDir }, await sessionFor(ADMIN)));

    const res = await GET(req("GET", undefined, await sessionFor(NHAN_VIEN)));
    const body = await res.json();

    expect(body.data.canManage).toBe(false);
    expect(body.data.roots[0].path).toBeNull();
    // Va phai noi ro dang dang nhap bang email nao — khong thi nguoi dung chi thay nut bien mat.
    expect(body.data.signedInAs).toBe(NHAN_VIEN);
    expect(JSON.stringify(body)).not.toContain(khoDir);
  });

  it("nguoi duoc cau hinh: thay du duong dan de sua", async () => {
    const { POST, GET } = await route();
    await POST(req("POST", { label: "Kho", path: khoDir }, await sessionFor(ADMIN)));

    const res = await GET(req("GET", undefined, await sessionFor(ADMIN)));
    const body = await res.json();

    expect(body.data.canManage).toBe(true);
    expect(body.data.roots[0].path).toBe(khoDir);
  });
});
