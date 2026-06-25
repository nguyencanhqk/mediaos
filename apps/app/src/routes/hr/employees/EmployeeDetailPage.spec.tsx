import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { hrApi } from "@mediaos/web-core";
import { EmployeeDetailPage } from "./EmployeeDetailPage";
import type { HrEmployeeDetail } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      getEmployee: vi.fn(),
    },
  };
});

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_DETAIL: HrEmployeeDetail = {
  id: "emp-001",
  userId: "user-001",
  employeeCode: "EMP0001",
  fullName: "Nguyễn Văn A",
  email: "a@demo.local",
  orgUnitId: "dept-001",
  orgUnitName: "Phòng Kỹ thuật",
  positionId: "pos-001",
  positionName: "Developer",
  directManagerId: null,
  workType: "Full-time",
  employmentType: "Official",
  startDate: "2026-01-01",
  endDate: null,
  status: "active",
  baseSalary: null,
  salaryType: null,
  phone: null,
  contractType: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
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

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("EmployeeDetailPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no read:employee → forbidden ──────────────────────────────
  it("renders forbidden state when user lacks read:employee", () => {
    setCapabilities({});
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(hrApi.getEmployee).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: renders employee name and code ────────────────────────────
  it("renders employee details when user has read:employee", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    // Name appears in heading + FieldRow — getAllByText is intentional
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.getByText("EMP0001")).toBeInTheDocument();
    expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument();
  });

  // ── SENSITIVE MASK: phone null → masked text (no view-sensitive grant) ───
  it("shows masked placeholder for phone when server returns null and user lacks view-sensitive", async () => {
    setCapabilities({ "read:employee": true }); // no view-sensitive:employee
    vi.mocked(hrApi.getEmployee).mockResolvedValue({ ...MOCK_DETAIL, phone: null });
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    // Wait for the employee name heading to confirm data has loaded
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    // The masked placeholder must appear (phone is null AND no view-sensitive cap)
    const maskedElements = screen.getAllByText(/bị ẩn do phân quyền/i);
    expect(maskedElements.length).toBeGreaterThan(0);
  });

  // ── SENSITIVE REVEAL: phone present → renders as-is (server revealed) ────
  it("renders phone value when server returns it (view-sensitive grant on server)", async () => {
    setCapabilities({ "read:employee": true, "view-sensitive:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue({
      ...MOCK_DETAIL,
      phone: "0901234567",
    });
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getByText("0901234567")).toBeInTheDocument());
  });

  // ── SALARY MASK: baseSalary null → masked text (no view-salary grant) ────
  it("shows masked placeholder for salary when server returns null and user lacks view-salary", async () => {
    setCapabilities({ "read:employee": true }); // no view-salary:employee
    vi.mocked(hrApi.getEmployee).mockResolvedValue({ ...MOCK_DETAIL, baseSalary: null });
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    const maskedElements = screen.getAllByText(/bị ẩn do phân quyền/i);
    expect(maskedElements.length).toBeGreaterThan(0);
  });

  // ── ERROR state ───────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getEmployee).mockRejectedValue(new Error("fetch failed"));
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    // findByText is async + retries until timeout
    const errEl = await screen.findByText(/không thể tải hồ sơ/i);
    expect(errEl).toBeInTheDocument();
  });

  // ── LOADING state ─────────────────────────────────────────────────────────
  it("shows loading skeleton while fetching", () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getEmployee).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    // Loading skeleton shows "Đang tải…" from common.loading key
    expect(screen.getByText(/đang tải/i)).toBeInTheDocument();
  });

  // ── TAB navigation: tabs rendered ─────────────────────────────────────────
  it("renders all tabs after data loads", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /tổng quan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /thông tin cá nhân/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /công việc/i })).toBeInTheDocument();
  });
});
