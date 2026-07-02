import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordPage } from "./ChangePasswordPage";

vi.mock("@mediaos/web-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mediaos/web-core")>()),
  authApi: {
    changePassword: vi.fn(),
  },
  logoutSession: vi.fn(),
}));

const { authApi, logoutSession } = await import("@mediaos/web-core");

function fillForm(current = "oldpass1", next = "newpass123", confirm = "newpass123") {
  fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu mới"), { target: { value: confirm } });
}

describe("apps/app ChangePasswordPage", () => {
  beforeEach(() => {
    vi.mocked(authApi.changePassword).mockReset();
    vi.mocked(logoutSession).mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "http://web.localhost:5273/account/change-password" },
    });
  });
  afterEach(cleanup);

  // No PermissionGate — self-service endpoint has no permission-table pair (JwtAuthGuard only).
  // Rendering succeeds for ANY authenticated user reaching the route (route-level authGuard handles auth).
  it("renders the 3 password fields (no permission gate — self-service)", () => {
    render(<ChangePasswordPage />);
    expect(screen.getByLabelText("Mật khẩu hiện tại")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu mới")).toBeInTheDocument();
    expect(screen.getByLabelText("Xác nhận mật khẩu mới")).toBeInTheDocument();
  });

  it("empty submit → inline validation errors, API NOT called", async () => {
    render(<ChangePasswordPage />);
    fireEvent.submit(screen.getByRole("button", { name: /đổi mật khẩu/i }).closest("form")!);

    await waitFor(() =>
      expect(screen.getAllByText("Vui lòng nhập mật khẩu.").length).toBeGreaterThan(0),
    );
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("mismatched confirm password → inline validation error, API NOT called", async () => {
    render(<ChangePasswordPage />);
    fillForm("oldpass1", "newpass123", "different123");
    fireEvent.click(screen.getByRole("button", { name: /đổi mật khẩu/i }));

    await waitFor(() =>
      expect(screen.getByText("Mật khẩu xác nhận không khớp.")).toBeInTheDocument(),
    );
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("new password same as current → inline validation error, API NOT called", async () => {
    render(<ChangePasswordPage />);
    fillForm("samepass1", "samepass1", "samepass1");
    fireEvent.click(screen.getByRole("button", { name: /đổi mật khẩu/i }));

    await waitFor(() =>
      expect(screen.getByText("Mật khẩu mới phải khác mật khẩu hiện tại.")).toBeInTheDocument(),
    );
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("submit success → calls API, logoutSession, then redirects to auth login URL", async () => {
    vi.mocked(authApi.changePassword).mockResolvedValueOnce({ ok: true });
    render(<ChangePasswordPage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /đổi mật khẩu/i }));

    await waitFor(() =>
      expect(authApi.changePassword).toHaveBeenCalledWith({
        currentPassword: "oldpass1",
        newPassword: "newpass123",
      }),
    );
    await waitFor(() => expect(logoutSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.href).toContain("/login?redirect="));
  });

  it("401 from server (wrong current password) → friendly error, no redirect", async () => {
    const { ApiError } = await import("@mediaos/web-core");
    vi.mocked(authApi.changePassword).mockRejectedValueOnce(
      new ApiError(401, "INVALID_CREDENTIALS", "Invalid current password"),
    );
    render(<ChangePasswordPage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /đổi mật khẩu/i }));

    await waitFor(() =>
      expect(screen.getByText("Email hoặc mật khẩu không đúng.")).toBeInTheDocument(),
    );
    expect(logoutSession).not.toHaveBeenCalled();
  });
});
