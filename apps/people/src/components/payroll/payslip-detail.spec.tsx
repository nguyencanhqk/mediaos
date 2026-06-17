import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PayslipDetail } from "./payslip-detail";
import type { PayslipDto } from "@mediaos/contracts";

const UUID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const ISO = "2026-06-15T08:00:00.000Z";

const SLIP: PayslipDto = {
  id: UUID,
  companyId: UUID,
  payrollPeriodId: UUID,
  userId: UUID,
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
  createdBy: UUID,
  createdAt: ISO,
};

afterEach(() => vi.restoreAllMocks());

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("PayslipDetail — mask by default (before reauth)", () => {
  it("does NOT render net/gross/baseSalary numbers before reauth", () => {
    const onRequestReauth = vi.fn();
    wrap(<PayslipDetail payslipId={UUID} onRequestReauth={onRequestReauth} />);

    // monetary amounts must NOT appear
    expect(screen.queryByText(/24.500.000|24,500,000|24500000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/26.000.000|26,000,000|26000000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/25.000.000|25,000,000|25000000/)).not.toBeInTheDocument();
  });

  it("renders ••• placeholder before reauth", () => {
    wrap(<PayslipDetail payslipId={UUID} onRequestReauth={vi.fn()} />);
    // Should have masked placeholder(s)
    expect(screen.getAllByText(/•••/).length).toBeGreaterThan(0);
  });

  it("renders 'Xác minh để xem' button before reauth", () => {
    wrap(<PayslipDetail payslipId={UUID} onRequestReauth={vi.fn()} />);
    expect(screen.getByRole("button", { name: /xác minh để xem/i })).toBeInTheDocument();
  });

  it("calls onRequestReauth when 'Xác minh để xem' is clicked", () => {
    const onRequestReauth = vi.fn();
    wrap(<PayslipDetail payslipId={UUID} onRequestReauth={onRequestReauth} />);
    fireEvent.click(screen.getByRole("button", { name: /xác minh để xem/i }));
    expect(onRequestReauth).toHaveBeenCalled();
  });
});

describe("PayslipDetail — after reauth reveal", () => {
  it("renders net/gross when revealed detail is passed", async () => {
    wrap(
      <PayslipDetail
        payslipId={UUID}
        onRequestReauth={vi.fn()}
        revealedSlip={SLIP}
      />,
    );
    // After reveal, monetary values should be visible
    await waitFor(() => {
      expect(screen.getByText(/24\.500\.000|24,500,000/)).toBeInTheDocument();
    });
  });

  it("NEVER self-unmasks (no revealedSlip → always shows •••)", () => {
    wrap(<PayslipDetail payslipId={UUID} onRequestReauth={vi.fn()} />);
    // No way to get the number without revealedSlip being passed
    expect(screen.queryByText(/24\.500\.000|24,500,000/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/•••/).length).toBeGreaterThan(0);
  });
});
