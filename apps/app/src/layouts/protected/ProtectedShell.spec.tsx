// @vitest-environment jsdom
/**
 * ProtectedShell — guard ÉP enroll 2FA (AUTH-003).
 *
 * Vì sao spec này tồn tại: guard loại trừ "chính trang enroll" khỏi vòng redirect. Khi TwoFactorSetupPage
 * được mount THÊM ở /me/security/2fa (nút "Bật 2FA" trong ME workspace), allow-list chỉ-một-path sẽ đá
 * user `mustSetupTwoFactor` ra khỏi route ME ngay khi họ vừa tới — vòng lặp redirect vô hình. Spec khoá
 * CẢ HAI mount đều được loại trừ.
 *
 * PHẠM VI: đây là UX-guard phía client. Cổng chặn THẬT là TwoFactorEnforcementGuard ở server — spec này
 * KHÔNG phải bằng chứng enforcement; đừng coi green ở đây là "2FA đã được ép".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useAuthStore } from "@mediaos/web-core";
import { ProtectedShell } from "./ProtectedShell";
import { ACCOUNT_SETUP_2FA_PATH, ME_SETUP_2FA_PATH } from "@/routes/account/constants";

const { navigateMock, pathnameRef } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  pathnameRef: { current: "/home" },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: pathnameRef.current } }),
}));

// Chrome nặng — không thuộc phạm vi guard.
vi.mock("../topbar/GlobalTopbar", () => ({ GlobalTopbar: () => <div data-testid="topbar" /> }));
vi.mock("../home/AppSwitcher", () => ({ AppSwitcher: () => null }));
vi.mock("@/hooks/use-current-route-meta", () => ({ useCurrentRouteMeta: () => undefined }));

function setUser(mustSetupTwoFactor: boolean) {
  useAuthStore.setState({
    isAuthenticated: true,
    mustSetupTwoFactor,
    user: { id: "u1", email: "a@demo.local", fullName: "A", status: "Active", companyId: "co1" },
  });
}

function renderShell(pathname: string) {
  pathnameRef.current = pathname;
  return render(
    <ProtectedShell>
      <div data-testid="protected-content" />
    </ProtectedShell>,
  );
}

describe("ProtectedShell — guard ép enroll 2FA (AUTH-003)", () => {
  beforeEach(() => {
    pathnameRef.current = "/home";
  });
  afterEach(() => {
    // Unmount TRƯỚC khi hạ isAuthenticated: shell còn mount sẽ chạy effect redirect
    // `window.location.href = ...` → jsdom ném "Not implemented: navigation" (noise, không phải lỗi thật).
    cleanup();
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, user: null, mustSetupTwoFactor: false });
  });

  it("mustSetupTwoFactor + route thường → điều hướng màn enroll, KHÔNG render nội dung protected", () => {
    setUser(true);
    renderShell("/home");

    expect(navigateMock).toHaveBeenCalledWith({ to: ACCOUNT_SETUP_2FA_PATH });
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("mustSetupTwoFactor + ĐANG ở /account/setup-2fa → KHÔNG điều hướng (chống vòng lặp)", () => {
    setUser(true);
    renderShell(ACCOUNT_SETUP_2FA_PATH);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });

  it("mustSetupTwoFactor + ĐANG ở /me/security/2fa (mount ME của CÙNG trang) → KHÔNG điều hướng", () => {
    setUser(true);
    renderShell(ME_SETUP_2FA_PATH);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });

  it("KHÔNG bị ép enroll → route ME bình thường render nội dung, không điều hướng", () => {
    setUser(false);
    renderShell("/me/account");

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });
});
