/**
 * TwoFactorSetupPage — S2-FE-AUTH-6 (/account/setup-2fa, AUTH-003).
 *
 * Luồng: mount → tự động POST /auth/2fa/enroll (QR + recovery codes hiển thị 1 LẦN) → nhập mã TOTP →
 * POST /auth/2fa/enable → refetch /auth/me (đồng bộ store, mustSetupTwoFactor về false) → điều hướng /home.
 * BẤT BIẾN #3: recovery codes KHÔNG BAO GIỜ ghi vào localStorage/sessionStorage/console.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { MeResponse } from "@mediaos/contracts";
import { useAuthStore } from "@mediaos/web-core";
import { TwoFactorSetupPage } from "./TwoFactorSetupPage";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    twoFactorApi: { enroll: vi.fn(), enable: vi.fn() },
    authApi: { ...actual.authApi, me: vi.fn() },
  };
});

const { twoFactorApi, authApi } = await import("@mediaos/web-core");

const ENROLL_RESPONSE = {
  otpauthUri: "otpauth://totp/FUNTIME%20MEDIA:user?secret=ABCDEF",
  recoveryCodes: ["AAAA-BBBB", "CCCC-DDDD"],
};

const ME_AFTER_ENABLE: MeResponse = {
  id: "u1",
  companyId: "co1",
  email: "u@demo.local",
  fullName: "U",
  status: "active",
  capabilities: {},
  mustSetupTwoFactor: false,
};

function seedForcedAuth() {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: {},
    mustSetupTwoFactor: true,
    user: { id: "u1", email: "u@demo.local", fullName: "U", status: "Active", companyId: "co1" },
  });
}

describe("TwoFactorSetupPage", () => {
  beforeEach(() => {
    seedForcedAuth();
  });
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: false,
      user: null,
      capabilities: {},
      mustSetupTwoFactor: false,
    });
  });

  it("gọi POST /auth/2fa/enroll khi mount và hiển thị QR + recovery codes", async () => {
    vi.mocked(twoFactorApi.enroll).mockResolvedValue(ENROLL_RESPONSE);
    render(<TwoFactorSetupPage />);

    await waitFor(() => expect(twoFactorApi.enroll).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("AAAA-BBBB")).toBeInTheDocument();
    expect(screen.getByText("CCCC-DDDD")).toBeInTheDocument();
  });

  it("enroll thất bại → hiển thị lỗi + nút thử lại gọi lại enroll", async () => {
    vi.mocked(twoFactorApi.enroll).mockRejectedValueOnce(new Error("network down"));
    render(<TwoFactorSetupPage />);

    const retryButton = await screen.findByRole("button", { name: "Thử lại" });
    vi.mocked(twoFactorApi.enroll).mockResolvedValueOnce(ENROLL_RESPONSE);
    fireEvent.click(retryButton);

    await waitFor(() => expect(twoFactorApi.enroll).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("AAAA-BBBB")).toBeInTheDocument();
  });

  it("nút xác nhận bị disable khi mã chưa đủ 6 số", async () => {
    vi.mocked(twoFactorApi.enroll).mockResolvedValue(ENROLL_RESPONSE);
    render(<TwoFactorSetupPage />);
    await screen.findByText("AAAA-BBBB");

    const confirmButton = screen.getByRole("button", { name: "Xác nhận bật" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Mã xác nhận"), { target: { value: "12345" } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Mã xác nhận"), { target: { value: "123456" } });
    expect(confirmButton).not.toBeDisabled();
  });

  it("xác nhận mã đúng → enable → refetch /auth/me → cập nhật store → điều hướng /home", async () => {
    vi.mocked(twoFactorApi.enroll).mockResolvedValue(ENROLL_RESPONSE);
    vi.mocked(twoFactorApi.enable).mockResolvedValue({ ok: true });
    vi.mocked(authApi.me).mockResolvedValue(ME_AFTER_ENABLE);
    render(<TwoFactorSetupPage />);
    await screen.findByText("AAAA-BBBB");

    fireEvent.change(screen.getByLabelText("Mã xác nhận"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bật" }));

    await waitFor(() => expect(twoFactorApi.enable).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(authApi.me).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/home" }));
    expect(useAuthStore.getState().mustSetupTwoFactor).toBe(false);
  });

  it("mã sai (enable thất bại) → hiển thị lỗi, KHÔNG điều hướng", async () => {
    vi.mocked(twoFactorApi.enroll).mockResolvedValue(ENROLL_RESPONSE);
    const { ApiError } = await import("@mediaos/web-core");
    vi.mocked(twoFactorApi.enable).mockRejectedValue(
      new ApiError(401, "INVALID_CODE", "Mã không đúng."),
    );
    render(<TwoFactorSetupPage />);
    await screen.findByText("AAAA-BBBB");

    fireEvent.change(screen.getByLabelText("Mã xác nhận"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bật" }));

    await waitFor(() => expect(screen.getByText("Mã không đúng.")).toBeInTheDocument());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  // ── BẤT BIẾN #3: recovery codes KHÔNG BAO GIỜ vào localStorage/sessionStorage/console ─────────────
  it("recovery codes KHÔNG được ghi vào localStorage/sessionStorage", async () => {
    vi.mocked(twoFactorApi.enroll).mockResolvedValue(ENROLL_RESPONSE);
    render(<TwoFactorSetupPage />);
    await screen.findByText("AAAA-BBBB");

    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) ?? "";
        const value = storage.getItem(key) ?? "";
        expect(`${key}${value}`).not.toContain("AAAA-BBBB");
        expect(`${key}${value}`).not.toContain("CCCC-DDDD");
      }
    }
  });
});
