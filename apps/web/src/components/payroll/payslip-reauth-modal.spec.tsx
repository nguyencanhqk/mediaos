import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PayslipReauthModal } from "./payslip-reauth-modal";

const PAYSLIP_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ISO = "2026-06-15T08:00:00.000Z";
const SLIP_DETAIL = {
  id: PAYSLIP_ID,
  companyId: PAYSLIP_ID,
  payrollPeriodId: PAYSLIP_ID,
  userId: PAYSLIP_ID,
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
  entryKind: "original" as const,
  replacesPayslipId: null,
  createdBy: PAYSLIP_ID,
  createdAt: ISO,
};

afterEach(() => vi.restoreAllMocks());

function wrap(ui: ReactNode): { client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client };
}

function cacheHoldsNumber(client: QueryClient, value: number): boolean {
  const inQ = client.getQueryCache().getAll()
    .some((q) => JSON.stringify(q.state.data ?? null).includes(String(value)));
  const inM = client.getMutationCache().getAll()
    .some((m) => JSON.stringify(m.state.data ?? null).includes(String(value)));
  return inQ || inM;
}

describe("PayslipReauthModal — disabled state", () => {
  it("submit button is disabled when password is empty", () => {
    wrap(
      <PayslipReauthModal
        open
        payslipId={PAYSLIP_ID}
        onClose={vi.fn()}
        onRevealed={vi.fn()}
        reauth={vi.fn()}
        getOne={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /xác minh/i })).toBeDisabled();
  });
});

describe("PayslipReauthModal — success flow", () => {
  it("calls reauth then getOne, passes detail to onRevealed, closes", async () => {
    const reauth = vi.fn(async () => ({ expiresAt: ISO }));
    const getOne = vi.fn(async () => SLIP_DETAIL);
    const onRevealed = vi.fn();
    const onClose = vi.fn();
    wrap(
      <PayslipReauthModal
        open
        payslipId={PAYSLIP_ID}
        onClose={onClose}
        onRevealed={onRevealed}
        reauth={reauth}
        getOne={getOne}
      />,
    );
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: "correct-pw" } });
    fireEvent.click(screen.getByRole("button", { name: /xác minh/i }));

    await waitFor(() => expect(onRevealed).toHaveBeenCalledWith(SLIP_DETAIL));
    expect(reauth).toHaveBeenCalledWith(PAYSLIP_ID, "correct-pw");
    expect(getOne).toHaveBeenCalledWith(PAYSLIP_ID);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("PayslipReauthModal — error flow", () => {
  it("shows role=alert and does NOT call onRevealed when reauth fails", async () => {
    const reauth = vi.fn(async () => { throw new Error("Sai mật khẩu"); });
    const onRevealed = vi.fn();
    wrap(
      <PayslipReauthModal
        open
        payslipId={PAYSLIP_ID}
        onClose={vi.fn()}
        onRevealed={onRevealed}
        reauth={reauth}
        getOne={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /xác minh/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/thất bại|sai mật khẩu/i);
    expect(onRevealed).not.toHaveBeenCalled();
  });

  it("reauth OK but getOne fails → distinct error (not wrong-password), no reveal, stays open", async () => {
    const reauth = vi.fn(async () => ({ expiresAt: ISO }));
    const getOne = vi.fn(async () => {
      throw new Error("network");
    });
    const onRevealed = vi.fn();
    const onClose = vi.fn();
    wrap(
      <PayslipReauthModal
        open
        payslipId={PAYSLIP_ID}
        onClose={onClose}
        onRevealed={onRevealed}
        reauth={reauth}
        getOne={getOne}
      />,
    );
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: "correct-pw" } });
    fireEvent.click(screen.getByRole("button", { name: /xác minh/i }));

    // reauth thành công → getOne lỗi: thông báo PHẢI phân biệt với sai mật khẩu, modal KHÔNG đóng.
    expect(await screen.findByRole("alert")).toHaveTextContent(/không tải được phiếu lương|network/i);
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(onRevealed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PayslipReauthModal — clear factor on close/unmount", () => {
  it("clears typed password when modal is closed then reopened", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      payslipId: PAYSLIP_ID,
      onClose: vi.fn(),
      onRevealed: vi.fn(),
      reauth: vi.fn(),
      getOne: vi.fn(),
    };
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <PayslipReauthModal open {...props} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: "remembered?" } });

    // close
    rerender(
      <QueryClientProvider client={client}>
        <PayslipReauthModal open={false} {...props} />
      </QueryClientProvider>,
    );
    // reopen
    rerender(
      <QueryClientProvider client={client}>
        <PayslipReauthModal open {...props} />
      </QueryClientProvider>,
    );
    const field = screen.getByLabelText(/mật khẩu/i) as HTMLInputElement;
    expect(field.value).toBe("");
  });

  it("never stores payslip monetary values in React Query cache", async () => {
    const reauth = vi.fn(async () => ({ expiresAt: ISO }));
    const getOne = vi.fn(async () => SLIP_DETAIL);
    const onRevealed = vi.fn();
    const { client } = wrap(
      <PayslipReauthModal
        open
        payslipId={PAYSLIP_ID}
        onClose={vi.fn()}
        onRevealed={onRevealed}
        reauth={reauth}
        getOne={getOne}
      />,
    );
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /xác minh/i }));

    await waitFor(() => expect(onRevealed).toHaveBeenCalled());
    // net=24_500_000 không được lưu trong cache
    expect(cacheHoldsNumber(client, 24_500_000)).toBe(false);
  });
});
