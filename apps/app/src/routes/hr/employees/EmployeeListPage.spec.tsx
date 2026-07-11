import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { hrApi } from "@mediaos/web-core";
import { EmployeeListPage } from "./EmployeeListPage";
import type { HrEmployeeListResponse } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      listEmployees: vi.fn(),
      listDepartments: vi.fn().mockResolvedValue([]),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_RESPONSE: HrEmployeeListResponse = {
  items: [
    {
      id: "emp-001",
      userId: "user-001",
      employeeCode: "EMP0001",
      fullName: "Nguyễn Văn A",
      email: "a@demo.local",
      orgUnitId: "dept-001",
      orgUnitName: "Phòng Kỹ thuật",
      positionId: "pos-001",
      positionName: "Developer",
      workType: "Full-time",
      employmentType: "Official",
      status: "active",
      avatarUrl: null,
      startDate: null,
      gender: null,
      dateOfBirth: null,
      phone: null,
      contractType: null,
      baseSalary: null,
    },
  ],
  meta: {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
};

// ---------------------------------------------------------------------------
// Set capabilities via store (mirrors what /auth/me bootstraps)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("EmployeeListPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no read:employee ──────────────────────────────────────────
  it("renders forbidden state when user lacks read:employee", () => {
    setCapabilities({}); // empty caps → useCan returns false
    renderWithQuery(<EmployeeListPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    // API must NOT be called
    expect(hrApi.listEmployees).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: create button hidden without create:employee ─────────────
  it("hides 'Thêm nhân viên' button when user lacks create:employee", async () => {
    setCapabilities({ "read:employee": true }); // has view, not create
    vi.mocked(hrApi.listEmployees).mockResolvedValue(MOCK_RESPONSE);
    renderWithQuery(<EmployeeListPage />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.queryByText(/thêm nhân viên/i)).not.toBeInTheDocument();
  });

  // ── ALLOW-PATH: list renders on success ──────────────────────────────────
  it("renders employee list when user has read:employee", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.listEmployees).mockResolvedValue(MOCK_RESPONSE);
    renderWithQuery(<EmployeeListPage />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.getByText("EMP0001")).toBeInTheDocument();
    expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
  });

  // ── ALLOW-PATH: create button visible with create:employee ───────────────
  it("shows 'Thêm nhân viên' button when user has create:employee", async () => {
    setCapabilities({ "read:employee": true, "create:employee": true });
    vi.mocked(hrApi.listEmployees).mockResolvedValue(MOCK_RESPONSE);
    renderWithQuery(<EmployeeListPage />);
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument());
    expect(screen.getByText(/thêm nhân viên/i)).toBeInTheDocument();
  });

  // ── LOADING state ─────────────────────────────────────────────────────────
  it("shows skeleton rows while loading", () => {
    setCapabilities({ "read:employee": true });
    // never resolves → stays in loading
    vi.mocked(hrApi.listEmployees).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<EmployeeListPage />);
    // DataTable renders 5 skeleton rows during loading — check table is present
    const table = document.querySelector("table");
    expect(table).toBeInTheDocument();
  });

  // ── ERROR state ───────────────────────────────────────────────────────────
  it("shows error state when API call fails", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.listEmployees).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<EmployeeListPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeInTheDocument());
  });

  // ── EMPTY state ────────────────────────────────────────────────────────────
  it("shows empty state when list has no results", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.listEmployees).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });
    renderWithQuery(<EmployeeListPage />);
    await waitFor(() => expect(screen.getByText(/không có nhân viên/i)).toBeInTheDocument());
  });
});
