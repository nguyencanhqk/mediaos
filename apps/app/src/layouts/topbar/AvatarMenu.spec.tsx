/**
 * AvatarMenu — đích điều hướng của menu avatar.
 *
 * Lịch sử: S2-FE-AUTH-6 ép "Tài khoản của tôi" trỏ /account/profile (TRƯỚC ĐÂY trỏ nhầm /home). Sau
 * S5-ME-FE-2 (ME workspace mount lại các màn account/security), menu RE-POINT sang ME:
 *   "Cá nhân" → /me · "Tài khoản của tôi" → /me/account · "Đổi mật khẩu" → /me/security/password.
 * Route /account/* vẫn sống (bookmark cũ) nhưng KHÔNG còn là đích của topbar — spec khoá điều đó.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import { AvatarMenu } from "./AvatarMenu";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    logoutSession: vi.fn(),
    getAuthRedirectUrl: () => "http://auth.localhost/login",
    // S5-ME-FE-4 — AvatarMenu đọc GET /me/avatar (fail-soft). Mặc định null (chưa có avatar → initials).
    meApi: { ...actual.meApi, getAvatar: vi.fn(() => Promise.resolve(null)) },
  };
});

/** AvatarMenu giờ dùng useQuery (meApi.getAvatar) → cần QueryClientProvider. */
function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AvatarMenu />
    </QueryClientProvider>,
  );
}

function setAuthenticated() {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: {},
    user: { id: "u1", email: "a@demo.local", fullName: "A", status: "Active", companyId: "co1" },
  });
}

describe("AvatarMenu", () => {
  beforeEach(() => {
    setAuthenticated();
  });
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, user: null, capabilities: {} });
  });

  it("'Cá nhân' điều hướng /me (lối vào ME Personal Hub)", () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText("Menu tài khoản"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^cá nhân$/i }));

    expect(navigateMock).toHaveBeenCalledWith({ to: "/me" });
  });

  it("'Tài khoản của tôi' điều hướng /me/account (KHÔNG còn /account/profile, KHÔNG còn /home)", () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText("Menu tài khoản"));
    fireEvent.click(screen.getByRole("menuitem", { name: /tài khoản của tôi/i }));

    expect(navigateMock).toHaveBeenCalledWith({ to: "/me/account" });
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/account/profile" });
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/home" });
  });

  it("'Đổi mật khẩu' điều hướng /me/security/password (KHÔNG còn /account/change-password)", () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText("Menu tài khoản"));
    fireEvent.click(screen.getByRole("menuitem", { name: /đổi mật khẩu/i }));

    expect(navigateMock).toHaveBeenCalledWith({ to: "/me/security/password" });
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/account/change-password" });
  });
});
