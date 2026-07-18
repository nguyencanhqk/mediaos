/**
 * me-api.spec.ts — contract/URL boundary tests (S5-ME-FE-1/FE-3).
 *
 * Mock `apiFetch` tại ranh giới `./api-client` (cùng pattern hr-employee-code-config-api.spec.ts) để
 * kiểm chứng meApi gọi ĐÚNG path/method/body cho từng route + KHÔNG bao giờ truyền user_id/employee_id
 * (chống IDOR — SPEC-09 §14.4: owner resolve 100% từ token, client không được phép chỉ định chủ sở hữu).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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

// ── S5-ME-FE-2 — getSecurityActivity (Hoạt động bảo mật own-scope, GET /me/security/activity) ──
//
// Query CHỈ page/per_page/from_date/to_date (whitelist tường minh). DENY-IDOR: owner-param client cố
// chèn (user_id/employee_id) BỊ LOẠI khỏi URL — owner resolve 100% từ token (§14.4). Response parse
// z.array(meSecurityActivityItemSchema) — shape sai ném ngay, KHÔNG render sai.
describe("meApi.getSecurityActivity (S5-ME-FE-2)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("không query → GET /me/security/activity (đường thuần, không param owner)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
    await meApi.getSecurityActivity();
    const [url, schema, init] = lastCall();
    expect(url).toBe("/me/security/activity");
    expect(schema).toBeDefined();
    expect(init).toBeUndefined();
    assertNoOwnerParam(url);
  });

  it("truyền page/per_page/from_date/to_date qua buildQueryString", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
    await meApi.getSecurityActivity({
      page: 2,
      per_page: 50,
      from_date: "2026-06-01",
      to_date: "2026-06-30",
    });
    const [url] = lastCall();
    expect(url).toMatch(/^\/me\/security\/activity\?/);
    expect(url).toContain("page=2");
    expect(url).toContain("per_page=50");
    expect(url).toContain("from_date=2026-06-01");
    expect(url).toContain("to_date=2026-06-30");
    assertNoOwnerParam(url);
  });

  it("DENY-IDOR: user_id/employee_id chèn vào query BỊ LOẠI khỏi URL (owner 100% từ token, §14.4)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
    // Caller cố chèn owner-param (cast bỏ type-guard) — whitelist tường minh phải strip.
    await meApi.getSecurityActivity({
      page: 1,
      user_id: "victim-user",
      employee_id: "victim-emp",
    } as never);
    const [url, , init] = lastCall();
    expect(url).not.toMatch(/user_id=|employee_id=|userId=|employeeId=/i);
    assertNoOwnerParam(url, init?.body);
    // Param hợp lệ vẫn giữ.
    expect(url).toContain("page=1");
  });

  it("parse z.array(meSecurityActivityItemSchema): shape ĐÚNG pass, shape SAI/không-mảng ném (không render sai)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
    await meApi.getSecurityActivity();
    const [, schema] = lastCall();
    const zschema = schema as z.ZodType<unknown>;
    const okItem = {
      id: "11111111-1111-1111-1111-111111111111",
      source: "login",
      eventType: "LOGIN_SUCCESS",
      severity: null,
      device: "Chrome trên Windows",
      ipMasked: "203.0.*.*",
      createdAt: "2026-07-17T03:00:00Z",
    };
    expect(zschema.safeParse([okItem]).success).toBe(true);
    expect(zschema.safeParse([]).success).toBe(true);
    // Shape sai (id không phải uuid) → parse fail (apiFetch thật ném ApiError).
    expect(zschema.safeParse([{ ...okItem, id: "not-a-uuid" }]).success).toBe(false);
    // Không phải mảng → fail (envelope.data phải là array).
    expect(zschema.safeParse(okItem).success).toBe(false);
  });
});
