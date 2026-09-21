import { describe, expect, it } from "vitest";
import { parseHashtags, targetTypeLabel } from "./social-mentions";

/**
 * S16-SOCIAL-BE-1 — parse hashtag (plan §2 D8 · §5 R25).
 *
 * ⚠️ Lý do file này tồn tại: regex ASCII (`[a-zA-Z0-9_]`) trông "chạy được" trên mọi ca tiếng Anh và
 * âm thầm cắt cụt MỌI hashtag tiếng Việt có dấu — `#tuyểndụng` thành `tuy`. Đây là ca THƯỜNG của một
 * công ty Việt Nam, không phải ca biên.
 */

describe("parseHashtags — Unicode", () => {
  it("hashtag tiếng Việt CÓ DẤU giữ nguyên trọn vẹn", () => {
    expect(parseHashtags("tin mới #tuyểndụng hôm nay")).toEqual(["tuyểndụng"]);
  });

  it("hashtag có dấu + chữ số + gạch dưới", () => {
    expect(parseHashtags("#đợt_2 và #q4_2026")).toEqual(["đợt_2", "q4_2026"]);
  });

  it("chuẩn hoá về CHỮ THƯỜNG", () => {
    expect(parseHashtags("#TuyenDung #tuyendung")).toEqual(["tuyendung"]);
  });

  it("bỏ TRÙNG, giữ THỨ TỰ xuất hiện", () => {
    expect(parseHashtags("#b #a #b #c")).toEqual(["b", "a", "c"]);
  });
});

describe("parseHashtags — biên", () => {
  it("body rỗng / null / undefined ⇒ mảng rỗng", () => {
    expect(parseHashtags("")).toEqual([]);
    expect(parseHashtags(null)).toEqual([]);
    expect(parseHashtags(undefined)).toEqual([]);
  });

  it("KHÔNG bắt `#` nằm GIỮA một từ (`abc#def` là một phần của từ, không phải thẻ)", () => {
    expect(parseHashtags("email abc#def xyz")).toEqual([]);
  });

  it("`#` trơ trọi / theo sau là khoảng trắng ⇒ không thẻ nào", () => {
    expect(parseHashtags("# và # nữa")).toEqual([]);
  });

  it("BỎ thẻ dài hơn 64 ký tự, KHÔNG cắt cụt (cắt cụt đẻ thẻ rác gần-giống)", () => {
    const long = "a".repeat(65);
    expect(parseHashtags(`#${long} #ok`)).toEqual(["ok"]);
    expect(parseHashtags(`#${"a".repeat(64)}`)).toEqual(["a".repeat(64)]);
  });

  it("trần 20 thẻ / một nội dung", () => {
    const body = Array.from({ length: 30 }, (_, i) => `#t${i}`).join(" ");
    expect(parseHashtags(body)).toHaveLength(20);
  });

  it("dừng ở dấu câu — `#tag.` cho ra `tag`", () => {
    expect(parseHashtags("xong #tag. hết")).toEqual(["tag"]);
  });
});

describe("targetTypeLabel — biến template NOTI-028", () => {
  it("khớp nhãn tiếng Việt của template 0581", () => {
    expect(targetTypeLabel("post")).toBe("bài viết");
    expect(targetTypeLabel("comment")).toBe("bình luận");
  });
});
