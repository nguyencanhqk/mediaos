import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError } from "@mediaos/web-core";
import { hrApi } from "@mediaos/web-core";
import type { HrEmployeeDetail } from "@mediaos/contracts";
import { EmployeeFormPage } from "./EmployeeFormPage";

// ---------------------------------------------------------------------------
// Mocks — keep real web-core (useCan/store/ApiError) but stub the HR API surface.
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listPositions: vi.fn().mockResolvedValue([]),
      listJobLevels: vi.fn().mockResolvedValue([]),
      listContractTypes: vi.fn().mockResolvedValue([]),
      getEmployee: vi.fn(),
      createEmployee: vi.fn(),
      updateEmployee: vi.fn(),
    },
  };
});

// Dirty-form guard pulls TanStack router state (no RouterProvider in this unit test) → stub to no-op.
vi.mock("@/hooks/use-dirty-form-guard", () => ({
  useDirtyFormGuard: () => {},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

const DETAIL: HrEmployeeDetail = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  employeeCode: "EMP0001",
  fullName: "Nguyễn Văn A",
  email: "a@demo.local",
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
  workType: "offline",
  employmentType: "full_time",
  startDate: "2024-01-01",
  endDate: null,
  status: "active",
  baseSalary: null,
  salaryType: "monthly",
  phone: null,
  contractType: null,
  notes: null,
  avatarUrl: null,
  gender: null,
  dateOfBirth: null,
  maritalStatus: null,
  personalEmail: null,
  currentAddress: null,
  permanentAddress: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  officialDate: null,
  probationEndDate: null,
  workLocation: null,
  taxCode: null,
  personalExtra: null,
  // HR-IDENTITY-READ-1 — server masks to null unless caller holds EXACT view-identity grant.
  identityNumber: null,
  identityIssueDate: null,
  identityIssuePlace: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("EmployeeFormPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: create without create:employee ──────────────────────────────
  it("renders forbidden state when user lacks create:employee", () => {
    setCapabilities({});
    renderWithQuery(<EmployeeFormPage />);
    expect(screen.getByText(/không có quyền tạo hoặc chỉnh sửa/i)).toBeInTheDocument();
    expect(hrApi.createEmployee).not.toHaveBeenCalled();
  });

  // ── ALLOW: create form renders ─────────────────────────────────────────────
  it("renders the create form (account + work sections) with create:employee", () => {
    setCapabilities({ "create:employee": true });
    renderWithQuery(<EmployeeFormPage />);
    // HR-PROFILE-UI-1: label section xuất hiện CẢ ở anchor-nav trái lẫn heading section → getAllByText.
    expect(screen.getAllByText("Tài khoản đăng nhập").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Thông tin công việc").length).toBeGreaterThan(0);
    expect(document.querySelector("#email")).toBeInTheDocument();
  });

  // ── VALIDATION: empty required fields block submit ─────────────────────────
  it("shows validation errors and does not call the API on empty submit", async () => {
    setCapabilities({ "create:employee": true });
    renderWithQuery(<EmployeeFormPage />);
    fireEvent.click(screen.getByRole("button", { name: /tạo nhân viên/i }));
    await waitFor(() => expect(screen.getByText("Vui lòng nhập email.")).toBeInTheDocument());
    expect(screen.getByText("Vui lòng nhập họ tên.")).toBeInTheDocument();
    expect(hrApi.createEmployee).not.toHaveBeenCalled();
  });

  // ── ALLOW: successful create → API called + onSuccess ───────────────────────
  it("submits a valid create and calls onSuccess with the new id", async () => {
    setCapabilities({ "create:employee": true });
    vi.mocked(hrApi.createEmployee).mockResolvedValue({
      id: "new-emp-id",
      employeeCode: "EMP0002",
      userId: "new-user-id",
    });
    const onSuccess = vi.fn();
    renderWithQuery(<EmployeeFormPage onSuccess={onSuccess} />);

    fireEvent.change(document.querySelector("#email")!, { target: { value: "b@demo.local" } });
    fireEvent.change(document.querySelector("#fullName")!, { target: { value: "Trần Văn B" } });
    fireEvent.click(screen.getByRole("button", { name: /tạo nhân viên/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("new-emp-id"));
    expect(hrApi.createEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "b@demo.local",
        fullName: "Trần Văn B",
        workType: "offline",
        employmentType: "full_time",
        salaryType: "monthly",
      }),
    );
  });

  // ── ERROR: surfaced API error shows a friendly alert ───────────────────────
  it("shows a conflict error when create fails with 409", async () => {
    setCapabilities({ "create:employee": true });
    vi.mocked(hrApi.createEmployee).mockRejectedValue(new ApiError(409, "HR-ERR-DUP", "dup"));
    renderWithQuery(<EmployeeFormPage onSuccess={vi.fn()} />);

    fireEvent.change(document.querySelector("#email")!, { target: { value: "c@demo.local" } });
    fireEvent.change(document.querySelector("#fullName")!, { target: { value: "C" } });
    fireEvent.click(screen.getByRole("button", { name: /tạo nhân viên/i }));

    await waitFor(() => expect(screen.getByText(/dữ liệu bị trùng/i)).toBeInTheDocument());
  });

  // ── DENY-PATH: edit without update:employee ────────────────────────────────
  it("renders forbidden state when user lacks update:employee (edit mode)", () => {
    setCapabilities({});
    renderWithQuery(<EmployeeFormPage employeeId={DETAIL.id} />);
    expect(screen.getByText(/không có quyền tạo hoặc chỉnh sửa/i)).toBeInTheDocument();
    expect(hrApi.getEmployee).not.toHaveBeenCalled();
  });

  // ── ALLOW: edit pre-fills + PATCHes only the dirty field ───────────────────
  it("pre-fills the edit form and PATCHes only changed fields", async () => {
    setCapabilities({ "update:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(DETAIL);
    vi.mocked(hrApi.updateEmployee).mockResolvedValue({
      id: DETAIL.id,
      changedFields: ["employeeCode"],
    });
    const onSuccess = vi.fn();
    renderWithQuery(<EmployeeFormPage employeeId={DETAIL.id} onSuccess={onSuccess} />);

    // Wait for the detail to load and pre-fill employeeCode.
    await waitFor(() =>
      expect((document.querySelector("#employeeCode") as HTMLInputElement)?.value).toBe("EMP0001"),
    );

    fireEvent.change(document.querySelector("#employeeCode")!, { target: { value: "EMP9999" } });
    fireEvent.click(screen.getByRole("button", { name: /lưu thay đổi/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(DETAIL.id));
    expect(hrApi.updateEmployee).toHaveBeenCalledWith(DETAIL.id, { employeeCode: "EMP9999" });
  });

  // ── EDIT: save disabled until a field changes (dirty guard) ─────────────────
  it("keeps the save button disabled until the edit form is dirty", async () => {
    setCapabilities({ "update:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(DETAIL);
    renderWithQuery(<EmployeeFormPage employeeId={DETAIL.id} />);

    await waitFor(() =>
      expect((document.querySelector("#employeeCode") as HTMLInputElement)?.value).toBe("EMP0001"),
    );
    expect(screen.getByRole("button", { name: /lưu thay đổi/i })).toBeDisabled();
  });
});
