import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PayslipTable } from "./payslip-table";
import type { PayslipSummary } from "@/lib/payslip-api";

const PERIOD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeRow(overrides: Partial<PayslipSummary> = {}): PayslipSummary {
  return {
    id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    payrollPeriodId: PERIOD_ID,
    entryKind: "original",
    createdAt: "2026-06-15T08:00:00.000Z",
    ...overrides,
  };
}

describe("PayslipTable — money-free list (BẤT BIẾN #3)", () => {
  it("renders period label + status from the period maps, date and entry-kind label", () => {
    render(
      <PayslipTable
        rows={[makeRow()]}
        periodLabels={{ [PERIOD_ID]: "2026-06" }}
        periodStatuses={{ [PERIOD_ID]: "published" }}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("2026-06")).toBeInTheDocument();
    expect(screen.getByText("Đã phát hành")).toBeInTheDocument();
    expect(screen.getByText("2026-06-15")).toBeInTheDocument();
    expect(screen.getByText("Gốc")).toBeInTheDocument();
  });

  it("renders NO monetary amounts (no money columns at all)", () => {
    render(
      <PayslipTable
        rows={[makeRow()]}
        periodLabels={{ [PERIOD_ID]: "2026-06" }}
        periodStatuses={{ [PERIOD_ID]: "published" }}
        onSelect={vi.fn()}
      />,
    );
    // A money-free row must not display any grouped-number amount.
    expect(screen.queryByText(/\d{1,3}([.,]\d{3})+/)).not.toBeInTheDocument();
  });

  it("falls back to the period id and an em-dash when period maps are missing", () => {
    render(<PayslipTable rows={[makeRow()]} onSelect={vi.fn()} />);
    expect(screen.getByText(PERIOD_ID)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("calls onSelect with the payslip id on row click", () => {
    const onSelect = vi.fn();
    render(<PayslipTable rows={[makeRow({ id: "row-1" })]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Gốc"));
    expect(onSelect).toHaveBeenCalledWith("row-1");
  });

  it("calls onSelect on keyboard activation (Enter) — rows are not mouse-only", () => {
    const onSelect = vi.fn();
    render(<PayslipTable rows={[makeRow({ id: "row-1" })]} onSelect={onSelect} />);
    const row = screen.getByRole("button");
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("row-1");
  });

  it("shows an empty-state message when there are no rows", () => {
    render(<PayslipTable rows={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/chưa có phiếu lương/i)).toBeInTheDocument();
  });
});
