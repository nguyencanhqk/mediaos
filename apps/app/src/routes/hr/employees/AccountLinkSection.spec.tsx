import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { hrApi, authUsersApi } from "@mediaos/web-core";
import type { HrEmployeeDetail, AuthUserDetailDto } from "@mediaos/contracts";
import { AccountLinkSection } from "./AccountLinkSection";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: { ...actual.hrApi, unlinkUser: vi.fn() },
    authUsersApi: { ...actual.authUsersApi, getUser: vi.fn() },
  };
});

// LinkUserDialog is tested in its own spec — stub it here so AccountLinkSection tests
// stay focused on the section's own gate/state logic.
vi.mock("./LinkUserDialog", () => ({
  LinkUserDialog: ({ onClose }: { employeeId: string; onClose: () => void }) => (
    <div data-testid="link-user-dialog-stub">
      <button type="button" onClick={onClose}>
        close-stub
      </button>
    </div>
  ),
}));

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const BASE_EMPLOYEE: HrEmployeeDetail = {
  id: "emp-001",
  userId: null,
  employeeCode: "EMP0001",
  fullName: "Nguyễn Văn A",
  email: null,
  orgUnitId: null,
  orgUnitName: null,
  positionId: null,
  positionName: null,
  directManagerId: null,
  jobLevelName: null,
  contractTypeName: null,
  directManagerName: null,
  directManagerEmployeeId: null,
  indirectManagerName: null,
  resignationReason: null,
  workType: null,
  employmentType: null,
  startDate: null,
  endDate: null,
  status: "active",
  avatarUrl: null,
  baseSalary: null,
  salaryType: null,
  phone: null,
  contractType: null,
  notes: null,
  gender: null,
  dateOfBirth: null,
  maritalStatus: null,
  personalEmail: null,
  currentAddress: null,
  permanentAddress: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  identityNumber: null,
  identityIssueDate: null,
  identityIssuePlace: null,
  officialDate: null,
  probationEndDate: null,
  workLocation: null,
  taxCode: null,
  personalExtra: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const LINKED_EMPLOYEE: HrEmployeeDetail = {
  ...BASE_EMPLOYEE,
  userId: "user-001",
  email: "a@demo.local",
};

const LINKED_USER_DETAIL: AuthUserDetailDto = {
  id: "user-001",
  email: "a@demo.local",
  fullName: "Nguyễn Văn A",
  status: "active",
  lockedAt: null,
  lockedReason: null,
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  twoFactor: { enabled: false, requiredByRole: false, requiredByUser: false },
};

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

describe("AccountLinkSection", () => {
  beforeEach(() => {
    setCapabilities({});
    vi.clearAllMocks();
  });

  // ── Trạng thái CHƯA liên kết ────────────────────────────────────────────────
  it("shows 'Chưa liên kết' when employee.userId is null", () => {
    setCapabilities({ "update:employee": true, "view:user": true });
    renderWithQuery(<AccountLinkSection employee={BASE_EMPLOYEE} employeeId="emp-001" />);
    expect(screen.getByText("Chưa liên kết")).toBeInTheDocument();
    expect(screen.queryByText("a@demo.local")).not.toBeInTheDocument();
  });

  // ── Trạng thái ĐÃ liên kết: email + trạng thái tài khoản ───────────────────
  it("shows 'Đã liên kết' + email + account status when employee.userId is set", async () => {
    setCapabilities({ "update:employee": true, "view:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(LINKED_USER_DETAIL);
    renderWithQuery(<AccountLinkSection employee={LINKED_EMPLOYEE} employeeId="emp-001" />);
    expect(screen.getByText("Đã liên kết")).toBeInTheDocument();
    expect(screen.getByText("a@demo.local")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Đang hoạt động")).toBeInTheDocument());
  });

  it("does NOT fetch the linked user's account status without view:user (no wasted round-trip)", () => {
    setCapabilities({ "update:employee": true }); // no view:user
    renderWithQuery(<AccountLinkSection employee={LINKED_EMPLOYEE} employeeId="emp-001" />);
    expect(authUsersApi.getUser).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: no update:employee → neither Link nor Unlink button ─────────
  it("hides both link and unlink buttons when caller lacks update:employee", () => {
    setCapabilities({ "view:user": true });
    renderWithQuery(<AccountLinkSection employee={BASE_EMPLOYEE} employeeId="emp-001" />);
    expect(screen.queryByText("Liên kết tài khoản")).not.toBeInTheDocument();

    renderWithQuery(<AccountLinkSection employee={LINKED_EMPLOYEE} employeeId="emp-001" />);
    expect(screen.queryByText("Hủy liên kết")).not.toBeInTheDocument();
  });

  // ── DENY-PATH: update:employee nhưng thiếu view:user → nút disabled + tooltip ──
  it("disables the link button with a tooltip when caller lacks view:user", () => {
    setCapabilities({ "update:employee": true }); // no view:user
    renderWithQuery(<AccountLinkSection employee={BASE_EMPLOYEE} employeeId="emp-001" />);
    const btn = screen.getByText("Liên kết tài khoản").closest("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      "title",
      "Cần quyền xem tài khoản (view:user) để chọn người liên kết.",
    );
    fireEvent.click(btn as HTMLButtonElement);
    expect(screen.queryByTestId("link-user-dialog-stub")).not.toBeInTheDocument();
  });

  // ── ALLOW-PATH: mở dialog liên kết ──────────────────────────────────────────
  it("opens the link dialog when caller has update:employee + view:user", () => {
    setCapabilities({ "update:employee": true, "view:user": true });
    renderWithQuery(<AccountLinkSection employee={BASE_EMPLOYEE} employeeId="emp-001" />);
    fireEvent.click(screen.getByText("Liên kết tài khoản"));
    expect(screen.getByTestId("link-user-dialog-stub")).toBeInTheDocument();
  });

  // ── Hủy liên kết: confirm dialog + mutation ─────────────────────────────────
  it("unlinks the account after confirming, and invalidates on success", async () => {
    setCapabilities({ "update:employee": true, "view:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(LINKED_USER_DETAIL);
    vi.mocked(hrApi.unlinkUser).mockResolvedValue({ id: "emp-001", userId: null });
    renderWithQuery(<AccountLinkSection employee={LINKED_EMPLOYEE} employeeId="emp-001" />);

    fireEvent.click(screen.getByText("Hủy liên kết"));
    expect(screen.getByText(/Bạn có chắc muốn hủy liên kết/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Xác nhận hủy liên kết"));
    await waitFor(() =>
      expect(hrApi.unlinkUser).toHaveBeenCalledWith("emp-001", { lockUser: false }),
    );
    await waitFor(() =>
      expect(screen.queryByText(/Bạn có chắc muốn hủy liên kết/)).not.toBeInTheDocument(),
    );
  });

  it("shows a mapped Vietnamese message when unlink fails (e.g. self-unlink 403)", async () => {
    setCapabilities({ "update:employee": true, "view:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(LINKED_USER_DETAIL);
    const { ApiError } = await import("@mediaos/web-core");
    vi.mocked(hrApi.unlinkUser).mockRejectedValue(
      new ApiError(403, "AUTH-ERR-FORBIDDEN", "You cannot unlink your own account"),
    );
    renderWithQuery(<AccountLinkSection employee={LINKED_EMPLOYEE} employeeId="emp-001" />);

    fireEvent.click(screen.getByText("Hủy liên kết"));
    fireEvent.click(screen.getByText("Xác nhận hủy liên kết"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bạn không thể tự hủy liên kết tài khoản của chính mình.");
  });
});
