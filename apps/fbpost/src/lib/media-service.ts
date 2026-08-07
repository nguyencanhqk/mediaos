import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ALLOWED_IMAGE_MIME, ALLOWED_VIDEO_MIME } from "./fb/constants";
import { resolveAbsolute, resolveFromRoot } from "./library/roots";
import { ensureDataDirs, UPLOADS_DIR } from "./paths";
import { createMedia } from "./repo/media-repo";
import type { MediaFile, MediaKind } from "./types";

/** Luu file media vao thu muc data/uploads va ghi nhan trong CSDL. */

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
};

export function mimeFromExtension(filename: string): string {
  return MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

export function kindFromMime(mime: string): MediaKind | null {
  if (ALLOWED_IMAGE_MIME.includes(mime)) return "image";
  if (ALLOWED_VIDEO_MIME.includes(mime)) return "video";
  return null;
}

/** Sinh ten file duy nhat, giu lai phan mo rong goc. */
function uniqueFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
}

export function saveMediaBuffer(originalName: string, mime: string, buffer: Buffer): MediaFile {
  const resolvedMime =
    mime && mime !== "application/octet-stream" ? mime : mimeFromExtension(originalName);
  const kind = kindFromMime(resolvedMime);
  if (!kind) {
    throw new Error(
      `Định dạng không được hỗ trợ: ${originalName}. Chỉ nhận ảnh (jpg, png, gif, webp) và video (mp4, mov, webm).`,
    );
  }

  ensureDataDirs();
  const filename = uniqueFilename(originalName);
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

  return createMedia({
    filename,
    originalName: path.basename(originalName),
    mime: resolvedMime,
    size: buffer.length,
    kind,
  });
}

/**
 * Le an toan khi chep: tu choi neu sau khi chep, o dich con it hon nguong nay.
 * Dia day khong chi lam hong app Dang bai — o C:/D: cua may nay con chay Postgres va cac dich vu
 * PROD khac, nen dung lai som van re hon la de dia can kiet.
 */
const MIN_FREE_BYTES_AFTER_COPY = 20 * 1024 * 1024 * 1024; // 20 GB

/** Byte trong con lai o o dia chua `dir`. `null` khi he dieu hanh khong tra loi duoc. */
function freeBytes(dir: string): number | null {
  try {
    const stat = fs.statfsSync(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

/** Hai duong dan co cung o dia (volume) khong — quyet dinh duoc phep hardlink hay phai chep that. */
function sameVolume(a: string, b: string): boolean {
  return path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase();
}

/**
 * Dua mot file co san tren dia vao kho media.
 *
 * KHONG nap file vao bo nho. Ban cu dung `fs.readFileSync` — voi video vai GB thi do la vai GB
 * trong heap Node va gan nhu chac chan sap. O day dung `fs.copyFileSync` (he dieu hanh tu chep,
 * khong qua tien trinh) va uu tien `fs.linkSync` khi nguon cung o dia voi kho: hardlink la tuc
 * thi va khong ton them byte nao.
 *
 * Duong dan PHAI da qua whitelist (`library/roots`) truoc khi den day — ham nay khong tu kiem tra
 * de khong co hai noi cung chiu trach nhiem mot viec; hai duong goi cong khai ben duoi lam viec do.
 */
function ingestFile(absolutePath: string): MediaFile {
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`Đường dẫn không phải file: ${absolutePath}`);
  }

  const resolvedMime = mimeFromExtension(absolutePath);
  const kind = kindFromMime(resolvedMime);
  if (!kind) {
    throw new Error(
      `Định dạng không được hỗ trợ: ${path.basename(absolutePath)}. Chỉ nhận ảnh (jpg, png, gif, webp) và video (mp4, mov, webm).`,
    );
  }

  ensureDataDirs();
  const filename = uniqueFilename(absolutePath);
  const destination = path.join(UPLOADS_DIR, filename);

  /**
   * Chep that thi phai con cho. Tach thanh ham rieng va goi o CA HAI duong: ban dau phep kiem chi
   * chay o nhanh `!canHardlink`, nen khi hardlink that bai va roi xuong `copyFileSync` thi mot file
   * hang GB duoc chep ma KHONG qua bat ky phep kiem nao — dung nhanh de xay ra nhat (mount point,
   * ReFS, file dang bi khoa) vi `sameVolume` chi so ky tu o dia.
   */
  const assertEnoughSpace = () => {
    const free = freeBytes(UPLOADS_DIR);
    if (free === null) return; // Khong do duoc thi khong chan — day la lan an toan ve dung luong,
    // khong phai lop bao mat; chan oan se lam hong viec that.
    if (free - stat.size < MIN_FREE_BYTES_AFTER_COPY) {
      const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
      throw new Error(
        `Không đủ dung lượng: file ${gb(stat.size)} GB nhưng ổ chứa kho chỉ còn ${gb(free)} GB. Dọn bớt hoặc chuyển SOCIAL_DATA_DIR sang ổ khác.`,
      );
    }
  };

  if (sameVolume(absolutePath, destination)) {
    try {
      // Hardlink khong ton them byte nao ⇒ khong can kiem dung luong.
      fs.linkSync(absolutePath, destination);
    } catch {
      // Hardlink hong (khac phan vung that su, he thong file khong ho tro, file dang bi khoa)
      // — chep that, VA phai kiem dung luong nhu moi lan chep that.
      assertEnoughSpace();
      fs.copyFileSync(absolutePath, destination);
    }
  } else {
    assertEnoughSpace();
    fs.copyFileSync(absolutePath, destination);
  }

  return createMedia({
    filename,
    originalName: path.basename(absolutePath),
    mime: resolvedMime,
    size: stat.size,
    kind,
  });
}

/**
 * Nap file tu kho video theo (chi so goc, duong dan tuong doi) — duong ma giao dien duyet kho dung.
 * Client khong bao gio gui duong dan tuyet doi o duong nay.
 */
export function importMediaFromLibrary(rootKey: string, relativePath: string): MediaFile {
  return ingestFile(resolveFromRoot(rootKey, relativePath).absolutePath);
}

/**
 * Nap file theo duong dan TUYET DOI (cot `media` trong file CSV/Excel do nguoi dung go tay).
 *
 * Duong dan bat buoc nam trong mot goc cua SOCIAL_MEDIA_LIBRARY_DIRS. Truoc ban va nay ham nhan
 * duong dan bat ky va doc thang, nghia la bat ky ai co phien deu doc duoc file tren may chu roi
 * tai ve qua /api/media/:id/file.
 */
export function importMediaFromPath(sourcePath: string): MediaFile {
  return ingestFile(resolveAbsolute(sourcePath).absolutePath);
}
