/**
 * S16-SOCIAL-FE-3B (L5a, ca T6 / X1 — vế bảng lỗi) — lỗi của 052 (đọc số liệu) và 053 (xuất XLSX): hai lời gọi
 * CHUNG một bảng (plan §3 L5). Mỗi lỗi ra một `reason` của tập đóng + MỘT «lối thoát» mà màn vẽ thành nút.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@mediaos/web-core";
import { ZodError } from "zod";
import { ADMIN_ERR, UNIT_ID } from "../../admin/admin-test-doubles";
import { ADMIN_ERROR_REASONS } from "../../admin/lib/admin-errors";
import { GuardedMutationTimeoutError } from "../../admin/lib/use-guarded-mutation";
import { STATS_ERROR_TABLE, StatsExportFileError, describeStatsError } from "./stats-errors";

const DEFAULT_PARAMS = {};
const WITH_UNIT = { orgUnitId: UNIT_ID };
const WITH_RANGE = { from: "2026-09-21", to: "2026-10-04" };

describe("STATS_ERROR_TABLE", () => {
  it("khai đúng 1 mã (viết tay)", () => {
    expect(STATS_ERROR_TABLE).toEqual({
      "SOCIAL-ERR-STATS-UNIT-OUT-OF-SCOPE": "statsUnitOutOfScope",
    });
  });
});

describe("describeStatsError — reason + lối thoát", () => {
  it("403 `STATS-UNIT-OUT-OF-SCOPE` ⇒ `statsUnitOutOfScope` + «bỏ lọc đơn vị»", () => {
    expect(describeStatsError(ADMIN_ERR.statsUnitOutOfScope(), WITH_UNIT)).toStrictEqual({
      reason: "statsUnitOutOfScope",
      recovery: "clearOrgUnit",
    });
  });

  it("403 KHÁC (tầng quyền) ⇒ `forbidden`, KHÔNG có lối thoát (thử lại vô ích)", () => {
    expect(describeStatsError(ADMIN_ERR.forbidden(), WITH_UNIT)).toStrictEqual({
      reason: "forbidden",
      recovery: "none",
    });
    expect(describeStatsError(ADMIN_ERR.moderationDenied(), DEFAULT_PARAMS)).toStrictEqual({
      reason: "forbidden",
      recovery: "none",
    });
  });

  it("400 khi ĐANG gửi `from` / `to` ⇒ `statsRangeInvalid` + «về mặc định»", () => {
    expect(describeStatsError(ADMIN_ERR.badRequest(), WITH_RANGE)).toStrictEqual({
      reason: "statsRangeInvalid",
      recovery: "resetRange",
    });
  });

  it("400 khi KHÔNG gửi khoảng nào ⇒ `invalidRequest`, không mời «về mặc định» (bấm cũng không đổi gì)", () => {
    expect(describeStatsError(ADMIN_ERR.badRequest(), WITH_UNIT)).toStrictEqual({
      reason: "invalidRequest",
      recovery: "none",
    });
  });

  it.each([
    ["500", () => ADMIN_ERR.server()],
    ["502 của proxy (không envelope)", () => new ApiError(502, "HTTP_ERROR", "Bad Gateway")],
    ["lỗi mạng", () => new TypeError("Failed to fetch")],
    ["hết hạn chờ 30 giây", () => new GuardedMutationTimeoutError()],
    ["tệp tải về rỗng / không phải XLSX", () => new StatsExportFileError()],
    ["thân 2xx hỏng schema", () => new ZodError([])],
    ["thứ không phải Error", () => "boom"],
    ["404 mã lạ", () => new ApiError(404, "RESOURCE-ERR-NOT-FOUND", "Not found")],
  ])("%s ⇒ `generic` + «thử lại»", (_name, make) => {
    expect(describeStatsError(make(), WITH_RANGE)).toStrictEqual({
      reason: "generic",
      recovery: "retry",
    });
  });

  it("mã thắng status: mã `STATS-UNIT-OUT-OF-SCOPE` trên một 403 mang `message` bất kỳ vẫn ra đúng reason", () => {
    const err = new ApiError(403, "SOCIAL-ERR-STATS-UNIT-OUT-OF-SCOPE", "Forbidden resource");
    expect(describeStatsError(err, WITH_UNIT).reason).toBe("statsUnitOutOfScope");
  });

  it("mọi reason trả ra thuộc tập đóng `ADMIN_ERROR_REASONS` (có câu ở `admin.error.*`)", () => {
    const known: readonly string[] = ADMIN_ERROR_REASONS;
    const errors: unknown[] = [
      ...Object.values(ADMIN_ERR).map((make) => make()),
      new TypeError("x"),
      new StatsExportFileError(),
    ];
    const reasons = errors.flatMap((err) => [
      describeStatsError(err, DEFAULT_PARAMS).reason,
      describeStatsError(err, WITH_RANGE).reason,
    ]);
    for (const reason of reasons) expect(known).toContain(reason);
    // Màn Thống kê chỉ ra NĂM reason — không bao giờ ra reason riêng của báo cáo / huy hiệu.
    expect([...new Set(reasons)].sort()).toEqual([
      "forbidden",
      "generic",
      "invalidRequest",
      "statsRangeInvalid",
      "statsUnitOutOfScope",
    ]);
  });
});
