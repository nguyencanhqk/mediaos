/**
 * PermissionsPage — S2-FE-AUTH-4 (lane FE batch C). Catalog quyền, chỉ đọc.
 * Gate: view:permission. States: forbidden · loading · error · empty · list + search filter.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, roleAdminApi } from "@mediaos/web-core";
import { PermissionsPage } from "./PermissionsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    roleAdminApi: {
      listRoles: vi.fn(),
      listPermissions: vi.fn(),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      assignPermission: vi.fn(),
      revokePermission: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const PERMISSIONS = [
  { id: "p1", action: "view", resourceType: "department", isSensitive: false },
  { id: "p2", action: "assign", resourceType: "permission", isSensitive: true },
];

describe("PermissionsPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(roleAdminApi.listPermissions).mockResolvedValue(PERMISSIONS);
  });

  it("shows forbidden when user lacks view:permission", () => {
    setCaps({});
    renderWithQuery(<PermissionsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(roleAdminApi.listPermissions).not.toHaveBeenCalled();
  });

  it("renders permission catalog with sensitive badge", async () => {
    setCaps({ "view:permission": true });
    renderWithQuery(<PermissionsPage />);
    await waitFor(() => expect(screen.getByText("department")).toBeInTheDocument());
    expect(screen.getByText("permission")).toBeInTheDocument();
    expect(screen.getAllByText("Nhạy cảm").length).toBeGreaterThan(0);
  });

  it("shows loading skeleton", () => {
    setCaps({ "view:permission": true });
    vi.mocked(roleAdminApi.listPermissions).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<PermissionsPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    setCaps({ "view:permission": true });
    vi.mocked(roleAdminApi.listPermissions).mockRejectedValue(new Error("net"));
    renderWithQuery(<PermissionsPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh mục quyền/i)).toBeInTheDocument(),
    );
  });

  it("shows empty state when catalog is empty", async () => {
    setCaps({ "view:permission": true });
    vi.mocked(roleAdminApi.listPermissions).mockResolvedValue([]);
    renderWithQuery(<PermissionsPage />);
    await waitFor(() => expect(screen.getByText(/không có quyền/i)).toBeInTheDocument());
  });

  it("filters rows via the search input (global filter)", async () => {
    setCaps({ "view:permission": true });
    renderWithQuery(<PermissionsPage />);
    await waitFor(() => expect(screen.getByText("department")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/tìm theo action\/resource/i), {
      target: { value: "assign" },
    });

    expect(screen.queryByText("department")).not.toBeInTheDocument();
    expect(screen.getByText("permission")).toBeInTheDocument();
  });
});
