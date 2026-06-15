import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthTokens, MeResponse } from "@mediaos/contracts";
import { LoginPage } from "./login";

// --- router mock ---
const mockNavigate = vi.fn(() => Promise.resolve());
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

// --- auth-api mock ---
vi.mock("@/lib/auth-api", () => ({
  authApi: {
    login: vi.fn(),
    me: vi.fn(),
  },
}));

// --- 2FA challenge form mock ---
vi.mock("@/components/two-factor/TwoFactorChallengeForm", () => ({
  TwoFactorChallengeForm: ({
    onSuccess,
    onCancel,
  }: {
    challengeToken: string;
    onSuccess: (tokens: AuthTokens) => void;
    onCancel?: () => void;
  }) => (
    <div data-testid="2fa-challenge">
      <button onClick={() => onSuccess({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 })}>
        verify-2fa
      </button>
      {onCancel && <button onClick={onCancel}>cancel-2fa</button>}
    </div>
  ),
}));

// --- auth store mock: Zustand hook called with no args in LoginPage ---
const mockSetTokens = vi.fn();
const mockSetUser = vi.fn();
const mockLogout = vi.fn();

const mockStoreState = {
  isAuthenticated: false,
  user: null,
  username: null,
  accessToken: null,
  refreshToken: null,
  capabilities: {},
  setTokens: mockSetTokens,
  setUser: mockSetUser,
  logout: mockLogout,
};

vi.mock("@/stores/auth", () => ({
  useAuthStore: vi.fn((selector?: (s: typeof mockStoreState) => unknown) =>
    selector ? selector(mockStoreState) : mockStoreState,
  ),
  getAccessToken: vi.fn(() => null),
}));

const { authApi } = await import("@/lib/auth-api");

const mockTokens: AuthTokens = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  expiresIn: 900,
};

const mockMe: MeResponse = {
  id: "u1",
  companyId: "co1",
  email: "admin@co.com",
  fullName: "Admin",
  status: "active",
  capabilities: {},
  mustSetupTwoFactor: false,
};

function fillCredentials(slug = "my-co", email = "admin@co.com", pass = "secret") {
  fireEvent.change(screen.getByLabelText("Mã công ty"), { target: { value: slug } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: pass } });
}

describe("LoginPage — credentials form", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSetTokens.mockClear();
    mockSetUser.mockClear();
    mockLogout.mockClear();
    vi.mocked(authApi.login).mockReset();
    vi.mocked(authApi.me).mockReset();
  });
  afterEach(cleanup);

  it("renders credential fields", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText("Mã công ty")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
  });

  it("submit button disabled when fields empty", () => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /đăng nhập/i })).toBeDisabled();
  });

  it("login success → setTokens + setUser + navigate", async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce(mockTokens);
    vi.mocked(authApi.me).mockResolvedValueOnce(mockMe);
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    await waitFor(() => expect(mockSetTokens).toHaveBeenCalledWith("access-abc", "refresh-xyz"));
    expect(mockSetUser).toHaveBeenCalledWith(mockMe, mockMe.capabilities);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("/me fails after tokens set → clears orphaned tokens (logout) + no navigation", async () => {
    const { ApiError } = await import("@/lib/api-client");
    vi.mocked(authApi.login).mockResolvedValueOnce(mockTokens);
    vi.mocked(authApi.me).mockRejectedValueOnce(new ApiError(500, "INTERNAL", "boom"));
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    // setTokens chạy trước (me() đọc token từ store), nhưng me() lỗi → logout xoá token mồ côi.
    await waitFor(() => expect(mockLogout).toHaveBeenCalled());
    expect(mockSetTokens).toHaveBeenCalledWith("access-abc", "refresh-xyz");
    expect(mockSetUser).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("login → 2FA challenge → shows TwoFactorChallengeForm", async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({
      twoFactorRequired: true,
      challengeToken: "ch-tok",
    });
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    await waitFor(() => expect(screen.getByTestId("2fa-challenge")).toBeInTheDocument());
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("2FA verify success → setTokens + navigate", async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({
      twoFactorRequired: true,
      challengeToken: "ch-tok",
    });
    vi.mocked(authApi.me).mockResolvedValueOnce(mockMe);
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));
    await waitFor(() => screen.getByTestId("2fa-challenge"));

    fireEvent.click(screen.getByText("verify-2fa"));

    await waitFor(() => expect(mockSetTokens).toHaveBeenCalledWith("tok", "ref"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("cancel 2FA → returns to credentials form", async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({
      twoFactorRequired: true,
      challengeToken: "ch-tok",
    });
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));
    await waitFor(() => screen.getByTestId("2fa-challenge"));

    fireEvent.click(screen.getByText("cancel-2fa"));

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByTestId("2fa-challenge")).not.toBeInTheDocument();
  });

  it("401 error → friendly message, no navigation", async () => {
    const { ApiError } = await import("@/lib/api-client");
    vi.mocked(authApi.login).mockRejectedValueOnce(
      new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials"),
    );
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    await waitFor(() =>
      expect(screen.getByText("Email hoặc mật khẩu không đúng.")).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("500 error → generic server error message", async () => {
    const { ApiError } = await import("@/lib/api-client");
    vi.mocked(authApi.login).mockRejectedValueOnce(
      new ApiError(503, "SERVICE_UNAVAILABLE", "Service unavailable"),
    );
    render(<LoginPage />);

    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    await waitFor(() =>
      expect(screen.getByText("Lỗi máy chủ. Vui lòng thử lại sau.")).toBeInTheDocument(),
    );
  });
});
