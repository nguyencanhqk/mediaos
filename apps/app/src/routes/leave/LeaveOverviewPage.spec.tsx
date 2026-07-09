/**
 * S3-FE-LEAVE-7 — LeaveOverviewPage tests (LEAVE-SCREEN-001, hub tổng quan nghỉ phép).
 *
 * DENY-PATH FIRST (RED cho việc nhạy cảm — mirror LeaveApprovalPage.spec gating):
 *  (a) employee CHỈ view-own:leave → section "Đơn chờ tôi duyệt" + cảnh báo "đơn quá hạn" KHÔNG render
 *      VÀ listRequests (cross-read) KHÔNG chạy (enabled:canView=false) → KHÔNG nổ 403.
 *  (b) regression: employee vẫn thấy balance summary + recent-requests bình thường.
 *  (c) allow: user có view:leave (HR/manager) → thấy section pending-approvals + cảnh báo quá hạn.
 *  + anti-false-green: gate gọi ĐÚNG cặp engine (view-own/view : leave), KHÔNG hard-code true.
 *
 * BẤT BIẾN: useCan gate KHÔNG hard-code role. Cross-read (pending + quá-hạn) gate = view:leave TRỰC TIẾP
 * (cặp engine, KHÔNG qua PERMISSION_CODE_TO_PAIR) — employee thường (view-own) không nổ 403.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  leaveApi: {
    getMyBalances: vi.fn(),
    listMyRequests: vi.fn(),
    listRequests: vi.fn(),
  },
  leaveKeys: {
    all: ["leave"],
    balances: { my: () => ["leave", "balances", "my"] },
    requests: {
      my: (p?: unknown) => ["leave", "requests", "my", p],
      list: (p?: unknown) => ["leave", "requests", "list", p],
    },
  },
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({
      title,
      description,
      children,
    }: {
      title: string;
      description?: string;
      children?: React.ReactNode;
    }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
    ),
  };
});

import { useCan, leaveApi } from "@mediaos/web-core";
import { LeaveOverviewPage } from "./LeaveOverviewPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockGetMyBalances = leaveApi.getMyBalances as ReturnType<typeof vi.fn>;
const mockListMyRequests = leaveApi.listMyRequests as ReturnType<typeof vi.fn>;
const mockListRequests = leaveApi.listRequests as ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────────────────────

const BALANCE = {
  id: "bal-1",
  leaveType: { id: "lt-1", code: "ANNUAL", name: "Nghỉ phép năm" },
  periodYear: 2026,
  openingBalance: 12,
  usedDays: 2,
  reservedDays: 1,
  adjustedDays: 0,
  remainingDays: 9,
  unit: "Day",
};

const MY_REQUESTS = {
  items: [
    {
      id: "req-mine",
      leaveTypeId: "lt-1",
      leaveTypeCode: "ANNUAL",
      leaveTypeName: "Nghỉ phép năm",
      startDate: "2026-07-10",
      endDate: "2026-07-11",
      durationType: "FullDay",
      totalDays: 2,
      totalHours: null,
      status: "Pending",
      reason: null,
      balanceEffectStatus: null,
      submittedAt: "2026-07-01T03:00:00.000Z",
      createdAt: "2026-07-01T02:50:00.000Z",
    },
  ],
  meta: { page: 1, pageSize: 5, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

// Đơn chờ duyệt cross-read — submittedAt CŨ (2020) ⇒ chắc chắn quá hạn (cảnh báo overdue hiện).
const PENDING_MGMT = {
  items: [
    {
      id: "req-pending",
      leaveTypeId: "lt-1",
      leaveTypeCode: "ANNUAL",
      leaveTypeName: "Nghỉ phép năm",
      startDate: "2026-07-20",
      endDate: "2026-07-21",
      durationType: "FullDay",
      totalDays: 2,
      totalHours: null,
      status: "Pending",
      reason: "Về quê",
      balanceEffectStatus: null,
      submittedAt: "2020-01-01T03:00:00.000Z",
      createdAt: "2020-01-01T02:50:00.000Z",
      requester: {
        userId: "u-req",
        employeeCode: "EMP001",
        fullName: "Nguyễn Văn A",
        department: "Kỹ thuật",
      },
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
  ],
  meta: { page: 1, pageSize: 5, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

// Employee: view-own:leave + view-own:leave-balance + create:leave = true; view:leave = FALSE.
function employeeCan(action: string, resourceType: string): boolean {
  if (resourceType === "leave-balance") return action === "view-own";
  if (resourceType === "leave") return action === "view-own" || action === "create";
  return false;
}
// Manager/HR: thêm view:leave (đọc chéo) = true.
function managerCan(action: string, resourceType: string): boolean {
  if (resourceType === "leave-balance") return action === "view-own";
  if (resourceType === "leave")
    return action === "view-own" || action === "create" || action === "view";
  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <LeaveOverviewPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockImplementation(employeeCan);
  mockGetMyBalances.mockResolvedValue([BALANCE]);
  mockListMyRequests.mockResolvedValue(MY_REQUESTS);
  mockListRequests.mockResolvedValue(PENDING_MGMT);
});

// ── (a) Deny-path: cross-read gate view:leave ──────────────────────────────────

describe("LeaveOverviewPage — deny-path cross-read (employee view-own)", () => {
  it("(a) employee view-own → section pending-approvals + cảnh báo quá hạn ẨN + listRequests KHÔNG chạy", async () => {
    renderPage(buildQC());
    // Chờ trang render xong (balance summary xuất hiện) rồi mới khẳng định phần cross-read ẩn.
    await waitFor(() => expect(screen.getByTestId("section-balance-summary")).toBeInTheDocument());

    expect(screen.queryByTestId("section-pending-approvals")).not.toBeInTheDocument();
    expect(screen.queryByTestId("warning-overdue")).not.toBeInTheDocument();
    // enabled:canView=false ⇒ query cross-read KHÔNG chạy ⇒ không thể nổ 403.
    expect(mockListRequests).not.toHaveBeenCalled();
  });

  it("anti-false-green: gate gọi ĐÚNG cặp view-own:leave và view:leave (không hard-code true)", async () => {
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByTestId("section-balance-summary")).toBeInTheDocument());
    expect(mockUseCan).toHaveBeenCalledWith("view-own", "leave");
    expect(mockUseCan).toHaveBeenCalledWith("view", "leave");
  });
});

// ── (b) Regression: self-service sections vẫn hiện ─────────────────────────────

describe("LeaveOverviewPage — regression self-service (employee view-own)", () => {
  it("(b) employee vẫn thấy balance summary + recent-requests, listMyRequests dùng page/pageSize (KHÔNG per_page)", async () => {
    renderPage(buildQC());
    // balance card render sau khi getMyBalances resolve (server trả — client chỉ hiển thị)
    await waitFor(() => expect(screen.getAllByText("Nghỉ phép năm").length).toBeGreaterThan(0));
    expect(screen.getByTestId("section-balance-summary")).toBeInTheDocument();
    // recent-requests section hiện
    expect(screen.getByTestId("section-recent-requests")).toBeInTheDocument();
    // recent nạp qua page/pageSize (contract chỉ có page/pageSize)
    expect(mockListMyRequests).toHaveBeenCalledWith({ page: 1, pageSize: 5 });
    expect(mockGetMyBalances).toHaveBeenCalled();
  });
});

// ── (c) Allow: manager/HR view:leave thấy cross-read ───────────────────────────

describe("LeaveOverviewPage — allow cross-read (manager/HR view:leave)", () => {
  beforeEach(() => {
    mockUseCan.mockImplementation(managerCan);
  });

  it("(c) view:leave → section pending-approvals hiện + listRequests chạy với status Pending", async () => {
    renderPage(buildQC());
    await waitFor(() =>
      expect(screen.getByTestId("section-pending-approvals")).toBeInTheDocument(),
    );
    expect(mockListRequests).toHaveBeenCalledWith({ page: 1, pageSize: 5, status: "Pending" });
  });

  it("(c) cảnh báo 'đơn quá hạn' hiện khi có đơn Pending cross-read quá hạn", async () => {
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByTestId("warning-overdue")).toBeInTheDocument());
  });
});
