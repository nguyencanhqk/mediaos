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
 */
import { describe, expect, it } from "vitest";
import { FEED_WISH_MAX, validateFeedRouteSearch } from "./feed-route-search";

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
