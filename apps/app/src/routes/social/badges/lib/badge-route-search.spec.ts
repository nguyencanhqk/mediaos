/**
 * S16-SOCIAL-FE-3B (L4, ca S2) — tham số URL của `/feed/kudos-badges`.
 *
 * Bộ lọc ăn ĐẦU RA của parser THẬT của TanStack Router (`defaultParseSearch` = `parseSearchWith(JSON.parse)`):
 * `?page=2` tới hàm là SỐ 2. Mọi vế kỳ vọng viết tay.
 */
import { describe, expect, it } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import { FEED_PAGE_MAX, listKudosBadgesAdminQuerySchema } from "@mediaos/contracts";
import {
  badgeListParams,
  BADGES_PAGE_SIZE,
  searchForBadgePage,
  validateBadgeRouteSearch,
} from "./badge-route-search";

/** Đầu ra của parser THẬT của router — không dựng object tay. */
const parse = (qs: string) => defaultParseSearch(qs) as Record<string, unknown>;
const fromUrl = (qs: string) => validateBadgeRouteSearch(parse(qs));

const NOTHING = { page: undefined };

describe("validateBadgeRouteSearch — S2: ăn đầu ra parser thật, luôn trả khoá `page`", () => {
  it("URL trống ⇒ khoá `page` CÓ MẶT với `undefined` tường minh (khoá vắng thì giá trị thô sống sót)", () => {
    const out = fromUrl("");
    expect(Object.keys(out)).toEqual(["page"]);
    expect(out).toStrictEqual(NOTHING);
  });

  it("`?page=2` ⇒ parser đưa SỐ 2 ⇒ giữ 2 (không phải chuỗi)", () => {
    expect(parse("?page=2").page).toBe(2);
    expect(fromUrl("?page=2")).toStrictEqual({ page: 2 });
  });

  it.each([
    ["?page=1", "trang 1 là mặc định — không ghi lên URL"],
    ["?page=x", "chuỗi"],
    ["?page=0", "dưới 1"],
    ["?page=-3", "âm"],
    ["?page=2.5", "không nguyên"],
    ['?page="2"', "chuỗi JSON «2» — không phải số"],
    ["?page=true", "boolean"],
    ["?page=[2]", "mảng"],
    [`?page=${FEED_PAGE_MAX + 1}`, "vượt trần trang của hợp đồng ⇒ 056 sẽ trả 400"],
  ])("`%s` ⇒ `page` là `undefined` (%s)", (qs) => {
    expect(fromUrl(qs)).toStrictEqual(NOTHING);
  });

  it("trang lớn nhất hợp đồng nhận ⇒ giữ; khoá lạ trên URL bị bỏ khỏi đầu ra", () => {
    expect(fromUrl(`?page=${FEED_PAGE_MAX}`)).toStrictEqual({ page: FEED_PAGE_MAX });
    expect(fromUrl("?page=3&tab=hidden&status=open")).toStrictEqual({ page: 3 });
  });

  it("không ném với đầu vào bất kỳ", () => {
    for (const raw of [{ page: null }, { page: {} }, { page: Number.NaN }, { page: Infinity }]) {
      expect(() => validateBadgeRouteSearch(raw)).not.toThrow();
      expect(validateBadgeRouteSearch(raw)).toStrictEqual(NOTHING);
    }
  });
});

describe("badgeListParams — tham số gửi 056", () => {
  it("cỡ trang là 50 (viết tay — plan D13) và qua `listKudosBadgesAdminQuerySchema`", () => {
    expect(BADGES_PAGE_SIZE).toBe(50);
    expect(badgeListParams({})).toStrictEqual({ page: 1, limit: 50 });
    expect(badgeListParams({ page: 4 })).toStrictEqual({ page: 4, limit: 50 });
    expect(listKudosBadgesAdminQuerySchema.safeParse(badgeListParams({ page: 4 })).success).toBe(
      true,
    );
  });
});

describe("searchForBadgePage — search kế tiếp khi đổi trang", () => {
  it("trang ≥ 2 ⇒ ghi; trang 1 / không hợp lệ ⇒ `page: undefined` tường minh", () => {
    expect(searchForBadgePage(2)).toStrictEqual({ page: 2 });
    expect(searchForBadgePage(1)).toStrictEqual(NOTHING);
    expect(searchForBadgePage(0)).toStrictEqual(NOTHING);
    expect(searchForBadgePage(2.5)).toStrictEqual(NOTHING);
    expect(searchForBadgePage(FEED_PAGE_MAX + 1)).toStrictEqual(NOTHING);
  });
});
