/**
 * S17-CHAT-UX2-FE-1 — `previewFromMessage` (bản FE của `buildLastMessagePreview`).
 *
 * 5 nhánh `kind` + hai bẫy đã đo được ở BE-1:
 *  · `kind:'text'` KÈM tệp — ai đọc `kind === 'file'` để suy "có tệp" sẽ bỏ sót đúng ca phổ biến nhất;
 *  · `attachmentCount` là CỘT lịch sử, không phải `attachments.length` — hai giá trị lệch nhau ở tin
 *    đã thu hồi, và bản server đọc cột.
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_PREVIEW_MAX_GRAPHEMES,
  previewFromMessage,
  truncateByGrapheme,
  type ChatPreviewSource,
} from "./chat-preview";

const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function src(over: Partial<ChatPreviewSource> = {}): ChatPreviewSource {
  return {
    senderId: SENDER,
    senderName: "Nguyễn Văn A",
    body: "xin chào",
    messageType: "text",
    attachmentCount: 0,
    recalledAt: null,
    ...over,
  };
}

describe("previewFromMessage · 5 nhánh kind (thứ tự LÀ hợp đồng)", () => {
  it("thu hồi THẮNG tất cả ⇒ kind 'recalled' + excerpt null, kể cả khi body còn trong RAM", () => {
    const out = previewFromMessage(
      src({ body: "nội dung cũ", recalledAt: "2026-08-04T10:00:00Z" }),
    );
    expect(out.kind).toBe("recalled");
    expect(out.excerpt).toBeNull();
  });

  it("tin `system` ⇒ kind 'system', VẪN có excerpt (FE vẽ nghiêng/xám, không giấu chữ)", () => {
    const out = previewFromMessage(src({ messageType: "system", body: "A đã thêm B vào phòng" }));
    expect(out).toMatchObject({ kind: "system", excerpt: "A đã thêm B vào phòng" });
  });

  it("có chữ ⇒ 'text'", () => {
    expect(previewFromMessage(src()).kind).toBe("text");
  });

  /** Bẫy chính: chữ THẮNG tệp, nhưng `attachmentCount` vẫn > 0 để FE vẽ được kẹp giấy. */
  it("có chữ VÀ có tệp ⇒ vẫn 'text', `attachmentCount` GIỮ > 0", () => {
    const out = previewFromMessage(src({ body: "ảnh nhé", attachmentCount: 2 }));
    expect(out).toMatchObject({ kind: "text", excerpt: "ảnh nhé", attachmentCount: 2 });
  });

  it("không chữ mà có tệp ⇒ 'file' + excerpt null", () => {
    const out = previewFromMessage(src({ body: "", attachmentCount: 3 }));
    expect(out).toMatchObject({ kind: "file", excerpt: null, attachmentCount: 3 });
  });

  it("body rỗng + 0 tệp ⇒ 'text' + excerpt null (FE để dòng preview TRỐNG)", () => {
    expect(previewFromMessage(src({ body: "" }))).toMatchObject({ kind: "text", excerpt: null });
  });

  it("tin thu hồi GIỮ `attachmentCount` của cột lịch sử (server đọc cột, không đọc mảng)", () => {
    const out = previewFromMessage(
      src({ body: "", attachmentCount: 2, recalledAt: "2026-08-04T10:00:00Z" }),
    );
    expect(out.attachmentCount).toBe(2);
  });

  it("`senderName` null vẫn đi qua nguyên vẹn (roster CỐ Ý giữ người đã rời)", () => {
    expect(previewFromMessage(src({ senderName: null })).senderName).toBeNull();
  });
});

describe("previewFromMessage · ép một dòng + cắt theo grapheme", () => {
  it("xuống dòng/tab → khoảng trắng, gom lại, cắt hai đầu — làm TRƯỚC khi cắt độ dài", () => {
    const out = previewFromMessage(src({ body: "  dòng 1\n\n\tdòng 2  " }));
    expect(out.excerpt).toBe("dòng 1 dòng 2");
  });

  it("body TOÀN ký tự điều khiển ⇒ excerpt null, không phải một chuỗi khoảng trắng", () => {
    expect(previewFromMessage(src({ body: "\n\n\t  " })).excerpt).toBeNull();
  });

  it("cắt ở đúng trần 120 GRAPHEME", () => {
    const out = previewFromMessage(src({ body: "a".repeat(300) }));
    expect(out.excerpt).toHaveLength(CHAT_PREVIEW_MAX_GRAPHEMES);
  });

  it("KHÔNG chẻ đôi cụm emoji ZWJ — đó là lý do dùng Segmenter thay `slice`", () => {
    const family = "👨‍👩‍👧";
    // 3 cụm; cắt ở 2 phải ra ĐÚNG hai cụm nguyên vẹn, không ra ký tự thay thế.
    expect(truncateByGrapheme(family.repeat(3), 2)).toBe(family.repeat(2));
    // Và ZWJ bên trong cụm KHÔNG bị strip (nó thuộc \p{Cf}, cố ý không nằm trong bộ lọc).
    expect(previewFromMessage(src({ body: family })).excerpt).toBe(family);
  });
});
