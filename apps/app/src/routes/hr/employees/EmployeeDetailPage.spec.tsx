import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { hrApi, employeeFilesApi } from "@mediaos/web-core";
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
    // S2-FE-HR-9 — Tab "File hồ sơ" gọi employeeFilesApi.getEmployeeFiles khi có file-view:employee.
    employeeFilesApi: {
      getEmployeeFiles: vi.fn(),
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
    // HR-PROFILE-UI-1: header cover gộp "Chức vụ – Đơn vị" thành 1 chuỗi → match bằng regex.
    expect(screen.getByText(/Phòng Kỹ thuật/)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    // HR-PROFILE-UI-1: phone nằm ở tab "Thông tin liên hệ" — chuyển tab rồi mới thấy.
    fireEvent.click(screen.getByRole("tab", { name: /thông tin liên hệ/i }));
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
  // HR-PROFILE-UI-1: bộ tab mới (Thông tin cơ bản/Liên hệ/Công việc/Lương) + TabsTrigger role="tab".
  it("renders all tabs after data loads", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.getByRole("tab", { name: /thông tin cơ bản/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /thông tin liên hệ/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /công việc/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /lương/i })).toBeInTheDocument();
  });

  // ── S2-FE-HR-9 — Tab "File hồ sơ" chỉ hiển thị nếu có file-view:employee ────
  it("hides the files tab when user lacks file-view:employee", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.queryByRole("tab", { name: /file hồ sơ/i })).not.toBeInTheDocument();
  });

  it("shows the files tab and switches to it when user has file-view:employee", async () => {
    setCapabilities({ "read:employee": true, "file-view:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    vi.mocked(employeeFilesApi.getEmployeeFiles).mockResolvedValue([]);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    const filesTabButton = screen.getByRole("tab", { name: /file hồ sơ/i });
    expect(filesTabButton).toBeInTheDocument();
    fireEvent.click(filesTabButton);
    expect(screen.getByText(/tài liệu đính kèm hồ sơ nhân viên này/i)).toBeInTheDocument();
  });
});
