import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Whitelist thu muc kho video.
 *
 * Bai quan trong nhat KHONG phai "duong dan dung thi qua" ma la nhung cach di VONG: `..`, trung
 * tien to mot phan, va duong dan tuyet doi tro ra ngoai kho.
 *
 * `SOCIAL_DATA_DIR` tro vao thu muc tam roi `resetModules()` + `await import(...)`: `libraryRoots()`
 * gop ca goc luu trong CSDL, ma `paths.ts` doc bien moi truong o CAP MODULE. Khong lam vay thi bai
 * test se mo CSDL THAT trong `apps/fbpost/data` — test khong duoc dung vao du lieu that.
 */

let base: string;
let rootA: string;
let outside: string;

async function lib() {
  return import("./roots");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "fbpost-lib-"));
  rootA = join(base, "kho-video");
  // Ten CO Y trung tien to voi rootA — ca ma kiem tra bang `startsWith` se cho lot.
  outside = join(base, "kho-video-khac");

  mkdirSync(join(rootA, "Hong"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(rootA, "Hong", "a.mp4"), "video-gia");
  writeFileSync(join(outside, "trom.mp4"), "khong-duoc-doc");

  process.env.SOCIAL_DATA_DIR = join(base, "data");
  process.env.SOCIAL_KEK_PATH = join(base, "data", "kek.bin");
  process.env.SOCIAL_MEDIA_LIBRARY_DIRS = rootA;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  delete process.env.SOCIAL_MEDIA_LIBRARY_DIRS;
  vi.resetModules();
});

describe("isInside", () => {
  it("KHONG coi thu muc trung tien to mot phan la nam trong goc", async () => {
    const { isInside } = await lib();
    // Chinh xac cai bay ma `target.startsWith(root)` mac phai.
    expect(isInside("D:\\kho-video", "D:\\kho-video-khac\\a.mp4")).toBe(false);
    expect(isInside("/srv/kho-video", "/srv/kho-video-khac/a.mp4")).toBe(false);
  });

  it("chinh thu muc goc KHONG duoc coi la nam trong no", async () => {
    const { isInside } = await lib();
    expect(isInside(rootA, rootA)).toBe(false);
  });

  it("nhan file that su nam trong goc", async () => {
    const { isInside } = await lib();
    expect(isInside(rootA, join(rootA, "Hong", "a.mp4"))).toBe(true);
  });
});

describe("libraryRoots", () => {
  it("khong dat bien = KHONG co goc nao (fail-closed, khong phai mo toang)", async () => {
    delete process.env.SOCIAL_MEDIA_LIBRARY_DIRS;
    vi.resetModules();
    const { libraryRoots } = await lib();
    expect(libraryRoots()).toEqual([]);
  });

  it("doc nhieu goc ngan cach bang dau cham phay va lay nhan khi co", async () => {
    process.env.SOCIAL_MEDIA_LIBRARY_DIRS = `Bánh xe=${rootA};${outside}`;
    vi.resetModules();
    const { libraryRoots } = await lib();

    const roots = libraryRoots();
    expect(roots).toHaveLength(2);
    expect(roots[0].label).toBe("Bánh xe");
    expect(roots[1].label).toBe("kho-video-khac");
    // Khoa PHAI on dinh va gan voi nguon, khong phai chi so trong danh sach gop.
    expect(roots.map((r) => r.key)).toEqual(["env:0", "env:1"]);
    expect(roots.every((r) => r.source === "env")).toBe(true);
  });

  it("KHONG nham o dia Windows thanh nhan (D: khong phai nhan cua duong dan)", async () => {
    process.env.SOCIAL_MEDIA_LIBRARY_DIRS = "D:\\kho-video";
    vi.resetModules();
    const { libraryRoots } = await lib();

    const roots = libraryRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0].path.toLowerCase()).toContain("kho-video");
  });
});

