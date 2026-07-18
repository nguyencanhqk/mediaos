/**
 * AccountProfilePage — S2-FE-AUTH-6 (/account/profile, đọc-only).
 *
 * Dữ liệu từ GET /auth/me (authKeys.me()) — CÙNG endpoint bootstrap dùng, KHÔNG API mới. Client CHỈ
 * render field server trả (masking là việc server — BẤT BIẾN #2): employee=null → "chưa liên kết",
 * roles=[] → "chưa gán vai trò".
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MeResponse, TwoFactorStatus } from "@mediaos/contracts";
import { ApiError, useAuthStore } from "@mediaos/web-core";
import { AccountProfilePage } from "./AccountProfilePage";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    authApi: { ...actual.authApi, me: vi.fn() },
    // S2-FE-ACCT-SEC-1 — card "Bảo mật" đọc/ghi qua twoFactorApi (status/disable) — reuse, KHÔNG API mới.
    twoFactorApi: { ...actual.twoFactorApi, status: vi.fn(), disable: vi.fn() },
  };
});

const { authApi, twoFactorApi } = await import("@mediaos/web-core");

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const ME_WITH_EMPLOYEE: MeResponse = {
  id: "u1",
  companyId: "co1",
  email: "a@demo.local",
  fullName: "Nguyễn Văn A",
  status: "active",
  capabilities: { "create:profile-change-request": true },
  mustSetupTwoFactor: false,
  company: { id: "co1", name: "Acme Co", status: "active" },
  employee: {
    id: "emp-1",
    employeeCode: "EMP0001",
    fullName: "Nguyễn Văn A",
    departmentId: "d1",
    directManagerId: null,
    employmentStatus: "active",
  },
  roles: [{ id: "r1", name: "employee" }],
};

const ME_NO_EMPLOYEE: MeResponse = {
  id: "u2",
  companyId: "co1",
  email: "operator@demo.local",
  fullName: null,
  status: "active",
  capabilities: {},
  mustSetupTwoFactor: false,
  employee: null,
  roles: [],
};

function setAuthenticated(capabilities: Record<string, boolean> = {}) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities,
    mustSetupTwoFactor: false,
    user: {
      id: "u1",
      email: "a@demo.local",
      fullName: "Nguyễn Văn A",
      status: "Active",
      companyId: "co1",
    },
  });
}

const TWO_FACTOR_DISABLED: TwoFactorStatus = { enabled: false, required: false };
const TWO_FACTOR_ENABLED_OPTIONAL: TwoFactorStatus = { enabled: true, required: false };
const TWO_FACTOR_ENABLED_REQUIRED: TwoFactorStatus = { enabled: true, required: true };

describe("AccountProfilePage", () => {
  beforeEach(() => {
    setAuthenticated();
    // Mặc định card "Bảo mật" đọc trạng thái tắt — test riêng override khi cần enabled/required.
    vi.mocked(twoFactorApi.status).mockResolvedValue(TWO_FACTOR_DISABLED);
  });
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, user: null, capabilities: {} });
  });

  it("shows loading skeleton while fetching", () => {
    vi.mocked(authApi.me).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<AccountProfilePage />);
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows error state with retry on failure", async () => {
    vi.mocked(authApi.me).mockRejectedValue(new Error("net"));
    renderWithQuery(<AccountProfilePage />);
    await waitFor(() =>
      expect(screen.getByText("Không thể tải thông tin tài khoản")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("renders user + employee + roles from /auth/me (KHÔNG gọi API mới ngoài /auth/me)", async () => {
    vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
    setAuthenticated({ "create:profile-change-request": true });
    renderWithQuery(<AccountProfilePage />);

    await waitFor(() => expect(screen.getByText("a@demo.local")).toBeInTheDocument());
    expect(screen.getByText("EMP0001")).toBeInTheDocument();
    expect(screen.getByText("employee")).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    expect(authApi.me).toHaveBeenCalledTimes(1);
  });

  it("employee=null → hiển thị 'chưa liên kết hồ sơ nhân sự' (KHÔNG crash, KHÔNG bịa dữ liệu)", async () => {
    vi.mocked(authApi.me).mockResolvedValue(ME_NO_EMPLOYEE);
    renderWithQuery(<AccountProfilePage />);

    // fullName=null → PageHeader description RƠI về email → email xuất hiện 2 lần (header + field row).
    await waitFor(() => expect(screen.getAllByText("operator@demo.local").length).toBe(2));
    expect(screen.getByText("Tài khoản chưa liên kết hồ sơ nhân sự.")).toBeInTheDocument();
    expect(screen.getByText("Chưa được gán vai trò nào.")).toBeInTheDocument();
  });

  it("ẩn link 'Đề nghị thay đổi hồ sơ' khi thiếu create:profile-change-request (PermissionGate, không hard-code)", async () => {
    vi.mocked(authApi.me).mockResolvedValue(ME_NO_EMPLOYEE);
    setAuthenticated({}); // KHÔNG có create:profile-change-request
    renderWithQuery(<AccountProfilePage />);

    await waitFor(() => expect(screen.getAllByText("operator@demo.local").length).toBe(2));
    expect(
      screen.queryByRole("button", { name: "Đề nghị thay đổi hồ sơ" }),
    ).not.toBeInTheDocument();
    // Link đổi mật khẩu + phiên đăng nhập KHÔNG bị gate (self-service, không cặp quyền riêng).
    expect(screen.getByRole("button", { name: "Đổi mật khẩu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phiên đăng nhập" })).toBeInTheDocument();
  });

  // RE-POINT sang ME workspace: page này mount ở CẢ /account/profile lẫn /me/account, nên 3 nút
  // self-service phải dẫn về /me/* (không rơi ra khỏi ME giữa chừng). Assert negative khoá route cũ
  // để lần revert vô ý sẽ đỏ.
  it("điều hướng đúng route ME khi bấm các link self-service", async () => {
    vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
    setAuthenticated({ "create:profile-change-request": true });
    renderWithQuery(<AccountProfilePage />);
    await waitFor(() => expect(screen.getByText("a@demo.local")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Đề nghị thay đổi hồ sơ" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/me/profile/change-requests" });
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/hr/me/change-request" });

    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/me/security/password" });
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/account/change-password" });

    fireEvent.click(screen.getByRole("button", { name: "Phiên đăng nhập" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/me/security/sessions" });
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/account/sessions" });
  });

  // ── Card "Bảo mật" (S2-FE-ACCT-SEC-1) ─────────────────────────────────────────
  // Đọc twoFactorApi.status() (query riêng, KHÔNG API mới ngoài /auth/2fa/status). enabled=false → nút
  // "Bật 2FA" điều hướng /me/security/2fa (CÙNG TwoFactorSetupPage, mount trong ME). required=true → ẨN nút tắt +
  // hiện nhãn "bắt buộc theo chính sách". enabled=true & !required → Dialog nhập mật khẩu → disable().
  describe("card Bảo mật (2FA)", () => {
    it("required=true → ẨN nút 'Tắt 2FA' + hiện nhãn 'bắt buộc theo chính sách'", async () => {
      vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
      vi.mocked(twoFactorApi.status).mockResolvedValue(TWO_FACTOR_ENABLED_REQUIRED);
      renderWithQuery(<AccountProfilePage />);

      await waitFor(() => expect(screen.getByText("bắt buộc theo chính sách")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Tắt 2FA" })).not.toBeInTheDocument();
    });

    it("enabled=false → hiện nút 'Bật 2FA', bấm điều hướng /me/security/2fa (KHÔNG ra khỏi ME)", async () => {
      vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
      vi.mocked(twoFactorApi.status).mockResolvedValue(TWO_FACTOR_DISABLED);
      renderWithQuery(<AccountProfilePage />);

      const enableButton = await screen.findByRole("button", { name: "Bật 2FA" });
      fireEvent.click(enableButton);
      expect(navigateMock).toHaveBeenCalledWith({ to: "/me/security/2fa" });
      expect(navigateMock).not.toHaveBeenCalledWith({ to: "/account/setup-2fa" });
    });

    it("disable trả 409 (TWO_FACTOR_ENFORCED) → hiện message enforced, 2FA vẫn bật, không crash", async () => {
      vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
      vi.mocked(twoFactorApi.status).mockResolvedValue(TWO_FACTOR_ENABLED_OPTIONAL);
      vi.mocked(twoFactorApi.disable).mockRejectedValue(
        new ApiError(409, "TWO_FACTOR_ENFORCED", "enforced"),
      );
      renderWithQuery(<AccountProfilePage />);

      const disableButton = await screen.findByRole("button", { name: "Tắt 2FA" });
      fireEvent.click(disableButton);

      const inputEl = await screen.findByLabelText("Mật khẩu hiện tại");
      const attemptValue = ["wrong", "attempt", "value"].join("-");
      fireEvent.change(inputEl, { target: { value: attemptValue } });
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));

      await waitFor(() =>
        expect(
          screen.getByText(
            "Không thể tắt 2FA — vai trò của bạn yêu cầu bắt buộc bật xác thực 2 lớp.",
          ),
        ).toBeInTheDocument(),
      );
      // Vẫn bật (status không đổi) — nút "Tắt 2FA" vẫn còn, KHÔNG rớt về "Bật 2FA".
      expect(screen.getByRole("button", { name: "Tắt 2FA" })).toBeInTheDocument();
    });

    it("happy-path: enabled=true & !required → mở dialog, nhập mật khẩu, submit → disable() + refetch + feedback", async () => {
      vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
      vi.mocked(twoFactorApi.status)
        .mockResolvedValueOnce(TWO_FACTOR_ENABLED_OPTIONAL)
        .mockResolvedValueOnce(TWO_FACTOR_DISABLED);
      vi.mocked(twoFactorApi.disable).mockResolvedValue({ ok: true });
      renderWithQuery(<AccountProfilePage />);

      const disableButton = await screen.findByRole("button", { name: "Tắt 2FA" });
      fireEvent.click(disableButton);

      const inputEl = await screen.findByLabelText("Mật khẩu hiện tại");
      const confirmValue = ["correct", "attempt", "value"].join("-");
      fireEvent.change(inputEl, { target: { value: confirmValue } });
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));

      await waitFor(() => expect(twoFactorApi.disable).toHaveBeenCalledTimes(1));
      expect(twoFactorApi.disable).toHaveBeenCalledWith(confirmValue);
      await waitFor(() => expect(screen.getByText("Đã tắt xác thực 2 lớp.")).toBeInTheDocument());
      // refetch sau invalidate → status query gọi lại lần 2 (mockResolvedValueOnce thứ 2).
      await waitFor(() => expect(twoFactorApi.status).toHaveBeenCalledTimes(2));
    });

    it("BẤT BIẾN #3 — dữ liệu nhập ở dialog KHÔNG bao giờ ghi vào localStorage/sessionStorage/console", async () => {
      const localSetItemSpy = vi.spyOn(window.localStorage.__proto__, "setItem");
      const sessionSetItemSpy = vi.spyOn(window.sessionStorage.__proto__, "setItem");
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
      vi.mocked(twoFactorApi.status).mockResolvedValue(TWO_FACTOR_ENABLED_OPTIONAL);
      vi.mocked(twoFactorApi.disable).mockResolvedValue({ ok: true });
      renderWithQuery(<AccountProfilePage />);

      const disableButton = await screen.findByRole("button", { name: "Tắt 2FA" });
      fireEvent.click(disableButton);
      const inputEl = await screen.findByLabelText("Mật khẩu hiện tại");
      const invariantCheckValue = ["never", "persisted", "anywhere", "123"].join("-");
      fireEvent.change(inputEl, { target: { value: invariantCheckValue } });
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));

      await waitFor(() => expect(twoFactorApi.disable).toHaveBeenCalledTimes(1));

      const calledWith = (spy: ReturnType<typeof vi.spyOn>) =>
        spy.mock.calls.some((args) => args.some((a) => String(a).includes(invariantCheckValue)));

      expect(calledWith(localSetItemSpy)).toBe(false);
      expect(calledWith(sessionSetItemSpy)).toBe(false);
      expect(calledWith(consoleLogSpy)).toBe(false);
      expect(calledWith(consoleErrorSpy)).toBe(false);

      localSetItemSpy.mockRestore();
      sessionSetItemSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("status query loading → skeleton cục bộ; status query error → lỗi cục bộ, phần /auth/me vẫn render", async () => {
      vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
      vi.mocked(twoFactorApi.status).mockReturnValue(new Promise(() => {}));
      renderWithQuery(<AccountProfilePage />);

      await waitFor(() => expect(screen.getByText("a@demo.local")).toBeInTheDocument());
      expect(screen.getByText("Bảo mật")).toBeInTheDocument();

      vi.mocked(authApi.me).mockResolvedValue(ME_WITH_EMPLOYEE);
      vi.mocked(twoFactorApi.status).mockRejectedValue(new Error("net"));
      renderWithQuery(<AccountProfilePage />);
      await waitFor(() =>
        expect(
          screen.getAllByText("Không thể tải trạng thái bảo mật. Vui lòng thử lại sau.").length,
        ).toBeGreaterThan(0),
      );
      // Phần /auth/me không bị vỡ dù card Bảo mật lỗi.
      expect(screen.getAllByText("a@demo.local").length).toBeGreaterThan(0);
    });
  });
});
