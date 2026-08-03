import { describe, expect, it } from "vitest";
import {
  decodeChatSearchCursor,
  encodeChatSearchCursor,
  type ChatSearchCursor,
} from "./chat-search-cursor";

const ID = "11111111-2222-4333-8444-555555555555";

function cursorAt(iso: string): ChatSearchCursor {
  return { sortAt: new Date(iso), id: ID };
}

describe("con trỏ tìm kiếm — vòng khứ hồi", () => {
  it("encode → decode trả đúng mốc và id", () => {
    const src = cursorAt("2026-08-03T01:02:03.399Z");
    const out = decodeChatSearchCursor(encodeChatSearchCursor(src));
    expect(out.id).toBe(ID);
    expect(out.sortAt.toISOString()).toBe("2026-08-03T01:02:03.399Z");
  });

  it("GIỮ NGUYÊN mili-giây, không làm tròn", () => {
    // ⚠️ Đây là ca canh chính xác của con trỏ. `created_at` là `timestamptz` micro-giây; khoá sắp xếp
    // được cắt về mili-giây bằng `date_trunc` để BẰNG ĐÚNG độ chính xác con trỏ mang được. Nếu ai đó
    // "gọn hoá" con trỏ xuống giây, phép so sánh keyset loại nhầm mọi hàng trong cùng giây đó ⇒ trang
    // sau sót tin, HTTP 200, không lỗi.
    for (const ms of ["000", "001", "399", "999"]) {
      const iso = `2026-08-03T01:02:03.${ms}Z`;
      expect(
        decodeChatSearchCursor(encodeChatSearchCursor(cursorAt(iso))).sortAt.toISOString(),
      ).toBe(iso);
    }
  });

  it("con trỏ là OPAQUE — không lộ hình dạng ở dạng đọc được", () => {
    const encoded = encodeChatSearchCursor(cursorAt("2026-08-03T01:02:03.399Z"));
    expect(encoded).not.toContain("2026-08-03");
    expect(encoded).not.toContain(ID);
    // base64url: không có ký tự cần escape trong query-string.
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("KHÔNG chứa `seq` — không mở lại lỗ rò lưu lượng mà S7-CHAT-DB-2 vừa bịt", () => {
    // `chat_messages.seq` là identity CẤP BẢNG: hiệu số giữa hai lần gọi cho biết công ty gửi bao nhiêu
    // tin. Ca này soi CHUỖI ĐÃ GIẢI MÃ, nên nó đỏ ngay cả khi ai đó nhét `seq` vào rồi mã hoá lại.
    const decoded = Buffer.from(
      encodeChatSearchCursor(cursorAt("2026-08-03T01:02:03.399Z")),
      "base64url",
    ).toString("utf8");
    expect(decoded).toBe(`2026-08-03T01:02:03.399Z|${ID}`);
    expect(decoded).not.toMatch(/seq/i);
  });
});

describe("con trỏ tìm kiếm — mọi đầu vào hỏng đều NÉM (400), không im lặng về trang đầu", () => {
  // Rơi về trang đầu khi con trỏ hỏng biến "trang 2" thành "trang 1" mãi mãi ⇒ vòng lặp vô hạn ở FE.
  const bad: Array<[string, string]> = [
    ["chuỗi rỗng", ""],
    ["không phải base64url", "!!!not-base64!!!"],
    ["thiếu dấu phân cách", Buffer.from("2026-08-03T01:02:03.399Z").toString("base64url")],
    ["dấu phân cách ở đầu", Buffer.from(`|${ID}`).toString("base64url")],
    [
      "uuid sai hình dạng",
      Buffer.from("2026-08-03T01:02:03.399Z|not-a-uuid").toString("base64url"),
    ],
    ["uuid rỗng", Buffer.from("2026-08-03T01:02:03.399Z|").toString("base64url")],
    ["mốc thời gian rác", Buffer.from(`khong-phai-ngay|${ID}`).toString("base64url")],
    // Ba ca dưới đây là lý do phải so vòng-khứ-hồi TRÙNG NGUYÊN VĂN chứ không chỉ `!isNaN(Date)`:
    // `new Date()` nuốt cả ba, rồi mốc suy ra sẽ LỆCH với khoá sắp xếp đã cắt-về-mili-giây.
    ["thiếu mili-giây", Buffer.from(`2026-08-03T01:02:03Z|${ID}`).toString("base64url")],
    ["chỉ có ngày", Buffer.from(`2026-08-03|${ID}`).toString("base64url")],
    ["có micro-giây", Buffer.from(`2026-08-03T01:02:03.399123Z|${ID}`).toString("base64url")],
  ];

  for (const [label, raw] of bad) {
    it(`${label} → ném`, () => {
      expect(() => decodeChatSearchCursor(raw)).toThrow();
    });
  }

  it("thông điệp mang mã CHAT-ERR-016 của TRỤC TÌM KIẾM, không mượn mã của beforeSeq/afterSeq", () => {
    try {
      decodeChatSearchCursor("!!!");
      expect.unreachable("phải ném");
    } catch (err) {
      const msg = JSON.stringify((err as { response?: unknown }).response ?? String(err));
      expect(msg).toContain("CHAT-ERR-016");
      expect(msg).toContain("tìm kiếm");
      // Mã của `/messages` nói về hai con trỏ loại trừ nhau — sai nghĩa ở đây.
      expect(msg).not.toContain("beforeSeq");
    }
  });
});
