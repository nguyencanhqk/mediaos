import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { files } from "../db/schema/files";
import {
  CHAT_ATTACHMENT_LINK_TYPE,
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  CHAT_MESSAGE_ENTITY_TYPE,
  imageMimeSqlPredicate,
  isAttachableFile,
  isImageMimeType,
  trimToMessageBoundary,
} from "./chat-file.constants";

/** S7-CHAT-BE-3 — hằng + vị từ thuần của đường đính kèm. */

describe("khoá điều phối + trần", () => {
  it("giá trị khớp NGUYÊN VĂN nơi đăng ký resolver và nơi tạo file_links", () => {
    // Lệch một ký tự giữa ba chỗ ⇒ `deny-no-resolver` ⇒ gửi được tệp mà không ai tải được.
    expect(CHAT_MESSAGE_ENTITY_TYPE).toBe("chat_message");
    // Phải ∈ CHECK `chk_file_links_link_type` (mig 0433) — giá trị lạ là 23514 lúc INSERT.
    expect(CHAT_ATTACHMENT_LINK_TYPE).toBe("Attachment");
    // Phải khớp `.max()` của `sendMessageSchema.fileIds` ở contracts.
    expect(CHAT_MAX_ATTACHMENTS_PER_MESSAGE).toBe(10);
  });
});

describe("isImageMimeType — server quyết định, không đoán từ phần mở rộng", () => {
  it.each([
    ["image/png", true],
    ["IMAGE/JPEG", true],
    ["image/svg+xml", true],
    ["application/pdf", false],
    ["text/plain", false],
    ["", false],
  ])("%s → %s", (mime, expected) => {
    expect(isImageMimeType(mime)).toBe(expected);
  });
});

/**
 * S17-CHAT-UX2-BE-1 — "là ảnh" phải là MỘT định nghĩa cho CẢ HAI tầng (SPEC-15 §15b · API-13 §5.1d):
 * khoá DTO `isImage` (mapper, JS) và bộ lọc `kind=image|file` của CHAT-API-017 (SQL).
 *
 * ⚠️ Ca dưới KHÔNG so vị từ SQL với một chuỗi kỳ vọng chép tay — nó **suy luật ra TỪ SQL đã render** rồi
 * đối chiếu với `isImageMimeType` trên cùng bảng MIME. Chép tay chuỗi kỳ vọng chỉ khoá được chính tả;
 * suy ngược mới bắt được lệch NGỮ NGHĨA — bỏ `lower()` là ca `IMAGE/JPEG` đỏ ngay.
 */
describe("imageMimeSqlPredicate ⟷ isImageMimeType — MỘT định nghĩa, hai tầng", () => {
  const dialect = new PgDialect();
  const render = (isImage: boolean) =>
    dialect.sqlToQuery(imageMimeSqlPredicate(files.mimeType, isImage));

  const MIMES = ["image/png", "IMAGE/JPEG", "Image/Gif", "image/svg+xml", "application/pdf", "text/plain", ""];

  it("vị từ chạy trên `lower(mime_type)` + tham số BIND, không nội suy chuỗi", () => {
    const q = render(true);
    expect(q.sql).toBe('lower("files"."mime_type") like $1');
    expect(q.params).toEqual(["image/%"]);
  });

  it("nhánh `file` là PHỦ ĐỊNH của cùng vị từ — không phải một luật thứ hai", () => {
    const q = render(false);
    expect(q.sql).toBe('lower("files"."mime_type") not like $1');
    expect(q.params).toEqual(["image/%"]);
  });

  it("SQL và JS ĐỒNG Ý trên mọi MIME, kể cả viết HOA", () => {
    const q = render(true);
    // Emulate Postgres: `lower(col) LIKE 'image/%'`. Luật lấy TỪ chuỗi đã render, không viết lại.
    const usesLower = q.sql.includes("lower(");
    const prefix = String(q.params[0]).replace(/%$/u, "");
    const sqlSaysImage = (mime: string) =>
      (usesLower ? mime.toLowerCase() : mime).startsWith(prefix);

    for (const mime of MIMES) {
      expect(sqlSaysImage(mime), `SQL và JS lệch nhau ở MIME '${mime}'`).toBe(isImageMimeType(mime));
    }
  });

  it("ca neo: `IMAGE/JPEG` là ảnh ở CẢ HAI tầng", () => {
    // Đây là ca mà `mime_type LIKE 'image/%'` TRẦN (không `lower`) sẽ trượt: DTO nói `isImage: true`
    // còn `kind=image` lọc mất tệp. `mime_type` do client khai lúc upload và KHÔNG được chuẩn hoá ở DB.
    const q = render(true);
    expect(isImageMimeType("IMAGE/JPEG")).toBe(true);
    expect(q.sql).toContain("lower(");
  });
});

