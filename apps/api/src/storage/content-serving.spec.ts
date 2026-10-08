/**
 * S16-SOCIAL-FILEDISPOSITION-1 L1 — quy tắc phục vụ nội dung (hàm thuần).
 *
 * Ca P1 · P2 của plan §4. Mỗi ca «tải xuống / kiểu dự phòng» đứng cạnh ca «hiển thị trực tiếp» cùng khung.
 * Bảng 14 kiểu lấy từ hằng THẬT của contracts (không chép tay) — đó là trần cứng của tầng storage.
 */
import { ATTACHMENT_ALLOWED_CONTENT_TYPES } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_SERVE_MIME,
  HARD_BLOCKED_EXTENSIONS,
  INLINE_SERVE_MIME_TYPES,
  isActiveContentMime,
  normalizeMimeForCompare,
  resolveServeDirectives,
} from "./content-serving";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ATTACHMENT_PREFIX = /^attachment; filename="/;

describe("normalizeMimeForCompare", () => {
  it.each([
    ["image/png", "image/png"],
    ["IMAGE/PNG ; q=1", "image/png"],
    [" Text/CSV ;charset=utf-8", "text/csv"],
    ["application/pdf; x=1", "application/pdf"],
    [DOCX, DOCX],
  ])("%j ⇒ %j", (raw, expected) => {
    expect(normalizeMimeForCompare(raw)).toBe(expected);
  });

  it.each([
    [""],
    ["   "],
    ["rác"],
    ["text"],
    ["text/"],
    ["/html"],
    ["a/b/c"],
    ["text /html"],
    [";x=1"],
  ])("%j ⇒ null (rỗng hoặc sai dạng type/subtype)", (raw) => {
    expect(normalizeMimeForCompare(raw)).toBeNull();
  });

  it("null / undefined ⇒ null", () => {
    expect(normalizeMimeForCompare(null)).toBeNull();
    expect(normalizeMimeForCompare(undefined)).toBeNull();
  });
});

describe("isActiveContentMime", () => {
  it.each([
    ["text/html"],
    ["application/xhtml+xml"],
    ["image/svg+xml"],
    ["text/xml"],
    ["application/xml"],
    ["application/atom+xml"],
    [" TEXT/HTML "],
    ["text/html; charset=utf-8"],
    ["Image/SVG+XML"],
  ])("%j ⇒ true", (raw) => {
    expect(isActiveContentMime(raw)).toBe(true);
  });

  it.each([["image/png"], ["application/pdf"], ["text/plain"], ["video/mp4"], [""], ["rác"]])(
    "%j ⇒ false",
    (raw) => {
      expect(isActiveContentMime(raw)).toBe(false);
    },
  );
});

describe("resolveServeDirectives — P1", () => {
  it.each([["image/svg+xml"], ["text/html"], ["application/atom+xml"], [""], ["rác"]])(
    "%j ⇒ kiểu dự phòng + attachment",
    (mime) => {
      const directives = resolveServeDirectives(mime, "tep.bin");
      expect(directives.responseContentType).toBe("application/octet-stream");
      expect(directives.responseContentDisposition).toMatch(ATTACHMENT_PREFIX);
    },
  );

  it.each([
    ["image/png", "image/png"],
    ["IMAGE/PNG ; q=1", "image/png"],
  ])("%j ⇒ %j, hiển thị trực tiếp (disposition ghim là inline)", (mime, expected) => {
    const directives = resolveServeDirectives(mime, "anh.png");
    expect(directives.responseContentType).toBe(expected);
    // Ghim hẳn giá trị: để trống thì storage trả disposition đang lưu kèm object.
    expect(directives.responseContentDisposition).toBe("inline");
  });

  it("mọi đầu vào ⇒ disposition là chuỗi KHÁC RỖNG: inline hoặc attachment kèm tên", () => {
    const inputs = [
      ...INLINE_SERVE_MIME_TYPES,
      ...ATTACHMENT_ALLOWED_CONTENT_TYPES,
      "text/html",
      "image/svg+xml",
      "",
      "rác",
    ];
    for (const mime of inputs) {
      const { responseContentDisposition } = resolveServeDirectives(mime, "tep.bin");
      expect(typeof responseContentDisposition, mime).toBe("string");
      expect(responseContentDisposition, mime).toMatch(/^(inline$|attachment; filename=")/);
    }
  });

  it("FALLBACK_SERVE_MIME là application/octet-stream", () => {
    expect(FALLBACK_SERVE_MIME).toBe("application/octet-stream");
  });

  it("bảng 14 kiểu có đủ 14 mục và gồm 3 kiểu OOXML", () => {
    expect(ATTACHMENT_ALLOWED_CONTENT_TYPES).toHaveLength(14);
    expect(
      ATTACHMENT_ALLOWED_CONTENT_TYPES.filter((type) => type.includes("openxmlformats")),
    ).toHaveLength(3);
  });

  it.each(ATTACHMENT_ALLOWED_CONTENT_TYPES.map((type) => [type]))(
    "bảng 14 kiểu — %s: không thuộc nhóm chủ động, kiểu trả là chính nó",
    (type) => {
      expect(isActiveContentMime(type)).toBe(false);
      expect(resolveServeDirectives(type, "tep").responseContentType).toBe(type);
    },
  );
});

describe("resolveServeDirectives — P2", () => {
  it.each([
    ["application/pdf", "application/pdf"],
    ["text/csv", "text/csv"],
    [DOCX, DOCX],
    ["application/pdf; x=1", "application/pdf"],
    [" Text/CSV ;charset=utf-8", "text/csv"],
  ])("%j ⇒ %j + attachment", (mime, expected) => {
    const directives = resolveServeDirectives(mime, "tai-lieu.dat");
    expect(directives.responseContentType).toBe(expected);
    expect(directives.responseContentDisposition).toMatch(ATTACHMENT_PREFIX);
    expect(directives.responseContentDisposition).toContain("tai-lieu.dat");
  });

  it.each([["video/mp4"], ["video/webm"], ["image/jpeg"], ["image/gif"], ["image/webp"]])(
    "%s ⇒ hiển thị trực tiếp",
    (mime) => {
      const directives = resolveServeDirectives(mime, "tep");
      expect(directives.responseContentType).toBe(mime);
      expect(directives.responseContentDisposition).toBe("inline");
    },
  );
});

describe("hằng của quy tắc", () => {
  it("danh sách hiển thị trực tiếp là ĐÚNG 6 kiểu tường minh", () => {
    expect([...INLINE_SERVE_MIME_TYPES].sort()).toEqual(
      ["image/gif", "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"].sort(),
    );
  });

  it("không kiểu hiển thị trực tiếp nào thuộc nhóm chủ động", () => {
    for (const type of INLINE_SERVE_MIME_TYPES) {
      expect(isActiveContentMime(type), type).toBe(false);
    }
  });

  it("đuôi chặn cứng là ĐÚNG 10 đuôi của D5", () => {
    expect([...HARD_BLOCKED_EXTENSIONS].sort()).toEqual(
      ["html", "htm", "xhtml", "xht", "shtml", "svg", "svgz", "xml", "xsl", "xslt"].sort(),
    );
  });
});
