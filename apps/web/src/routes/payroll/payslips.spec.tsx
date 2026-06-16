import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayslipsPage } from "./payslips";
import { ApiError } from "@/lib/api-client";
import { payslipApi } from "@/lib/payslip-api";
import type { PayslipDto } from "@mediaos/contracts";

const PERIOD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PAYSLIP_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ISO = "2026-06-15T08:00:00.000Z";

// B1: listOwn returns a money-FREE PayslipSummaryDto (server-stripped). Includes userId/replacesPayslipId
// per the contract schema; the table only reads id/payrollPeriodId/entryKind/createdAt.
const SUMMARY_ROW = {
  id: PAYSLIP_ID,
  payrollPeriodId: PERIOD_ID,
  userId: USER_ID,
  entryKind: "original",
  replacesPayslipId: null,
  createdAt: ISO,
};

const REVEALED: PayslipDto = {
  id: PAYSLIP_ID,
  companyId: USER_ID,
  payrollPeriodId: PERIOD_ID,
  userId: USER_ID,
  salaryProfileId: null,
  baseSalary: 25_000_000,
  totalAllowances: 1_000_000,
  gross: 26_000_000,
  net: 24_500_000,
  currency: "VND",
  workDays: 22,
  presentDays: 22,
  lateMinutes: 0,
  kpiAmount: null,
  bonusAmount: null,
  penaltyAmount: null,
  entryKind: "original",
  replacesPayslipId: null,
  createdBy: USER_ID,
  createdAt: ISO,
};

function makePeriod() {
  return {
    id: PERIOD_ID,
    companyId: USER_ID,
    periodMonth: "2026-06",
    status: "published",
    attendancePeriodId: null,
    kpiLocked: false,
    createdBy: USER_ID,
    approvedBy: USER_ID,
    approvedAt: ISO,
    publishedBy: USER_ID,
    publishedAt: ISO,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

// ── mocks ──────────────────────────────────────────────────────────────────────
// B1: the page wires the OWN endpoints — listOwn (money-free list) + reauthOwn/getOwn (reveal).
const mockListOwn = vi.fn();
const mockReauthOwn = vi.fn();
const mockGetOwn = vi.fn();
const mockListAcks = vi.fn();
vi.mock("@/lib/payslip-api", () => ({
  payslipApi: {
    listOwn: (...a: unknown[]) => mockListOwn(...a),
    reauthOwn: (...a: unknown[]) => mockReauthOwn(...a),
    getOwn: (...a: unknown[]) => mockGetOwn(...a),
    listAcknowledgements: (...a: unknown[]) => mockListAcks(...a),
  },
}));

const mockPeriodList = vi.fn();
vi.mock("@/lib/payroll-period-api", () => ({
  payrollPeriodApi: { list: (...a: unknown[]) => mockPeriodList(...a) },
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: USER_ID } }),
}));

// Controllable reveal controller — drives the re-auth → reveal flow deterministically.
// B1: captures the options the page passes so we can assert it wires the OWN reveal endpoints.
const mockRequestReauth = vi.fn();
const mockUseReauthController = vi.fn((_options?: unknown) => ({
  requestReauth: mockRequestReauth,
  modal: null,
}));
vi.mock("@/components/payroll/use-payslip-reauth-controller", () => ({
  usePayslipReauthController: (options?: unknown) => mockUseReauthController(options),
}));

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseReauthController.mockReturnValue({ requestReauth: mockRequestReauth, modal: null });
  mockListAcks.mockResolvedValue([]);
  mockPeriodList.mockResolvedValue([makePeriod()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PayslipsPage — money-free list", () => {
  it("lists via the OWN endpoint with no userId (ownership enforced server-side)", async () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]);
    wrap(<PayslipsPage />);
    await waitFor(() => expect(mockListOwn).toHaveBeenCalled());
    // B1: the client never passes a userId — the server scopes to the caller's own slips.
    expect(mockListOwn).toHaveBeenCalledWith();
  });

  it("wires the OWN reveal endpoints into the re-auth controller", () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]);
    wrap(<PayslipsPage />);
    // Reveal must go through reauthOwn/getOwn (re-auth-gated, ownership-scoped), not the admin path.
    expect(mockUseReauthController).toHaveBeenCalledWith({
      reauth: payslipApi.reauthOwn,
      getOne: payslipApi.getOwn,
    });
  });

  it("renders the period label/status but NO monetary amounts", async () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]);
    wrap(<PayslipsPage />);

    expect(await screen.findByText("2026-06")).toBeInTheDocument();
    // "Đã phát hành" also appears as a filter <option>; assert on the table cell specifically.
    expect(screen.getByRole("cell", { name: "Đã phát hành" })).toBeInTheDocument();
    // No money anywhere on the list view.
    expect(screen.queryByText(/24\.500\.000|26\.000\.000|25\.000\.000/)).not.toBeInTheDocument();
  });
});

