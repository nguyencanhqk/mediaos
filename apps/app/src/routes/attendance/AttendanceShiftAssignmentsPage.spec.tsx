// @vitest-environment jsdom
/**
 * [deny-path] AttendanceShiftAssignmentsPage — gate useCanExact('view','shift-assignment'), fail-closed.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCanExact: vi.fn(() => false),
  attendanceApi: {
    listShiftAssignments: vi.fn(),
  },
  attendanceKeys: {
    shiftAssignments: { list: () => ["attendance", "shift-assignments", "list"] },
  },
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title }: { title: string }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
      </div>
    ),
    DataTable: ({ data, emptyState }: { data: unknown[]; emptyState?: React.ReactNode }) => (
      <div data-testid="data-table">
        {data.length === 0
          ? emptyState
          : data.map((_, i) => <div key={i} data-testid="table-row" />)}
      </div>
    ),
    EmptyState: ({
      title,
      description,
      "data-testid": testId,
    }: {
      title: string;
      description?: string;
      "data-testid"?: string;
    }) => (
      <div data-testid={testId ?? "empty-state"}>
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
  };
});

import { useCanExact, attendanceApi } from "@mediaos/web-core";
import { AttendanceShiftAssignmentsPage } from "./AttendanceShiftAssignmentsPage";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockListShiftAssignments = attendanceApi.listShiftAssignments as ReturnType<typeof vi.fn>;

const ASSIGNMENTS_RESPONSE = [
  {
    id: "sa-1",
    shiftId: "shift-1",
    shiftName: "Ca hành chính",
    assignmentScope: "Company",
    departmentId: null,
    employeeId: null,
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    priority: 100,
    status: "Active",
  },
];

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <AttendanceShiftAssignmentsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AttendanceShiftAssignmentsPage", () => {
  it("[crown deny] no view:shift-assignment (useCanExact false) → forbidden EmptyState + API NOT called", () => {
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("shift-assignments-forbidden")).toBeInTheDocument();
    expect(mockListShiftAssignments).not.toHaveBeenCalled();
    expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
  });

  it("has view:shift-assignment → calls listShiftAssignments and renders rows", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockListShiftAssignments.mockResolvedValue(ASSIGNMENTS_RESPONSE);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByTestId("table-row")).toHaveLength(1);
    });
    expect(mockListShiftAssignments).toHaveBeenCalled();
  });

  it("shows error EmptyState when API fails", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockListShiftAssignments.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });
});
