/**
 * S16-SOCIAL-FE-3B (L5a, ca T2) — tham số URL của `/feed/stats` (`SOC-SCREEN-011`) và tham số gửi 052 / 053.
 *
 * Đầu vào là thứ parser của TanStack Router THẬT SỰ đưa tới (`parseSearchWith(JSON.parse)`): `?from=2026` là
 * SỐ 2026, `?from=2026-09-01` là chuỗi. «Bỏ» một khoá = khoá đó có mặt với `undefined` TƯỜNG MINH ⇒ so bằng
 * `toStrictEqual` (nó phân biệt `{ a: undefined }` với `{}`).
 */
import { describe, expect, it } from "vitest";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { feedEngagementQuerySchema } from "@mediaos/contracts";
import { socialKeys } from "@mediaos/web-core";
import { UNIT_ID } from "../../admin/admin-test-doubles";
import {
  engagementParams,
  hasCustomRange,
  isEngagementKeyOfSameUnit,
  isSameStatsSearch,
  searchForOrgUnit,
  searchForRange,
  validateStatsRouteSearch,
} from "./stats-route-search";

const NONE = { from: undefined, to: undefined, orgUnitId: undefined };

describe("validateStatsRouteSearch — `from` / `to` đi THEO CẶP", () => {
  it("URL trần ⇒ đủ ba khoá, đều `undefined`", () => {
    expect(validateStatsRouteSearch({})).toStrictEqual(NONE);
  });

  it("cặp hợp lệ ⇒ GIỮ nguyên văn (kể cả ngày giữa tuần — server tự nắn về tuần ISO)", () => {
    expect(validateStatsRouteSearch({ from: "2026-09-21", to: "2026-10-04" })).toStrictEqual({
      ...NONE,
      from: "2026-09-21",
      to: "2026-10-04",
    });
    expect(validateStatsRouteSearch({ from: "2026-09-23", to: "2026-09-30" })).toStrictEqual({
      ...NONE,
      from: "2026-09-23",
      to: "2026-09-30",
    });
  });

  it("đúng 26 tuần sau khi nắn ⇒ giữ", () => {
    expect(validateStatsRouteSearch({ from: "2026-04-08", to: "2026-10-01" })).toStrictEqual({
      ...NONE,
      from: "2026-04-08",
      to: "2026-10-01",
    });
  });

  it.each([
    ["thiếu `to`", { from: "2026-09-01" }],
    ["thiếu `from`", { to: "2026-09-30" }],
    ["ngày không tồn tại", { from: "2026-02-30", to: "2026-03-08" }],
    ["`to` không tồn tại", { from: "2026-02-02", to: "2026-02-31" }],
    ["`from` > `to`", { from: "2026-10-04", to: "2026-09-21" }],
    ["27 tuần", { from: "2026-03-30", to: "2026-10-04" }],
    ["`from` là SỐ (`?from=2026`)", { from: 2026, to: "2026-10-04" }],
    ["`to` là mảng", { from: "2026-09-21", to: ["2026-10-04"] }],
    ["năm ngoài miền hợp đồng", { from: "0000-01-01", to: "0000-01-07" }],
    ["sai dạng", { from: "21/09/2026", to: "04/10/2026" }],
  ])("%s ⇒ bỏ CẢ HAI", (_name, raw) => {
    expect(validateStatsRouteSearch(raw)).toStrictEqual(NONE);
  });

  it("cặp ngày hỏng KHÔNG kéo theo `orgUnitId` hợp lệ", () => {
    expect(validateStatsRouteSearch({ from: "2026-09-01", orgUnitId: UNIT_ID })).toStrictEqual({
      ...NONE,
      orgUnitId: UNIT_ID,
    });
  });
});

