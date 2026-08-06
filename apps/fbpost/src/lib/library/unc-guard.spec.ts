import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dau vao "duong dan tuong doi" phai bi chan bang LOC TU VUNG, TRUOC moi loi goi he thong file.
 *
 * Do duoc tren may nay: `realpathSync.native` toi mot UNC khong tim thay duong khoa DONG BO 21
 * giay — ma route handler cua Next chay tren main thread, nen do la ca app dung. Nang hon: cham
 * toi `\<may la>\share` ep Windows xac thuc ra ngoai bang danh tinh cua tien trinh dich vu.
 *
 * Vi vay bang chung cua bai test la THOI GIAN, khong phai noi dung thong bao loi: chan bang chuoi
 * thi tra ve tuc thi, con neu lot xuong realpath thi mat hang chuc giay.
 */

const BS = String.fromCharCode(92);
let base: string;
let rootA: string;

async function lib() {
  return import("./roots");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "fbpost-unc-"));
  rootA = join(base, "kho-video");
  mkdirSync(rootA, { recursive: true });
  writeFileSync(join(rootA, "a.mp4"), "x");

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

describe("chan UNC tuon vao o duong dan tuong doi", () => {
  it("TUC THI tu choi UNC gach xuoi toi may la (khong cham dia)", async () => {
    const { resolveFromRoot, LibraryPathError } = await lib();
    const t0 = Date.now();
    expect(() => resolveFromRoot("env:0", "//203.0.113.7/share/x.mp4")).toThrow(LibraryPathError);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("TUC THI tu choi UNC gach nguoc toi may la", async () => {
    const { resolveFromRoot } = await lib();
    const t0 = Date.now();
    expect(() => resolveFromRoot("env:0", `${BS}${BS}203.0.113.8${BS}share${BS}x.mp4`)).toThrow();
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("tu choi duong dan tuyet doi co ky tu o dia", async () => {
    const { resolveFromRoot } = await lib();
    expect(() => resolveFromRoot("env:0", "C:" + BS + "Windows" + BS + "explorer.exe")).toThrow();
  });

  it("tu choi tien to duong dan dai", async () => {
    const { resolveFromRoot } = await lib();
    expect(() =>
      resolveFromRoot("env:0", `${BS}${BS}?${BS}C:${BS}Windows${BS}explorer.exe`),
    ).toThrow();
  });

  it("duong dan tuong doi that su van chay binh thuong", async () => {
    const { resolveFromRoot } = await lib();
    expect(resolveFromRoot("env:0", "a.mp4").relativePath).toBe("a.mp4");
  });

  it("resolveAbsolute: TUC THI tu choi UNC toi may la", async () => {
    const { resolveAbsolute } = await lib();
    const t0 = Date.now();
    expect(() => resolveAbsolute("//203.0.113.9/share/x.mp4")).toThrow();
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("khong phan biet duoc 'ton tai' voi 'khong ton tai' (chong do ban do o dia)", async () => {
    // CA HAI deu nam NGOAI kho; khac nhau o cho mot cai co that tren dia. Neu hai thong bao khac
    // nhau thi bat ky ai co phien deu do duoc su ton tai cua duong dan bat ky tren may chu —
    // mot buoc ve ban do chuan bi cho don sau.
    writeFileSync(join(base, "co-that.mp4"), "x");

    const { resolveFromRoot, resolveAbsolute } = await lib();
    const bat = (fn: () => unknown): string => {
      try {
        fn();
        return "(khong nem loi)";
      } catch (e) {
        return (e as Error).message;
      }
    };

    // Qua duong tuong doi
    expect(bat(() => resolveFromRoot("env:0", join("..", "co-that.mp4")))).toBe(
      bat(() => resolveFromRoot("env:0", join("..", "khong-he-co.mp4"))),
    );

    // Va qua duong tuyet doi (cot `media` cua file CSV). Thong bao co lap lai chinh chuoi nguoi
    // dung go vao — do la dau vao cua HO, khong phai trang thai may chu — nen bo phan do ra roi
    // so KHUON con lai. Khuon giong nhau = khong suy ra duoc file co ton tai hay khong.
    const khuon = (p: string) => bat(() => resolveAbsolute(p)).split(p).join("<đường-dẫn>");
    expect(khuon(join(base, "co-that.mp4"))).toBe(khuon(join(base, "khong-he-co.mp4")));
  });
});
