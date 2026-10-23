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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, cleanup, within } from "@testing-library/react";
import { ApiError, configureToast, showApiErrorToast, useAuthStore } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { ProtectedShell } from "./ProtectedShell";
import { ACCOUNT_SETUP_2FA_PATH, ME_SETUP_2FA_PATH } from "@/routes/account/constants";

const { navigateMock, pathnameRef, searchRef } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  pathnameRef: { current: "/home" },
  searchRef: { current: {} as Record<string, unknown> },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: pathnameRef.current, search: searchRef.current } }),
}));

// S20-TASK-DRAWER-1 — drawer việc toàn cục (nạp lười). Thân drawer có spec riêng (TaskDetailDrawer.spec);
// ở đây chỉ khoá: shell mount nó ĐÚNG MỘT lần khi URL có `?task=`, và không nạp gì khi không có.
vi.mock("@/routes/tasks/TaskDetailDrawer", () => ({
  GlobalTaskDrawer: () => <div data-testid="global-task-drawer" />,
}));

// Chrome nặng — không thuộc phạm vi guard.
vi.mock("../topbar/GlobalTopbar", () => ({ GlobalTopbar: () => <div data-testid="topbar" /> }));
vi.mock("../home/AppSwitcher", () => ({ AppSwitcher: () => null }));
vi.mock("@/hooks/use-current-route-meta", () => ({ useCurrentRouteMeta: () => undefined }));

// S7-CHAT-FE-1: cô lập hạ tầng realtime khỏi spec guard (hành vi của hook có spec riêng —
// `use-chat-realtime.spec.tsx`), ĐỒNG THỜI làm điểm neo cho ca "shell có thật sự gọi hook" bên dưới.
const useChatRealtimeMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-chat-realtime", () => ({ useChatRealtime: useChatRealtimeMock }));

function setUser(mustSetupTwoFactor: boolean) {
  useAuthStore.setState({
    isAuthenticated: true,
    mustSetupTwoFactor,
    user: { id: "u1", email: "a@demo.local", fullName: "A", status: "Active", companyId: "co1" },
  });
}

function renderShell(pathname: string) {
  pathnameRef.current = pathname;
  // S5-BRAND-FE-2: shell nay dùng useBrandingQuery (favicon động) ⇒ cần QueryClientProvider.
  // retry:false + client MỚI mỗi lần render để test không dính cache/lỗi mạng chéo nhau.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProtectedShell>
        <div data-testid="protected-content" />
      </ProtectedShell>
    </QueryClientProvider>,
  );
}

describe("ProtectedShell — guard ép enroll 2FA (AUTH-003)", () => {
  beforeEach(() => {
    pathnameRef.current = "/home";
    searchRef.current = {};
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

describe("ProtectedShell — nối hạ tầng realtime CHAT (S7-CHAT-FE-1)", () => {
  // Ca này bắt đúng một lớp hỏng: hook realtime được viết, có test riêng xanh, nhưng KHÔNG AI GẮN nó vào
  // shell. Mọi thứ xanh, chat im lặng không bao giờ nhận tin, và không có test nào nói ra
  // (memory `ui-promises-backend-never-reads` — kiểm CẢ HAI đầu luồng).
  beforeEach(() => {
    pathnameRef.current = "/home";
    useChatRealtimeMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    useAuthStore.setState({ isAuthenticated: false, user: null, mustSetupTwoFactor: false });
  });

  it("shell mount → gọi useChatRealtime ĐÚNG 1 lần (một kết nối, không nhân theo route con)", () => {
    setUser(false);
    renderShell("/home");
    expect(useChatRealtimeMock).toHaveBeenCalledTimes(1);
  });

  it("gọi cả khi đang bị ép enroll 2FA — panel chat của FE-3 nằm ở shell, không nằm trong nhánh nội dung", () => {
    setUser(true);
    renderShell("/home");
    expect(useChatRealtimeMock).toHaveBeenCalledTimes(1);
  });
});

describe("ProtectedShell — hệ thông báo nổi dùng chung (S20-FE-TOAST-1)", () => {
  // Lớp hỏng mà ca này bắt: `showApiErrorToast` có từ lâu nhưng KHÔNG ai gắn đích hiển thị ⇒ lỗi ghi
  // chỉ rơi vào console, người dùng thấy im lặng. Đầu luồng = configureToast (main.tsx làm y hệt dòng
  // dưới), cuối luồng = Toaster mount ở shell — ca chỉ xanh khi CẢ HAI đầu nối với nhau.
  beforeEach(() => {
    pathnameRef.current = "/home";
    configureToast(toast);
  });
  afterEach(() => {
    act(() => toast.clear());
    cleanup();
    configureToast(null);
    useAuthStore.setState({ isAuthenticated: false, user: null, mustSetupTwoFactor: false });
  });

  it("showApiErrorToast ở màn bất kỳ ⇒ thông báo lỗi hiện trong vùng assertive, không chỉ log console", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setUser(false);
    renderShell("/home");

    act(() =>
      showApiErrorToast(new ApiError({ message: "Máy chủ đang bận", kind: "SERVER", status: 500 })),
    );

    const region = screen.getByRole("region", { name: "Thông báo" });
    expect(within(region).getByRole("alert")).toHaveTextContent("Máy chủ đang bận");
    expect(consoleError).not.toHaveBeenCalledWith("[api]", "Máy chủ đang bận");
    consoleError.mockRestore();
  });

  it("Toaster mount ĐÚNG một lần ở shell", () => {
    setUser(false);
    renderShell("/home");

    expect(document.querySelectorAll('[data-slot="toaster"]')).toHaveLength(1);
  });
});

describe("ProtectedShell — drawer việc toàn cục (S20-TASK-DRAWER-1)", () => {
  afterEach(() => {
    cleanup();
    searchRef.current = {};
    useAuthStore.setState({ isAuthenticated: false, user: null, mustSetupTwoFactor: false });
  });

  it("URL có ?task= ⇒ mount drawer việc ĐÚNG một lần, ở mọi route (kể cả /goals/G)", async () => {
    setUser(false);
    searchRef.current = { task: "0b9f6a4e-2c1d-4e8f-9a7b-3c5d6e7f8a9b" };
    renderShell("/goals/g-1");

    expect(await screen.findByTestId("global-task-drawer")).toBeInTheDocument();
    expect(screen.getAllByTestId("global-task-drawer")).toHaveLength(1);
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });

  it("không có ?task= ⇒ không mount drawer việc", async () => {
    setUser(false);
    renderShell("/tasks");

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("global-task-drawer")).not.toBeInTheDocument();
  });
});
