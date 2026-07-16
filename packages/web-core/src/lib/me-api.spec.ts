/**
 * me-api.spec.ts — contract/URL boundary tests (S5-ME-FE-1/FE-3).
 *
 * Mock `apiFetch` tại ranh giới `./api-client` (cùng pattern hr-employee-code-config-api.spec.ts) để
 * kiểm chứng meApi gọi ĐÚNG path/method/body cho từng route + KHÔNG bao giờ truyền user_id/employee_id
 * (chống IDOR — SPEC-09 §14.4: owner resolve 100% từ token, client không được phép chỉ định chủ sở hữu).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meApi } from "./me-api";
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

/** Không có user_id/employee_id ở URL lẫn body (chống IDOR, §14.4). */
function assertNoOwnerParam(url: string, body?: string) {
  expect(url).not.toMatch(/user_id|employee_id|userId|employeeId/i);
  if (body) expect(body).not.toMatch(/user_id|employee_id|userId|employeeId/i);
}

const SECTION_OK = { status: "ok", data: null };

describe("meApi", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("getOverview() → GET /me/overview, không param owner", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
    await meApi.getOverview();
    const [url, schema, init] = lastCall();
    expect(url).toBe("/me/overview");
    expect(schema).toBeDefined();
    expect(init).toBeUndefined();
    assertNoOwnerParam(url);
  });

  it("getAttendanceSummary() → GET /me/attendance-summary, parse section-envelope, không param owner", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(SECTION_OK as never);
    await meApi.getAttendanceSummary();
    const [url, , init] = lastCall();
    expect(url).toBe("/me/attendance-summary");
    expect(init).toBeUndefined();
    assertNoOwnerParam(url);
  });

  it("getLeaveSummary() → GET /me/leave-summary, không param owner", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(SECTION_OK as never);
    await meApi.getLeaveSummary();
    const [url, , init] = lastCall();
    expect(url).toBe("/me/leave-summary");
    expect(init).toBeUndefined();
    assertNoOwnerParam(url);
  });

  it("getTaskSummary() → GET /me/task-summary, không param owner", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(SECTION_OK as never);
    await meApi.getTaskSummary();
    const [url, , init] = lastCall();
    expect(url).toBe("/me/task-summary");
    expect(init).toBeUndefined();
    assertNoOwnerParam(url);
  });

  it("getNotificationSummary() → GET /me/notification-summary, không param owner", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(SECTION_OK as never);
    await meApi.getNotificationSummary();
    const [url, , init] = lastCall();
    expect(url).toBe("/me/notification-summary");
    expect(init).toBeUndefined();
    assertNoOwnerParam(url);
  });

  it("getPreferences() → GET /me/preferences, parse mePreferencesSchema, không param owner", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      locale: null,
      timezone: null,
      theme: "dark",
      dateFormat: null,
      timeFormat: null,
      defaultLanding: null,
      density: null,
      favoriteModules: null,
      meLayoutConfig: null,
      updatedAt: null,
    } as never);
    const result = await meApi.getPreferences();
    const [url, , init] = lastCall();
    expect(url).toBe("/me/preferences");
    expect(init).toBeUndefined();
    expect(result.theme).toBe("dark");
    assertNoOwnerParam(url);
  });

  it("patchAppearance(patch) → PATCH /me/preferences/appearance kèm body đúng field, không param owner", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      locale: null,
      timezone: null,
      theme: "light",
      dateFormat: null,
      timeFormat: null,
      defaultLanding: null,
      density: null,
      favoriteModules: null,
      meLayoutConfig: null,
      updatedAt: null,
    } as never);
    await meApi.patchAppearance({ theme: "light" });
    const [url, , init] = lastCall();
    expect(url).toBe("/me/preferences/appearance");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ theme: "light" });
    assertNoOwnerParam(url, init?.body);
  });
});
