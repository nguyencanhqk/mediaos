/**
 * leave-api — contract/URL boundary tests (S3-FE-LEAVE-2).
 *
 * KHÔNG mock leaveApi; chỉ mock apiFetch tại ranh giới `./api-client` (đúng pattern
 * attendance-api.spec.ts / users-api.spec.ts) để kiểm chứng mỗi method quản lý duyệt nghỉ gọi
 * ĐÚNG path+method của controller (GET /leave/requests · POST /leave/requests/:id/approve|reject)
 * + truyền schema Zod contracts làm validator (arg 2), KHÔNG tự forward company_id.
 * Cổng quyền/scope là việc SERVER — client chỉ chọn endpoint + validate response.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  leaveManagementListResponseSchema,
  leaveRequestDetailViewSchema,
  leaveCalendarResponseSchema,
} from "@mediaos/contracts";
import { leaveApi } from "./leave-api";
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

describe("leaveApi — management/approval endpoints (URL + method + Zod validator)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
  });

  it("listRequests → GET /leave/requests + leaveManagementListResponseSchema validator", async () => {
    await leaveApi.listRequests();
    const [url, schema] = lastCall();
    expect(url.startsWith("/leave/requests")).toBe(true);
    expect(schema).toBe(leaveManagementListResponseSchema);
  });

  it("listRequests(query) → forward filter qua query-string, KHÔNG company_id", async () => {
    await leaveApi.listRequests({ page: 2, status: "Pending" });
    const [url, , opts] = lastCall();
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("page")).toBe("2");
    expect(qs.get("status")).toBe("Pending");
    expect(url).not.toContain("company");
    // GET mặc định (apiFetch không nhận method) → không có body method POST
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("approveRequest(id, note) → POST /leave/requests/:id/approve + detail schema", async () => {
    await leaveApi.approveRequest("lr-1", "ok duyệt");
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/leave/requests/lr-1/approve");
    expect(schema).toBe(leaveRequestDetailViewSchema);
    expect(opts?.method).toBe("POST");
    expect(JSON.parse(opts?.body ?? "{}")).toEqual({ note: "ok duyệt" });
    expect(opts?.body ?? "").not.toContain("company");
  });

  it("approveRequest(id) không note → body { note: undefined } (server-authoritative)", async () => {
    await leaveApi.approveRequest("lr-2");
    const [url, , opts] = lastCall();
    expect(url).toBe("/leave/requests/lr-2/approve");
    expect(opts?.method).toBe("POST");
  });

  it("rejectRequest(id, reason) → POST /leave/requests/:id/reject + detail schema + reason body", async () => {
    await leaveApi.rejectRequest("lr-3", "thiếu chứng từ");
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/leave/requests/lr-3/reject");
    expect(schema).toBe(leaveRequestDetailViewSchema);
    expect(opts?.method).toBe("POST");
    expect(JSON.parse(opts?.body ?? "{}")).toEqual({ reason: "thiếu chứng từ" });
  });

  // ── S3-FE-LEAVE-4: lịch nghỉ ────────────────────────────────────────────────

  it("getCalendar(query) → GET /leave/calendar + leaveCalendarResponseSchema validator + forward scope/from/to, KHÔNG company_id", async () => {
    await leaveApi.getCalendar({ scope: "team", from: "2026-07-01", to: "2026-07-31" });
    const [url, schema, opts] = lastCall();
    expect(url.startsWith("/leave/calendar")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("scope")).toBe("team");
    expect(qs.get("from")).toBe("2026-07-01");
    expect(qs.get("to")).toBe("2026-07-31");
    expect(url).not.toContain("company_id");
    expect(schema).toBe(leaveCalendarResponseSchema);
    expect(opts?.method ?? "GET").toBe("GET");
  });
});
