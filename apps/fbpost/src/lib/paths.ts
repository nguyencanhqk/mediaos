import fs from "node:fs";
import path from "node:path";

/**
 * Thu muc goc chua toan bo du lieu cuc bo (DB + media da upload).
 *
 * `SOCIAL_DATA_DIR` cho phep tro sang cho khac — can cho hai viec that:
 * (1) trien khai bang NSSM, noi thu muc lam viec khong nhat thiet la thu muc ma nguon;
 * (2) test tich hop, de moi ca test chay tren mot CSDL rieng thay vi dung chung `data/` cua may dev.
 */
export const DATA_DIR = process.env.SOCIAL_DATA_DIR ?? path.join(process.cwd(), "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const DB_PATH = path.join(DATA_DIR, "fbpost.db");

/** Tao san thu muc du lieu. An toan khi goi nhieu lan. */
export function ensureDataDirs(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Ghep duong dan tuyet doi cho mot file media da upload.
 * Chan path traversal: `filename` phai la ten file don thuan.
 */
export function resolveUploadPath(filename: string): string {
  const safe = path.basename(filename);
  if (safe !== filename || safe === "." || safe === "..") {
    throw new Error(`Ten file khong hop le: ${filename}`);
  }
  return path.join(UPLOADS_DIR, safe);
}
