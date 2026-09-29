/**
 * Ca H1 (plan FE-2B §8): validator ăn ĐẦU RA của parser THẬT của router (`defaultParseSearch` =
 * `parseSearchWith(JSON.parse)`), không object tay — `?invite=1` tới đây là SỐ `1`.
 */
import { describe, expect, it } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import {
  groupInviteUrl,
  isGroupId,
  validateGroupDetailRouteSearch,
  validateGroupsRouteSearch,
} from "./group-route-search";

const parse = (qs: string) => defaultParseSearch(qs) as Record<string, unknown>;

describe("validateGroupDetailRouteSearch", () => {
  it("?invite=1 qua parser thật (giá trị là SỐ 1) ⇒ invite:true", () => {
    const raw = parse("?invite=1");
    expect(raw.invite).toBe(1); // đo tiền đề: parser biến "1" thành số
    expect(validateGroupDetailRouteSearch(raw)).toEqual({ invite: true });
  });

  it("invite dạng chuỗi/true vẫn nhận; giá trị khác ⇒ bỏ", () => {
    expect(validateGroupDetailRouteSearch({ invite: "1" })).toEqual({ invite: true });
    expect(validateGroupDetailRouteSearch({ invite: true })).toEqual({ invite: true });
    expect(validateGroupDetailRouteSearch(parse("?invite=0"))).toEqual({});
    expect(validateGroupDetailRouteSearch(parse("?invite=yes"))).toEqual({});
  });

  it("tab hợp lệ giữ; `posts` (mặc định) và rác ⇒ bỏ; KHÔNG ném", () => {
    expect(validateGroupDetailRouteSearch(parse("?tab=members"))).toEqual({ tab: "members" });
    expect(validateGroupDetailRouteSearch(parse("?tab=settings&invite=1"))).toEqual({
      tab: "settings",
      invite: true,
    });
    expect(validateGroupDetailRouteSearch(parse("?tab=posts"))).toEqual({});
    expect(validateGroupDetailRouteSearch(parse("?tab=%7B%7D&x=1"))).toEqual({});
  });
});

describe("validateGroupsRouteSearch", () => {
  it("?q=2024 (parser thành SỐ) vẫn giữ làm chuỗi; ?page=2 là số", () => {
    const raw = parse("?q=2024&page=2&membership=mine");
    expect(raw.q).toBe(2024);
    expect(validateGroupsRouteSearch(raw)).toEqual({ membership: "mine", q: "2024", page: 2 });
  });

  it("q chỉ khoảng trắng ⇒ bỏ (server `min(1)` sau trim sẽ 400); q được trim", () => {
    expect(validateGroupsRouteSearch({ q: "   " })).toEqual({});
    expect(validateGroupsRouteSearch({ q: "  bóng đá " })).toEqual({ q: "bóng đá" });
  });

  it("membership lạ · page 1/0/âm/lẻ/quá trần ⇒ bỏ (mặc định giải ở component)", () => {
    expect(validateGroupsRouteSearch({ membership: "all" })).toEqual({});
    expect(validateGroupsRouteSearch({ membership: "x" })).toEqual({});
    for (const page of [1, 0, -2, 1.5, 10_001, "abc"]) {
      expect(validateGroupsRouteSearch({ page })).toEqual({});
    }
    expect(validateGroupsRouteSearch({ page: "3" })).toEqual({ page: 3 });
  });
});

describe("isGroupId · groupInviteUrl", () => {
  it("UUID hợp lệ ⇒ true; chuỗi khác/undefined ⇒ false", () => {
    expect(isGroupId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isGroupId("abc")).toBe(false);
    expect(isGroupId(undefined)).toBe(false);
    expect(isGroupId("11111111-1111-4111-8111-11111111111")).toBe(false);
  });

  it("nhóm kín thêm ?invite=1; public thì không; bỏ `/` thừa của origin", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(groupInviteUrl("https://app.x/", id, "private")).toBe(
      `https://app.x/feed/groups/${id}?invite=1`,
    );
    expect(groupInviteUrl("https://app.x", id, "public")).toBe(`https://app.x/feed/groups/${id}`);
  });

  it("link mời đi vòng qua parser thật vẫn ra invite:true (khép vòng O1)", () => {
    const url = new URL(groupInviteUrl("https://app.x", "11111111-1111-4111-8111-111111111111", "private"));
    expect(validateGroupDetailRouteSearch(parse(url.search))).toEqual({ invite: true });
  });
});
