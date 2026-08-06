import { importMediaFromPath } from "../media-service";
import type { PostType } from "../types";
import { parseScheduleValue } from "./parse-datetime";
import type { TableRow } from "./read-table";

/**
 * Chuyen tung dong trong file import thanh du lieu bai dang.
 * Chap nhan nhieu ten cot (Viet lan Anh) de nguoi dung khong phai
 * ghi nho dung mot mau duy nhat.
 */

const COLUMN_ALIASES: Record<string, string[]> = {
  message: ["message", "noi_dung", "noidung", "content", "caption", "text", "bai_viet"],
  link: ["link", "url", "duong_dan", "lien_ket"],
  type: ["type", "loai", "loai_bai", "kieu"],
  title: ["title", "tieu_de", "ten"],
  media: ["media", "file", "anh", "hinh", "hinh_anh", "video", "duong_dan_file", "tep"],
  scheduledAt: [
    "scheduled_at",
    "schedule",
    "thoi_gian",
    "gio_dang",
    "lich_dang",
    "ngay_gio",
    "time",
    "ngay_dang",
  ],
  page: ["page", "pages", "trang", "fanpage", "page_name", "ten_page", "dang_len"],
};

const TYPE_ALIASES: Record<string, PostType> = {
  text: "text",
  chu: "text",
  link: "text",
  photo: "photo",
  image: "photo",
  anh: "photo",
  hinh: "photo",
  video: "video",
  reel: "reel",
  reels: "reel",
};

export interface MappedRow {
  /** So dong trong file (tinh ca dong tieu de) de bao loi cho nguoi dung. */
  rowNumber: number;
  type: PostType;
  message: string;
  link: string | null;
  title: string | null;
  mediaPaths: string[];
  scheduledAt: number | null;
  /**
   * Ten hoac ID cac Page ghi trong cot `page`. De trong nghia la dung
   * danh sach Page da chon tren man hinh.
   */
  pageNames: string[];
  error: string | null;
}

function pick(row: TableRow, field: keyof typeof COLUMN_ALIASES): unknown {
  for (const alias of COLUMN_ALIASES[field]) {
    const value = row[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function asText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function splitMediaPaths(value: unknown): string[] {
  const text = asText(value);
  if (!text) return [];
  return text
    .split(/[|;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Cot `page` nhan nhieu Page, cach nhau bang dau |, ; hoac dau phay. */
function splitPageNames(value: unknown): string[] {
  const text = asText(value);
  if (!text) return [];
  return text
    .split(/[|;,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Doan loai bai khi nguoi dung khong dien cot `type`. */
function inferType(mediaPaths: string[]): PostType {
  if (mediaPaths.length === 0) return "text";
  const isVideo = /\.(mp4|mov|m4v|webm)$/i.test(mediaPaths[0]);
  return isVideo ? "video" : "photo";
}

export function mapRows(rows: TableRow[]): MappedRow[] {
  return rows.map((row, index) => {
    const rowNumber = index + 2;
    const mediaPaths = splitMediaPaths(pick(row, "media"));
    const message = asText(pick(row, "message"));
    const link = asText(pick(row, "link")) || null;
    const title = asText(pick(row, "title")) || null;

    const rawType = asText(pick(row, "type")).toLowerCase();
    const type: PostType = rawType
      ? (TYPE_ALIASES[rawType] ?? inferType(mediaPaths))
      : inferType(mediaPaths);

    const rawSchedule = pick(row, "scheduledAt");
    const scheduledAt = parseScheduleValue(rawSchedule);
    const pageNames = splitPageNames(pick(row, "page"));

    let error: string | null = null;
    if (rawSchedule !== undefined && scheduledAt === null) {
      error = `Không đọc được thời gian "${asText(rawSchedule)}". Dùng dạng 10/08/2026 09:00 hoặc 2026-08-10 09:00.`;
    } else if (type === "text" && !message && !link) {
      error = "Thiếu nội dung và link.";
    } else if (type !== "text" && mediaPaths.length === 0) {
      error = `Bài loại "${type}" cần có đường dẫn file ở cột media.`;
    } else if ((type === "video" || type === "reel") && mediaPaths.length > 1) {
      error = "Bài video/Reels chỉ nhận một file.";
    }

    return { rowNumber, type, message, link, title, mediaPaths, scheduledAt, pageNames, error };
  });
}

/** Nap cac file media cua mot dong vao kho media, tra ve danh sach id. */
export function resolveMediaIds(mediaPaths: string[]): number[] {
  return mediaPaths.map((filePath) => importMediaFromPath(filePath).id);
}
