import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RbacPage } from "./rbac-page";
import { useAuthStore } from "@/stores/auth";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const ROLE_ID = "11111111-1111-4111-8111-111111111111";

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps, accessToken: "tok", isAuthenticated: true });
}

/** Định tuyến fetch theo path → trả roles/employees. */
function stubFetchByPath() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const body = url.includes("/org/roles")
      ? [{ id: ROLE_ID, name: "Quản trị" }]
      : [{ id: USER_ID, email: "ann@x.test", fullName: "Ann", status: "active", teams: [] }];
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
  return render(
    <QueryClientProvider client={queryClient}>
      <RbacPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  stubFetchByPath();
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe("RbacPage — gating (deny-path)", () => {
  it("hiển thị 'không có quyền' khi thiếu cả hai quyền", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
  });
});

describe("RbacPage — với quyền assign-role:user", () => {
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
});

describe("RbacPage — với quyền grant-object-permission:permission", () => {
  beforeEach(() => setCaps({ "grant-object-permission:permission": true }));

  it("hiện nút quyền-đối-tượng, ẩn bảng vai trò + nút role", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("ann@x.test")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Quyền theo đối tượng" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gán vai trò" })).not.toBeInTheDocument();
  });
});

describe("RbacPage — lỗi tải", () => {
  it("hiển thị thông báo lỗi role=alert khi fetch thất bại", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: { code: "ERR", message: "boom" } }),
        json: async () => ({}),
      }),
    );
    setCaps({ "assign-role:user": true });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Không tải được dữ liệu phân quyền.")).toBeInTheDocument(),
    );
  });
});
