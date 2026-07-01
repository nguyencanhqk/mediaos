/**
 * attendance-api — contract/URL boundary tests (S3-FE-REGISTRY-1).
 *
 * KHÔNG mock attendanceApi; chỉ mock apiFetch tại ranh giới `./api-client` (đúng pattern
 * users-api.spec.ts) để kiểm chứng mỗi method gọi ĐÚNG path scoped của controller
 * (my-records / team-records / records / records/:id) + truyền schema Zod làm validator (arg 2),
 * KHÔNG tự forward company_id. Scope gate là việc SERVER — client chỉ chọn endpoint.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceApi } from "./attendance-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

function lastCall(): [string, { parse?: unknown }, Record<string, unknown>?] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

describe("attendanceApi — scoped record endpoints (URL + Zod validator)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
  });

  it("getToday → GET /attendance/today + schema validator", async () => {
    await attendanceApi.getToday();
    const [url, schema] = lastCall();
    expect(url).toBe("/attendance/today");
    expect(typeof schema.parse).toBe("function");
  });

  it("listMyRecords → path bắt đầu /attendance/my-records", async () => {
    await attendanceApi.listMyRecords({ page: 2 });
    const [url] = lastCall();
    expect(url.startsWith("/attendance/my-records")).toBe(true);
    expect(new URLSearchParams(url.split("?")[1]).get("page")).toBe("2");
  });

  it("listTeamRecords → path bắt đầu /attendance/team-records", async () => {
    await attendanceApi.listTeamRecords();
    const [url] = lastCall();
    expect(url.startsWith("/attendance/team-records")).toBe(true);
  });

  it("listRecords (company) → path bắt đầu /attendance/records", async () => {
    await attendanceApi.listRecords();
    const [url] = lastCall();
    expect(url.startsWith("/attendance/records")).toBe(true);
  });

  it("getRecord(id) → GET /attendance/records/:id", async () => {
    await attendanceApi.getRecord("rec-1");
    const [url] = lastCall();
    expect(url).toBe("/attendance/records/rec-1");
  });

  it("checkIn → POST /attendance/check-in với body JSON (KHÔNG company_id)", async () => {
    await attendanceApi.checkIn({ method: "web" });
    const calls = vi.mocked(apiClient.apiFetch).mock.calls;
    const [url, , opts] = calls[calls.length - 1] as [
      string,
      unknown,
      { method?: string; body?: string },
    ];
    expect(url).toBe("/attendance/check-in");
    expect(opts?.method).toBe("POST");
    expect(opts?.body ?? "").not.toContain("company");
  });

  it("checkOut → POST /attendance/check-out", async () => {
    await attendanceApi.checkOut({ method: "web" });
    const calls = vi.mocked(apiClient.apiFetch).mock.calls;
    const [url, , opts] = calls[calls.length - 1] as [string, unknown, { method?: string }];
    expect(url).toBe("/attendance/check-out");
    expect(opts?.method).toBe("POST");
  });

  // ── S3-FE-ATT-5: Shift / Shift-assignment / Rule (read-only minimum) ──────

  it("listShifts → GET /attendance/shifts + schema validator array", async () => {
    await attendanceApi.listShifts();
    const [url, schema] = lastCall();
    expect(url).toBe("/attendance/shifts");
    expect(typeof schema.parse).toBe("function");
  });

  it("listShiftAssignments → GET /attendance/shift-assignments", async () => {
    await attendanceApi.listShiftAssignments();
    const [url] = lastCall();
    expect(url).toBe("/attendance/shift-assignments");
  });

  it("listRules → GET /attendance/rules", async () => {
    await attendanceApi.listRules();
    const [url] = lastCall();
    expect(url).toBe("/attendance/rules");
  });
});
