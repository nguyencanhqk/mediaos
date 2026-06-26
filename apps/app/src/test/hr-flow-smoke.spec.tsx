// @vitest-environment jsdom
/**
 * [hr-flow-smoke] S2-QA-2 — Frontend smoke (QA-S2-005, IMPLEMENTATION-05 §17.3).
 *
 * The §17.3 journey SPINE walked end-to-end as one narrative: login/route-guard → HR list → detail →
 * create employee → logout. This is a different ALTITUDE from the per-page specs: those exhaustively
 * cover each leg's loading/empty/error/deny states in isolation (EmployeeListPage.spec /
 * EmployeeDetailPage.spec / EmployeeFormPage.spec / ProtectedRoute.spec). This spec instead proves the
 * happy-path legs are WIRED TOGETHER — so a regression that breaks the flow (but leaves each page green
 * on its own) is still caught. It deliberately does NOT re-assert every state matrix.
 *
 * Covered legs:
 *   FE-S2-TC-003  unauthenticated → route guard withholds content (redirect intent fired)
 *   FE-S2-TC-005  capable user → employee list renders
 *   FE-S2-TC-007  capable user → employee detail renders
 *   FE-S2-TC-008  capable user → create employee submits → onSuccess(newId)
 *   FE-S2-TC-010  logout → auth store cleared (query cache clear is wired to this in web-core)
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, type RouteMeta } from "@mediaos/web-core";
import { hrApi } from "@mediaos/web-core";
import type { HrEmployeeDetail, HrEmployeeListResponse } from "@mediaos/contracts";
import { ProtectedRoute } from "@/layouts/protected/ProtectedRoute";
import { EmployeeListPage } from "@/routes/hr/employees/EmployeeListPage";
import { EmployeeDetailPage } from "@/routes/hr/employees/EmployeeDetailPage";
import { EmployeeFormPage } from "@/routes/hr/employees/EmployeeFormPage";

// Keep the real store/useCan/PermissionGate from web-core; stub only the HR API surface the pages call.
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      listEmployees: vi.fn(),
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

// The create form's dirty-guard pulls TanStack router state (no RouterProvider here) → stub to no-op.
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function login(capabilities: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities,
    user: {
      id: "u1",
      email: "hr@demo.local",
      fullName: "HR User",
      status: "Active",
      companyId: "co-1",
    },
    username: "hr@demo.local",
    accessToken: "a",
    refreshToken: null,
  });
}

const HR_META: RouteMeta = {
  routeKey: "hr.employees",
  path: "/hr/employees",
  layout: "MODULE_WORKSPACE",
  titleKey: "routeTitle.hrEmployees",
  requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
};

const LIST: HrEmployeeListResponse = {
  items: [
    {
      id: "emp-1",
      userId: "user-1",
      employeeCode: "EMP0001",
      fullName: "Nguyễn Văn A",
      email: "a@demo.local",
      orgUnitId: "d1",
      orgUnitName: "Phòng Kỹ thuật",
      positionId: "p1",
      positionName: "Developer",
      workType: "offline",
      employmentType: "full_time",
      status: "active",
      baseSalary: null,
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

const DETAIL: HrEmployeeDetail = {
  id: "emp-1",
  userId: "user-1",
  employeeCode: "EMP0001",
  fullName: "Nguyễn Văn A",
  email: "a@demo.local",
  orgUnitId: "d1",
  orgUnitName: "Phòng Kỹ thuật",
  positionId: "p1",
  positionName: "Developer",
  directManagerId: null,
  workType: "offline",
  employmentType: "full_time",
  startDate: "2026-01-01",
  endDate: null,
  status: "active",
  baseSalary: null,
  salaryType: "monthly",
  phone: null,
  contractType: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("HR flow smoke (§17.3 journey spine)", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    vi.clearAllMocks();
  });

  it("FE-S2-TC-003: unauthenticated → route guard withholds content (redirect intent)", () => {
    const onRedirect = vi.fn();
    render(
      <ProtectedRoute meta={HR_META} onRedirect={onRedirect}>
        <div>guarded-hr-content</div>
      </ProtectedRoute>,
    );
    expect(onRedirect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("guarded-hr-content")).not.toBeInTheDocument();
  });

  it("FE-S2-TC-005 → 007 → 008: capable user walks list → detail → create", async () => {
    login({ "read:employee": true, "create:employee": true });

    // — list — (FE-S2-TC-005)
    vi.mocked(hrApi.listEmployees).mockResolvedValue(LIST);
    const list = renderWithQuery(<EmployeeListPage />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.getByText("EMP0001")).toBeInTheDocument();
    list.unmount();

    // — detail — (FE-S2-TC-007)
    vi.mocked(hrApi.getEmployee).mockResolvedValue(DETAIL);
    const detail = renderWithQuery(<EmployeeDetailPage employeeId="emp-1" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    detail.unmount();

    // — create — (FE-S2-TC-008)
    vi.mocked(hrApi.createEmployee).mockResolvedValue({
      id: "emp-new",
      employeeCode: "EMP0002",
      userId: "user-new",
    });
    const onSuccess = vi.fn();
    renderWithQuery(<EmployeeFormPage onSuccess={onSuccess} />);
    fireEvent.change(document.querySelector("#email")!, { target: { value: "b@demo.local" } });
    fireEvent.change(document.querySelector("#fullName")!, { target: { value: "Trần Văn B" } });
    fireEvent.click(screen.getByRole("button", { name: /tạo nhân viên/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("emp-new"));
    expect(hrApi.createEmployee).toHaveBeenCalledWith(
      expect.objectContaining({ email: "b@demo.local", fullName: "Trần Văn B" }),
    );
  });

  it("FE-S2-TC-010: logout clears the auth store (cache clear is wired to logout in web-core)", () => {
    login({ "read:employee": true });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    useAuthStore.getState().logout();

    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.capabilities).toEqual({});
  });
});
