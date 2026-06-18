import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { UsagePage } from "./index";
import { useAuthStore } from "@mediaos/web-core";

/**
 * CS-7 UsagePage unit tests.
 *
 * Kiểm tra:
 * 1. Deny without view:usage → noPermission EmptyState.
 * 2. Allow + empty users → EmptyState chưa có dữ liệu.
 * 3. Allow + data → StatCards + user table rows.
 * 4. Allow + fetch error → alert.
 * 5. Fetch calls correct endpoint /tenant/usage.
 */

function stubFetch(res: { ok: boolean; status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => JSON.stringify(res.body ?? ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<UsagePage />, { wrapper });
}

const makeUsageBody = (overrides?: Partial<{
  loginCount: number;
  activeUserCount: number;
  tasksCreated: number;
  tasksCompleted: number;
  users: unknown[];
}>) => ({
  loginCount: overrides?.loginCount ?? 0,
  activeUserCount: overrides?.activeUserCount ?? 0,
  tasksCreated: overrides?.tasksCreated ?? 0,
  tasksCompleted: overrides?.tasksCompleted ?? 0,
  users: overrides?.users ?? [],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ capabilities: {} });
});

describe("CS-7 UsagePage (PermissionGate view:usage)", () => {
  it("KHÔNG có view:usage → EmptyState 'Không có quyền'", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
  });

  it("KHÔNG có view:usage → KHÔNG fetch API", () => {
    setCaps({});
    const fetchMock = stubFetch({ ok: true, status: 200 });
    renderPage();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("có view:usage + empty users → EmptyState chưa có dữ liệu", async () => {
    setCaps({ "view:usage": true });
    stubFetch({ ok: true, status: 200, body: makeUsageBody() });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Chưa có dữ liệu")).toBeInTheDocument(),
    );
  });

  it("có view:usage + lỗi fetch → role=alert", async () => {
    setCaps({ "view:usage": true });
    stubFetch({ ok: false, status: 500, body: {} });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("có view:usage → fetch gọi đúng endpoint /tenant/usage", async () => {
    setCaps({ "view:usage": true });
    const fetchMock = stubFetch({ ok: true, status: 200, body: makeUsageBody() });
    renderPage();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/tenant/usage"),
        expect.anything(),
      ),
    );
  });

  it("có view:usage + data → hiển thị StatCards (lượt đăng nhập, người dùng)", async () => {
    setCaps({ "view:usage": true });
    stubFetch({
      ok: true,
      status: 200,
      body: makeUsageBody({
        loginCount: 42,
        activeUserCount: 7,
        tasksCreated: 15,
        tasksCompleted: 8,
        users: [],
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Lượt đăng nhập")).toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });

  it("hiển thị người dùng trong bảng", async () => {
    setCaps({ "view:usage": true });
    stubFetch({
      ok: true,
      status: 200,
      body: makeUsageBody({
        users: [
          {
            userId: "11111111-1111-1111-1111-111111111111",
            fullName: "Nguyễn Văn A",
            email: "a@test.com",
            departmentName: "IT",
            lastLoginAt: "2026-06-18T08:00:00.000Z",
          },
        ],
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument();
      expect(screen.getByText("a@test.com")).toBeInTheDocument();
    });
  });

  it("hiển thị nút 'Xuất khẩu CSV'", async () => {
    setCaps({ "view:usage": true });
    stubFetch({ ok: true, status: 200, body: makeUsageBody() });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Xuất khẩu CSV")).toBeInTheDocument();
    });
  });
});
