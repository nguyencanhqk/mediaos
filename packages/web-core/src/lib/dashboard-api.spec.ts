/**
 * dashboard-api — contract/URL boundary tests (S4-FE-REGISTRY-1).
 *
 * Mock apiFetch tại ranh giới `./api-client`; kiểm chứng mỗi method gọi ĐÚNG path /dashboard/* (KHÔNG
 * forward company_id) + truyền ĐÚNG schema contract dashboard.ts (arg 2, reference-equality — schema là
 * export trực tiếp, không z.array bọc). Masking (null field) là việc server → client chỉ render field nhận.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  dashboardSummarySchema,
  reportResponseSchema,
  mvStatsResponseSchema,
  alertsResponseSchema,
  refreshResponseSchema,
  dashboardViewResponseSchema,
  dashboardTypesResponseSchema,
  dashboardWidgetDataSchema,
  dashboardConfigListResponseSchema,
  dashboardConfigItemSchema,
} from "@mediaos/contracts";
import { dashboardApi } from "./dashboard-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

function lastCall(): [string, unknown, { method?: string; body?: string }?] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

beforeEach(() => {
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
});

describe("dashboardApi — URL + schema boundary (KHÔNG company_id)", () => {
  it("getSummary → GET /dashboard/summary + dashboardSummarySchema", async () => {
    await dashboardApi.getSummary();
    const [url, schema] = lastCall();
    expect(url).toBe("/dashboard/summary");
    expect(url).not.toContain("company");
    expect(schema).toBe(dashboardSummarySchema);
  });

  it("getReport → GET /dashboard/report + period query + reportResponseSchema", async () => {
    await dashboardApi.getReport({ period: "lastMonth" });
    const [url, schema] = lastCall();
    expect(url).toContain("/dashboard/report");
    expect(url).toContain("period=lastMonth");
    expect(schema).toBe(reportResponseSchema);
  });

  it("getMvStats → GET /dashboard/mv-stats + mvStatsResponseSchema", async () => {
    await dashboardApi.getMvStats({ month: "2026-07" });
    const [url, schema] = lastCall();
    expect(url).toContain("/dashboard/mv-stats");
    expect(url).toContain("month=2026-07");
    expect(schema).toBe(mvStatsResponseSchema);
  });

  it("getAlerts → GET /dashboard/alerts + alertsResponseSchema", async () => {
    await dashboardApi.getAlerts();
    const [url, schema] = lastCall();
    expect(url).toBe("/dashboard/alerts");
    expect(schema).toBe(alertsResponseSchema);
  });

  it("refresh → POST /dashboard/refresh + refreshResponseSchema", async () => {
    await dashboardApi.refresh();
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/dashboard/refresh");
    expect(opts?.method).toBe("POST");
    expect(schema).toBe(refreshResponseSchema);
  });
});

describe("dashboardApi — resolver + widget DATA (S4-FE-DASH-1)", () => {
  it("getMyDashboard → GET /dashboard/me + dashboardViewResponseSchema", async () => {
    await dashboardApi.getMyDashboard();
    const [url, schema] = lastCall();
    expect(url).toBe("/dashboard/me");
    expect(url).not.toContain("company");
    expect(schema).toBe(dashboardViewResponseSchema);
  });

  it("getMyDashboard(limit) → forward query string", async () => {
    await dashboardApi.getMyDashboard({ limit: 5 });
    const [url] = lastCall();
    expect(url).toContain("limit=5");
  });

  it("getDashboardTypes → GET /dashboard/types + dashboardTypesResponseSchema", async () => {
    await dashboardApi.getDashboardTypes();
    const [url, schema] = lastCall();
    expect(url).toBe("/dashboard/types");
    expect(schema).toBe(dashboardTypesResponseSchema);
  });

  it("getWidgetCatalog → GET /dashboard/widgets + query include_data", async () => {
    await dashboardApi.getWidgetCatalog({ include_data: true });
    const [url, schema] = lastCall();
    expect(url).toContain("/dashboard/widgets");
    expect(url).toContain("include_data=true");
    // z.array(widgetCatalogItemSchema) tạo instance MỚI mỗi lần gọi — chỉ assert parse thành công
    // đúng shape catalog item (KHÔNG reference-equality như schema đơn ở trên).
    expect(() =>
      (schema as z.ZodTypeAny).parse([
        {
          widget_code: "MY_TASKS",
          widget_name: "Task của tôi",
          widget_type: "List",
          permission: "read:task",
          source_modules: ["TASK"],
          data_scope: "Own",
          enabled: true,
          layout: { order: 20 },
          quick_actions: [],
        },
      ]),
    ).not.toThrow();
  });

  it("getWidgetData('MY_TASKS') → GET /dashboard/widgets/my-tasks + dashboardWidgetDataSchema", async () => {
    await dashboardApi.getWidgetData("MY_TASKS", { refresh: true });
    const [url, schema] = lastCall();
    expect(url).toBe("/dashboard/widgets/my-tasks?refresh=true");
    expect(schema).toBe(dashboardWidgetDataSchema);
  });

  it("getWidgetData('TASK_ALERTS') → slug task-alerts", async () => {
    await dashboardApi.getWidgetData("TASK_ALERTS");
    const [url] = lastCall();
    expect(url).toBe("/dashboard/widgets/task-alerts");
  });

  it("getWidgetData('NOTIFICATIONS') → slug notifications", async () => {
    await dashboardApi.getWidgetData("NOTIFICATIONS");
    const [url] = lastCall();
    expect(url).toBe("/dashboard/widgets/notifications");
  });

  it("getWidgetData(widget chưa map slug) → throw NGAY, KHÔNG gọi apiFetch (fail-fast)", async () => {
    const before = vi.mocked(apiClient.apiFetch).mock.calls.length;
    // LEAVE_BALANCE — catalog-only, chưa có FE component ở Sprint 4 (IMPLEMENTATION-07 §11.3).
    expect(() => dashboardApi.getWidgetData("LEAVE_BALANCE")).toThrow(/chưa có FE slug mapping/);
    expect(vi.mocked(apiClient.apiFetch).mock.calls.length).toBe(before);
  });

  it("getWidgetData('ATTENDANCE_TODAY') → slug attendance-today", async () => {
    await dashboardApi.getWidgetData("ATTENDANCE_TODAY");
    const [url] = lastCall();
    expect(url).toBe("/dashboard/widgets/attendance-today");
  });

  it("getWidgetData('PENDING_LEAVE') → slug pending-leave", async () => {
    await dashboardApi.getWidgetData("PENDING_LEAVE");
    const [url] = lastCall();
    expect(url).toBe("/dashboard/widgets/pending-leave");
  });

  it("getWidgetData('PROJECT_PROGRESS', { project_id }) → slug project-progress + query project_id", async () => {
    await dashboardApi.getWidgetData("PROJECT_PROGRESS", { project_id: "p-1" });
    const [url] = lastCall();
    expect(url).toBe("/dashboard/widgets/project-progress?project_id=p-1");
  });

  it("getWidgetData('HR_OVERVIEW') → slug hr-overview", async () => {
    await dashboardApi.getWidgetData("HR_OVERVIEW");
    const [url] = lastCall();
    expect(url).toBe("/dashboard/widgets/hr-overview");
  });
});

describe("dashboardApi — getDashboardByType (S4-FE-DASH-2, DashboardTypeSwitcher)", () => {
  it("getDashboardByType('Employee') → GET /dashboard/employee + dashboardViewResponseSchema", async () => {
    await dashboardApi.getDashboardByType("Employee");
    const [url, schema] = lastCall();
    expect(url).toBe("/dashboard/employee");
    expect(schema).toBe(dashboardViewResponseSchema);
  });

  it("getDashboardByType('HR') → GET /dashboard/hr", async () => {
    await dashboardApi.getDashboardByType("HR");
    const [url] = lastCall();
    expect(url).toBe("/dashboard/hr");
  });

  it("getDashboardByType('Admin') → GET /dashboard/admin", async () => {
    await dashboardApi.getDashboardByType("Admin");
    const [url] = lastCall();
    expect(url).toBe("/dashboard/admin");
  });
});

describe("dashboardApi — config admin (S4-FE-DASH-3, nối S4-DASH-BE-3)", () => {
  it("getDashboardConfigs() → GET /dashboard/configs + dashboardConfigListResponseSchema, KHÔNG company_id", async () => {
    await dashboardApi.getDashboardConfigs();
    const [url, schema] = lastCall();
    expect(url).toBe("/dashboard/configs");
    expect(url).not.toContain("company");
    expect(schema).toBe(dashboardConfigListResponseSchema);
  });

  it("getDashboardConfigs({ dashboard_type }) → forward query string", async () => {
    await dashboardApi.getDashboardConfigs({ dashboard_type: "Admin" });
    const [url] = lastCall();
    expect(url).toBe("/dashboard/configs?dashboard_type=Admin");
  });

  it("updateDashboardConfig(id, body) → PATCH /dashboard/configs/:id + dashboardConfigItemSchema + JSON body", async () => {
    await dashboardApi.updateDashboardConfig("cfg-1", { is_enabled: false, sort_order: 20 });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/dashboard/configs/cfg-1");
    expect(schema).toBe(dashboardConfigItemSchema);
    expect(opts?.method).toBe("PATCH");
    expect(opts?.body).toBe(JSON.stringify({ is_enabled: false, sort_order: 20 }));
  });
});
