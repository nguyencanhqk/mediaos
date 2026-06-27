import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login";

// --- 2FA challenge form mock (đơn giản hoá: nút verify gọi onSuccess không tham số) ---
vi.mock("@/components/TwoFactorChallengeForm", () => ({
  TwoFactorChallengeForm: ({
    onSuccess,
    onCancel,
  }: {
    challengeToken: string;
    onSuccess: () => void;
    onCancel?: () => void;
  }) => (
    <div data-testid="2fa-challenge">
      <button onClick={() => onSuccess()}>verify-2fa</button>
      {onCancel && <button onClick={onCancel}>cancel-2fa</button>}
    </div>
  ),
}));

// Partial mock: giữ ApiError thật, override authApi (login + checkRedirect).
vi.mock("@mediaos/web-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mediaos/web-core")>()),
  authApi: {
    login: vi.fn(),
    checkRedirect: vi.fn(),
  },
}));

const { authApi } = await import("@mediaos/web-core");
const DEFAULT_APP_URL = "http://web.localhost:5273";

const assign = vi.fn();

function fillCredentials(email = "u@co.com", pass = "secret") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: pass } });
}

describe("apps/auth LoginPage", () => {
  beforeEach(() => {
    assign.mockClear();
    vi.mocked(authApi.login).mockReset();
    vi.mocked(authApi.checkRedirect).mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        search: "?redirect=https://web.localhost/dash",
        assign,
        href: "http://auth.localhost:5275/login",
      },
    });
  });
  afterEach(cleanup);

  it("renders credential fields (no company-slug field — single tenant)", () => {
    render(<LoginPage />);
    expect(screen.queryByLabelText("Mã công ty")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
  });

  it("submit button disabled when fields empty", () => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /vào hệ thống/i })).toBeDisabled();
  });

  it("login success (no 2FA) → checkRedirect(requested) → window.location to allowed target", async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 900,
    });
    vi.mocked(authApi.checkRedirect).mockResolvedValueOnce({
      allowed: true,
      target: "https://web.localhost/dash",
    });
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /vào hệ thống/i }));

    await waitFor(() =>
      expect(authApi.checkRedirect).toHaveBeenCalledWith("https://web.localhost/dash"),
    );
    expect(assign).toHaveBeenCalledWith("https://web.localhost/dash");
  });

  it("redirect NOT allowed → falls back to default app URL (server is source of truth)", async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 900,
    });
    vi.mocked(authApi.checkRedirect).mockResolvedValueOnce({ allowed: false, target: null });
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /vào hệ thống/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(DEFAULT_APP_URL));
  });

  it("checkRedirect throws → falls back to default app URL (no open redirect)", async () => {
    const { ApiError } = await import("@mediaos/web-core");
    vi.mocked(authApi.login).mockResolvedValueOnce({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 900,
    });
    vi.mocked(authApi.checkRedirect).mockRejectedValueOnce(new ApiError(500, "X", "boom"));
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /vào hệ thống/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(DEFAULT_APP_URL));
  });

  it("login → 2FA challenge → shows TwoFactorChallengeForm", async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({
      twoFactorRequired: true,
      challengeToken: "ch-tok",
    });
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /vào hệ thống/i }));

    await waitFor(() => expect(screen.getByTestId("2fa-challenge")).toBeInTheDocument());
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("2FA verify success → redirect to target", async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({
      twoFactorRequired: true,
      challengeToken: "ch-tok",
    });
    vi.mocked(authApi.checkRedirect).mockResolvedValueOnce({
      allowed: true,
      target: "https://web.localhost/dash",
    });
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /vào hệ thống/i }));
    await waitFor(() => screen.getByTestId("2fa-challenge"));

    fireEvent.click(screen.getByText("verify-2fa"));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://web.localhost/dash"));
  });

  it("cancel 2FA → returns to credentials form", async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({
      twoFactorRequired: true,
      challengeToken: "ch-tok",
    });
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /vào hệ thống/i }));
    await waitFor(() => screen.getByTestId("2fa-challenge"));

    fireEvent.click(screen.getByText("cancel-2fa"));

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByTestId("2fa-challenge")).not.toBeInTheDocument();
  });

  it("empty email submit → inline RHF+Zod validation error, authApi.login NOT called", async () => {
    render(<LoginPage />);

    // Chỉ điền mật khẩu, để trống email rồi submit form (bỏ qua disabled-check qua submit form).
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByRole("button", { name: /vào hệ thống/i }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Vui lòng nhập email.")).toBeInTheDocument());
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it("invalid email format → inline validation error, authApi.login NOT called", async () => {
    render(<LoginPage />);

    fillCredentials("not-an-email", "secret");
    fireEvent.submit(screen.getByRole("button", { name: /vào hệ thống/i }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Email không hợp lệ.")).toBeInTheDocument());
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it("401 error → friendly message, no redirect", async () => {
    const { ApiError } = await import("@mediaos/web-core");
    vi.mocked(authApi.login).mockRejectedValueOnce(
      new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials"),
    );
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /vào hệ thống/i }));

    await waitFor(() =>
      expect(screen.getByText("Email hoặc mật khẩu không đúng.")).toBeInTheDocument(),
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
