/**
 * S4-DASH-HROVERVIEW-FLOOR-1 · U1 — sàn scope của widget `HR_OVERVIEW` qua `meetsMinDataScope` (hàm mà CẢ
 * đường metadata — `DashboardWidgetRegistryService.filterByGatePair` — LẪN đường data — `gateHrOverview` — gọi).
 *
 * Sàn = `Department` (quyết định owner 16/10/2026, SPEC-07 §14.8): HR / company-admin (@Company) thấy cả công
 * ty, người giữ @Department thấy phòng mình; @Team (quản lý) và @Own (nhân viên) KHÔNG nhận số liệu. Không có
 * grant (`null`) ⇒ fail-closed.
 *
 * Tệp này CHỈ import catalog phía BE (plan F5): lỗi phân giải export mới của contracts không được che bằng
 * chứng RED của ca này — ca đó sống riêng ở `dashboard-widget-floor-contract.unit-spec.ts`.
 */
import { describe, expect, it } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import { meetsMinDataScope } from "../../src/dashboard/dashboard-widget-catalog.const";

const CODE = "HR_OVERVIEW";

describe("U1 · meetsMinDataScope('HR_OVERVIEW', scope) — sàn Department", () => {
  it.each<[DataScope | null, boolean]>([
    [null, false],
    ["Own", false],
    ["Team", false],
    ["Department", true],
    ["Company", true],
    ["System", true],
  ])("scope %s ⇒ %s", (scope, expected) => {
    expect(meetsMinDataScope(CODE, scope)).toBe(expected);
  });
});