describe("PayslipsPage — masked detail + reveal flow", () => {
  it("shows masked detail with a verify button after selecting a row", async () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]);
    wrap(<PayslipsPage />);

    fireEvent.click(await screen.findByText("2026-06"));
    expect(await screen.findByRole("button", { name: /xác minh để xem/i })).toBeInTheDocument();
    expect(screen.getAllByText(/•••/).length).toBeGreaterThan(0);
    // Still masked — no money before reveal.
    expect(screen.queryByText(/24\.500\.000/)).not.toBeInTheDocument();
  });

  it("reveals money ONLY after re-auth resolves the slip", async () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]);
    mockRequestReauth.mockResolvedValue(REVEALED);
    wrap(<PayslipsPage />);

    fireEvent.click(await screen.findByText("2026-06"));
    fireEvent.click(await screen.findByRole("button", { name: /xác minh để xem/i }));

    await waitFor(() => expect(screen.getByText(/24\.500\.000/)).toBeInTheDocument());
    expect(mockRequestReauth).toHaveBeenCalledWith(PAYSLIP_ID);
  });

  it("keeps masking if re-auth is cancelled (resolves null)", async () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]);
    mockRequestReauth.mockResolvedValue(null);
    wrap(<PayslipsPage />);

    fireEvent.click(await screen.findByText("2026-06"));
    fireEvent.click(await screen.findByRole("button", { name: /xác minh để xem/i }));

    await waitFor(() => expect(mockRequestReauth).toHaveBeenCalled());
    expect(screen.queryByText(/24\.500\.000/)).not.toBeInTheDocument();
  });
});

describe("PayslipsPage — re-auth-per-view + degraded states", () => {
  it("re-masks revealed money after a period-filter round-trip (no reveal without fresh re-auth)", async () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]); // period is 'published'
    mockRequestReauth.mockResolvedValue(REVEALED);
    wrap(<PayslipsPage />);

    fireEvent.click(await screen.findByText("2026-06"));
    fireEvent.click(await screen.findByRole("button", { name: /xác minh để xem/i }));
    await waitFor(() => expect(screen.getByText(/24\.500\.000/)).toBeInTheDocument());

    // Filter to 'draft' (hides the published row), then back to all.
    const filter = screen.getByLabelText(/trạng thái kỳ/i);
    fireEvent.change(filter, { target: { value: "draft" } });
    fireEvent.change(filter, { target: { value: "" } });

    // Row is back, but money must be masked again — selecting it once more requires re-auth.
    expect(await screen.findByText("2026-06")).toBeInTheDocument();
    expect(screen.queryByText(/24\.500\.000/)).not.toBeInTheDocument();
  });

  it("warns (without leaking) when period enrichment fails", async () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]);
    mockPeriodList.mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));
    wrap(<PayslipsPage />);

    expect(await screen.findByText(/không tải được thông tin kỳ lương/i)).toBeInTheDocument();
  });

  it("warns when the acknowledgement state fails to load (not a silent 'fresh' state)", async () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]);
    mockListAcks.mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));
    wrap(<PayslipsPage />);

    fireEvent.click(await screen.findByText("2026-06"));
    expect(await screen.findByText(/không tải được trạng thái xác nhận/i)).toBeInTheDocument();
  });

  it("never labels another person's acknowledgement as mine (no data[0] fallback)", async () => {
    mockListOwn.mockResolvedValue([SUMMARY_ROW]);
    // Only a stranger's ack is returned (HR sees all) — the page must NOT treat it as the current user's.
    mockListAcks.mockResolvedValue([
      {
        id: "ack-stranger",
        companyId: USER_ID,
        payslipId: PAYSLIP_ID,
        userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        status: "acknowledged",
        reason: null,
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ]);
    wrap(<PayslipsPage />);

    fireEvent.click(await screen.findByText("2026-06"));
    // Fresh action buttons (no ack of mine) — NOT the stranger's "Đã xác nhận" status.
    expect(await screen.findByRole("button", { name: /^xác nhận$/i })).toBeInTheDocument();
    expect(screen.queryByText(/đã xác nhận/i)).not.toBeInTheDocument();
  });
});

describe("PayslipsPage — graceful 403 (employee lacks view-payslip)", () => {
  it("shows a permission notice and no table on 403", async () => {
    mockListOwn.mockRejectedValue(new ApiError(403, "FORBIDDEN", "Insufficient permission"));
    wrap(<PayslipsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/không có quyền/i);
    expect(screen.queryByText("2026-06")).not.toBeInTheDocument();
  });

  it("shows a generic error on non-403 failures", async () => {
    mockListOwn.mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));
    wrap(<PayslipsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/không tải được/i);
  });
});
