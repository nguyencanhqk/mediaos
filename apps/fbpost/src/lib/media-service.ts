import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ALLOWED_IMAGE_MIME, ALLOWED_VIDEO_MIME } from "./fb/constants";
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

/** Sao chep mot file co san tren may vao kho media (dung khi import hang loat). */
export function importMediaFromPath(sourcePath: string): MediaFile {
  const trimmed = sourcePath.trim().replace(/^["']|["']$/g, "");
  if (!fs.existsSync(trimmed)) {
    throw new Error(`Không tìm thấy file: ${trimmed}`);
  }

  const stat = fs.statSync(trimmed);
  if (!stat.isFile()) {
    throw new Error(`Đường dẫn không phải file: ${trimmed}`);
  }

  const buffer = fs.readFileSync(trimmed);
  return saveMediaBuffer(path.basename(trimmed), mimeFromExtension(trimmed), buffer);
}