describe("validateStatsRouteSearch — `orgUnitId`", () => {
  it("UUID hợp lệ ⇒ giữ", () => {
    expect(validateStatsRouteSearch({ orgUnitId: UNIT_ID })).toStrictEqual({
      ...NONE,
      orgUnitId: UNIT_ID,
    });
  });

  it.each([["abc"], [1], [""], [["x"]], [null], [true]])("sai dạng (%j) ⇒ bỏ", (orgUnitId) => {
    expect(validateStatsRouteSearch({ orgUnitId })).toStrictEqual(NONE);
  });

  it("`orgUnitId` hỏng KHÔNG kéo theo cặp ngày hợp lệ", () => {
    expect(
      validateStatsRouteSearch({ from: "2026-09-21", to: "2026-10-04", orgUnitId: "abc" }),
    ).toStrictEqual({ ...NONE, from: "2026-09-21", to: "2026-10-04" });
  });

  it("khoá lạ trên URL không lọt vào đầu ra", () => {
    expect(validateStatsRouteSearch({ page: 2, foo: "bar" })).toStrictEqual(NONE);
  });
});

describe("engagementParams — tham số gửi 052 / 053", () => {
  it("mặc định ⇒ object KHÔNG có khoá nào (server tự lấy 8 tuần)", () => {
    expect(engagementParams(NONE)).toStrictEqual({});
  });

  it("chỉ lọc đơn vị ⇒ chỉ có `orgUnitId`, không có khoá `from` / `to`", () => {
    expect(engagementParams({ ...NONE, orgUnitId: UNIT_ID })).toStrictEqual({ orgUnitId: UNIT_ID });
  });

  it("đủ ba ⇒ đủ ba; `from` lẻ (không thể có sau validate) ⇒ KHÔNG gửi vế nào", () => {
    const full = { from: "2026-09-21", to: "2026-10-04", orgUnitId: UNIT_ID };
    expect(engagementParams(full)).toStrictEqual(full);
    expect(engagementParams({ ...NONE, from: "2026-09-21" })).toStrictEqual({});
  });

  it("mọi đầu ra đều qua `feedEngagementQuerySchema`", () => {
    const outputs = [
      engagementParams(NONE),
      engagementParams({ ...NONE, orgUnitId: UNIT_ID }),
      engagementParams({ from: "2026-09-21", to: "2026-10-04", orgUnitId: UNIT_ID }),
      engagementParams({ ...NONE, from: "2026-09-21" }),
    ];
    for (const output of outputs) {
      expect(feedEngagementQuerySchema.safeParse(output).success).toBe(true);
    }
  });
});

describe("search kế tiếp", () => {
  const current = { from: "2026-09-21", to: "2026-10-04", orgUnitId: UNIT_ID };

  it("`searchForRange(null)` ⇒ bỏ `from` + `to` (tường minh), GIỮ đơn vị", () => {
    expect(searchForRange(current, null)).toStrictEqual({ ...NONE, orgUnitId: UNIT_ID });
  });

  it("`searchForRange(khoảng)` ⇒ ghi khoảng mới, GIỮ đơn vị", () => {
    expect(searchForRange(current, { from: "2026-09-07", to: "2026-09-20" })).toStrictEqual({
      from: "2026-09-07",
      to: "2026-09-20",
      orgUnitId: UNIT_ID,
    });
  });

  it("`searchForOrgUnit` ⇒ đổi / bỏ đơn vị, GIỮ khoảng", () => {
    expect(searchForOrgUnit({ ...current, orgUnitId: undefined }, UNIT_ID)).toStrictEqual(current);
    expect(searchForOrgUnit(current, undefined)).toStrictEqual({
      from: "2026-09-21",
      to: "2026-10-04",
      orgUnitId: undefined,
    });
  });

  it("`hasCustomRange`: có cặp ngày ⇒ true; mặc định ⇒ false", () => {
    expect(hasCustomRange(current)).toBe(true);
    expect(hasCustomRange({ ...NONE, orgUnitId: UNIT_ID })).toBe(false);
  });
});

