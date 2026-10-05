/**
 * S16-SOCIAL-FE-3 (L2, ca S1) — tham số URL của `/feed/moderation`.
 *
 * Bộ lọc ăn ĐẦU RA của parser THẬT của TanStack Router (`defaultParseSearch` = `parseSearchWith(JSON.parse)`):
 * `?page=2` tới hàm là SỐ 2, `?status=1` là SỐ 1 — khuôn `typeof === "string"` chép từ `/feed` sẽ làm
 * `page` không bao giờ đọc được. Mọi vế kỳ vọng viết tay.
 */
import { describe, expect, it } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import { FEED_PAGE_MAX, listFeedReportsQuerySchema } from "@mediaos/contracts";
import {
  activeModerationTab,
  activeStatusFilter,
  reportListParams,
  searchForPage,
  searchForStatusFilter,
  searchForTab,
  validateModerationRouteSearch,
} from "./moderation-route-search";

/** Đầu ra của parser THẬT của router — không dựng object tay. */
const parse = (qs: string) => defaultParseSearch(qs) as Record<string, unknown>;
const fromUrl = (qs: string) => validateModerationRouteSearch(parse(qs));

const NOTHING = { tab: undefined, status: undefined, page: undefined };

describe("validateModerationRouteSearch — S1: ăn đầu ra parser thật, luôn đủ 3 khoá", () => {
  it("URL trống ⇒ đủ 3 khoá, tất cả `undefined` TƯỜNG MINH", () => {
    const out = fromUrl("");
    expect(Object.keys(out).sort()).toEqual(["page", "status", "tab"]);
    expect(out).toStrictEqual(NOTHING);
  });

  it("`?page=2` ⇒ parser đưa SỐ 2 ⇒ giữ 2 (không phải chuỗi)", () => {
    expect(parse("?page=2").page).toBe(2);
    expect(fromUrl("?page=2")).toStrictEqual({ ...NOTHING, page: 2 });
  });

  it.each([
    ["?page=1", "trang 1 là mặc định — không ghi lên URL"],
    ["?page=0", "dưới 1"],
    ["?page=-3", "âm"],
    ["?page=2.5", "không nguyên"],
    ["?page=abc", "chuỗi"],
    ['?page="2"', "chuỗi JSON «2» — không phải số"],
    ["?page=true", "boolean"],
    ["?page=[2]", "mảng"],
    [`?page=${FEED_PAGE_MAX + 1}`, "vượt trần trang của hợp đồng ⇒ 028 sẽ trả 400"],
  ])("`%s` ⇒ bỏ `page` (%s)", (qs) => {
    expect(fromUrl(qs)).toStrictEqual(NOTHING);
  });

  it("trang lớn nhất hợp đồng nhận ⇒ giữ", () => {
    expect(fromUrl(`?page=${FEED_PAGE_MAX}`)).toStrictEqual({ ...NOTHING, page: FEED_PAGE_MAX });
  });

  it.each(["open", "resolved", "dismissed", "all"] as const)("`?status=%s` ⇒ giữ", (status) => {
    expect(fromUrl(`?status=${status}`)).toStrictEqual({ ...NOTHING, status });
  });

  it.each(["?status=1", "?status=closed", "?status=OPEN", "?status=", "?status=null"])(
    "`%s` ⇒ bỏ `status`",
    (qs) => {
      expect(fromUrl(qs)).toStrictEqual(NOTHING);
    },
  );

  it.each(["reports", "hidden"] as const)("`?tab=%s` ⇒ giữ", (tab) => {
    expect(fromUrl(`?tab=${tab}`)).toStrictEqual({ ...NOTHING, tab });
  });

  it.each(["?tab=x", "?tab=1", "?tab=Hidden", "?tab="])("`%s` ⇒ bỏ `tab`", (qs) => {
    expect(fromUrl(qs)).toStrictEqual(NOTHING);
  });

  it("giữ đủ ba khoá hợp lệ cùng lúc", () => {
    expect(fromUrl("?tab=hidden&status=resolved&page=4")).toStrictEqual({
      tab: "hidden",
      status: "resolved",
      page: 4,
    });
  });

  it("KHÔNG NÉM với URL rác; khoá lạ không lọt vào đầu ra", () => {
    const raw = { tab: {}, status: [], page: null, limit: "abc", hacker: { a: 1 } };
    expect(() => validateModerationRouteSearch(raw)).not.toThrow();
    expect(validateModerationRouteSearch(raw)).toStrictEqual(NOTHING);
  });

  it("gộp kiểu router `{ ...thô, ...đầuRa }` ⇒ không giá trị thô hỏng nào sống sót", () => {
    const raw = parse("?tab=x&status=1&page=1");
    expect(raw).toEqual({ tab: "x", status: 1, page: 1 });
    const merged: Record<string, unknown> = { ...raw, ...validateModerationRouteSearch(raw) };
    expect(merged).toStrictEqual(NOTHING);
    // Đối chứng cùng khung: giá trị HỢP LỆ sống qua phép gộp (ca trên không xanh vì hàm xoá hết).
    const good = parse("?tab=hidden&status=all&page=3");
    expect({ ...good, ...validateModerationRouteSearch(good) }).toStrictEqual({
      tab: "hidden",
      status: "all",
      page: 3,
    });
  });
});

