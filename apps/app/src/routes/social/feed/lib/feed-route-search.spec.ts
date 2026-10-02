/**
 * S16-SOCIAL-FE-1 — `validateFeedRouteSearch`.
 *
 * Ca đáng giá nhất ở đây là **trần của `wish`** (vá FULL gate 23/09/2026): `wish` là văn bản do
 * người khác kiểm soát, đi thẳng vào ô soạn bài của người nhận link. Không phải XSS — rủi ro là
 * xã hội: một link dựng sẵn cả bài viết trong ô soạn của nạn nhân, một cú bấm «Đăng» là bài đăng
 * toàn công ty đứng tên họ.
 *
 * Các ca còn lại giữ luật «KHÔNG NÉM» (C17): `validateSearch` mà ném là màn hình lỗi thay cho bảng
 * tin, chỉ vì người dùng sửa tay thanh địa chỉ.
 *
 * S16-SOCIAL-FESEARCHBOUNDS-1 thêm vế thứ hai của cùng luật đó: không ném CHƯA ĐỦ — tham số chuyển
 * tiếp mà vượt biên hợp đồng thì server trả 400 và bảng tin vẫn ra màn LỖI. Các ca ở khối cuối đo
 * bằng CHÍNH schema `.strict()` của hợp đồng (`listFeedQuerySchema` · `searchFeedQuerySchema`), không
 * chép lại con số trần nào.
 */
import { describe, expect, it } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import {
  FEED_SEARCH_QUERY_MAX,
  feedPostTypeSchema,
  listFeedQuerySchema,
  searchFeedQuerySchema,
} from "@mediaos/contracts";
import { FEED_WISH_MAX, validateFeedRouteSearch, type FeedRouteSearch } from "./feed-route-search";

describe("validateFeedRouteSearch — trần của `wish`", () => {
  it("cắt `wish` về FEED_WISH_MAX", () => {
    const long = "x".repeat(5000);
    const out = validateFeedRouteSearch({ wish: long });
    expect(out.wish).toHaveLength(FEED_WISH_MAX);
  });

  it("trần phải đủ NGẮN để không chở nổi một bài viết", () => {
    // Ghim quan hệ chứ không ghim con số: ai nới FEED_WISH_MAX lên sát trần bài viết thì ca này đỏ.
    // FEED_BODY_MAX = 4000 (trần sản phẩm của thân bài).
    expect(FEED_WISH_MAX).toBeLessThan(4000 / 10);
  });

  it("`wish` ngắn thì giữ nguyên, không cắt oan", () => {
    expect(validateFeedRouteSearch({ wish: "An Nguyễn" }).wish).toBe("An Nguyễn");
  });

  it("không có `wish` ⇒ khoá vắng hẳn, không phải chuỗi rỗng", () => {
    expect("wish" in validateFeedRouteSearch({})).toBe(false);
    expect("wish" in validateFeedRouteSearch({ wish: "" })).toBe(false);
  });
});

describe("validateFeedRouteSearch — KHÔNG NÉM với URL rác (C17)", () => {
  it("tham số lạ bị bỏ, không ném", () => {
    expect(() => validateFeedRouteSearch({ limit: "abc", hacker: {} })).not.toThrow();
    expect(validateFeedRouteSearch({ limit: "abc", hacker: {} })).toEqual({});
  });

  it("`sort` ngoài tập hợp lệ ⇒ rơi về mặc định (khoá vắng), không ném", () => {
    expect(validateFeedRouteSearch({ sort: "popular" })).toEqual({});
    expect(validateFeedRouteSearch({ sort: "latest" })).toEqual({ sort: "latest" });
    expect(validateFeedRouteSearch({ sort: "active" })).toEqual({ sort: "active" });
  });

  it("giá trị không phải chuỗi ⇒ bỏ, không ném", () => {
    expect(validateFeedRouteSearch({ tag: 123, q: null, type: [] })).toEqual({});
  });

  it("giữ đủ bộ lọc hợp lệ", () => {
    expect(
      validateFeedRouteSearch({ sort: "latest", tag: "quy-che", type: "news", q: "nghỉ lễ" }),
    ).toEqual({ sort: "latest", tag: "quy-che", type: "news", q: "nghỉ lễ" });
  });
});

// ─────────────── S16-SOCIAL-FESEARCHBOUNDS-1 — biên hợp đồng của tham số CHUYỂN TIẾP ───────────────

/** Validator ăn ĐẦU RA của parser THẬT của router (`parseSearchWith(JSON.parse)`), không object tay. */
const parse = (qs: string) => defaultParseSearch(qs) as Record<string, unknown>;

/**
 * Đúng phần `FeedPage` gửi lên `001`: mọi khoá TRỪ `q`/`wish` (tham số chỉ của FE). Trả danh sách
 * issue thay cho boolean để ca đỏ in ra ĐÚNG trường nào làm server trả 400.
 */
function listIssues(out: FeedRouteSearch) {
  const { q: _q, wish: _wish, ...forwarded } = out;
  return listFeedQuerySchema.safeParse(forwarded).error?.issues ?? [];
}

/** Đúng phần `FeedPage` gửi lên `023` (chỉ khi có `q`). */
function searchIssues(out: FeedRouteSearch) {
  if (out.q === undefined) return [];
  return searchFeedQuerySchema.safeParse({ q: out.q }).error?.issues ?? [];
}

/** Trần THẬT của một trường chuỗi, dò bằng chính schema hợp đồng — không chép con số vào spec. */
function probeMax(accepts: (s: string) => boolean): number {
  let n = 1;
  while (n < 10_000 && accepts("t".repeat(n + 1))) n += 1;
  return n;
}

