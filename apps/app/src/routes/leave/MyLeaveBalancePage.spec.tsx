/**
 * S3-FE-LEAVE-1 — MyLeaveBalancePage tests.
 * Covers: loading, empty, error, forbidden (useCan=false), balance cards rendered.
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
}));

// Synchronous factory — avoids importOriginal async-race in vitest 3
vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  leaveApi: {
    getMyBalances: vi.fn(),
  },
  leaveKeys: {
    balances: { my: () => ["leave", "balances", "my"] },
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
  };
});

import { useCan, leaveApi } from "@mediaos/web-core";
import { MyLeaveBalancePage } from "./MyLeaveBalancePage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockGetMyBalances = leaveApi.getMyBalances as ReturnType<typeof vi.fn>;

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MyLeaveBalancePage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
});

describe("MyLeaveBalancePage", () => {
  it("shows forbidden state when useCan returns false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    // Component renders EmptyState for forbidden — heading text
    expect(screen.getAllByText(/quyền/i).length).toBeGreaterThan(0);
  });

  it("renders balance cards when data returns", async () => {
    mockGetMyBalances.mockResolvedValue([
      {
        id: "bal-1",
        leaveType: { id: "lt-1", code: "ANNUAL", name: "Nghỉ phép năm" },
        periodYear: 2026,
        openingBalance: 12,
        usedDays: 2,
        reservedDays: 1,
        adjustedDays: 0,
        remainingDays: 9,
        unit: "Day",
      },
    ]);
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText("Nghỉ phép năm")).toBeTruthy();
    });
    // remaining days visible
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("shows empty state when no balances returned", async () => {
    mockGetMyBalances.mockResolvedValue([]);
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText(/chưa có số dư/i)).toBeTruthy();
    });
  });

  it("shows error state on fetch failure", async () => {
    mockGetMyBalances.mockRejectedValue(new Error("network"));
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByText(/không thể tải/i)).toBeTruthy();
    });
  });
});

describe("LeaveBalanceCard", () => {
  it("shows low-balance warning when remainingDays <= 1", async () => {
    mockGetMyBalances.mockResolvedValue([
      {
        id: "bal-2",
        leaveType: { id: "lt-1", code: "ANNUAL", name: "Nghỉ phép năm" },
        periodYear: 2026,
        openingBalance: 12,
        usedDays: 11,
        reservedDays: 0,
        adjustedDays: 0,
        remainingDays: 1,
        unit: "Day",
      },
    ]);
    renderPage(buildQC());
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });
});
