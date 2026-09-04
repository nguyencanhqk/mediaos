import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login";

// LoginPage render đơn lẻ (không có <RouterProvider>) — link "quên mật khẩu" chỉ cần render tĩnh trong test
// này, KHÔNG cần điều hướng thật. Mock Link → <a> (cùng pattern ProtectedRoute.spec.tsx).
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

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

  // ── S18-AUTH-RETRYAFTER-1 — 429 mang retryAfterSec ⇒ đếm ngược mm:ss ─────────────────────────
  describe("429 đếm ngược", () => {
    // Đồng hồ giả CHỈ trong describe này: các ca ở trên dùng `waitFor` với timer THẬT sẽ treo nếu bật
    // toàn file.
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    async function reject429(details: unknown) {
      const { ApiError } = await import("@mediaos/web-core");
      vi.mocked(authApi.login).mockRejectedValueOnce(
        new ApiError({
          status: 429,
          code: "SYSTEM-ERR-RATE-LIMIT",
          message: "Quá nhiều lần thử. Vui lòng thử lại sau.",
          details,
        }),
      );
    }

    const lockDetail = (sec: string) => [
      { field: "retryAfterSec", message: sec, rule: "retry-after" },
    ];

    const submit = () => fireEvent.click(screen.getByRole("button", { name: /vào hệ thống/i }));
    const submitBtn = () => screen.getByRole("button", { name: /vào hệ thống|đang/i });

    /** Nhích đồng hồ N giây — bản `…Async` vì state update nằm trong callback `setTimeout`. */
    async function tick(sec: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(sec * 1000);
      });
    }

    it("429 có số ⇒ hiện mm:ss, nút Submit bị khoá", async () => {
      await reject429(lockDetail("900"));
      render(<LoginPage />);
      fillCredentials();
      submit();

      await waitFor(() =>
        expect(screen.getByText("Quá nhiều lần thử. Thử lại sau 15:00.")).toBeInTheDocument(),
      );
      expect(submitBtn()).toBeDisabled();
    });

    it("đồng hồ chạy ⇒ số giảm từng giây (mm:ss có đệm 0)", async () => {
      await reject429(lockDetail("65"));
      render(<LoginPage />);
      fillCredentials();
      submit();

      await waitFor(() => expect(screen.getByText(/01:05/)).toBeInTheDocument());
      await tick(1);
      expect(screen.getByText(/01:04/)).toBeInTheDocument();
      await tick(60);
      expect(screen.getByText(/00:04/)).toBeInTheDocument();
    });

    it("hết giờ ⇒ nút bật lại VÀ thông báo biến mất (nói 'quá nhiều lần thử' sau khi hết giờ là NÓI SAI)", async () => {
      await reject429(lockDetail("3"));
      render(<LoginPage />);
      fillCredentials();
      submit();

      await waitFor(() => expect(screen.getByText(/00:03/)).toBeInTheDocument());
      expect(submitBtn()).toBeDisabled();

      await tick(3);

      expect(screen.queryByRole("alert")).toBeNull();
      expect(submitBtn()).toBeEnabled();
    });

    it("429 KHÔNG số ⇒ chuỗi CŨ, nút KHÔNG bị khoá (hành vi y hệt trước WO này)", async () => {
      await reject429(null);
      render(<LoginPage />);
      fillCredentials();
      submit();

      await waitFor(() =>
        expect(screen.getByText("Quá nhiều lần thử. Vui lòng thử lại sau.")).toBeInTheDocument(),
      );
      expect(submitBtn()).toBeEnabled();
    });

    it("429 số HỎNG HÌNH ('0') ⇒ chuỗi cũ, KHÔNG hiện '00:00', nút KHÔNG khoá", async () => {
      await reject429(lockDetail("0"));
      render(<LoginPage />);
      fillCredentials();
      submit();

      await waitFor(() =>
        expect(screen.getByText("Quá nhiều lần thử. Vui lòng thử lại sau.")).toBeInTheDocument(),
      );
      expect(screen.queryByText(/00:00/)).toBeNull();
      expect(submitBtn()).toBeEnabled();
    });

    it("unmount giữa chừng ⇒ KHÔNG rò timer (không setState sau khi gỡ)", async () => {
      await reject429(lockDetail("900"));
      const { unmount } = render(<LoginPage />);
      fillCredentials();
      submit();
      await waitFor(() => expect(screen.getByText(/15:00/)).toBeInTheDocument());

      unmount();
      await tick(5);

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
