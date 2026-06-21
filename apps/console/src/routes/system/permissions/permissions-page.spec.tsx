import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { PermissionsPage } from "./permissions-page";
import { useAuthStore } from "@mediaos/web-core";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const ROLE_ID = "11111111-1111-4111-8111-111111111111";

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps, accessToken: "tok", isAuthenticated: true });
}

const okEnvelope = (data: unknown) => ({ success: true, data, error: null });

/** Định tuyến fetch theo path → trả roles/employees (envelope như web-core apiFetch kỳ vọng). */
function stubFetchByPath() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const body = url.includes("/org/roles")
      ? okEnvelope([{ id: ROLE_ID, name: "Quản trị" }])
      : okEnvelope([
          { id: USER_ID, email: "ann@x.test", fullName: "Ann", status: "active", teams: [] },
        ]);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<PermissionsPage />, { wrapper });
}

beforeEach(() => {
  stubFetchByPath();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ capabilities: {}, accessToken: null, isAuthenticated: false });
});

// ────────────────────────────────────────────────────────────────
// DENY-PATH: không có quyền nào
// ────────────────────────────────────────────────────────────────
describe("CS-2 PermissionsPage — gating (deny-path)", () => {
  it("hiển thị 'không có quyền' khi thiếu cả hai quyền", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Phân quyền" })).not.toBeInTheDocument();
  });

  it("không hiện bất kỳ nút hành động nào khi không có quyền", () => {
    setCaps({});
    renderPage();
    expect(screen.queryByRole("button", { name: "Gán vai trò" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thu vai trò" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quyền theo đối tượng" })).not.toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────
// QuyỀN assign-role:user
// ────────────────────────────────────────────────────────────────
describe("CS-2 PermissionsPage — với quyền assign-role:user", () => {
  beforeEach(() => setCaps({ "assign-role:user": true }));

  it("render tiêu đề + bảng vai trò và người dùng", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Phân quyền" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Quản trị")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("ann@x.test")).toBeInTheDocument());
  });

  it("hiện nút gán/thu role, ẩn nút quyền-đối-tượng (thiếu grant-object-permission)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("ann@x.test")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Gán vai trò" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thu vai trò" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quyền theo đối tượng" })).not.toBeInTheDocument();
  });

  it("gọi đúng endpoint /org/roles và /org/employees", async () => {
    const fetchMock = stubFetchByPath();
    setCaps({ "assign-role:user": true });
    renderPage();
    await waitFor(() => expect(screen.getByText("ann@x.test")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/org/roles"),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/org/employees"),
      expect.anything(),
    );
  });

  it("lọc user qua ô tìm kiếm — nhập email hiện đúng user, nhập rác ẩn hết", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("ann@x.test")).toBeInTheDocument());

    const searchInput = screen.getByRole("searchbox", { name: "Tìm kiếm người dùng" });

    // Lọc đúng email
    fireEvent.change(searchInput, { target: { value: "ann" } });
    await waitFor(() => expect(screen.getByText("ann@x.test")).toBeInTheDocument());

    // Lọc không khớp → empty state
    fireEvent.change(searchInput, { target: { value: "zzz-no-match" } });
    await waitFor(() =>
      expect(screen.getByText("Không tìm thấy người dùng.")).toBeInTheDocument(),
    );
  });
});

// ────────────────────────────────────────────────────────────────
// QUYỀN grant-object-permission:permission
// ────────────────────────────────────────────────────────────────
describe("CS-2 PermissionsPage — với quyền grant-object-permission:permission", () => {
  beforeEach(() => setCaps({ "grant-object-permission:permission": true }));

  it("hiện nút quyền-đối-tượng, ẩn bảng vai trò + nút role", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("ann@x.test")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Quyền theo đối tượng" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gán vai trò" })).not.toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────
// CẢ HAI QUYỀN
// ────────────────────────────────────────────────────────────────
describe("CS-2 PermissionsPage — với cả hai quyền", () => {
  beforeEach(() =>
    setCaps({ "assign-role:user": true, "grant-object-permission:permission": true }),
  );

  it("hiện cả 3 nút hành động cho user", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("ann@x.test")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Gán vai trò" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thu vai trò" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quyền theo đối tượng" })).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────
// LỖI TẢI
// ────────────────────────────────────────────────────────────────
describe("CS-2 PermissionsPage — lỗi tải", () => {
  it("hiển thị thông báo lỗi role=alert khi fetch thất bại", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () =>
          JSON.stringify({ success: false, data: null, error: { code: "ERR", message: "boom" } }),
        json: async () => ({
          success: false,
          data: null,
          error: { code: "ERR", message: "boom" },
        }),
      }),
    );
    setCaps({ "assign-role:user": true });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Không tải được dữ liệu phân quyền.")).toBeInTheDocument(),
    );
  });

  it("hiển thị nút thử lại trong alert lỗi", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () =>
          JSON.stringify({ success: false, data: null, error: { code: "ERR", message: "boom" } }),
        json: async () => ({
          success: false,
          data: null,
          error: { code: "ERR", message: "boom" },
        }),
      }),
    );
    setCaps({ "assign-role:user": true });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // Nút thử lại hiện trong alert
    expect(screen.getByRole("button", { name: /thử lại/i })).toBeInTheDocument();
  });
});
