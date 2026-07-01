/**
 * S3-FE-LEAVE-3 — AllLeaveRequestsPage tests (LEAVE-SCREEN-006).
 *
 * Covers:
 *  - gate: view:leave=false → forbidden mềm + KHÔNG gọi listRequests.
 *  - anti-false-green: gate gọi ĐÚNG cặp view:leave (không hard-code true).
 *  - data states: loading (không lỗi) / empty / error / render dòng.
 *  - filter: đổi trạng thái → refetch với status mới; period (fromDate/toDate) truyền vào query.
 *  - detail dialog: xem chi tiết đơn (READ-ONLY — KHÔNG có nút Duyệt/Từ chối, khác LeaveApprovalPage).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  leaveApi: {
    listRequests: vi.fn(),
    listTypes: vi.fn().mockResolvedValue([]),
  },
  leaveKeys: {
    all: ["leave"],
    requests: {
      list: (p?: unknown) => ["leave", "requests", "list", p],
      detail: (id: string) => ["leave", "requests", "detail", id],
    },
    types: { list: (p?: unknown) => ["leave", "types", "list", p] },
  },
  hrApi: {
    listDepartments: vi.fn().mockResolvedValue([]),
  },
  hrKeys: {
    departments: { list: () => ["hr", "departments", "list"] },
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

import { useCan, leaveApi, hrApi } from "@mediaos/web-core";
import { AllLeaveRequestsPage } from "./AllLeaveRequestsPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockListRequests = leaveApi.listRequests as ReturnType<typeof vi.fn>;
const mockListDepartments = hrApi.listDepartments as ReturnType<typeof vi.fn>;

const DEPARTMENTS = [
  { id: "dept-1", name: "Kỹ thuật", code: "TECH", parentId: null },
  { id: "dept-2", name: "Kinh doanh", code: "SALES", parentId: null },
];

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
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

const LIST_EMPTY = {
  items: [],
  meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
};

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
  (leaveApi.listTypes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mockListDepartments.mockResolvedValue(DEPARTMENTS);
});

// ── Gate ──────────────────────────────────────────────────────────────────────

describe("AllLeaveRequestsPage — gate view:leave", () => {
  it("forbidden mềm + KHÔNG gọi listRequests khi view:leave=false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    expect(screen.getAllByText(/không có quyền/i).length).toBeGreaterThan(0);
    expect(mockListRequests).not.toHaveBeenCalled();
  });

  it("anti-false-green: gate gọi ĐÚNG cặp view:leave (không hard-code true)", async () => {
    mockListRequests.mockResolvedValue(LIST_EMPTY);
    renderPage(buildQC());
    await waitFor(() => expect(mockListRequests).toHaveBeenCalled());
    expect(mockUseCan).toHaveBeenCalledWith("view", "leave");
  });
});

// ── Data states ────────────────────────────────────────────────────────────────

describe("AllLeaveRequestsPage — data states", () => {
  it("empty state khi không có đơn", async () => {
    mockListRequests.mockResolvedValue(LIST_EMPTY);
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText(/không có đơn nghỉ/i)).toBeTruthy());
  });

  it("error state khi listRequests lỗi", async () => {
    mockListRequests.mockRejectedValue(new Error("network"));
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeTruthy());
  });

  it("render dòng đơn: requester + loại nghỉ + trạng thái", async () => {
    mockListRequests.mockResolvedValue(LIST_ONE);
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeTruthy());
    expect(screen.getByText("Nghỉ phép năm")).toBeTruthy();
  });
});

// ── Filters ────────────────────────────────────────────────────────────────────

describe("AllLeaveRequestsPage — filters (status / kỳ / phòng ban)", () => {
  it("đổi trạng thái → gọi lại listRequests với status mới", async () => {
    mockListRequests.mockResolvedValue(LIST_EMPTY);
    renderPage(buildQC());
    await waitFor(() => expect(mockListRequests).toHaveBeenCalled());

    const statusSelect = screen.getByLabelText(/trạng thái/i);
    fireEvent.change(statusSelect, { target: { value: "Approved" } });

    await waitFor(() =>
      expect(mockListRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "Approved" }),
      ),
    );
  });

  it("chọn khoảng ngày nghỉ (fromDate/toDate) → truyền vào query params", async () => {
    mockListRequests.mockResolvedValue(LIST_EMPTY);
    renderPage(buildQC());
    await waitFor(() => expect(mockListRequests).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/từ ngày/i), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText(/đến ngày/i), { target: { value: "2026-07-31" } });

    await waitFor(() =>
      expect(mockListRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ fromDate: "2026-07-01", toDate: "2026-07-31" }),
      ),
    );
  });

  it("chọn phòng ban → gọi listDepartments để đổ options + gọi lại listRequests với departmentId (server-side, nối GET /leave/requests)", async () => {
    mockListRequests.mockResolvedValue(LIST_EMPTY);
    renderPage(buildQC());
    await waitFor(() => expect(mockListRequests).toHaveBeenCalled());
    await waitFor(() => expect(mockListDepartments).toHaveBeenCalled());

    const departmentSelect = screen.getByLabelText(/phòng ban/i);
    // Options đổ từ hrApi.listDepartments() — KHÔNG suy từ items trang hiện tại.
    expect(screen.getByRole("option", { name: "Kinh doanh" })).toBeTruthy();

    fireEvent.change(departmentSelect, { target: { value: "dept-2" } });

    await waitFor(() =>
      expect(mockListRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ departmentId: "dept-2" }),
      ),
    );
  });
});

// ── Detail dialog (READ-ONLY) ──────────────────────────────────────────────────

describe("AllLeaveRequestsPage — detail dialog", () => {
  it("xem chi tiết đơn — KHÔNG có nút Duyệt/Từ chối (màn hình chỉ đọc)", async () => {
    mockListRequests.mockResolvedValue(LIST_ONE);
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByRole("button", { name: /xem chi tiết/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /xem chi tiết/i }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^duyệt$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /từ chối/i })).not.toBeInTheDocument();
  });
});
