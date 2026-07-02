import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, attendanceApi } from "@mediaos/web-core";
import type { AuditLogListResponse } from "@mediaos/contracts";
import { AttendanceAuditLogsPage } from "./AttendanceAuditLogsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    attendanceApi: { listAttendanceAuditLogs: vi.fn() },
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

const RESPONSE: AuditLogListResponse = {
  data: [
    {
      id: "audit-1",
      companyId: "co1",
      actorUserId: "u1",
      action: "create",
      objectType: "attendance_record",
      objectId: "rec-1",
      before: null,
      after: null,
      ip: null,
      userAgent: null,
      moduleCode: "ATT",
      entityType: "attendance_record",
      entityId: "rec-1",
      actorType: "User",
      oldValues: null,
      newValues: null,
      changedFields: null,
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

describe("AttendanceAuditLogsPage (gate = view:attendance-audit-log)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(attendanceApi.listAttendanceAuditLogs).mockResolvedValue(RESPONSE);
  });

  it("shows forbidden and does not fetch without view:attendance-audit-log", () => {
    setCaps({ "view:audit-log": true });
    renderWithQuery(<AttendanceAuditLogsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(attendanceApi.listAttendanceAuditLogs).not.toHaveBeenCalled();
  });

  it("renders audit log rows with view:attendance-audit-log", async () => {
    setCaps({ "view:attendance-audit-log": true });
    renderWithQuery(<AttendanceAuditLogsPage />);
    await waitFor(() => expect(screen.getByText("attendance_record")).toBeInTheDocument());
    expect(screen.getByText("create")).toBeInTheDocument();
  });
});
