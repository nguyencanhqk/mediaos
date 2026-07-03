import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, leaveApi } from "@mediaos/web-core";
import type { AuditLogListResponse } from "@mediaos/contracts";
import { LeaveAuditLogsPage } from "./LeaveAuditLogsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    leaveApi: { listLeaveAuditLogs: vi.fn() },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

// before/oldValues/newValues KHÔNG BAO GIỜ được render bởi client (server đã mask; page chỉ render
// field top-level). Nhồi sentinel vào các khối này để test khẳng định client KHÔNG khôi phục chúng.
const RESPONSE: AuditLogListResponse = {
  data: [
    {
      id: "audit-1",
      companyId: "co1",
      actorUserId: "u1",
      action: "leave.approve",
      objectType: "leave_request",
      objectId: "11111111-1111-1111-1111-111111111111",
      before: { note: "SENTINEL_MASKED_BEFORE" },
      after: { note: "SENTINEL_MASKED_AFTER" },
      ip: null,
      userAgent: null,
      moduleCode: "LEAVE",
      entityType: "leave_request",
      entityId: "11111111-1111-1111-1111-111111111111",
      actorType: "User",
      oldValues: { status: "SENTINEL_MASKED_OLD" },
      newValues: { status: "SENTINEL_MASKED_NEW" },
      changedFields: ["status"],
      sensitivityLevel: null,
      resultStatus: "Success",
      requestId: null,
      correlationId: null,
      ipAddress: null,
      actorEmployeeId: null,
      actionGroup: null,
      entityIdText: null,
      entityCode: null,
      permissionCode: null,
      dataScope: "Company",
      deviceInfo: null,
      diffSummary: null,
      errorCode: null,
      errorMessage: null,
      metadata: null,
      createdAt: "2026-07-01T08:00:00Z",
    },
  ],
  meta: { total: 1, limit: 50, offset: 0 },
};

describe("LeaveAuditLogsPage (gate = view:leave-audit-log)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(leaveApi.listLeaveAuditLogs).mockResolvedValue(RESPONSE);
  });

  it("shows forbidden and does NOT fetch without view:leave-audit-log (foundation view:audit-log insufficient)", () => {
    // foundation view:audit-log là cặp KHÁC — KHÔNG mở cổng audit LEAVE (pair-as-gate).
    setCaps({ "view:audit-log": true });
    renderWithQuery(<LeaveAuditLogsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(leaveApi.listLeaveAuditLogs).not.toHaveBeenCalled();
  });

  it("renders audit rows with view:leave-audit-log", async () => {
    setCaps({ "view:leave-audit-log": true });
    renderWithQuery(<LeaveAuditLogsPage />);
    await waitFor(() => expect(screen.getByText("leave_request")).toBeInTheDocument());
    expect(screen.getByText("leave.approve")).toBeInTheDocument();
  });

  it("does NOT render masked before/after/oldValues/newValues JSON blocks", async () => {
    setCaps({ "view:leave-audit-log": true });
    renderWithQuery(<LeaveAuditLogsPage />);
    await waitFor(() => expect(screen.getByText("leave.approve")).toBeInTheDocument());
    // Client chỉ render field top-level — KHÔNG dựng lại khối JSON đã mask (dù server có lỡ gửi).
    expect(screen.queryByText(/SENTINEL_MASKED_BEFORE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SENTINEL_MASKED_AFTER/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SENTINEL_MASKED_OLD/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SENTINEL_MASKED_NEW/)).not.toBeInTheDocument();
  });
});
