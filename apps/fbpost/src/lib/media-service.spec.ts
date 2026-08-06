import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Duong NAP FILE TU DIA vao kho media.
 *
 * Hai dieu duoc chung minh o day:
 *
 * 1. LO DA VA — truoc ban nay `importMediaFromPath` nhan duong dan BAT KY tu client (cot `media`
 *    cua file CSV di thang vao no qua /api/import/commit), nghia la bat ky ai co phien deu doc
 *    duoc file tren may chu roi tai ve qua /api/media/:id/file. Bai "tu choi file ngoai kho" chinh
 *    la bai do: chay no tren ban code CU se DO.
 *
 * 2. KHONG NAP FILE VAO BO NHO — ban cu dung `fs.readFileSync`, tuc video vai GB la vai GB trong
 *    heap Node. Bai cuoi chay voi heap bi ep nho de chung minh dieu do da het.
 *
 * `SOCIAL_DATA_DIR` phai dat TRUOC khi nap module vi `paths.ts` doc no o cap module — nen moi ca
 * test deu `resetModules()` roi `await import(...)`, giong db.spec.ts.
 */

let dataDir: string;
let libraryDir: string;
let outsideDir: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "fbpost-media-"));
  dataDir = join(base, "data");
  libraryDir = join(base, "kho-video");
  outsideDir = join(base, "ngoai-kho");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(libraryDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  process.env.SOCIAL_DATA_DIR = dataDir;
  process.env.SOCIAL_KEK_PATH = join(dataDir, "kek.bin");
  process.env.SOCIAL_MEDIA_LIBRARY_DIRS = libraryDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  delete process.env.SOCIAL_MEDIA_LIBRARY_DIRS;
  vi.resetModules();
});

function uploadsDir(): string {
  return join(dataDir, "uploads");
}

/** So file trong kho media. Thu muc chua ton tai = chua tung nap gi = 0. */
function uploadedCount(): number {
  try {
    return readdirSync(uploadsDir()).length;
  } catch {
    return 0;
  }
}

describe("importMediaFromPath — whitelist thu muc", () => {
  it("TU CHOI file nam ngoai kho (bai RED cua lo doc-file-tuy-y)", async () => {
    const stray = join(outsideDir, "bi-mat.mp4");
    writeFileSync(stray, "noi dung khong duoc phep doc");

    const { importMediaFromPath } = await import("./media-service");

    expect(() => importMediaFromPath(stray)).toThrow(/ngoài kho video được phép/);
    // Va quan trong khong kem: KHONG co ban sao nao duoc tao ra.
    expect(uploadedCount()).toBe(0);
  });

  it("TU CHOI ca khi dung `..` de leo tu trong kho ra ngoai", async () => {
    const stray = join(outsideDir, "bi-mat.mp4");
    writeFileSync(stray, "x");

    const { importMediaFromPath } = await import("./media-service");

    expect(() => importMediaFromPath(join(libraryDir, "..", "ngoai-kho", "bi-mat.mp4"))).toThrow(
      /ngoài kho video được phép/,
    );
  });

  it("KHONG khai bao kho thi khong nap duoc gi (fail-closed)", async () => {
    delete process.env.SOCIAL_MEDIA_LIBRARY_DIRS;
    vi.resetModules();

    const inside = join(libraryDir, "a.mp4");
    writeFileSync(inside, "x");

    const { importMediaFromPath } = await import("./media-service");
    expect(() => importMediaFromPath(inside)).toThrow(/Chưa khai báo kho video/);
  });

  it("NHAN file nam trong kho va chep vao kho media", async () => {
    const inside = join(libraryDir, "video-that.mp4");
    writeFileSync(inside, "0123456789");

    const { importMediaFromPath } = await import("./media-service");
    const media = importMediaFromPath(inside);

    expect(media.kind).toBe("video");
    expect(media.originalName).toBe("video-that.mp4");
    expect(media.size).toBe(10);
    expect(statSync(join(uploadsDir(), media.filename)).size).toBe(10);
  });

  it("tu choi dinh dang khong phai anh/video du nam trong kho", async () => {
    const script = join(libraryDir, "script.ps1");
    writeFileSync(script, "whoami");

    const { importMediaFromPath } = await import("./media-service");
    expect(() => importMediaFromPath(script)).toThrow(/Định dạng không được hỗ trợ/);
  });
});

describe("importMediaFromLibrary — duong giao dien duyet kho", () => {
  it("nap theo (chi so goc, duong dan tuong doi)", async () => {
    mkdirSync(join(libraryDir, "Hồng"), { recursive: true });
    writeFileSync(join(libraryDir, "Hồng", "xe.mp4"), "abcdef");

    const { importMediaFromLibrary } = await import("./media-service");
    const media = importMediaFromLibrary("env:0", join("Hồng", "xe.mp4"));

    expect(media.originalName).toBe("xe.mp4");
    expect(media.size).toBe(6);
  });

  it("chi so goc khong ton tai thi tu choi", async () => {
    const { importMediaFromLibrary } = await import("./media-service");
    expect(() => importMediaFromLibrary("cfg:7", "xe.mp4")).toThrow(/không hợp lệ hoặc đã bị xoá/);
  });
});

describe("khong nap file vao bo nho", () => {
  /**
   * Bat bien: duong nap KHONG duoc doc noi dung file vao tien trinh. Ban cu dung `fs.readFileSync`
   * — voi video 2 GB do la 2 GB buffer, va do chinh la ly do phai bo.
   *
   * Do bang cach theo doi loi goi thay vi do bo nho: buffer cua Node nam NGOAI heap V8 nen
   * `--max-old-space-size` khong chan duoc no, con do `memoryUsage()` thi phu thuoc thoi diem GC
   * — ca hai cach deu cho ket qua xanh oan. "Co goi readFileSync tren file nguon khong" moi la
   * cau hoi dung, va cau tra loi cua no khong dao dong.
   */
  it("KHONG goi readFileSync tren file nguon — dung copyFileSync/linkSync", async () => {
    const fs = (await import("node:fs")).default;
    const source = join(libraryDir, "nang.mp4");
    writeFileSync(source, Buffer.alloc(2 * 1024 * 1024, 7));

    const readSpy = vi.spyOn(fs, "readFileSync");
    const copySpy = vi.spyOn(fs, "copyFileSync");
    const linkSpy = vi.spyOn(fs, "linkSync");

    try {
      const { importMediaFromPath } = await import("./media-service");
      const media = importMediaFromPath(source);
      expect(media.size).toBe(2 * 1024 * 1024);

      // readFileSync van duoc dung o cho khac (KEK, CSDL) — chi cam tren CHINH file media.
      const readSource = readSpy.mock.calls.filter((call) => String(call[0]) === source);
      expect(readSource).toEqual([]);

      // Va phai that su di qua mot trong hai duong chep cua he dieu hanh.
      const copied = [...copySpy.mock.calls, ...linkSpy.mock.calls].filter(
        (call) => String(call[0]) === source,
      );
      expect(copied.length).toBe(1);
    } finally {
      readSpy.mockRestore();
      copySpy.mockRestore();
      linkSpy.mockRestore();
    }
  });
});
