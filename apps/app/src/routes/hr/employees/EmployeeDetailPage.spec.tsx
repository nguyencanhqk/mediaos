import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { hrApi, employeeFilesApi, employeeAvatarApi } from "@mediaos/web-core";
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
    // S5-HR-AVATAR-1 — HR/admin đổi/gỡ avatar NHÂN VIÊN KHÁC (gate update:employee).
    employeeAvatarApi: {
      uploadEmployeeAvatar: vi.fn(),
      removeEmployeeAvatar: vi.fn(),
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
  jobLevelName: null,
  contractTypeName: null,
  directManagerName: null,
  directManagerEmployeeId: null,
  indirectManagerName: null,
  resignationReason: null,
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
  // HR-IDENTITY-READ-1 — server masks to null unless caller holds EXACT view-identity grant.
  identityNumber: null,
  identityIssueDate: null,
  identityIssuePlace: null,
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

  // ── HR-IDENTITY-READ-1 — CCCD/CMND section gated on EXACT view-identity:employee ───────────
  it("hides the identity section when user lacks view-identity:employee", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    // Default active tab is "basic" — identity section would live there if mounted.
    expect(screen.queryByText(/giấy tờ tùy thân/i)).not.toBeInTheDocument();
  });

  it("does NOT fall through a *:* wildcard grant for the identity section (useCanExact only)", async () => {
    setCapabilities({ "read:employee": true, "*:*": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.queryByText(/giấy tờ tùy thân/i)).not.toBeInTheDocument();
  });

  it("shows identity values when user holds the EXACT view-identity:employee grant", async () => {
    setCapabilities({ "read:employee": true, "view-identity:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue({
      ...MOCK_DETAIL,
      identityNumber: "079123456789",
      identityIssueDate: "2020-05-01",
      identityIssuePlace: "Cục Cảnh sát QLHC về TTXH",
    });
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.getByText(/giấy tờ tùy thân/i)).toBeInTheDocument();
    expect(screen.getByText("079123456789")).toBeInTheDocument();
    expect(screen.getByText("Cục Cảnh sát QLHC về TTXH")).toBeInTheDocument();
  });

  // ── S5-HR-WORKINFO-1 — khối Thông tin công việc bổ sung (tab "Công việc") ─────────
  it("work tab shows Cấp bậc + Quản lý trực tiếp/gián tiếp (directory-class) khi server trả", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue({
      ...MOCK_DETAIL,
      jobLevelName: "Senior",
      directManagerName: "Trần Văn B",
      directManagerEmployeeId: "emp-mgr-1",
      indirectManagerName: "Lê Văn C",
    });
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("tab", { name: /công việc/i }));
    expect(screen.getByText("Senior")).toBeInTheDocument();
    expect(screen.getByText("Trần Văn B")).toBeInTheDocument();
    expect(screen.getByText("Lê Văn C")).toBeInTheDocument();
  });

  it("direct-manager link điều hướng sang hồ sơ quản lý (server enforce quyền)", async () => {
    setCapabilities({ "read:employee": true });
    const onNavigate = vi.fn();
    vi.mocked(hrApi.getEmployee).mockResolvedValue({
      ...MOCK_DETAIL,
      directManagerName: "Trần Văn B",
      directManagerEmployeeId: "emp-mgr-1",
    });
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" onNavigateEmployee={onNavigate} />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("tab", { name: /công việc/i }));
    fireEvent.click(screen.getByRole("button", { name: "Trần Văn B" }));
    expect(onNavigate).toHaveBeenCalledWith("emp-mgr-1");
  });

  it("khối 'Thông tin nghỉ việc' ẩn khi active, hiện khi resigned (+ lý do server trả)", async () => {
    setCapabilities({ "read:employee": true, "view-sensitive:employee": true });
    // active → không có khối nghỉ việc
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    const { unmount } = renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("tab", { name: /công việc/i }));
    expect(screen.queryByText(/thông tin nghỉ việc/i)).not.toBeInTheDocument();
    unmount();

    // resigned → khối hiện + lý do
    vi.mocked(hrApi.getEmployee).mockResolvedValue({
      ...MOCK_DETAIL,
      status: "resigned",
      endDate: "2026-06-30",
      resignationReason: "Chuyển công tác",
    });
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("tab", { name: /công việc/i }));
    expect(screen.getByText(/thông tin nghỉ việc/i)).toBeInTheDocument();
    expect(screen.getByText("Chuyển công tác")).toBeInTheDocument();
  });

  // ── S5-HR-AVATAR-1 — HR/admin đổi/gỡ avatar NHÂN VIÊN KHÁC (gate update:employee) ──────────
  const pngFile = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
  const txtFile = () => new File([new Uint8Array([1, 2, 3])], "a.txt", { type: "text/plain" });

  it("hiện nút 'Đổi ảnh' khi có update:employee", async () => {
    setCapabilities({ "read:employee": true, "update:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /Đổi ảnh/ })).toBeInTheDocument();
  });

  it("ẨN nút quản lý avatar khi THIẾU update:employee (server vẫn là chốt)", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /Đổi ảnh/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gỡ ảnh/ })).not.toBeInTheDocument();
  });

  it("chưa có avatar → KHÔNG hiện nút 'Gỡ ảnh'", async () => {
    setCapabilities({ "read:employee": true, "update:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL); // avatarUrl: null
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /Gỡ ảnh/ })).not.toBeInTheDocument();
  });

  it("đã có avatar → hiện nút 'Gỡ ảnh', click gọi employeeAvatarApi.removeEmployeeAvatar", async () => {
    setCapabilities({ "read:employee": true, "update:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue({
      ...MOCK_DETAIL,
      avatarUrl: "https://s3/get.png",
    });
    vi.mocked(employeeAvatarApi.removeEmployeeAvatar).mockResolvedValue(undefined);
    renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /Gỡ ảnh/ }));
    await waitFor(() =>
      expect(employeeAvatarApi.removeEmployeeAvatar).toHaveBeenCalledWith("emp-001"),
    );
  });

  it("chọn ảnh hợp lệ → gọi employeeAvatarApi.uploadEmployeeAvatar(employeeId, file)", async () => {
    setCapabilities({ "read:employee": true, "update:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    vi.mocked(employeeAvatarApi.uploadEmployeeAvatar).mockResolvedValue({ fileId: "f1" });
    const { container } = renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = pngFile();
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(employeeAvatarApi.uploadEmployeeAvatar).toHaveBeenCalledWith("emp-001", file),
    );
  });

  it("file SAI loại → hiện lỗi + KHÔNG gọi uploadEmployeeAvatar", async () => {
    setCapabilities({ "read:employee": true, "update:employee": true });
    vi.mocked(hrApi.getEmployee).mockResolvedValue(MOCK_DETAIL);
    const { container } = renderWithQuery(<EmployeeDetailPage employeeId="emp-001" />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [txtFile()] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Chỉ chấp nhận ảnh/);
    expect(employeeAvatarApi.uploadEmployeeAvatar).not.toHaveBeenCalled();
  });
});
