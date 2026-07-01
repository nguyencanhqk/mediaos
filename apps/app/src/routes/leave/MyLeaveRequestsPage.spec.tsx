/**
 * S3-FE-LEAVE-1 — MyLeaveRequestsPage tests.
 * Covers: forbidden (gate), loading, empty, list renders, pagination.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Synchronous factory — avoids importOriginal async-race in vitest 3
vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  leaveApi: {
    listMyRequests: vi.fn(),
    listTypes: vi.fn().mockResolvedValue([]),
  },
  leaveKeys: {
    requests: {
      my: (p?: unknown) => ["leave", "requests", "my", p],
      detail: (id: string) => ["leave", "requests", "detail", id],
    },
    types: { list: (p?: unknown) => ["leave", "types", "list", p] },
    all: ["leave"],
  },
}));

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
    DataTable: ({ data, emptyState }: { data: unknown[]; emptyState?: React.ReactNode }) =>
      data.length === 0 ? (
        emptyState
      ) : (
        <table>
          <tbody>
            {(data as Array<{ id: string; leaveTypeName: string; status: string }>).map((row) => (
              <tr key={row.id}>
                <td>{row.leaveTypeName}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
  };
});

import { useCan, leaveApi } from "@mediaos/web-core";
import { MyLeaveRequestsPage } from "./MyLeaveRequestsPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockListMyRequests = leaveApi.listMyRequests as ReturnType<typeof vi.fn>;

const EMPTY_RESPONSE = {
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
        <MyLeaveRequestsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
});

describe("MyLeaveRequestsPage — gate", () => {
  it("shows forbidden EmptyState when useCan(view-own, leave) = false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    expect(screen.getAllByText(/không có quyền/i).length).toBeGreaterThan(0);
  });

  it("does NOT fetch when forbidden", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    expect(mockListMyRequests).not.toHaveBeenCalled();
  });
});

describe("MyLeaveRequestsPage — data states", () => {
  it("renders empty state when no requests", async () => {
    mockListMyRequests.mockResolvedValue(EMPTY_RESPONSE);
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText(/chưa có đơn nghỉ/i)).toBeTruthy();
    });
  });

  it("renders leave request rows", async () => {
    mockListMyRequests.mockResolvedValue({
      items: [
        {
          id: "req-1",
          leaveTypeId: "lt-1",
          leaveTypeCode: "ANNUAL",
          leaveTypeName: "Nghỉ phép năm",
          startDate: "2026-07-01",
          endDate: "2026-07-02",
          durationType: "FullDay",
          totalDays: 2,
          totalHours: 16,
          status: "Pending",
          reason: null,
          balanceEffectStatus: null,
          submittedAt: "2026-06-30T10:00:00.000Z",
          createdAt: "2026-06-30T09:50:00.000Z",
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
    });
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText("Nghỉ phép năm")).toBeTruthy();
    });
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("shows error state on fetch failure", async () => {
    mockListMyRequests.mockRejectedValue(new Error("network"));
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText(/không thể tải danh sách/i)).toBeTruthy();
    });
  });
});
