// @vitest-environment jsdom
/**
 * AdjustmentRequestsPage tests (S3-FE-ATT-3) — đơn cần duyệt (Team/Company).
 * Phủ: mặc định scope=team (chỉ gọi listTeam, KHÔNG gọi listCompany) · chuyển tab → gọi scope tương ứng ·
 * loading/error/empty/forbidden(403) · nút "Xem" điều hướng detail.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@mediaos/web-core", () => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message = "") {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError: MockApiError,
    attendanceApi: {
      listTeamAdjustmentRequests: vi.fn(),
      listCompanyAdjustmentRequests: vi.fn(),
    },
    attendanceKeys: {
      adjustments: {
        team: (p?: unknown) => ["attendance", "adjustments", "team", p],
        company: (p?: unknown) => ["attendance", "adjustments", "company", p],
      },
    },
  };
});

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, children }: { title: string; children?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {children}
      </div>
    ),
    DataTable: ({
      columns,
      data,
      isLoading,
      emptyState,
    }: {
      columns: Array<{
        id?: string;
        accessorKey?: string;
        header: string;
        cell?: (ctx: { row: { original: unknown } }) => React.ReactNode;
      }>;
      data: unknown[];
      isLoading: boolean;
      emptyState?: React.ReactNode;
    }) => {
      if (isLoading) return <div data-testid="table-loading" />;
      if (data.length === 0) return <>{emptyState}</>;
      return (
        <div data-testid="data-table">
          {data.map((row, ri) => (
            <div key={ri} data-testid="table-row">
              {columns.map((col, ci) =>
                col.cell ? (
                  <span
                    key={ci}
                    data-testid={`cell-${String(col.accessorKey ?? col.id ?? ci)}-${ri}`}
                  >
                    {col.cell({ row: { original: row } })}
                  </span>
                ) : null,
              )}
            </div>
          ))}
        </div>
      );
    },
  };
});

import { attendanceApi, ApiError } from "@mediaos/web-core";
import { AdjustmentRequestsPage } from "./AdjustmentRequestsPage";

const mockListTeam = attendanceApi.listTeamAdjustmentRequests as ReturnType<typeof vi.fn>;
const mockListCompany = attendanceApi.listCompanyAdjustmentRequests as ReturnType<typeof vi.fn>;

const ITEM = {
  id: "adj-1",
  requestCode: "ADJ-0001",
  employeeId: "emp-1",
  employeeCode: "EMP001",
  fullName: "Nguyen Van A",
  attendanceRecordId: null,
  workDate: "2026-07-01",
  requestType: "OTHER",
  requestedCheckInAt: null,
  requestedCheckOutAt: null,
  reason: "Lý do",
  status: "Pending",
  submittedAt: "2026-07-01T02:00:00.000Z",
  requestedBy: "u-1",
  currentApproverUserId: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  attachmentFileId: null,
  createdAt: "2026-07-01T02:00:00.000Z",
  updatedAt: "2026-07-01T02:00:00.000Z",
};

function makeResponse(items = [ITEM]) {
  return {
    items,
    meta: {
      page: 1,
      pageSize: 20,
      total: items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  };
}

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={buildQC()}>
      <I18nextProvider i18n={i18n}>
        <AdjustmentRequestsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListTeam.mockResolvedValue(makeResponse());
  mockListCompany.mockResolvedValue(makeResponse());
});

describe("AdjustmentRequestsPage — scope tabs", () => {
  it("mặc định scope=team: chỉ gọi listTeam, KHÔNG gọi listCompany", async () => {
    renderPage();
    await waitFor(() => {
      expect(mockListTeam).toHaveBeenCalled();
    });
    expect(mockListCompany).not.toHaveBeenCalled();
  });

  it("chuyển tab Company → gọi listCompany", async () => {
    renderPage();
    await waitFor(() => expect(mockListTeam).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("scope-company"));
    await waitFor(() => {
      expect(mockListCompany).toHaveBeenCalled();
    });
  });
});

describe("AdjustmentRequestsPage — states", () => {
  it("loading → table-loading", () => {
    mockListTeam.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId("table-loading")).toBeInTheDocument();
  });

  it("empty → empty EmptyState", async () => {
    mockListTeam.mockResolvedValue(makeResponse([]));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không có đơn điều chỉnh/i)).toBeInTheDocument();
    });
  });

  it("403 → forbidden EmptyState", async () => {
    mockListTeam.mockRejectedValue(new ApiError(403, "ERR", "forbidden"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/không có quyền xem đơn điều chỉnh/i)).toBeInTheDocument();
    });
  });
});

describe("AdjustmentRequestsPage — happy path", () => {
  it("nút 'Xem' điều hướng tới chi tiết đơn", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Xem" }));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/attendance/adjustment-requests/adj-1" }),
    );
  });
});
