import { describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENT_LINK_TYPE,
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  CHAT_MESSAGE_ENTITY_TYPE,
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
