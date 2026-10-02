/**
 * S16-SOCIAL-FE-1 — ca **C14**: `parseFeedBody` (plan D5).
 *
 * Hai việc ca này phải chứng minh, và chỉ hai:
 *  1. Nội dung người dùng gõ vào **không bao giờ** trở thành markup — kể cả chuỗi trông như thẻ HTML.
 *  2. `#thẻ` khớp ĐÚNG luật mà BE dùng để lưu thẻ (lệch luật ⇒ link dẫn tới bộ lọc rỗng).
 */
import { describe, expect, it } from "vitest";
import type { FeedMentionDto } from "@mediaos/contracts";
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

/**
 * S16-SOCIAL-MENTIONLINK-1 (plan S16-SOCIAL-FE-2D §4 B1 · §5 lát B) — `mentions` của server biến
 * `@Họ Tên` thành link hồ sơ. Mỗi ca DENY đứng cạnh một ca ALLOW: DENY xanh trên code cũ (code cũ
 * không có link nào) nên giá trị của nó nằm ở mutant mB1–mB9, không ở lượt RED đầu.
 */
describe("MENTIONLINK — parseFeedBody(body, mentions): link CHỈ khi server nói `withheld:false`", () => {
  const E1 = "33333333-3333-4333-8333-333333333333";
  const E2 = "66666666-6666-4666-8666-666666666666";
  const AN = { withheld: false, employeeId: E1, label: "Nguyễn Văn An" } as const;

  /** Token của bản cũ (span một chữ) cho `"Chào @Nguyễn Văn An!"` — đích mà mọi ca DENY phải giữ. */
  const SPAN_TOKENS: FeedBodyToken[] = [
    { kind: "text", value: "Chào " },
    { kind: "mention", value: "@Nguyễn" },
    { kind: "text", value: " Văn An!" },
  ];

  it("P1 ALLOW: nhãn khớp trọn ⇒ `mentionLink` mang `employeeId` của SERVER, chữ nguyên văn", () => {
    expect(parseFeedBody("Chào @Nguyễn Văn An!", [AN])).toEqual([
      { kind: "text", value: "Chào " },
      { kind: "mentionLink", value: "@Nguyễn Văn An", employeeId: E1 },
      { kind: "text", value: "!" },
    ]);
  });

  it("P2 DENY: chỉ phần tử `withheld:true` ⇒ KHÔNG link; phần tử rút bị nhét lậu nhãn + id ⇒ vẫn KHÔNG", () => {
    expect(parseFeedBody("Chào @Nguyễn Văn An!", [{ withheld: true }])).toEqual(SPAN_TOKENS);

    // Hợp đồng cấm nhánh rút mang `label`/`employeeId`; một server lỗi (hay một proxy) nhét vào thì
    // FE vẫn không được đọc chúng — nhánh rút là «đã rời audience», link tới đó là rò.
    const smuggled = {
      withheld: true,
      employeeId: E1,
      label: "Nguyễn Văn An",
    } as unknown as FeedMentionDto;
    expect(parseFeedBody("Chào @Nguyễn Văn An!", [smuggled])).toEqual(SPAN_TOKENS);
  });

  it("P3 DENY: hai phần tử CÙNG nhãn mà KHÁC người ⇒ mơ hồ ⇒ span (không đoán ai)", () => {
    const twin = { withheld: false, employeeId: E2, label: "Nguyễn Văn An" } as const;
    expect(parseFeedBody("Chào @Nguyễn Văn An!", [AN, twin])).toEqual(SPAN_TOKENS);
  });

  it("P4 DENY: biên phải — `@Nguyễn Văn Anh` KHÔNG phải `Nguyễn Văn An`; `x@…` không có biên trái", () => {
    expect(parseFeedBody("@Nguyễn Văn Anh", [AN])).toEqual([
      { kind: "mention", value: "@Nguyễn" },
      { kind: "text", value: " Văn Anh" },
    ]);
    expect(parseFeedBody("x@Nguyễn Văn An", [AN])).toEqual([
      { kind: "text", value: "x@Nguyễn Văn An" },
    ]);
  });

  it("PU1 DENY: dạng TRỘN (dựng sẵn tới `A` + U+0309 rời) — `@Nguyễn Văn Ả` là NGƯỜI KHÁC, không link sang `Nguyễn Văn A`", () => {
    const mixed = "@Nguyễn Văn Ả ơi";
    // Đối chứng fixture: đúng là chuỗi trộn (chữ «Ả» dựng sẵn KHÔNG có trong thân, U+0309 đứng rời).
    expect(mixed.includes("Ả")).toBe(false);
    expect(mixed.normalize("NFC")).toBe("@Nguyễn Văn Ả ơi");

    const tokens = parseFeedBody(mixed, [
      { withheld: false, employeeId: E1, label: "Nguyễn Văn A" },
    ]);
    expect(tokens.filter((t) => t.kind === "mentionLink")).toEqual([]);
  });

  it("PU2 ALLOW: thân NFD toàn phần, nhãn NFC ⇒ vẫn link; `value` là chuỗi con NFD NGUYÊN VĂN", () => {
    const body = "Chào @Nguyễn Văn An!".normalize("NFD");
    const i = body.indexOf("@");
    const j = body.length - 1; // trước dấu «!»
    // Đối chứng fixture: thân thật sự là NFD (dài hơn bản NFC) — không thì ca này trùng P1.
    expect(body.length).toBeGreaterThan("Chào @Nguyễn Văn An!".length);

    expect(parseFeedBody(body, [AN])).toEqual([
      { kind: "text", value: body.slice(0, i) },
      { kind: "mentionLink", value: body.slice(i, j), employeeId: E1 },
      { kind: "text", value: "!" },
    ]);
  });

  it("PU3 DENY/ALLOW: ngữ cảnh trái đọc trên CHUỖI GỐC — `#tag@…` không link, `#tag @…` link", () => {
    const deny = parseFeedBody("#tag@Nguyễn Văn An", [AN]);
    expect(deny.filter((t) => t.kind === "mentionLink")).toEqual([]);

    expect(parseFeedBody("#tag @Nguyễn Văn An", [AN])).toEqual([
      { kind: "tag", value: "#tag", tag: "tag" },
      { kind: "text", value: " " },
      { kind: "mentionLink", value: "@Nguyễn Văn An", employeeId: E1 },
    ]);
  });

  it("P5: nhãn DÀI thắng ở cùng vị trí; dấu chấm sau nhãn ngắn là text, không dính vào link", () => {
    const an = { withheld: false, employeeId: E1, label: "An" } as const;
    const anNguyen = { withheld: false, employeeId: E2, label: "An Nguyễn" } as const;
    expect(parseFeedBody("@An Nguyễn và @An.", [an, anNguyen])).toEqual([
      { kind: "mentionLink", value: "@An Nguyễn", employeeId: E2 },
      { kind: "text", value: " và " },
      { kind: "mentionLink", value: "@An", employeeId: E1 },
      { kind: "text", value: "." },
    ]);
  });

  it("P6: nhãn có ký tự đặc biệt của regex `Lê (HR)` ⇒ khớp NGUYÊN VĂN", () => {
    const le = { withheld: false, employeeId: E1, label: "Lê (HR)" } as const;
    expect(parseFeedBody("Gửi @Lê (HR) nhé", [le])).toEqual([
      { kind: "text", value: "Gửi " },
      { kind: "mentionLink", value: "@Lê (HR)", employeeId: E1 },
      { kind: "text", value: " nhé" },
    ]);
  });

  it("P7: `mentions` vắng / rỗng / chỉ phần tử rút ⇒ token Y HỆT bản cũ", () => {
    for (const body of [
      "xem https://a.b rồi #thẻ và @ai đó",
      "Chào @Nguyễn Văn An!",
      "Cảm ơn @An.",
      "gửi an@acme.vn giúp",
    ]) {
      const legacy = parseFeedBody(body);
      expect(parseFeedBody(body, undefined)).toEqual(legacy);
      expect(parseFeedBody(body, [])).toEqual(legacy);
      expect(parseFeedBody(body, [{ withheld: true }])).toEqual(legacy);
    }
  });
});
