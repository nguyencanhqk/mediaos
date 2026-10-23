/**
 * S4-DASH-HROVERVIEW-FLOOR-1 · U2 — hằng sàn scope widget DASH sống ở `packages/contracts` (tín hiệu dùng chung
 * cho FE) và phía BE là CÙNG MỘT đối tượng, không phải bản chép.
 *
 *   - `toStrictEqual` ghim ĐÚNG tập khoá + giá trị: thêm / bớt / đổi một sàn phải sửa ca này có chủ đích.
 *   - `Object.isFrozen`: hằng dùng chung không được sửa lúc chạy (một consumer đổi giá trị = đổi cổng của
 *     mọi consumer khác).
 *   - MỘT assert identity riêng: BE re-export đúng đối tượng của contracts. BE giữ bản cục bộ lệch contracts
 *     ⇒ metadata / data (BE) và FE đọc hai hằng khác nhau ⇒ ca này đỏ.
 *
 * Tệp DUY NHẤT import export mới của contracts (plan F5).
 */
import { describe, expect, it } from "vitest";
import { DASH_WIDGET_MIN_DATA_SCOPE as CONTRACT_FLOOR } from "@mediaos/contracts";
import { DASH_WIDGET_MIN_DATA_SCOPE as BE_FLOOR } from "../../src/dashboard/dashboard-widget-catalog.const";

describe("U2 · DASH_WIDGET_MIN_DATA_SCOPE — contracts là nguồn, BE re-export cùng đối tượng", () => {
  it("đúng 8 khoá với giá trị ghim", () => {
    expect({ ...CONTRACT_FLOOR }).toStrictEqual({
      ASSET_SUMMARY: "Department",
      RECRUIT_FUNNEL: "Company",
      PAYROLL_COST: "Company",
      PAYROLL_BUDGET: "Company",
      PAYROLL_ADVANCE_PENDING: "Company",
      SOCIAL_ENGAGEMENT_WEEK: "Department",
      SOCIAL_NEWS_UNACKED: "Company",
      HR_OVERVIEW: "Department",
    });
  });

  it("đóng băng (Object.freeze)", () => {
    // `Object.isFrozen(undefined)` = true ⇒ phải chứng là object trước.
    expect(typeof CONTRACT_FLOOR).toBe("object");
    expect(Object.isFrozen(CONTRACT_FLOOR)).toBe(true);
  });

  it("BE re-export CÙNG đối tượng của contracts (không phải bản chép)", () => {
    expect(BE_FLOOR).toBe(CONTRACT_FLOOR);
  });
});