describe("isEngagementKeyOfSameUnit — giữ số liệu cũ CHỈ khi cùng bộ lọc đơn vị (L5b)", () => {
  const OTHER_UNIT = "99999999-9999-4999-8999-999999999999";
  const RANGE = { from: "2026-09-21", to: "2026-10-04" };
  const key = socialKeys.stats.engagement;

  it("ALLOW — cùng «tất cả đơn vị», khoảng khác nhau ⇒ true", () => {
    expect(isEngagementKeyOfSameUnit(key({}), {})).toBe(true);
    expect(isEngagementKeyOfSameUnit(key({}), RANGE)).toBe(true);
    expect(isEngagementKeyOfSameUnit(key(RANGE), {})).toBe(true);
  });

  it("ALLOW — cùng MỘT đơn vị, khoảng khác nhau ⇒ true", () => {
    expect(isEngagementKeyOfSameUnit(key({ orgUnitId: UNIT_ID }), { orgUnitId: UNIT_ID })).toBe(
      true,
    );
    expect(
      isEngagementKeyOfSameUnit(key({ ...RANGE, orgUnitId: UNIT_ID }), { orgUnitId: UNIT_ID }),
    ).toBe(true);
  });

  it("DENY — khác đơn vị (kể cả một bên là «tất cả») ⇒ false", () => {
    expect(isEngagementKeyOfSameUnit(key({ orgUnitId: UNIT_ID }), {})).toBe(false);
    expect(isEngagementKeyOfSameUnit(key({}), { orgUnitId: UNIT_ID })).toBe(false);
    expect(isEngagementKeyOfSameUnit(key({ orgUnitId: OTHER_UNIT }), { orgUnitId: UNIT_ID })).toBe(
      false,
    );
  });

  it("DENY — không có khoá trước / khoá không mang tham số (tiền tố) ⇒ false, kể cả khi đang xem «tất cả»", () => {
    expect(isEngagementKeyOfSameUnit(undefined, {})).toBe(false);
    expect(isEngagementKeyOfSameUnit(socialKeys.stats.allOf(), {})).toBe(false);
    expect(isEngagementKeyOfSameUnit(key(), {})).toBe(false);
  });

  it("tìm tham số theo HÌNH DẠNG: khoá bị nối thêm phần tử sau tham số vẫn đọc đúng đơn vị", () => {
    const extended = [...key({ orgUnitId: UNIT_ID }), "them"];
    expect(isEngagementKeyOfSameUnit(extended, { orgUnitId: UNIT_ID })).toBe(true);
    expect(isEngagementKeyOfSameUnit(extended, {})).toBe(false);
  });
});

describe("Qua parser / serializer THẬT của router (`defaultParseSearch` · `defaultStringifySearch`)", () => {
  const parse = (qs: string) => defaultParseSearch(qs) as Record<string, unknown>;
  const PAIR = { from: "2026-09-21", to: "2026-10-04" };

  it("ALLOW — `?from=2026-09-21&to=2026-10-04` ⇒ parser giữ hai CHUỖI ngày ⇒ cặp được giữ nguyên văn và 052 nhận đúng cặp", () => {
    const search = validateStatsRouteSearch(parse("?from=2026-09-21&to=2026-10-04"));

    expect(search).toStrictEqual({ ...NONE, ...PAIR });
    expect(engagementParams(search)).toStrictEqual(PAIR);
  });

  it("ALLOW — khoảng mà nút ‹ ghi lên URL (kèm đơn vị) đi qua serializer rồi parser vẫn là CHÍNH nó", () => {
    const written = searchForRange({ ...NONE, orgUnitId: UNIT_ID }, PAIR);

    const reread = validateStatsRouteSearch(parse(defaultStringifySearch(written)));

    expect(reread).toStrictEqual({ ...PAIR, orgUnitId: UNIT_ID });
    expect(engagementParams(reread)).toStrictEqual({ ...PAIR, orgUnitId: UNIT_ID });
  });

  it("DENY — `?from=2026&to=2027`: parser đưa hai SỐ ⇒ bỏ cả cặp (không gửi tham số chắc chắn 400)", () => {
    expect(validateStatsRouteSearch(parse("?from=2026&to=2027"))).toStrictEqual(NONE);
  });
});

describe("isSameStatsSearch", () => {
  const FULL = { from: "2026-09-21", to: "2026-10-04", orgUnitId: UNIT_ID };

  it("cùng ba giá trị ⇒ true (khoá vắng và khoá `undefined` là một)", () => {
    expect(isSameStatsSearch(NONE, {})).toBe(true);
    expect(isSameStatsSearch(FULL, { ...FULL })).toBe(true);
  });

  it.each([{ from: "2026-09-14" }, { to: "2026-09-27" }, { orgUnitId: undefined }])(
    "khác một vế %j ⇒ false",
    (over) => {
      expect(isSameStatsSearch(FULL, { ...FULL, ...over })).toBe(false);
    },
  );
});
