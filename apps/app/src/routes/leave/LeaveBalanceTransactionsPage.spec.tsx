import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError } from "@mediaos/web-core";
import { leaveApi } from "@mediaos/web-core";
import type { LeaveBalanceTransactionView } from "@mediaos/contracts";
import { LeaveBalanceTransactionsPage } from "./LeaveBalanceTransactionsPage";

// Giữ web-core thật (useCanExact/store/PermissionGate/ApiError/i18n) — chỉ stub API surface.
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    leaveApi: {
      listBalanceTransactions: vi.fn(),
      adjustBalance: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const TX: LeaveBalanceTransactionView = {
  id: "tx-1",
  transactionType: "ADJUSTMENT",
  transactionDate: "2026-06-01",
  amountDays: -2,
  balanceBeforeDays: 10,
  balanceAfterDays: 8,
  reason: "Điều chỉnh do nghỉ ốm bổ sung",
  createdByType: "User",
  createdBy: "u1",
  createdAt: "2026-06-01T08:00:00.000Z",
};

describe("LeaveBalanceTransactionsPage (LEAVE-SCREEN-013, gate = view-transaction:leave-balance exact / adjust:leave-balance)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(leaveApi.listBalanceTransactions).mockResolvedValue([TX]);
  });

  it("shows forbidden and does not fetch without EXACT view-transaction:leave-balance", () => {
    setCaps({ "*:leave-balance": true });
    renderWithQuery(<LeaveBalanceTransactionsPage balanceId="bal-1" onBack={vi.fn()} />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(leaveApi.listBalanceTransactions).not.toHaveBeenCalled();
  });

  it("renders the ledger (read-only) when user has view-transaction:leave-balance", async () => {
    setCaps({ "view-transaction:leave-balance": true });
    renderWithQuery(<LeaveBalanceTransactionsPage balanceId="bal-1" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("ADJUSTMENT")).toBeInTheDocument());
    expect(screen.getByText("Điều chỉnh do nghỉ ốm bổ sung")).toBeInTheDocument();
    expect(leaveApi.listBalanceTransactions).toHaveBeenCalledWith("bal-1");
  });

  it("hides Điều chỉnh action when user lacks adjust:leave-balance", async () => {
    setCaps({ "view-transaction:leave-balance": true });
    renderWithQuery(<LeaveBalanceTransactionsPage balanceId="bal-1" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("ADJUSTMENT")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /điều chỉnh/i })).not.toBeInTheDocument();
  });

  it("shows Điều chỉnh action + opens adjust dialog when user has adjust:leave-balance", async () => {
    setCaps({ "view-transaction:leave-balance": true, "adjust:leave-balance": true });
    renderWithQuery(<LeaveBalanceTransactionsPage balanceId="bal-1" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("ADJUSTMENT")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /điều chỉnh/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    setCaps({ "view-transaction:leave-balance": true });
    renderWithQuery(<LeaveBalanceTransactionsPage balanceId="bal-1" onBack={onBack} />);
    await waitFor(() => expect(screen.getByText("ADJUSTMENT")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /quay lại danh sách/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows notFound state on 404 (balance không tồn tại hoặc không có quyền)", async () => {
    setCaps({ "view-transaction:leave-balance": true });
    vi.mocked(leaveApi.listBalanceTransactions).mockRejectedValue(
      new ApiError(404, "LEAVE-ERR-BALANCE-NOT-FOUND", "not found"),
    );
    renderWithQuery(<LeaveBalanceTransactionsPage balanceId="bal-x" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/không tìm thấy số dư phép/i)).toBeInTheDocument());
  });

  it("shows empty state when the ledger has no transactions", async () => {
    setCaps({ "view-transaction:leave-balance": true });
    vi.mocked(leaveApi.listBalanceTransactions).mockResolvedValue([]);
    renderWithQuery(<LeaveBalanceTransactionsPage balanceId="bal-1" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/^chưa có giao dịch$/i)).toBeInTheDocument());
  });

  it("shows generic error state on non-404 failure", async () => {
    setCaps({ "view-transaction:leave-balance": true });
    vi.mocked(leaveApi.listBalanceTransactions).mockRejectedValue(new Error("net"));
    renderWithQuery(<LeaveBalanceTransactionsPage balanceId="bal-1" onBack={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải lịch sử giao dịch/i)).toBeInTheDocument(),
    );
  });
});
