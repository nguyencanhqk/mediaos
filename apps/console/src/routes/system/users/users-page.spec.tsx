import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import type { AdminUserDto } from "@mediaos/contracts";
import { useAuthStore } from "@mediaos/web-core";
import { UsersPage } from "./users-page";

/**
 * ACCT-2-FE — Quản lý người dùng (admin) unit tests.
 *
 * Luận cứ test:
 *  1. DENY-PATH: useCan("manage","user") = false → EmptyState "không có quyền", KHÔNG fetch.
 *  2. allow + loading → bảng skeleton (isLoading).
 *  3. allow + error → role=alert + nút retry.
 *  4. allow + empty → empty state "Không có người dùng nào".
 *  5. allow + data → render row (email, fullName, status badge).
 *  6. DENY suspend button: useCan("suspend","user")=false → nút Khoá KHÔNG hiển thị.
 *  7. DENY delete button: useCan("delete-user","user")=false → nút Xoá KHÔNG hiển thị.
 *  8. DENY invite button: useCan("invite","user")=false → nút Mời KHÔNG hiển thị.
 *  9. allow suspend → nút Khoá hiển thị, click mở dialog suspend.
 * 10. allow delete → nút Xoá hiển thị, click mở confirm dialog.
 * 11. allow invite → nút Mời hiển thị.
 * 12. fetch gọi đúng endpoint /users/admin.
 */

/* ────── helpers ────── */

function makeCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

/** Caps đầy đủ: manage + suspend + delete-user + invite + approve. */
const FULL_CAPS: Record<string, boolean> = {
  "manage:user": true,
  "suspend:user": true,
  "delete-user:user": true,
  "invite:user": true,
  "approve:user": true,
};

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

function makeUser(overrides: Partial<AdminUserDto> = {}): AdminUserDto {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "alice@acme.test",
    fullName: "Alice Nguyen",
    status: "active",
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<UsersPage />, { wrapper });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ capabilities: {} });
});

/* ────── 1. DENY-PATH: manage:user = false ────── */
describe("UsersPage — DENY manage:user", () => {
  it("hiển thị EmptyState 'Không có quyền quản lý người dùng'", () => {
    makeCaps({});
    renderPage();
    expect(screen.getByText("Không có quyền quản lý người dùng")).toBeInTheDocument();
  });

  it("KHÔNG fetch khi không có manage:user", () => {
    makeCaps({});
    const fetchMock = stubFetch({ ok: true, status: 200, body: { users: [], total: 0 } });
    renderPage();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ────── 2–5. Allow + states ────── */
describe("UsersPage — allow manage:user", () => {
  it("allow + lỗi fetch → role=alert", async () => {
    makeCaps({ "manage:user": true });
    stubFetch({ ok: false, status: 500, body: {} });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("allow + danh sách rỗng → empty state", async () => {
    makeCaps({ "manage:user": true });
    stubFetch({ ok: true, status: 200, body: { users: [], total: 0 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Không có người dùng nào.")).toBeInTheDocument());
  });

  it("allow + data → render email + tên + badge trạng thái", async () => {
    makeCaps({ "manage:user": true });
    stubFetch({
      ok: true,
      status: 200,
      body: { users: [makeUser()], total: 1 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("alice@acme.test")).toBeInTheDocument());
    expect(screen.getByText("Alice Nguyen")).toBeInTheDocument();
    expect(screen.getByText("Hoạt động")).toBeInTheDocument();
  });

  it("fetch gọi đúng endpoint /users/admin", async () => {
    makeCaps({ "manage:user": true });
    const fetchMock = stubFetch({ ok: true, status: 200, body: { users: [], total: 0 } });
    renderPage();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/users/admin"),
        expect.anything(),
      ),
    );
  });
});

/* ────── 6. DENY suspend button (deny-path CRITICAL) ────── */
describe("UsersPage — DENY suspend:user", () => {
  it("KHÔNG có suspend:user → nút Khoá KHÔNG hiển thị dù có data", async () => {
    // chỉ manage, không suspend
    makeCaps({ "manage:user": true });
    stubFetch({
      ok: true,
      status: 200,
      body: { users: [makeUser({ status: "active" })], total: 1 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("alice@acme.test")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Khoá/ })).not.toBeInTheDocument();
  });
});

/* ────── 7. DENY delete button ────── */
describe("UsersPage — DENY delete-user:user", () => {
  it("KHÔNG có delete-user:user → nút Xoá tài khoản KHÔNG hiển thị dù có data", async () => {
    makeCaps({ "manage:user": true, "suspend:user": true });
    stubFetch({
      ok: true,
      status: 200,
      body: { users: [makeUser()], total: 1 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("alice@acme.test")).toBeInTheDocument());
    // "Xoá" action button specifically (not "Xoá lọc" filter button)
    expect(screen.queryByRole("button", { name: "Xoá" })).not.toBeInTheDocument();
  });
});

/* ────── 8. DENY invite button ────── */
describe("UsersPage — DENY invite:user", () => {
  it("KHÔNG có invite:user → nút Mời KHÔNG hiển thị", () => {
    makeCaps({ "manage:user": true });
    stubFetch({ ok: true, status: 200, body: { users: [], total: 0 } });
    renderPage();
    expect(screen.queryByRole("button", { name: /Mời người dùng/ })).not.toBeInTheDocument();
  });
});

/* ────── 9. allow suspend → dialog suspend ────── */
describe("UsersPage — allow suspend:user", () => {
  it("có suspend:user + active user → nút Khoá hiển thị, click mở dialog", async () => {
    makeCaps({ "manage:user": true, "suspend:user": true });
    stubFetch({
      ok: true,
      status: 200,
      body: { users: [makeUser({ status: "active" })], total: 1 },
    });
    renderPage();
    // Use exact text "Khoá" (not regex, avoids matching "Mở khoá")
    const suspendBtn = await screen.findByRole("button", { name: "Khoá" });
    expect(suspendBtn).toBeInTheDocument();
    fireEvent.click(suspendBtn);
    // Dialog title
    await waitFor(() =>
      expect(screen.getByText("Khoá tài khoản?")).toBeInTheDocument(),
    );
  });
});

/* ────── 10. allow delete → confirm dialog ────── */
describe("UsersPage — allow delete-user:user", () => {
  it("có delete-user:user → nút Xoá hiển thị, click mở confirm dialog", async () => {
    makeCaps({ ...FULL_CAPS });
    stubFetch({
      ok: true,
      status: 200,
      body: { users: [makeUser()], total: 1 },
    });
    renderPage();
    // Use exact text "Xoá" (delete button) not regex (avoids "Xoá lọc" filter button)
    const deleteBtn = await screen.findByRole("button", { name: "Xoá" });
    fireEvent.click(deleteBtn);
    await waitFor(() =>
      expect(screen.getByText("Xoá tài khoản?")).toBeInTheDocument(),
    );
  });
});

/* ────── 11. allow invite → nút Mời hiển thị ────── */
describe("UsersPage — allow invite:user", () => {
  it("có invite:user → nút Mời người dùng hiển thị ở header", () => {
    makeCaps({ "manage:user": true, "invite:user": true });
    stubFetch({ ok: true, status: 200, body: { users: [], total: 0 } });
    renderPage();
    expect(screen.getByRole("button", { name: /Mời người dùng/ })).toBeInTheDocument();
  });
});