describe("isAttachableFile — UỶ QUYỀN sang luật FOUNDATION, không bản sao", () => {
  const clean = { scanStatus: "Clean", uploadStatus: "Uploaded" };

  it("Uploaded + không Infected → dùng được", () => {
    expect(isAttachableFile(clean)).toBe(true);
    expect(isAttachableFile({ scanStatus: "NotRequired", uploadStatus: "Uploaded" })).toBe(true);
    // AV chưa đấu nối: `Pending`/`Failed` KHÔNG chặn — chỉ `Infected` chặn (luật FOUNDATION H2).
    expect(isAttachableFile({ scanStatus: "Pending", uploadStatus: "Uploaded" })).toBe(true);
  });

  it("Infected hoặc chưa Uploaded → KHÔNG dùng được", () => {
    expect(isAttachableFile({ ...clean, scanStatus: "Infected" })).toBe(false);
    expect(isAttachableFile({ ...clean, uploadStatus: "Pending" })).toBe(false);
    expect(isAttachableFile({ ...clean, uploadStatus: "Deleted" })).toBe(false);
  });
});

describe("trimToMessageBoundary — trang tab Tệp KHÔNG chẻ đôi một tin", () => {
  const row = (roomSeq: number, tag: string) => ({ roomSeq, tag });

  it("ít hơn/bằng limit → trả nguyên (không có trang sau)", () => {
    const rows = [row(9, "a"), row(8, "b")];
    expect(trimToMessageBoundary(rows, 5)).toEqual(rows);
    expect(trimToMessageBoundary(rows, 2)).toEqual(rows);
  });

  it("ranh giới rơi ĐÚNG giữa hai tin → cắt thẳng ở limit", () => {
    const rows = [row(9, "a"), row(8, "b"), row(7, "c")];
    expect(trimToMessageBoundary(rows, 2)).toEqual([row(9, "a"), row(8, "b")]);
  });

  it("ranh giới CHẺ ĐÔI một tin → bỏ cả nhóm đó, trang sau lấy trọn", () => {
    // Tin roomSeq=8 có 2 tệp; limit=2 cắt sau tệp thứ nhất. Không trim thì tệp thứ hai MẤT vĩnh viễn:
    // con trỏ trang kế là `beforeSeq=8` và vị từ là `room_seq < 8`.
    const rows = [row(9, "a"), row(8, "b1"), row(8, "b2")];
    expect(trimToMessageBoundary(rows, 2)).toEqual([row(9, "a")]);
  });

  it("một tin có nhiều tệp hơn cả limit → trả TRỌN nhóm (thà vượt limit còn hơn mất tệp/lặp vô hạn)", () => {
    // Cắt sạch sẽ trả 0 hàng ⇒ client lặp mãi trên cùng con trỏ. Trả nửa nhóm thì phần đuôi mất vĩnh
    // viễn (trang sau đã nhảy qua roomSeq=8). Chỉ trả TRỌN nhóm mới vừa tiến được vừa không rơi tệp —
    // và đó là lý do caller phải lấy dư `CHAT_MAX_ATTACHMENTS_PER_MESSAGE + 1` hàng.
    const rows = [row(8, "b1"), row(8, "b2"), row(8, "b3"), row(7, "c")];
    expect(trimToMessageBoundary(rows, 1)).toEqual([row(8, "b1"), row(8, "b2"), row(8, "b3")]);
  });
});
