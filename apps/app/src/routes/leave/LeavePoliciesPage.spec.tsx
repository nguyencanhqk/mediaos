import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError } from "@mediaos/web-core";
import { leaveApi, hrApi } from "@mediaos/web-core";
import type { LeavePolicyView, LeaveTypeView } from "@mediaos/contracts";
import { LeavePoliciesPage } from "./LeavePoliciesPage";

// Giữ web-core thật (useCan/store/PermissionGate/ApiError/i18n) — chỉ stub API surface.
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    leaveApi: {
      listTypes: vi.fn(),
      listPolicies: vi.fn(),
      createPolicy: vi.fn(),
      updatePolicy: vi.fn(),
      deletePolicy: vi.fn(),
    },
    hrApi: {
      ...actual.hrApi,
      listDepartments: vi.fn().mockResolvedValue([]),
      listJobLevels: vi.fn().mockResolvedValue([]),
      listContractTypes: vi.fn().mockResolvedValue([]),
    },
  };
});
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

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

const LEAVE_TYPE_ID = "11111111-1111-1111-1111-111111111111";

const LEAVE_TYPE: LeaveTypeView = {
  id: LEAVE_TYPE_ID,
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

const POLICY: LeavePolicyView = {
  id: "pol-1",
  leaveTypeId: LEAVE_TYPE_ID,
  leaveTypeCode: "annual",
  leaveTypeName: "Nghỉ phép năm",
  policyCode: "STD",
  name: "Chính sách chuẩn",
  description: null,
  policyScope: "Company",
  departmentId: null,
  employeeId: null,
  jobLevelId: null,
  contractTypeId: null,
  yearlyQuotaDays: 12,
  yearlyQuotaHours: null,
  accrualMethod: "None",
  reserveBalanceOnPending: true,
  allowNegativeBalance: false,
  maxNegativeDays: null,
  requiresManagerApproval: true,
  requiresHrApproval: false,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  priority: 0,
  status: "Active",
};

describe("LeavePoliciesPage (LEAVE-SCREEN-011, gate = view/create/update/delete:leave-policy)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(leaveApi.listPolicies).mockResolvedValue([POLICY]);
    vi.mocked(leaveApi.listTypes).mockResolvedValue([LEAVE_TYPE]);
    vi.mocked(hrApi.listDepartments).mockResolvedValue([]);
    vi.mocked(hrApi.listJobLevels).mockResolvedValue([]);
    vi.mocked(hrApi.listContractTypes).mockResolvedValue([]);
  });

  it("shows forbidden and does not fetch without view:leave-policy", () => {
    setCaps({ "view-own:leave": true });
    renderWithQuery(<LeavePoliciesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(leaveApi.listPolicies).not.toHaveBeenCalled();
  });

  it("renders list when user has view:leave-policy", async () => {
    setCaps({ "view:leave-policy": true });
    renderWithQuery(<LeavePoliciesPage />);
    await waitFor(() => expect(screen.getByText("Chính sách chuẩn")).toBeInTheDocument());
    expect(screen.getByText("STD")).toBeInTheDocument();
  });

  it("hides add/edit/delete when user only has view:leave-policy", async () => {
    setCaps({ "view:leave-policy": true });
    renderWithQuery(<LeavePoliciesPage />);
    await waitFor(() => expect(screen.getByText("Chính sách chuẩn")).toBeInTheDocument());
    expect(screen.queryByText(/thêm chính sách/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sửa$/i })).not.toBeInTheDocument();
  });

  it("shows add button when user has create:leave-policy", async () => {
    setCaps({ "view:leave-policy": true, "create:leave-policy": true });
    renderWithQuery(<LeavePoliciesPage />);
    await waitFor(() => expect(screen.getByText("Chính sách chuẩn")).toBeInTheDocument());
    expect(screen.getByText(/thêm chính sách/i)).toBeInTheDocument();
  });

  it("creates a policy with the correct payload (server-authoritative, no company_id)", async () => {
    setCaps({ "view:leave-policy": true, "create:leave-policy": true });
    vi.mocked(leaveApi.createPolicy).mockResolvedValue({
      ...POLICY,
      id: "pol-2",
      policyCode: "NEW",
    });
    const { container } = renderWithQuery(<LeavePoliciesPage />);
    await waitFor(() => expect(screen.getByText("Chính sách chuẩn")).toBeInTheDocument());

    fireEvent.click(screen.getByText(/thêm chính sách/i));
    await waitFor(() =>
      expect(
        (container.querySelector("#leaveTypeId") as HTMLSelectElement).options.length,
      ).toBeGreaterThan(1),
    );
    fireEvent.change(container.querySelector("#leaveTypeId") as HTMLSelectElement, {
      target: { value: LEAVE_TYPE_ID },
    });
    fireEvent.change(container.querySelector("#policyCode") as HTMLInputElement, {
      target: { value: "NEW" },
    });
    fireEvent.change(container.querySelector("#name") as HTMLInputElement, {
      target: { value: "Chính sách mới" },
    });
    fireEvent.change(container.querySelector("#effectiveFrom") as HTMLInputElement, {
      target: { value: "2026-01-01" },
    });
    fireEvent.submit(container.querySelector("#master-data-form") as HTMLFormElement);

    await waitFor(() => expect(leaveApi.createPolicy).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(leaveApi.createPolicy).mock.calls[0][0];
    expect(payload).toMatchObject({
      leaveTypeId: LEAVE_TYPE_ID,
      policyCode: "NEW",
      name: "Chính sách mới",
      policyScope: "Company",
      effectiveFrom: "2026-01-01",
    });
    expect(payload).not.toHaveProperty("companyId");
    expect(payload).not.toHaveProperty("status");
  });

  it("deletes via confirm dialog and refetches the list", async () => {
    setCaps({ "view:leave-policy": true, "delete:leave-policy": true });
    vi.mocked(leaveApi.deletePolicy).mockResolvedValue(undefined);
    renderWithQuery(<LeavePoliciesPage />);
    await waitFor(() => expect(screen.getByText("Chính sách chuẩn")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^xoá$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^xoá$/i }));

    await waitFor(() => expect(leaveApi.deletePolicy).toHaveBeenCalledWith("pol-1"));
    await waitFor(() =>
      expect(vi.mocked(leaveApi.listPolicies).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("maps a 409 conflict to a field-level error on the form (policyCode trùng)", async () => {
    setCaps({ "view:leave-policy": true, "create:leave-policy": true });
    vi.mocked(leaveApi.createPolicy).mockRejectedValue(
      new ApiError(409, "LEAVE-ERR-POLICY-DUP", "duplicate code"),
    );
    const { container } = renderWithQuery(<LeavePoliciesPage />);
    await waitFor(() => expect(screen.getByText("Chính sách chuẩn")).toBeInTheDocument());

    fireEvent.click(screen.getByText(/thêm chính sách/i));
    await waitFor(() =>
      expect(
        (container.querySelector("#leaveTypeId") as HTMLSelectElement).options.length,
      ).toBeGreaterThan(1),
    );
    fireEvent.change(container.querySelector("#leaveTypeId") as HTMLSelectElement, {
      target: { value: LEAVE_TYPE_ID },
    });
    fireEvent.change(container.querySelector("#policyCode") as HTMLInputElement, {
      target: { value: "STD" },
    });
    fireEvent.change(container.querySelector("#name") as HTMLInputElement, {
      target: { value: "Trùng mã" },
    });
    fireEvent.change(container.querySelector("#effectiveFrom") as HTMLInputElement, {
      target: { value: "2026-01-01" },
    });
    fireEvent.submit(container.querySelector("#master-data-form") as HTMLFormElement);

    await waitFor(() => expect(screen.getAllByText(/mã đã tồn tại/i).length).toBeGreaterThan(0));
  });

  it("shows empty state when there are no policies", async () => {
    setCaps({ "view:leave-policy": true });
    vi.mocked(leaveApi.listPolicies).mockResolvedValue([]);
    renderWithQuery(<LeavePoliciesPage />);
    await waitFor(() => expect(screen.getByText(/chưa có dữ liệu/i)).toBeInTheDocument());
  });

  it("shows error state when the list fails to load", async () => {
    setCaps({ "view:leave-policy": true });
    vi.mocked(leaveApi.listPolicies).mockRejectedValue(new Error("net"));
    renderWithQuery(<LeavePoliciesPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });
});