describe("activeModerationTab · activeStatusFilter — mặc định không ghi lên URL", () => {
  it("vắng `tab` ⇒ `reports`; `?tab=hidden` ⇒ `hidden`", () => {
    expect(activeModerationTab(fromUrl(""))).toBe("reports");
    expect(activeModerationTab({ tab: "reports" })).toBe("reports");
    expect(activeModerationTab({ tab: "hidden" })).toBe("hidden");
  });

  it("vắng `status` ⇒ `open` (D10); có ⇒ đúng giá trị", () => {
    expect(activeStatusFilter(fromUrl(""))).toBe("open");
    expect(activeStatusFilter({ status: "all" })).toBe("all");
    expect(activeStatusFilter({ status: "dismissed" })).toBe("dismissed");
  });
});

describe("reportListParams — tham số gửi 028 suy từ search", () => {
  it("mặc định ⇒ `status: open`, trang 1, 20 dòng/trang", () => {
    expect(reportListParams(fromUrl(""))).toStrictEqual({ status: "open", page: 1, limit: 20 });
  });

  it("«Tất cả» ⇒ KHÔNG có khoá `status` (vắng = mọi trạng thái; `status=all` là 400)", () => {
    const params = reportListParams(fromUrl("?status=all"));
    expect(params).toStrictEqual({ page: 1, limit: 20 });
    expect(Object.hasOwn(params, "status")).toBe(false);
  });

  it.each(["resolved", "dismissed"] as const)("`?status=%s&page=3` ⇒ gửi đúng cả hai", (status) => {
    expect(reportListParams(fromUrl(`?status=${status}&page=3`))).toStrictEqual({
      status,
      page: 3,
      limit: 20,
    });
  });

  it("tab không ảnh hưởng tham số 028", () => {
    expect(reportListParams(fromUrl("?tab=hidden&page=2"))).toStrictEqual({
      status: "open",
      page: 2,
      limit: 20,
    });
  });

  it.each(["", "?status=all", "?status=resolved&page=7", `?page=${FEED_PAGE_MAX}`, "?status=1"])(
    "tham số suy từ `%s` qua được CHÍNH schema `.strict()` của 028",
    (qs) => {
      const params = reportListParams(fromUrl(qs));
      expect(params.limit).toBe(20);
      expect(listFeedReportsQuerySchema.safeParse(params).error?.issues ?? []).toEqual([]);
    },
  );
});

describe("searchForStatusFilter — đổi bộ lọc ⇒ về trang 1", () => {
  it("đang ở trang 3, đổi sang `resolved` ⇒ bỏ `page`, ghi `status`", () => {
    expect(searchForStatusFilter({ status: "dismissed", page: 3 }, "resolved")).toStrictEqual({
      tab: undefined,
      status: "resolved",
      page: undefined,
    });
  });

  it("đổi về `open` ⇒ `status: undefined` (mặc định không ghi lên URL), bỏ `page`", () => {
    expect(searchForStatusFilter({ status: "all", page: 5 }, "open")).toStrictEqual(NOTHING);
  });

  it("«Tất cả» ⇒ ghi `status: all` lên URL", () => {
    expect(searchForStatusFilter({ page: 2 }, "all")).toStrictEqual({
      tab: undefined,
      status: "all",
      page: undefined,
    });
  });

  it("giữ nguyên `tab`", () => {
    expect(searchForStatusFilter({ tab: "reports", page: 9 }, "dismissed")).toStrictEqual({
      tab: "reports",
      status: "dismissed",
      page: undefined,
    });
  });

  it("không sửa object đầu vào", () => {
    const before = { status: "all", page: 5 } as const;
    searchForStatusFilter(before, "resolved");
    expect(before).toEqual({ status: "all", page: 5 });
    expect(searchForStatusFilter(before, "resolved").status).toBe("resolved");
  });
});

describe("searchForPage — đổi trang giữ bộ lọc", () => {
  it("sang trang 4 ⇒ ghi `page: 4`, giữ `status` + `tab`", () => {
    expect(searchForPage({ tab: "reports", status: "resolved", page: 3 }, 4)).toStrictEqual({
      tab: "reports",
      status: "resolved",
      page: 4,
    });
  });

  it("về trang 1 ⇒ `page: undefined` (không ghi lên URL), giữ `status`", () => {
    expect(searchForPage({ status: "all", page: 3 }, 1)).toStrictEqual({
      tab: undefined,
      status: "all",
      page: undefined,
    });
  });

  it("đầu ra đi vòng qua bộ lọc không đổi (URL ghi ra đọc lại được)", () => {
    const next = searchForPage({ status: "dismissed" }, 6);
    expect(next.page).toBe(6);
    expect(validateModerationRouteSearch({ ...next })).toStrictEqual(next);
  });
});

describe("searchForTab — đổi tab", () => {
  it("sang «Bài đang ẩn» ⇒ ghi `tab: hidden`, giữ bộ lọc + trang của hàng đợi", () => {
    expect(searchForTab({ status: "resolved", page: 2 }, "hidden")).toStrictEqual({
      tab: "hidden",
      status: "resolved",
      page: 2,
    });
  });

  it("về «Báo cáo» ⇒ `tab: undefined` (mặc định không ghi lên URL)", () => {
    const next = searchForTab({ tab: "hidden", status: "all", page: 2 }, "reports");
    expect(next).toStrictEqual({ tab: undefined, status: "all", page: 2 });
    expect(Object.hasOwn(next, "tab")).toBe(true);
  });
});
