import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordPage } from "./forgot-password";

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
    forgotPassword: vi.fn(),
  },
}));

const { authApi } = await import("@mediaos/web-core");

describe("apps/auth ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.mocked(authApi.forgotPassword).mockReset();
  });
  afterEach(cleanup);

  it("renders email field + back-to-login link", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /quay lại đăng nhập/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("empty email submit → inline validation error, API NOT called", async () => {
    render(<ForgotPasswordPage />);
    fireEvent.submit(screen.getByRole("button", { name: /gửi hướng dẫn/i }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Vui lòng nhập email.")).toBeInTheDocument());
    expect(authApi.forgotPassword).not.toHaveBeenCalled();
  });

  it("submit success → GENERIC message shown (does not reveal whether email exists)", async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValueOnce({ ok: true });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "u@co.com" } });
    fireEvent.click(screen.getByRole("button", { name: /gửi hướng dẫn/i }));

    await waitFor(() =>
      expect(screen.getByText(/nếu email này tồn tại trong hệ thống/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("rate-limit (429) → soft error message, stays on form", async () => {
    const { ApiError } = await import("@mediaos/web-core");
    vi.mocked(authApi.forgotPassword).mockRejectedValueOnce(
      new ApiError(429, "RATE_LIMIT", "Too many"),
    );
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "u@co.com" } });
    fireEvent.click(screen.getByRole("button", { name: /gửi hướng dẫn/i }));

    await waitFor(() =>
      expect(screen.getByText("Quá nhiều lần thử. Vui lòng thử lại sau.")).toBeInTheDocument(),
    );
    // Form vẫn còn (chưa chuyển sang trạng thái "đã gửi")
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
