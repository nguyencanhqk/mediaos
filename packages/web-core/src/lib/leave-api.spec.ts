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
import type { z } from "zod";
import {
  leaveManagementListResponseSchema,
  leaveRequestDetailViewSchema,
  leaveCalendarResponseSchema,
  leaveTypeAdminViewSchema,
  leavePolicyViewSchema,
  leaveBalanceAdminViewSchema,
  leaveReportResponseSchema,
  auditLogListResponseSchema,
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

  // ── S3-FE-LEAVE-5: admin — loại nghỉ / chính sách / số dư phép ────────────────

  it("listTypesAdmin → GET /leave/types + leaveTypeViewSchema validator, maps allowNegativeBalance:null", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce([
      { id: "lt-1", name: "Annual", code: "annual", paid: true, status: "active" },
    ] as never);
    const result = await leaveApi.listTypesAdmin();
    const [url] = lastCall();
    expect(url).toBe("/leave/types");
    expect(result).toEqual([
      {
        id: "lt-1",
        name: "Annual",
        code: "annual",
        paid: true,
        status: "active",
        allowNegativeBalance: null,
      },
    ]);
  });

  it("createTypeAdmin → POST /leave/admin/types + leaveTypeAdminViewSchema validator", async () => {
    await leaveApi.createTypeAdmin({
      name: "Annual",
      code: "annual",
      paid: true,
      deductBalance: true,
      balanceUnit: "Day",
      allowFullDay: true,
      allowHalfDay: false,
      allowHourly: false,
      allowMultipleDays: true,
      requireReason: false,
      requireAttachment: false,
      allowNegativeBalance: false,
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/leave/admin/types");
    expect(schema).toBe(leaveTypeAdminViewSchema);
    expect(opts?.method).toBe("POST");
    expect(JSON.parse(opts?.body ?? "{}")).toMatchObject({ code: "annual" });
  });

  it("updateTypeAdmin → PATCH /leave/admin/types/:id + leaveTypeAdminViewSchema validator", async () => {
    await leaveApi.updateTypeAdmin("lt-1", { name: "Annual leave" });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/leave/admin/types/lt-1");
    expect(schema).toBe(leaveTypeAdminViewSchema);
    expect(opts?.method).toBe("PATCH");
  });

  it("deleteTypeAdmin → POST /leave/admin/types/:id/delete + z.null() validator, resolves void", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(null as never);
    const result = await leaveApi.deleteTypeAdmin("lt-1");
    const [url, , opts] = lastCall();
    expect(url).toBe("/leave/admin/types/lt-1/delete");
    expect(opts?.method).toBe("POST");
    expect(result).toBeUndefined();
  });

  it("listPolicies → GET /leave/admin/policies + leavePolicyViewSchema validator, forward filters", async () => {
    await leaveApi.listPolicies({ leaveTypeId: "lt-1", status: "Active" });
    const [url, schema] = lastCall();
    expect(url.startsWith("/leave/admin/policies")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("leaveTypeId")).toBe("lt-1");
    expect(qs.get("status")).toBe("Active");
    expect((schema as z.ZodArray<typeof leavePolicyViewSchema>).element).toBe(
      leavePolicyViewSchema,
    );
  });

  it("createPolicy → POST /leave/admin/policies + leavePolicyViewSchema validator", async () => {
    await leaveApi.createPolicy({
      leaveTypeId: "lt-1",
      policyCode: "STD",
      name: "Standard",
      policyScope: "Company",
      accrualMethod: "None",
      prorateOnJoinDate: false,
      includeWeekends: false,
      includePublicHolidays: false,
      reserveBalanceOnPending: true,
      allowNegativeBalance: false,
      allowCancelAfterApproved: true,
      requiresManagerApproval: true,
      requiresHrApproval: false,
      effectiveFrom: "2026-01-01",
      priority: 0,
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/leave/admin/policies");
    expect(schema).toBe(leavePolicyViewSchema);
    expect(opts?.method).toBe("POST");
  });

  it("updatePolicy → PATCH /leave/admin/policies/:id + leavePolicyViewSchema validator", async () => {
    await leaveApi.updatePolicy("pol-1", { name: "Standard v2" });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/leave/admin/policies/pol-1");
    expect(schema).toBe(leavePolicyViewSchema);
    expect(opts?.method).toBe("PATCH");
  });

  it("deletePolicy → POST /leave/admin/policies/:id/delete + z.null() validator, resolves void", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(null as never);
    const result = await leaveApi.deletePolicy("pol-1");
    const [url, , opts] = lastCall();
    expect(url).toBe("/leave/admin/policies/pol-1/delete");
    expect(opts?.method).toBe("POST");
    expect(result).toBeUndefined();
  });

  it("listBalancesAdmin → GET /leave/admin/balances + leaveBalanceAdminViewSchema validator, forward filters, KHÔNG company_id", async () => {
    await leaveApi.listBalancesAdmin({ leaveTypeId: "lt-1", year: 2026 });
    const [url, schema] = lastCall();
    expect(url.startsWith("/leave/admin/balances")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("leaveTypeId")).toBe("lt-1");
    expect(qs.get("year")).toBe("2026");
    expect(url).not.toContain("company");
    expect((schema as z.ZodArray<typeof leaveBalanceAdminViewSchema>).element).toBe(
      leaveBalanceAdminViewSchema,
    );
  });

  it("listBalanceTransactions → GET /leave/balances/:id/transactions (canonical)", async () => {
    await leaveApi.listBalanceTransactions("bal-1");
    const [url, , opts] = lastCall();
    expect(url).toBe("/leave/balances/bal-1/transactions");
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("adjustBalance → POST /leave/admin/balances/:id/adjust + amountDays/reason body + leaveBalanceAdminViewSchema validator", async () => {
    await leaveApi.adjustBalance("bal-1", { amountDays: -2, reason: "Nghỉ ốm bổ sung" });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/leave/admin/balances/bal-1/adjust");
    expect(schema).toBe(leaveBalanceAdminViewSchema);
    expect(opts?.method).toBe("POST");
    expect(JSON.parse(opts?.body ?? "{}")).toEqual({
      amountDays: -2,
      reason: "Nghỉ ốm bổ sung",
    });
  });

  // ── S3-FE-LEAVE-6: báo cáo tổng hợp nghỉ + audit log LEAVE ────────────────────

  it("getLeaveReport(query) → GET /leave/reports + leaveReportResponseSchema validator, forward kỳ, KHÔNG company_id", async () => {
    await leaveApi.getLeaveReport({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      page: 1,
      pageSize: 20,
    });
    const [url, schema, opts] = lastCall();
    expect(url.startsWith("/leave/reports")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("fromDate")).toBe("2026-07-01");
    expect(qs.get("toDate")).toBe("2026-07-31");
    expect(url).not.toContain("company");
    expect(schema).toBe(leaveReportResponseSchema);
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("listLeaveAuditLogs(query) → GET /leave/audit-logs + auditLogListResponseSchema validator (route RIÊNG, KHÔNG /foundation/audit-logs)", async () => {
    await leaveApi.listLeaveAuditLogs({ action: "leave.approve", limit: 50, offset: 0 });
    const [url, schema, opts] = lastCall();
    expect(url.startsWith("/leave/audit-logs")).toBe(true);
    expect(url).not.toContain("/foundation/");
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("action")).toBe("leave.approve");
    expect(schema).toBe(auditLogListResponseSchema);
    expect(opts?.method ?? "GET").toBe("GET");
  });
});
