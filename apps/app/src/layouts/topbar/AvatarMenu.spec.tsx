/**
 * AvatarMenu — S2-FE-AUTH-6: "Tài khoản của tôi" phải trỏ /account/profile (TRƯỚC ĐÂY trỏ nhầm /home).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  };
});

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

  it("'Tài khoản của tôi' điều hướng /account/profile (KHÔNG còn /home)", () => {
    render(<AvatarMenu />);
    fireEvent.click(screen.getByLabelText("Menu tài khoản"));
    fireEvent.click(screen.getByRole("menuitem", { name: /tài khoản của tôi/i }));

    expect(navigateMock).toHaveBeenCalledWith({ to: "/account/profile" });
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/home" });
  });

  it("'Đổi mật khẩu' vẫn điều hướng /account/change-password", () => {
    render(<AvatarMenu />);
    fireEvent.click(screen.getByLabelText("Menu tài khoản"));
    fireEvent.click(screen.getByRole("menuitem", { name: /đổi mật khẩu/i }));

    expect(navigateMock).toHaveBeenCalledWith({ to: "/account/change-password" });
  });
});
