/**
 * S16-SOCIAL-FE-1 — ca **C14**: `parseFeedBody` (plan D5).
 *
 * Hai việc ca này phải chứng minh, và chỉ hai:
 *  1. Nội dung người dùng gõ vào **không bao giờ** trở thành markup — kể cả chuỗi trông như thẻ HTML.
 *  2. `#thẻ` khớp ĐÚNG luật mà BE dùng để lưu thẻ (lệch luật ⇒ link dẫn tới bộ lọc rỗng).
 */
import { describe, expect, it } from "vitest";
import { parseFeedBody, type FeedBodyToken } from "./parse-feed-body";

const kinds = (tokens: readonly FeedBodyToken[]): string[] => tokens.map((t) => t.kind);

describe("C14 — parseFeedBody: an toàn XSS", () => {
  it("chuỗi trông như thẻ HTML ⇒ MỘT token text nguyên văn, không token nào khác", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const tokens = parseFeedBody(evil);

    expect(tokens).toEqual([{ kind: "text", value: evil }]);
    // Không có `url` nào: `src=x` không phải http(s), và ký tự `<`/`>` bị URL_RE loại khỏi thân link.
    expect(kinds(tokens)).not.toContain("url");
  });

  it("`javascript:` và `data:` KHÔNG được nhận là URL (không sinh href thực thi được)", () => {
    for (const evil of [
      "bấm đây javascript:alert(1)",
      "xem data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
    ]) {
      const tokens = parseFeedBody(evil);
      expect(kinds(tokens)).toEqual(["text"]);
    }
  });

  it("URL http/https ⇒ token url có href BẰNG ĐÚNG chuỗi hiển thị (không tự ghép tiền tố)", () => {
    const tokens = parseFeedBody("tài liệu ở https://intranet.acme.vn/a/b?x=1 nhé");
    expect(kinds(tokens)).toEqual(["text", "url", "text"]);
    const url = tokens[1];
    expect(url).toEqual({
      kind: "url",
      value: "https://intranet.acme.vn/a/b?x=1",
      href: "https://intranet.acme.vn/a/b?x=1",
    });
  });

  it("dấu câu dính đuôi URL bị cắt khỏi href — `(xem https://a.b/c).`", () => {
    const tokens = parseFeedBody("(xem https://a.b/c).");
    const url = tokens.find((t) => t.kind === "url");
    expect(url).toEqual({ kind: "url", value: "https://a.b/c", href: "https://a.b/c" });
  });
});

describe("C14 — parseFeedBody: hashtag khớp luật của BE", () => {
  it("thẻ tiếng Việt CÓ DẤU không bị cắt — `#tuyểndụng` là MỘT thẻ trọn vẹn", () => {
    // Đây là ca sống còn: regex ASCII `[a-zA-Z0-9_]` sẽ cắt thành `#tuy`, và thẻ tiếng Việt có dấu
    // là ca THƯỜNG của công ty này, không phải ca biên.
    const tokens = parseFeedBody("#tuyểndụng đợt 3");
    expect(tokens[0]).toEqual({ kind: "tag", value: "#tuyểndụng", tag: "tuyểndụng" });
  });

  it("`tag` được hạ về chữ thường (khoá lọc), `value` giữ nguyên văn (hiển thị)", () => {
    const tokens = parseFeedBody("#TuyểnDụng");
    expect(tokens[0]).toEqual({ kind: "tag", value: "#TuyểnDụng", tag: "tuyểndụng" });
  });

  it("`#` đứng ngay sau ký tự chữ KHÔNG phải thẻ mới — `abc#def` là text", () => {
    expect(kinds(parseFeedBody("abc#def"))).toEqual(["text"]);
  });

  it("thẻ dài hơn 64 ký tự KHÔNG thành link (BE không lưu nó thành thẻ)", () => {
    const long = "#" + "a".repeat(65);
    expect(kinds(parseFeedBody(long))).toEqual(["text"]);
  });
});

describe("C14 — parseFeedBody: mention KHÔNG phải link", () => {
  it("`@Tên` ra token `mention` — và token đó KHÔNG mang href nào", () => {
    const tokens = parseFeedBody("chào @an.nguyen nhé");
    const mention = tokens.find((t) => t.kind === "mention");

    expect(mention).toEqual({ kind: "mention", value: "@an.nguyen" });
    // Ghim hợp đồng: không có `href` ⇒ `PostBody` KHÔNG thể vô tình dựng <a>. Lý do đầy đủ ở
    // docblock `parse-feed-body.ts` (contract không trả mention ⇒ không có employeeId để trỏ tới).
    expect(mention && "href" in mention).toBe(false);
  });

  it("email KHÔNG bị hiểu nhầm thành mention (`@` đứng sau ký tự chữ)", () => {
    expect(kinds(parseFeedBody("gửi an@acme.vn giúp"))).toEqual(["text"]);
  });
});

describe("C14 — parseFeedBody: thứ tự & biên", () => {
  it("nhiều loại trộn lẫn ⇒ token đúng THỨ TỰ XUẤT HIỆN, không theo thứ tự loại", () => {
    // Nếu hàm quét lần lượt từng loại trên cả chuỗi thì thẻ (xuất hiện sau) sẽ bị đẩy lên trước URL.
    const tokens = parseFeedBody("xem https://a.b rồi #thẻ và @ai đó");
    expect(kinds(tokens)).toEqual(["text", "url", "text", "tag", "text", "mention", "text"]);
  });

  it("body `null`/rỗng ⇒ mảng RỖNG (không phải một token text rỗng)", () => {
    // Phân biệt được "không có nội dung" (bài poll/kudos, body NULL hợp lệ) với "chuỗi rỗng" là điều
    // component cần để KHÔNG vẽ một khối trống — xem R16/C27.
    expect(parseFeedBody(null)).toEqual([]);
    expect(parseFeedBody(undefined)).toEqual([]);
    expect(parseFeedBody("")).toEqual([]);
  });

  it("chuỗi thuần text ⇒ đúng MỘT token, không cắt vụn", () => {
    expect(parseFeedBody("hôm nay trời đẹp")).toEqual([
      { kind: "text", value: "hôm nay trời đẹp" },
    ]);
  });
});
