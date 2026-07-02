import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordPage } from "./reset-password";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mediaos/web-core")>()),
  authApi: {
    resetPassword: vi.fn(),
  },
}));

const { authApi } = await import("@mediaos/web-core");

function setLocationSearch(search: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { search, href: `http://auth.localhost:5275/reset-password${search}` },
  });
}

describe("apps/auth ResetPasswordPage", () => {
  beforeEach(() => {
    vi.mocked(authApi.resetPassword).mockReset();
    setLocationSearch("?token=tok-123");
  });
  afterEach(cleanup);

  it("missing token in query-string → error state, no form", () => {
    setLocationSearch("");
    render(<ResetPasswordPage />);

    expect(screen.getByText(/thiếu liên kết đặt lại mật khẩu/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mật khẩu mới")).not.toBeInTheDocument();
  });

  it("renders new-password + confirm fields when token present", () => {
    render(<ResetPasswordPage />);
    expect(screen.getByLabelText("Mật khẩu mới")).toBeInTheDocument();
    expect(screen.getByLabelText("Xác nhận mật khẩu mới")).toBeInTheDocument();
  });

  it("password too short → inline validation error, API NOT called", async () => {
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /đặt lại mật khẩu/i }));

    await waitFor(() =>
      expect(screen.getByText("Mật khẩu phải có ít nhất 8 ký tự.")).toBeInTheDocument(),
    );
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it("mismatched confirm password → inline validation error, API NOT called", async () => {
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "newpass123" } });
    fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới"), {
      target: { value: "different123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /đặt lại mật khẩu/i }));

    await waitFor(() =>
      expect(screen.getByText("Mật khẩu xác nhận không khớp.")).toBeInTheDocument(),
    );
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it("submit success → success state with link to /login", async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValueOnce({ ok: true });
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "newpass123" } });
    fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới"), {
      target: { value: "newpass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /đặt lại mật khẩu/i }));

    await waitFor(() =>
      expect(screen.getByText(/đặt lại mật khẩu thành công/i)).toBeInTheDocument(),
    );
    expect(authApi.resetPassword).toHaveBeenCalledWith({
      token: "tok-123",
      newPassword: "newpass123",
    });
    expect(screen.getByRole("link", { name: /đến trang đăng nhập/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("invalid/expired token (400) → standard error, no user detail leaked", async () => {
    const { ApiError } = await import("@mediaos/web-core");
    vi.mocked(authApi.resetPassword).mockRejectedValueOnce(
      new ApiError(400, "INVALID_TOKEN", "Invalid or expired token"),
    );
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "newpass123" } });
    fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới"), {
      target: { value: "newpass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /đặt lại mật khẩu/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn."),
      ).toBeInTheDocument(),
    );
  });
});
