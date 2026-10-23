/**
 * S16-SOCIAL-FILEOPENUX-1 (U-1…U-3) — lọc sớm ở form tải: CHỈ nhóm server LUÔN từ chối lúc đăng ký (không
 * setting công ty nào mở được): MIME khai thuộc nhóm trình duyệt tự dựng (tập + hậu tố `+xml`) và đuôi thuộc
 * tập chặn cứng. Server vẫn là lưới chính; lưới theo công ty (allowlist MIME · đuôi chặn · cỡ) KHÔNG mirror.
 *
 * U-3 đọc VĂN BẢN nguồn API (chỉ đọc) và so tập: `apps/app` không import được `apps/api`. Rút ra rỗng ⇒ ĐỎ
 * (đổi cách khai hằng ở API mà regex không bắt được thì phải biết ngay, không xanh giả).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UPLOAD_ACTIVE_MIME_SUFFIX,
  UPLOAD_ACTIVE_MIME_TYPES,
  UPLOAD_HARD_BLOCKED_EXTENSIONS,
  uploadPrecheck,
} from "./upload-precheck";

const OOXML_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("uploadPrecheck — nhóm server luôn từ chối (U-1)", () => {
  it.each<[string, string, string, string]>([
    ["a.html", "", "blocked-extension", "html"],
    ["anh.SVG", "", "blocked-extension", "svg"],
    ["a.tar.xhtml", "application/octet-stream", "blocked-extension", "xhtml"],
  ])("tên `%s` (type `%s`) ⇒ %s (.%s)", (name, type, reason, extension) => {
    expect(uploadPrecheck({ name, type })).toEqual({ reason, extension });
  });

  it.each([
    ["trang.bin", "text/html"],
    ["trang.bin", "TEXT/HTML; charset=utf-8"],
    ["tin.bin", "application/rss+xml"],
    ["anh.png", "image/svg+xml"],
  ])("tên `%s` khai `%s` ⇒ active-mime (xét TRƯỚC đuôi, như server)", (name, type) => {
    expect(uploadPrecheck({ name, type })).toEqual({ reason: "active-mime" });
  });

  it("vừa MIME active vừa đuôi chặn ⇒ lý do là active-mime (thứ tự server)", () => {
    expect(uploadPrecheck({ name: "a.svg", type: "image/svg+xml" })).toEqual({
      reason: "active-mime",
    });
  });
});

describe("uploadPrecheck — cho qua những gì server có thể nhận (U-2)", () => {
  it.each([
    ["bao-cao.pdf", "application/pdf"],
    ["README", "text/plain"],
    ["hop-dong.docx", OOXML_DOCX],
    ["khong-ro.dat", ""],
    ["ket-thuc-cham.", ""],
    ["xml-trong-ten.pdf", "application/pdf"],
  ])("`%s` (type `%s`) ⇒ null", (name, type) => {
    expect(uploadPrecheck({ name, type })).toBeNull();
  });
});

/** `apps/app/src/lib` → `apps/api/src/storage/content-serving.ts`. */
const API_CONTENT_SERVING = join(
  __dirname,
  "..",
  "..",
  "..",
  "api",
  "src",
  "storage",
  "content-serving.ts",
);

/** Rút các chuỗi trong `new Set([...])` ngay sau tên hằng. Không khớp ⇒ mảng rỗng (ca gọi tự đỏ). */
function extractSet(source: string, constName: string): string[] {
  const pattern = new RegExp(`${constName}\\b[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`);
  const body = pattern.exec(source)?.[1] ?? "";
  return [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "").sort();
}

describe("uploadPrecheck — bản sao khớp nguồn API (U-3)", () => {
  const source = readFileSync(API_CONTENT_SERVING, "utf8");

  it("tập đuôi chặn cứng = `HARD_BLOCKED_EXTENSIONS` của API", () => {
    const api = extractSet(source, "HARD_BLOCKED_EXTENSIONS");
    expect(api.length, `không rút được tập từ ${API_CONTENT_SERVING}`).toBeGreaterThan(0);
    expect([...UPLOAD_HARD_BLOCKED_EXTENSIONS].sort()).toEqual(api);
  });

  it("tập MIME active = `ACTIVE_CONTENT_MIME_TYPES` của API", () => {
    const api = extractSet(source, "ACTIVE_CONTENT_MIME_TYPES");
    expect(api.length, `không rút được tập từ ${API_CONTENT_SERVING}`).toBeGreaterThan(0);
    expect([...UPLOAD_ACTIVE_MIME_TYPES].sort()).toEqual(api);
  });

  it("hậu tố active = `ACTIVE_SUFFIX` của API", () => {
    const api = /const ACTIVE_SUFFIX\s*=\s*"([^"]+)"/.exec(source)?.[1];
    expect(api, `không rút được ACTIVE_SUFFIX từ ${API_CONTENT_SERVING}`).toBeTruthy();
    expect(UPLOAD_ACTIVE_MIME_SUFFIX).toBe(api);
  });
});
