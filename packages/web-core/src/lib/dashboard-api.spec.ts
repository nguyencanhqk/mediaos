/**
 * dashboard-api — contract/URL boundary tests (S4-FE-REGISTRY-1).
 *
 * Mock apiFetch tại ranh giới `./api-client`; kiểm chứng mỗi method gọi ĐÚNG path /dashboard/* (KHÔNG
 * forward company_id) + truyền ĐÚNG schema contract dashboard.ts (arg 2, reference-equality — schema là
 * export trực tiếp, không z.array bọc). Masking (null field) là việc server → client chỉ render field nhận.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dashboardSummarySchema,
  reportResponseSchema,
  mvStatsResponseSchema,
  alertsResponseSchema,
  refreshResponseSchema,
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
