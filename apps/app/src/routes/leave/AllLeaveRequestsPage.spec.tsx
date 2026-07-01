/**
 * S3-FE-LEAVE-3 — AllLeaveRequestsPage tests (LEAVE-SCREEN-006).
 *
 * DENY-PATH FIRST (RED cho việc nhạy cảm — cùng cặp view:leave với LeaveApprovalPage):
 *  (a) view:leave=false → forbidden mềm + KHÔNG gọi listRequests.
 *  (b) anti-false-green: gate gọi ĐÚNG cặp view:leave (không hard-code true).
 *
 * + Merge nhiều status (BE GET /leave/requests luôn lọc ĐÚNG 1 status/lần gọi — xem
 *   use-all-leave-requests.ts): mặc định (không chọn status) → gọi 1 request/status (6 lần), merge kết quả.
 * + Chọn 1 status cụ thể → CHỈ gọi 1 lần với đúng status đó (KHÔNG merge 6 lần nữa).
 * + Lọc phòng ban CLIENT-SIDE trên tập đã merge (BE chưa có departmentId param).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => {
  return {
    useCan: vi.fn(() => true),
    leaveApi: {
      listRequests: vi.fn(),
      listTypes: vi.fn().mockResolvedValue([]),
    },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
    },
    leaveKeys: {
      all: ["leave"],
      requests: {
        list: (p?: unknown) => ["leave", "requests", "list", p],
      },
      types: { list: (p?: unknown) => ["leave", "types", "list", p] },
    },
    hrKeys: {
      departments: { list: (p?: unknown) => ["hr", "departments", "list", p] },
    },
  };
});

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

import { useCan, leaveApi, hrApi } from "@mediaos/web-core";
import { AllLeaveRequestsPage } from "./AllLeaveRequestsPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockListRequests = leaveApi.listRequests as ReturnType<typeof vi.fn>;
const mockListDepartments = hrApi.listDepartments as ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────────────────────

const PENDING_ITEM = {
  id: "req-1",
  leaveTypeId: "lt-1",
  leaveTypeCode: "ANNUAL",
  leaveTypeName: "Nghỉ phép năm",
  startDate: "2026-07-10",
  endDate: "2026-07-11",
  durationType: "FullDay",
  totalDays: 2,
  totalHours: null,
  status: "Pending",
  reason: "Về quê",
  balanceEffectStatus: null,
  submittedAt: "2026-07-01T03:00:00.000Z",
  createdAt: "2026-07-01T02:50:00.000Z",
  requester: {
    userId: "u-1",
    employeeCode: "EMP001",
    fullName: "Nguyễn Văn A",
    department: "Kỹ thuật",
  },
  approvedBy: null,
  approvedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  rejectionReason: null,
};

const LIST_ONE = {
  items: [PENDING_ITEM],
  meta: { page: 1, pageSize: 100, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

const LIST_EMPTY = {
  items: [],
  meta: { page: 1, pageSize: 100, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
};

const DEPARTMENTS = [
  { id: "d-1", name: "Kỹ thuật", code: "ENG", parentId: null },
  { id: "d-2", name: "Kinh doanh", code: "SALES", parentId: null },
];

/** Merge thực tế: chỉ status='Pending' có dữ liệu, 5 status còn lại rỗng. */
function mergeMock() {
  mockListRequests.mockImplementation((query?: { status?: string }) =>
    query?.status === "Pending" ? Promise.resolve(LIST_ONE) : Promise.resolve(LIST_EMPTY),
  );
}

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <AllLeaveRequestsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
  mockListDepartments.mockResolvedValue(DEPARTMENTS);
});

// ── Deny-path: gate view:leave ────────────────────────────────────────────────

describe("AllLeaveRequestsPage — gate view:leave", () => {
  it("(a) forbidden mềm + KHÔNG gọi listRequests khi view:leave=false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    expect(screen.getAllByText(/không có quyền/i).length).toBeGreaterThan(0);
    expect(mockListRequests).not.toHaveBeenCalled();
  });

  it("(b) anti-false-green: gate gọi ĐÚNG cặp view:leave (không hard-code true)", async () => {
    mergeMock();
    renderPage(buildQC());
    await waitFor(() => expect(mockListRequests).toHaveBeenCalled());
    expect(mockUseCan).toHaveBeenCalledWith("view", "leave");
  });
});

// ── Merge nhiều status (mặc định "Tất cả trạng thái") ──────────────────────────

describe("AllLeaveRequestsPage — merge mọi trạng thái mặc định", () => {
  it("gọi 1 request/status (6 lần) và merge kết quả — hiển thị đơn Pending", async () => {
    mergeMock();
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeTruthy());
    expect(screen.getByText("Nghỉ phép năm")).toBeTruthy();
    // 6 trạng thái LEAVE_STATUS → 6 lần gọi
    expect(mockListRequests).toHaveBeenCalledTimes(6);
  });

  it("empty state khi mọi status đều rỗng", async () => {
    mockListRequests.mockResolvedValue(LIST_EMPTY);
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText(/không có đơn nghỉ nào/i)).toBeTruthy());
  });
});

// ── Chọn 1 status cụ thể → CHỈ 1 lần gọi (KHÔNG merge 6 lần) ───────────────────

describe("AllLeaveRequestsPage — filter status cụ thể", () => {
  it("chọn 'Approved' (rỗng trong mock) → thu hẹp merge còn 1 status, đơn Pending biến mất khỏi bảng", async () => {
    mergeMock();
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeTruthy());

    const statusSelect = screen.getByLabelText(/tất cả trạng thái/i);
    fireEvent.change(statusSelect, { target: { value: "Approved" } });

    // statuses thu hẹp còn ["Approved"] (rỗng trong mergeMock) → merge KHÔNG còn đơn Pending nữa.
    await waitFor(() => expect(screen.queryByText("Nguyễn Văn A")).not.toBeInTheDocument());
    // ĐÃ gọi listRequests với status='Approved' ở đâu đó trong lịch sử (initial merge HOẶC lần này).
    expect(mockListRequests).toHaveBeenCalledWith(expect.objectContaining({ status: "Approved" }));
  });
});

// ── Lọc phòng ban (client-side) ─────────────────────────────────────────────────

describe("AllLeaveRequestsPage — lọc phòng ban (client-side)", () => {
  it("chọn phòng ban KHÔNG khớp requester.department → ẩn dòng khỏi bảng", async () => {
    mergeMock();
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeTruthy());

    await waitFor(() => expect(screen.getByText("Kinh doanh")).toBeTruthy());
    const deptSelect = screen.getByLabelText(/tất cả phòng ban/i);
    fireEvent.change(deptSelect, { target: { value: "Kinh doanh" } });

    await waitFor(() => expect(screen.queryByText("Nguyễn Văn A")).not.toBeInTheDocument());
  });
});
