import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { hrApi } from "@mediaos/web-core";
import { MyProfilePage } from "./MyProfilePage";
import type { HrMeProfile } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

// Trang giờ dùng useNavigate (nút "Yêu cầu cập nhật hồ sơ" trên banner) — không có router trong test.
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: {
      getMyProfile: vi.fn(),
    },
    // MeBannerAvatar (own-scope /me/avatar) mount trong banner — fail-soft null như production.
    meApi: { ...actual.meApi, getAvatar: vi.fn(() => Promise.resolve(null)) },
  };
});

// Mock react-i18next — factory uses dynamic import to avoid hoisting TDZ error.
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { default: hrVi } = await import("@/i18n/locales/vi/hr");
  const bundles: Record<string, Record<string, unknown>> = {
    hr: hrVi as unknown as Record<string, unknown>,
  };
  function resolve(ns: string, key: string): string {
    const bundle = bundles[ns] ?? {};
    return (
      (key.split(".").reduce<unknown>((acc, k) => {
        if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
        return undefined;
      }, bundle) as string) ?? key
    );
  }
  return {
    ...actual,
    useTranslation: (ns: string | string[] = "common") => {
      const namespace = Array.isArray(ns) ? ns[0] : ns;
      return {
        t: (key: string, opts?: Record<string, unknown>) => {
          const nsKey = key.includes(":") ? key : `${namespace}:${key}`;
          const [resolvedNs, resolvedKey] = nsKey.split(":");
          const result = resolve(resolvedNs, resolvedKey);
          if (opts?.defaultValue && result === resolvedKey) return opts.defaultValue as string;
          return result;
        },
        i18n: { language: "vi", changeLanguage: vi.fn() },
        ready: true,
      };
    },
    I18nextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
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

const MOCK_PROFILE: HrMeProfile = {
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

/**
 * Bố cục giờ giống màn chi tiết nhân viên: nội dung chia 4 tab và `TabsContent` KHÔNG render khi tab
 * không active (primitive tabs trả null) — nên field ở tab khác KHÔNG có trong DOM cho tới khi bấm.
 * Các assert về masking phải mở đúng tab, nếu không sẽ "xanh" nhờ nhãn masked của tab đang mở.
 */
function switchTab(name: RegExp) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MyProfilePage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── ALLOW-PATH: renders own profile ─────────────────────────────────────────
  it("renders profile data when API returns own profile", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue(MOCK_PROFILE);
    renderWithQuery(<MyProfilePage />);
    // fullName xuất hiện ở banner + FieldRow tab "Cơ bản" — dùng getAllByText
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.getByText("EMP0001")).toBeInTheDocument();
    // Banner ghép "chức vụ – đơn vị" thành MỘT dòng (giống /hr/employees/:id)
    expect(screen.getByText("Developer – Phòng Kỹ thuật")).toBeInTheDocument();
    // Phòng ban đầy đủ nằm ở tab "Công việc"
    switchTab(/công việc/i);
    expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument();
  });

  // ── Bố cục dùng chung với /hr/employees/:id: banner + 4 tab ────────────────
  it("hiển thị banner cover + đủ 4 tab như màn chi tiết nhân viên", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue(MOCK_PROFILE);
    renderWithQuery(<MyProfilePage />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));

    expect(screen.getByRole("tab", { name: /thông tin cơ bản/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /thông tin liên hệ/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /công việc/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /lương/i })).toBeInTheDocument();
  });

  // Nhân viên KHÔNG tự sửa hồ sơ — chỉ có lối "đề nghị thay đổi", và phải có cặp quyền mới hiện.
  it("ẩn nút đề nghị cập nhật khi thiếu create:profile-change-request", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue(MOCK_PROFILE);
    renderWithQuery(<MyProfilePage />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));

    expect(
      screen.queryByRole("button", { name: /đề nghị cập nhật hồ sơ/i }),
    ).not.toBeInTheDocument();
  });

  // Nút dẫn tới màn SỬA (giao diện như /hr/employees/:id/edit), KHÔNG dẫn thẳng tới danh sách yêu cầu
  // — danh sách chỉ là đích SAU KHI gửi thành công (nút OK ở màn sửa).
  it("có quyền → nút đề nghị cập nhật điều hướng màn sửa /me/profile/edit", async () => {
    setCapabilities({ "read:employee": true, "create:profile-change-request": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue(MOCK_PROFILE);
    renderWithQuery(<MyProfilePage />);
    const button = await screen.findByRole("button", { name: /đề nghị cập nhật hồ sơ/i });

    fireEvent.click(button);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/me/profile/edit" });
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/me/profile/change-requests" });
  });

  // ── LOADING state ─────────────────────────────────────────────────────────
  it("shows loading skeleton while fetching", () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getMyProfile).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<MyProfilePage />);
    const skeleton = document.querySelector(".animate-pulse");
    expect(skeleton).toBeInTheDocument();
  });

  // ── NOT LINKED: 404 → not-linked empty state ─────────────────────────────
  it("shows not-linked empty state when server returns 404", async () => {
    setCapabilities({ "read:employee": true });
    const err = Object.assign(new Error("not found"), { status: 404 });
    vi.mocked(hrApi.getMyProfile).mockRejectedValue(err);
    renderWithQuery(<MyProfilePage />);
    await waitFor(() =>
      expect(screen.getByText(/chưa liên kết hồ sơ nhân viên/i)).toBeInTheDocument(),
    );
  });

  // ── ERROR state — use status:403 so component retry exits immediately ────
  it("shows error state when API fails with non-404 error", async () => {
    setCapabilities({ "read:employee": true });
    // status 403 → retry fn returns false → no retries → isError immediately
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    vi.mocked(hrApi.getMyProfile).mockRejectedValue(err);
    renderWithQuery(<MyProfilePage />);
    await waitFor(() => expect(screen.getByText(/không thể tải hồ sơ/i)).toBeInTheDocument());
  });

  // ── SENSITIVE MASK: phone null → masked (no view-sensitive grant) ─────────
  it("shows masked placeholder for phone when null and user lacks view-sensitive", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue({ ...MOCK_PROFILE, phone: null });
    renderWithQuery(<MyProfilePage />);
    // fullName appears in multiple elements — use getAllByText
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    // Điện thoại nằm ở tab "Liên hệ" — mở đúng tab, KHÔNG dựa vào nhãn masked của tab đang mở.
    switchTab(/thông tin liên hệ/i);
    const maskedEls = screen.getAllByText(/bị ẩn do phân quyền/i);
    expect(maskedEls.length).toBeGreaterThan(0);
  });

  // ── SENSITIVE REVEAL: phone present → shown as-is (server granted) ────────
  it("renders phone value when server returns it (view-sensitive granted server-side)", async () => {
    setCapabilities({ "read:employee": true, "view-sensitive:employee": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue({ ...MOCK_PROFILE, phone: "0901234567" });
    renderWithQuery(<MyProfilePage />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    switchTab(/thông tin liên hệ/i);
    expect(screen.getByText("0901234567")).toBeInTheDocument();
  });

  // ── SALARY MASK: baseSalary null → masked (no view-salary grant) ──────────
  it("shows masked placeholder for salary when null and user lacks view-salary", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue({ ...MOCK_PROFILE, baseSalary: null });
    renderWithQuery(<MyProfilePage />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    // Lương nằm ở tab riêng (view-salary) — mở tab "Lương" rồi mới assert.
    switchTab(/^lương$/i);
    const maskedEls = screen.getAllByText(/bị ẩn do phân quyền/i);
    expect(maskedEls.length).toBeGreaterThan(0);
  });

  // ── API called once when session active (server enforces Own scope) ────────
  it("calls getMyProfile when session is active (server enforces Own scope)", () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getMyProfile).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<MyProfilePage />);
    expect(hrApi.getMyProfile).toHaveBeenCalledTimes(1);
  });

  // ── HR-IDENTITY-READ-1 — CCCD/CMND section gated on EXACT view-identity:employee ───────────
  it("hides the identity section when user lacks view-identity:employee", async () => {
    setCapabilities({ "read:employee": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue(MOCK_PROFILE);
    renderWithQuery(<MyProfilePage />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.queryByText(/giấy tờ tùy thân/i)).not.toBeInTheDocument();
  });

  it("does NOT fall through a *:* wildcard grant for the identity section (useCanExact only)", async () => {
    setCapabilities({ "read:employee": true, "*:*": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue(MOCK_PROFILE);
    renderWithQuery(<MyProfilePage />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.queryByText(/giấy tờ tùy thân/i)).not.toBeInTheDocument();
  });

  it("shows identity values when user holds the EXACT view-identity:employee grant", async () => {
    setCapabilities({ "read:employee": true, "view-identity:employee": true });
    vi.mocked(hrApi.getMyProfile).mockResolvedValue({
      ...MOCK_PROFILE,
      identityNumber: "079123456789",
      identityIssueDate: "2020-05-01",
      identityIssuePlace: "Cục Cảnh sát QLHC về TTXH",
    });
    renderWithQuery(<MyProfilePage />);
    await waitFor(() => expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0));
    expect(screen.getByText(/giấy tờ tùy thân/i)).toBeInTheDocument();
    expect(screen.getByText("079123456789")).toBeInTheDocument();
    expect(screen.getByText("Cục Cảnh sát QLHC về TTXH")).toBeInTheDocument();
  });
});