const TAG_MAX = probeMax((s) => listFeedQuerySchema.safeParse({ tag: s }).success);

describe("validateFeedRouteSearch — `tag` theo biên của 001", () => {
  it("`tag` toàn khoảng trắng ⇒ BỎ (gửi lên là 400: schema trim rồi đòi min 1)", () => {
    const raw = parse("?tag=%20%20%20");
    expect(raw.tag).toBe("   "); // tiền đề: parser giữ nguyên chuỗi khoảng trắng
    const out = validateFeedRouteSearch(raw);
    expect(listIssues(out)).toEqual([]);
    expect(out).not.toHaveProperty("tag");
  });

  it("`tag` đệm khoảng trắng ⇒ giữ bản ĐÃ trim (đối chứng dương)", () => {
    const out = validateFeedRouteSearch(parse("?tag=%20quy-che%20"));
    expect(out.tag).toBe("quy-che");
    expect(listIssues(out)).toEqual([]);
  });

  it("`tag` đúng trần ⇒ giữ · vượt trần 1 ký tự ⇒ BỎ, KHÔNG cắt (thẻ cắt cụt là một thẻ KHÁC)", () => {
    const atMax = "t".repeat(TAG_MAX);
    expect(validateFeedRouteSearch({ tag: atMax }).tag).toBe(atMax);

    const over = validateFeedRouteSearch({ tag: `${atMax}t` });
    expect(listIssues(over)).toEqual([]);
    expect(over).not.toHaveProperty("tag");
  });

  it("đo độ dài SAU trim: đệm khoảng trắng quanh thẻ đúng trần vẫn giữ", () => {
    const atMax = "t".repeat(TAG_MAX);
    expect(validateFeedRouteSearch({ tag: `  ${atMax}  ` }).tag).toBe(atMax);
  });
});

describe("validateFeedRouteSearch — `type` chỉ nhận enum loại bài", () => {
  it("`type` dài hơn trần của 001 ⇒ BỎ (gửi lên là 400)", () => {
    const out = validateFeedRouteSearch(parse(`?type=${"x".repeat(40)}`));
    expect(listIssues(out)).toEqual([]);
    expect(out).not.toHaveProperty("type");
  });

  it("`type` ngắn nhưng KHÔNG thuộc enum ⇒ BỎ (server nhận nhưng trả tập rỗng vĩnh viễn)", () => {
    expect(validateFeedRouteSearch(parse("?type=announcement"))).toEqual({});
    expect(validateFeedRouteSearch(parse("?type=NEWS"))).toEqual({});
  });

  it("mọi giá trị của enum loại bài đều giữ và qua 001 (đối chứng dương)", () => {
    for (const type of feedPostTypeSchema.options) {
      const out = validateFeedRouteSearch(parse(`?type=${type}`));
      expect(out.type).toBe(type);
      expect(listIssues(out)).toEqual([]);
    }
  });

  it("URL rác tổng hợp ⇒ mọi khoá chuyển tiếp qua 001, bộ lọc HỢP LỆ đi kèm vẫn giữ", () => {
    const out = validateFeedRouteSearch(parse(`?sort=latest&tag=%20&type=${"y".repeat(17)}`));
    expect(out).toEqual({ sort: "latest" });
    expect(listIssues(out)).toEqual([]);
  });
});

describe("validateFeedRouteSearch — `q` theo biên của 023", () => {
  it("tiền đề: hằng FE dùng để cắt TRÙNG trần thật của schema 023", () => {
    expect(probeMax((s) => searchFeedQuerySchema.safeParse({ q: s }).success)).toBe(
      FEED_SEARCH_QUERY_MAX,
    );
  });

  it("`q` vượt trần ⇒ CẮT về trần (không bỏ) và qua 023", () => {
    const out = validateFeedRouteSearch(parse(`?q=${"a".repeat(FEED_SEARCH_QUERY_MAX * 5)}`));
    expect(searchIssues(out)).toEqual([]);
    expect(out.q).toBe("a".repeat(FEED_SEARCH_QUERY_MAX));
  });

  it("trim TRƯỚC khi cắt: khoảng trắng đệm không ăn mất từ khoá", () => {
    const core = "b".repeat(FEED_SEARCH_QUERY_MAX);
    expect(validateFeedRouteSearch({ q: `   ${core}   ` }).q).toBe(core);
  });

  it("chỗ cắt rơi vào khoảng trắng ⇒ không để đuôi khoảng trắng", () => {
    const head = "c".repeat(FEED_SEARCH_QUERY_MAX - 1);
    const out = validateFeedRouteSearch({ q: `${head} ${"d".repeat(50)}` });
    expect(out.q).toBe(head);
    expect(searchIssues(out)).toEqual([]);
  });

  it("chỗ cắt rơi giữa cặp surrogate (emoji) ⇒ bỏ nửa cặp, không để ký tự mồ côi", () => {
    const head = "a".repeat(FEED_SEARCH_QUERY_MAX - 1);
    expect(validateFeedRouteSearch({ q: `${head}😀tail` }).q).toBe(head);
  });

  it("`q` toàn khoảng trắng ⇒ BỎ (023 đòi min 1)", () => {
    expect(validateFeedRouteSearch(parse("?q=%20%20"))).not.toHaveProperty("q");
  });

  it("`q` ngắn hợp lệ ⇒ giữ nguyên (đối chứng dương)", () => {
    const out = validateFeedRouteSearch(parse("?q=ngh%E1%BB%89%20l%E1%BB%85"));
    expect(out.q).toBe("nghỉ lễ");
    expect(searchIssues(out)).toEqual([]);
  });
});
