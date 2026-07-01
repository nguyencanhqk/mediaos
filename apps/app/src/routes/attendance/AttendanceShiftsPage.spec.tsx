// @vitest-environment jsdom
/**
 * [deny-path] AttendanceShiftsPage — gate useCan('view','shift') (non-sensitive, wildcard OK).
 *
 * - no view:shift (và no wildcard) → forbidden EmptyState + listShifts NOT called.
 * - has view:shift → DataTable renders rows.
 * - API error → error EmptyState. Empty list → empty EmptyState (qua DataTable emptyState prop).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  attendanceApi: {
    listShifts: vi.fn(),
  },
  attendanceKeys: {
    shifts: { list: () => ["attendance", "shifts", "list"] },
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

import { useCan, attendanceApi } from "@mediaos/web-core";
import { AttendanceShiftsPage } from "./AttendanceShiftsPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockListShifts = attendanceApi.listShifts as ReturnType<typeof vi.fn>;

const SHIFTS_RESPONSE = [
  {
    id: "shift-1",
    shiftCode: "OFFICE_8H",
    name: "Ca hành chính",
    shiftType: "Fixed",
    startTime: "08:00",
    endTime: "17:30",
    requiredWorkingMinutes: 480,
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
        <AttendanceShiftsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AttendanceShiftsPage", () => {
  it("[deny] no view:shift → forbidden EmptyState + listShifts NOT called", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("shifts-forbidden")).toBeInTheDocument();
    expect(mockListShifts).not.toHaveBeenCalled();
    expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
  });

  it("has view:shift → calls listShifts and renders rows", async () => {
    mockUseCan.mockReturnValue(true);
    mockListShifts.mockResolvedValue(SHIFTS_RESPONSE);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByTestId("table-row")).toHaveLength(1);
    });
    expect(mockListShifts).toHaveBeenCalled();
  });

  it("shows error EmptyState when API fails", async () => {
    mockUseCan.mockReturnValue(true);
    mockListShifts.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  it("shows empty state when list resolves with 0 items", async () => {
    mockUseCan.mockReturnValue(true);
    mockListShifts.mockResolvedValue([]);

    renderPage(buildQC());

    await waitFor(() => {
      expect(mockListShifts).toHaveBeenCalled();
    });
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
  });
});
