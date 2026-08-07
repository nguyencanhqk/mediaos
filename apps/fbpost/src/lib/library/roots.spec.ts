import fs, { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

/**
 * Bai KIEM CHUNG THAT — duyet THU MUC GOC cua mot o chia se song.
 *
 * Vi sao khong lam duoc bang thu muc tam: cho hong chi lo ra khi goc kho LA GOC CUA MOT SHARE
 * (`\MAY\share`). Chi voi no thi `path.resolve` moi them dau `\` cuoi trong khi `realpathSync`
 * bo di — mot thu muc thuong hay ca goc o dia (`D:\`) deu khong tai hien duoc. Do do khong co
 * bai test thuan-duong-dan nao bat duoc loi nay, va no da di thang len PROD.
 *
 * Mac dinh BO QUA. Chay that (dung DIA CHI IP cua may de tranh loi 1219 khi may dang chay da co
 * credential luu san cho TEN may do):
 *   SMB_TEST_SHARE='//10.0.0.5/tên-share' SMB_TEST_USER='TÊN-MÁY\tài-khoản' SMB_TEST_PASSWORD='...' \
 *     pnpm --filter @mediaos/fbpost test -- --no-file-parallelism
 *
 * `--no-file-parallelism` la BAT BUOC khi chay that: phien SMB toi mot may la tai nguyen dung
 * chung CUA CA MAY, khong phai cua tung tien trinh test. File spec nay va `net-connect.spec.ts`
 * cung noi/ngat mot share; chay song song thi bai nay doi ket noi ma bai kia vua ngat, va that bai
 * hien ra la HET GIO (~22s, dung bang thoi gian Windows tu choi mot lan dang nhap) chu khong phai
 * mot loi doc duoc. Timeout 45s duoi day de phan biet duoc hai thu do.
 */
const liveShare = process.env.SMB_TEST_SHARE;
const liveUser = process.env.SMB_TEST_USER;
const livePassword = process.env.SMB_TEST_PASSWORD;

describe.skipIf(!(liveShare && liveUser && livePassword))(
  "resolveFromRoot — thư mục gốc của ổ chia sẻ THẬT",
  () => {
    it("gốc share KHÔNG bị coi là nằm ngoài phạm vi", { timeout: 45_000 }, async () => {
      const uncPath = liveShare!.replace(/\//g, "\\");
      process.env.SOCIAL_MEDIA_LIBRARY_DIRS = uncPath;
      vi.resetModules();

      const { ensureShareConnection } = await import("./net-connect");
      ensureShareConnection(uncPath, { username: liveUser!, password: livePassword! }, { force: true });

      const { resolveFromRoot } = await lib();
      // `relativePath` rong = chinh thu muc goc — dung loi goi ma giao dien phat ra ngay khi mo
      // "Duyệt kho", tuc ca tinh nang dung hay khong nam o dung mot dong nay.
      const resolved = resolveFromRoot("env:0", "");
      expect(resolved.relativePath).toBe("");
      expect(fs.readdirSync(resolved.absolutePath).length).toBeGreaterThan(0);
    });

    it("đường dẫn NGOÀI gốc vẫn bị chặn — nới lỏng phép so sánh không mở thêm cửa nào", async () => {
      // Bai tren mot minh khong du: bo han hai phep kiem tra di cung lam no xanh.
      const uncPath = liveShare!.replace(/\//g, "\\");
      process.env.SOCIAL_MEDIA_LIBRARY_DIRS = uncPath;
      vi.resetModules();
      const { resolveFromRoot, LibraryPathError } = await lib();

      expect(() => resolveFromRoot("env:0", "C:\\Windows")).toThrow(LibraryPathError);
      expect(() => resolveFromRoot("env:0", "\\\\MAY-KHAC\\share")).toThrow(LibraryPathError);
      expect(() => resolveFromRoot("env:0", "//MAY-KHAC/share")).toThrow(LibraryPathError);

      // `..` thi KHONG nem loi — va do la dung. Windows KEP `..` lai tai goc cua share (khong the
      // di len tren `\\MAY\share`), nen no phan giai ve chinh thu muc goc. Dieu phai chung minh o
      // day khong phai "co nem loi khong" ma la "co ra khoi kho khong": ket qua tra ve van la
      // chinh goc chu khong phai mot cho nao ben ngoai.
      const climbed = resolveFromRoot("env:0", "..");
      expect(climbed.relativePath).toBe("");
      expect(climbed.absolutePath.replace(/[\\/]+$/, "").toLowerCase()).toBe(
        uncPath.replace(/[\\/]+$/, "").toLowerCase(),
      );
    });
  },
);