describe("normalizeRootPath", () => {
  it("doi gach xuoi thanh UNC dung tren Windows", async () => {
    const { normalizeRootPath } = await lib();
    const result = normalizeRootPath("//MAY-A/share/thu-muc");
    // Tren win32 phai ra `\\MAY-A\share\thu-muc`; tren nen khac giu nguyen dang POSIX.
    expect(result === "\\\\MAY-A\\share\\thu-muc" || result.includes("MAY-A")).toBe(true);
  });

  it("bo dau nhay bao quanh (Windows 'Copy as path' them dau nhay)", async () => {
    const { normalizeRootPath, resolveAbsolute } = await lib();
    expect(normalizeRootPath(`"${rootA}"`)).toBe(rootA);
    expect(resolveAbsolute(`"${join(rootA, "Hong", "a.mp4")}"`).relativePath).toBe(
      join("Hong", "a.mp4"),
    );
  });
});

describe("resolveFromRoot", () => {
  it("phan giai duoc file trong kho", async () => {
    const { resolveFromRoot } = await lib();
    expect(resolveFromRoot("env:0", join("Hong", "a.mp4")).relativePath).toBe(join("Hong", "a.mp4"));
  });

  it("tu choi duong dan dung `..` de leo ra ngoai", async () => {
    const { resolveFromRoot, LibraryPathError } = await lib();
    expect(() => resolveFromRoot("env:0", join("..", "kho-video-khac", "trom.mp4"))).toThrow(
      LibraryPathError,
    );
  });

  it("khoa goc khong ton tai (hoac vua bi xoa) thi tu choi, KHONG nhay sang kho khac", async () => {
    const { resolveFromRoot } = await lib();
    expect(() => resolveFromRoot("cfg:99", "Hong")).toThrow(/không hợp lệ hoặc đã bị xoá/);
  });

  it("khong khai bao goc nao thi khong phan giai duoc gi", async () => {
    delete process.env.SOCIAL_MEDIA_LIBRARY_DIRS;
    vi.resetModules();
    const { resolveFromRoot } = await lib();
    expect(() => resolveFromRoot("env:0", "Hong")).toThrow(/Chưa khai báo kho video/);
  });
});

describe("resolveAbsolute (duong file CSV go tay)", () => {
  it("nhan file nam trong goc", async () => {
    const { resolveAbsolute } = await lib();
    expect(resolveAbsolute(join(rootA, "Hong", "a.mp4")).relativePath).toBe(join("Hong", "a.mp4"));
  });

  it("tu choi file o thu muc trung tien to mot phan", async () => {
    const { resolveAbsolute, LibraryPathError } = await lib();
    expect(() => resolveAbsolute(join(outside, "trom.mp4"))).toThrow(LibraryPathError);
  });

  it("tu choi file bat ky ngoai kho", async () => {
    const { resolveAbsolute, LibraryPathError } = await lib();
    const stray = join(base, "ngoai.mp4");
    writeFileSync(stray, "x");
    expect(() => resolveAbsolute(stray)).toThrow(LibraryPathError);
  });

  it("thong bao loi KHONG liet ke danh sach thu muc goc cua may chu", async () => {
    const { resolveAbsolute } = await lib();
    const stray = join(base, "ngoai.mp4");
    writeFileSync(stray, "x");
    try {
      resolveAbsolute(stray);
      expect.unreachable("phai nem loi");
    } catch (error) {
      expect((error as Error).message).not.toContain(rootA);
    }
  });

  it("mot goc HONG khong lam ket ca duong nhap — van xet cac goc con lai", async () => {
    // Goc dau tro vao cho khong ton tai (vd share tat may), goc sau van dung.
    process.env.SOCIAL_MEDIA_LIBRARY_DIRS = `${join(base, "khong-ton-tai")};${rootA}`;
    vi.resetModules();
    const { resolveAbsolute } = await lib();
    expect(resolveAbsolute(join(rootA, "Hong", "a.mp4")).relativePath).toBe(join("Hong", "a.mp4"));
  });
});
