import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Duong dan UNC dung trong test — ghep tu ma ky tu de shell/heredoc khong nuot mat dau `\`. */
const BS = String.fromCharCode(92);
const UNC_SHARE = `${BS}${BS}MAY-A${BS}share`;

/**
 * Goc kho do nguoi dung them qua giao dien (luu trong bang `settings`).
 *
 * Bai xuong song: id KHONG DUOC DUNG LAI. Neu xoa goc `cfg:2` roi goc them moi cung mang id 2 thi
 * mot tab dang mo van tro `cfg:2` se lang le doc sang MOT KHO KHAC — nguoi dung khong he biet minh
 * dang nhin thu muc nao.
 */

let base: string;

async function store() {
  return import("./roots-store");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "fbpost-store-"));
  mkdirSync(join(base, "kho-1"), { recursive: true });
  mkdirSync(join(base, "kho-2"), { recursive: true });

  // KEK phai co TRUOC khi bao mat mat khau o dia chia se — moi ca test mot khoa rieng.
  mkdirSync(join(base, "data"), { recursive: true });
  writeFileSync(join(base, "data", "kek.bin"), randomBytes(32));

  process.env.SOCIAL_DATA_DIR = join(base, "data");
  process.env.SOCIAL_KEK_PATH = join(base, "data", "kek.bin");
  delete process.env.SOCIAL_MEDIA_LIBRARY_DIRS;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  vi.resetModules();
});

describe("roots-store", () => {
  it("chua them gi thi rong", async () => {
    const { storedRoots } = await store();
    expect(storedRoots()).toEqual([]);
  });

  it("them roi doc lai duoc, khoa co tien to cfg:", async () => {
    const { addStoredRoot, storedRoots } = await store();
    const added = addStoredRoot("Kho một", join(base, "kho-1"));

    expect(added.key).toBe("cfg:1");
    expect(added.source).toBe("config");
    expect(storedRoots()).toHaveLength(1);
  });

  it("nhan rong thi lay ten thu muc lam nhan", async () => {
    const { addStoredRoot } = await store();
    expect(addStoredRoot("  ", join(base, "kho-2")).label).toBe("kho-2");
  });

  it("them TRUNG duong dan thi khong nhan doi", async () => {
    const { addStoredRoot, storedRoots } = await store();
    const first = addStoredRoot("Kho một", join(base, "kho-1"));
    const again = addStoredRoot("Tên khác", join(base, "kho-1"));

    expect(again.key).toBe(first.key);
    expect(storedRoots()).toHaveLength(1);
  });

  it("KHONG dung lai id sau khi xoa — chong tro nham kho", async () => {
    const { addStoredRoot, removeStoredRoot, storedRoots } = await store();
    addStoredRoot("Một", join(base, "kho-1"));
    const second = addStoredRoot("Hai", join(base, "kho-2"));
    expect(second.key).toBe("cfg:2");

    expect(removeStoredRoot("cfg:2")).toBe(true);
    const third = addStoredRoot("Ba", join(base, "kho-3"));

    // Neu cho dung lai id thi day se la cfg:2 — va moi tab con dang mo `cfg:2` se doc nham kho.
    expect(third.key).toBe("cfg:3");
    expect(storedRoots().map((r) => r.key)).toEqual(["cfg:1", "cfg:3"]);
  });

  it("xoa khoa khong ton tai tra ve false", async () => {
    const { removeStoredRoot } = await store();
    expect(removeStoredRoot("cfg:99")).toBe(false);
    expect(removeStoredRoot("env:0")).toBe(false);
  });

  it("goc luu duoc GOP vao libraryRoots cung voi goc tu env", async () => {
    const { addStoredRoot } = await store();
    addStoredRoot("Từ giao diện", join(base, "kho-1"));

    process.env.SOCIAL_MEDIA_LIBRARY_DIRS = join(base, "kho-2");
    const { libraryRoots } = await import("./roots");

    const roots = libraryRoots();
    expect(roots.map((r) => r.source)).toEqual(["env", "config"]);
    expect(roots.map((r) => r.key)).toEqual(["env:0", "cfg:1"]);
  });
});

describe("tai khoan o dia chia se", () => {
  it("mat khau KHONG nam tho trong CSDL", async () => {
    const { addStoredRoot } = await store();
    const { getDb } = await import("../db");

    const secret = ["example-share", "password", "0123456789"].join("-");
    addStoredRoot("Ổ mạng", UNC_SHARE, { username: "ADMIN", password: secret });

    // Doc THO tu bang settings — dung con duong ke lay cap file CSDL se dung.
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = 'mediaLibraryRoots'")
      .get() as { value: string };
    expect(row.value).not.toContain(secret);
    expect(row.value).toContain("ADMIN"); // ten tai khoan KHONG phai bi mat
  });

  it("doc lai dung tai khoan va mat khau", async () => {
    const { addStoredRoot, credentialFor } = await store();
    const secret = ["example-share", "password", "9876543210"].join("-");
    const root = addStoredRoot("Ổ mạng", UNC_SHARE, {
      username: "ADMIN",
      password: secret,
    });

    expect(credentialFor(root.key)).toEqual({ username: "ADMIN", password: secret });
  });

  it("storedRoots tra ve TEN tai khoan nhung KHONG tra mat khau", async () => {
    const { addStoredRoot, storedRoots } = await store();
    addStoredRoot("Ổ mạng", UNC_SHARE, {
      username: "ADMIN",
      password: ["example-share", "password", "5555"].join("-"),
    });

    const root = storedRoots()[0];
    expect(root.username).toBe("ADMIN");
    expect(JSON.stringify(root)).not.toContain("password");
  });

  it("them lai cung duong dan = CAP NHAT, khong tao dong thu hai", async () => {
    const { addStoredRoot, storedRoots, credentialFor } = await store();
    const first = addStoredRoot("Ổ mạng", UNC_SHARE, {
      username: "cu",
      password: ["example-share", "password", "cu"].join("-"),
    });
    const moi = ["example-share", "password", "moi"].join("-");
    const second = addStoredRoot("Ổ mạng", UNC_SHARE, { username: "moi", password: moi });

    expect(second.key).toBe(first.key);
    expect(storedRoots()).toHaveLength(1);
    expect(credentialFor(first.key)).toEqual({ username: "moi", password: moi });
  });

  it("de trong tai khoan (undefined) thi GIU nguyen tai khoan cu", async () => {
    const { addStoredRoot, credentialFor } = await store();
    const pass = ["example-share", "password", "giu"].join("-");
    const root = addStoredRoot("Ổ mạng", UNC_SHARE, { username: "ADMIN", password: pass });

    addStoredRoot("Tên mới", UNC_SHARE);
    expect(credentialFor(root.key)).toEqual({ username: "ADMIN", password: pass });
  });

  it("truyen null thi XOA tai khoan", async () => {
    const { addStoredRoot, credentialFor } = await store();
    const root = addStoredRoot("Ổ mạng", UNC_SHARE, {
      username: "ADMIN",
      password: ["example-share", "password", "xoa"].join("-"),
    });

    addStoredRoot("Ổ mạng", UNC_SHARE, null);
    expect(credentialFor(root.key)).toBeNull();
  });

  it("kho khong co tai khoan thi credentialFor tra null", async () => {
    const { addStoredRoot, credentialFor } = await store();
    const root = addStoredRoot("Cục bộ", join(base, "kho-1"));
    expect(credentialFor(root.key)).toBeNull();
  });
});
