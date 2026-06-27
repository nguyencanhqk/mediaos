import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ACCT-1 (Module 2a) — "Tài khoản của tôi": self-service hồ sơ + đổi mật khẩu.
 * Test FE GATE phía client (validate trước khi gọi server) + luồng gọi đúng api:
 *   - Profile: đổi tên → usersApi.updateProfile → refetch /me → setUser; nút khoá khi chưa đổi.
 *   - Đổi mật khẩu: re-auth bằng mật khẩu hiện tại; submit chỉ khi ≥8 ký tự, khớp confirm, KHÁC mật khẩu cũ;
 *     thành công → authApi.changePassword + logoutSession (server đã thu hồi mọi phiên).
 * web-core mock: spread bản THẬT (giữ i18n init của setup.ts) + override api/store cần thiết.
 */

const updateProfile = vi.fn();
const me = vi.fn();
const changePassword = vi.fn();
const logoutSession = vi.fn();
const setUser = vi.fn();

let storeState: {
  user: { id: string; companyId: string; email: string; fullName: string | null; status: string } | null;
  setUser: typeof setUser;
};

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    usersApi: { ...actual.usersApi, updateProfile: (...a: unknown[]) => updateProfile(...a) },
    authApi: {
      ...actual.authApi,
      me: (...a: unknown[]) => me(...a),
      changePassword: (...a: unknown[]) => changePassword(...a),
    },
    logoutSession: (...a: unknown[]) => logoutSession(...a),
    useAuthStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
  };
});

// Import SAU vi.mock để component nhận bản đã override.
import { AccountSettingsPage } from "./account";

const ME = {
  id: "u-1",
  companyId: "c-1",
  email: "user@acme.test",
  fullName: "Tên Cũ",
  status: "active",
  capabilities: {},
  mustSetupTwoFactor: false,
};

beforeEach(() => {
  storeState = {
    user: { id: ME.id, companyId: ME.companyId, email: ME.email, fullName: ME.fullName, status: ME.status },
    setUser,
  };
  updateProfile.mockResolvedValue({ ok: true });
  me.mockResolvedValue(ME);
  changePassword.mockResolvedValue({ ok: true });
  logoutSession.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AccountSettingsPage — Hồ sơ (self-service)", () => {
  it("email là read-only (định danh, không tự đổi)", () => {
    render(<AccountSettingsPage />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.value).toBe(ME.email);
    expect(email).toHaveAttribute("readonly");
  });

  it("nút Lưu khoá khi tên chưa đổi", () => {
    render(<AccountSettingsPage />);
    expect(screen.getByRole("button", { name: /Lưu hồ sơ/ })).toBeDisabled();
  });

  it("đổi tên → updateProfile rồi refetch /me + setUser + báo thành công", async () => {
    render(<AccountSettingsPage />);
    fireEvent.change(screen.getByLabelText("Họ và tên"), { target: { value: "Tên Mới" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu hồ sơ/ }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ fullName: "Tên Mới" }));
    expect(me).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Đã lưu hồ sơ.")).toBeInTheDocument();
  });

  it("tên rỗng (chỉ khoảng trắng) → nút khoá, KHÔNG gọi server", () => {
    render(<AccountSettingsPage />);
    fireEvent.change(screen.getByLabelText("Họ và tên"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /Lưu hồ sơ/ })).toBeDisabled();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

describe("AccountSettingsPage — Đổi mật khẩu (re-auth, gate phía client)", () => {
  function fillPasswords(current: string, next: string, confirm: string) {
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: current } });
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: next } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: confirm } });
  }

  it("mật khẩu mới < 8 ký tự → nút khoá + báo lỗi, KHÔNG gọi server", () => {
    render(<AccountSettingsPage />);
    fillPasswords("OldPw!12345", "short", "short");
    expect(screen.getByRole("button", { name: "Đổi mật khẩu" })).toBeDisabled();
    expect(screen.getByText("Mật khẩu mới tối thiểu 8 ký tự.")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("nhập lại KHÔNG khớp → nút khoá + báo lệch, KHÔNG gọi server", () => {
    render(<AccountSettingsPage />);
    fillPasswords("OldPw!12345", "NewPw!12345", "NewPw!OTHER");
    expect(screen.getByRole("button", { name: "Đổi mật khẩu" })).toBeDisabled();
    expect(screen.getByText("Nhập lại mật khẩu không khớp.")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("mật khẩu mới TRÙNG mật khẩu hiện tại → nút khoá + cảnh báo, KHÔNG gọi server", () => {
    render(<AccountSettingsPage />);
    fillPasswords("SamePw!12345", "SamePw!12345", "SamePw!12345");
    expect(screen.getByRole("button", { name: "Đổi mật khẩu" })).toBeDisabled();
    expect(screen.getByText("Mật khẩu mới phải khác mật khẩu hiện tại.")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("hợp lệ → changePassword(current,new) rồi logoutSession (mọi phiên bị thu hồi)", async () => {
    render(<AccountSettingsPage />);
    fillPasswords("OldPw!12345", "NewPw!12345", "NewPw!12345");
    fireEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: "OldPw!12345",
        newPassword: "NewPw!12345",
      }),
    );
    await waitFor(() => expect(logoutSession).toHaveBeenCalledTimes(1));
  });
});
