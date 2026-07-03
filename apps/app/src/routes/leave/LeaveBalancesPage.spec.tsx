import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { leaveApi } from "@mediaos/web-core";
import type { LeaveBalanceAdminView, LeaveTypeView } from "@mediaos/contracts";
import { LeaveBalancesPage } from "./LeaveBalancesPage";

// Giữ web-core thật (useCanExact/store/PermissionGate/i18n) — chỉ stub API surface.
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    leaveApi: {
      listTypes: vi.fn(),
      listBalancesAdmin: vi.fn(),
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

const LEAVE_TYPE: LeaveTypeView = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Nghỉ phép năm",
  code: "annual",
  paid: true,
  status: "active",
  description: null,
  deductBalance: true,
  balanceUnit: "Day",
  allowFullDay: true,
  allowHalfDay: false,
  allowHourly: false,
  allowMultipleDays: true,
  requireReason: false,
  requireAttachment: false,
  minNoticeDays: null,
  maxDaysPerRequest: null,
  maxHoursPerRequest: null,
  sortOrder: null,
};

const BALANCE: LeaveBalanceAdminView = {
  id: "bal-1",
  employeeId: "emp-1",
  userId: "u2",
  userFullName: "Nguyễn Văn A",
  leaveTypeId: LEAVE_TYPE.id,
  leaveTypeCode: "annual",
  leaveTypeName: "Nghỉ phép năm",
  year: new Date().getFullYear(),
  totalDays: 12,
  usedDays: 3,
  pendingDays: 1,
  adjustedDays: 0,
  remainingDays: 8,
  allowNegativeBalance: false,
};

describe("LeaveBalancesPage (LEAVE-SCREEN-012, gate = view:leave-balance exact / adjust:leave-balance)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(leaveApi.listBalancesAdmin).mockResolvedValue([BALANCE]);
    vi.mocked(leaveApi.listTypes).mockResolvedValue([LEAVE_TYPE]);
  });

  it("shows forbidden and does not fetch when only a WILDCARD grant exists (is_sensitive=true → useCanExact, KHÔNG wildcard-fallback)", () => {
    // '*:leave-balance' đủ cho useCan() (wildcard fallback) nhưng KHÔNG đủ cho useCanExact() — đúng
    // hành vi BE (view:leave-balance is_sensitive=true, mig 0455) → tránh FE-permit/BE-403 mismatch.
    setCaps({ "*:leave-balance": true });
    renderWithQuery(<LeaveBalancesPage onViewTransactions={vi.fn()} />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(leaveApi.listBalancesAdmin).not.toHaveBeenCalled();
  });

  it("renders balance list when user has view:leave-balance", async () => {
    setCaps({ "view:leave-balance": true });
    renderWithQuery(<LeaveBalancesPage onViewTransactions={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    // "Nghỉ phép năm" xuất hiện CẢ trong ô bảng lẫn <option> bộ lọc loại phép — dùng getAllByText.
    expect(screen.getAllByText("Nghỉ phép năm").length).toBeGreaterThan(0);
    expect(screen.getByText("8")).toBeInTheDocument(); // remainingDays
  });

  it("hides Điều chỉnh button when user lacks adjust:leave-balance", async () => {
    setCaps({ "view:leave-balance": true });
    renderWithQuery(<LeaveBalancesPage onViewTransactions={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /điều chỉnh/i })).not.toBeInTheDocument();
    // "Xem giao dịch" luôn hiện (KHÔNG cần adjust) vì đó là quyền view-transaction, không phải adjust.
    expect(screen.getByRole("button", { name: /xem giao dịch/i })).toBeInTheDocument();
  });

  it("shows Điều chỉnh button when user has adjust:leave-balance and opens adjust dialog", async () => {
    setCaps({ "view:leave-balance": true, "adjust:leave-balance": true });
    renderWithQuery(<LeaveBalancesPage onViewTransactions={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /điều chỉnh/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("calls onViewTransactions with the balance id when clicked", async () => {
    const onViewTransactions = vi.fn();
    setCaps({ "view:leave-balance": true });
    renderWithQuery(<LeaveBalancesPage onViewTransactions={onViewTransactions} />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /xem giao dịch/i }));
    expect(onViewTransactions).toHaveBeenCalledWith("bal-1");
  });

  it("submits amountDays/reason via leaveApi.adjustBalance on confirm (KHÔNG sửa số dư ngoài ledger)", async () => {
    setCaps({ "view:leave-balance": true, "adjust:leave-balance": true });
    vi.mocked(leaveApi.adjustBalance).mockResolvedValue({ ...BALANCE, remainingDays: 6 });
    renderWithQuery(<LeaveBalancesPage onViewTransactions={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /điều chỉnh/i }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/số ngày điều chỉnh/i), { target: { value: "-2" } });
    fireEvent.change(screen.getByLabelText(/lý do điều chỉnh/i), {
      target: { value: "Nghỉ ốm bổ sung, có chứng từ" },
    });
    fireEvent.click(screen.getByTestId("btn-confirm-adjust"));

    await waitFor(() =>
      expect(leaveApi.adjustBalance).toHaveBeenCalledWith("bal-1", {
        amountDays: -2,
        reason: "Nghỉ ốm bổ sung, có chứng từ",
      }),
    );
  });

  it("filters client-side by employee name substring", async () => {
    vi.mocked(leaveApi.listBalancesAdmin).mockResolvedValue([
      BALANCE,
      { ...BALANCE, id: "bal-2", userFullName: "Trần Thị B" },
    ]);
    setCaps({ "view:leave-balance": true });
    renderWithQuery(<LeaveBalancesPage onViewTransactions={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.getByText("Trần Thị B")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/tìm nhân viên/i), { target: { value: "Trần" } });
    await waitFor(() => expect(screen.queryByText("Nguyễn Văn A")).not.toBeInTheDocument());
    expect(screen.getByText("Trần Thị B")).toBeInTheDocument();
  });

  it("shows empty state when there are no balances", async () => {
    setCaps({ "view:leave-balance": true });
    vi.mocked(leaveApi.listBalancesAdmin).mockResolvedValue([]);
    renderWithQuery(<LeaveBalancesPage onViewTransactions={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/không có số dư phép/i)).toBeInTheDocument());
  });

  it("shows error state when the list fails to load", async () => {
    setCaps({ "view:leave-balance": true });
    vi.mocked(leaveApi.listBalancesAdmin).mockRejectedValue(new Error("net"));
    renderWithQuery(<LeaveBalancesPage onViewTransactions={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });
});
