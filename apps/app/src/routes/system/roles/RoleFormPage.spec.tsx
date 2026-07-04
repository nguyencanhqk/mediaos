/**
 * RoleFormPage — S2-FE-AUTH-4 (lane FE batch C).
 * Create gate: create:role. Edit gate: update:role. System role (isSystem=true) → toàn bộ field +
 * submit DISABLED (defense-in-depth; server cũng REJECT 400) + banner cảnh báo.
 * States: forbidden · loading (edit) · error/not-found (edit) · form (create/edit).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, roleAdminApi } from "@mediaos/web-core";
import { RoleFormPage } from "./RoleFormPage";

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

vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

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

const ROLES = [
  { id: "role-1", name: "Kế toán", description: "Vai trò kế toán", isSystem: false },
  { id: "role-sys", name: "Super Admin", description: null, isSystem: true },
];

describe("RoleFormPage — create mode", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
  });

  it("shows forbidden when user lacks create:role", () => {
    setCaps({});
    renderWithQuery(<RoleFormPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
  });

  it("submits create form with correct payload", async () => {
    setCaps({ "create:role": true });
    vi.mocked(roleAdminApi.createRole).mockResolvedValue({
      id: "role-new",
      companyId: "co1",
      name: "Kế toán",
      description: null,
      isSystem: false,
      requiresTwoFactor: false,
    });
    const onSuccess = vi.fn();
    const { container } = renderWithQuery(<RoleFormPage onSuccess={onSuccess} />);

    fireEvent.change(container.querySelector("#name") as HTMLInputElement, {
      target: { value: "Kế toán" },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(roleAdminApi.createRole).toHaveBeenCalledWith({
        name: "Kế toán",
        description: null,
        requiresTwoFactor: false,
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("role-new"));
  });

  // ── S2-FE-SYS-SEC-1: switch requiresTwoFactor → create payload chứa requiresTwoFactor:true ──
  it("includes requiresTwoFactor in create payload when switch is toggled on", async () => {
    setCaps({ "create:role": true });
    vi.mocked(roleAdminApi.createRole).mockResolvedValue({
      id: "role-new",
      companyId: "co1",
      name: "Bảo mật",
      description: null,
      isSystem: false,
      requiresTwoFactor: true,
    });
    const { container } = renderWithQuery(<RoleFormPage />);

    fireEvent.change(container.querySelector("#name") as HTMLInputElement, {
      target: { value: "Bảo mật" },
    });
    fireEvent.click(container.querySelector("#requiresTwoFactor") as HTMLInputElement);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(roleAdminApi.createRole).toHaveBeenCalledWith({
        name: "Bảo mật",
        description: null,
        requiresTwoFactor: true,
      }),
    );
  });
});

describe("RoleFormPage — edit mode", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(roleAdminApi.listRoles).mockResolvedValue(ROLES);
  });

  it("shows forbidden when user lacks update:role", () => {
    setCaps({});
    renderWithQuery(<RoleFormPage roleId="role-1" />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
  });

  it("shows loading while fetching role catalog", () => {
    setCaps({ "update:role": true });
    vi.mocked(roleAdminApi.listRoles).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<RoleFormPage roleId="role-1" />);
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows not-found error when role id does not exist in catalog", async () => {
    setCaps({ "update:role": true });
    renderWithQuery(<RoleFormPage roleId="unknown-id" />);
    await waitFor(() => expect(screen.getByText(/không tìm thấy vai trò/i)).toBeInTheDocument());
  });

  it("prefills form + submits PATCH with dirty fields only", async () => {
    setCaps({ "update:role": true });
    vi.mocked(roleAdminApi.updateRole).mockResolvedValue({
      id: "role-1",
      companyId: "co1",
      name: "Kế toán trưởng",
      description: "Vai trò kế toán",
      isSystem: false,
      requiresTwoFactor: false,
    });
    const onSuccess = vi.fn();
    const { container } = renderWithQuery(<RoleFormPage roleId="role-1" onSuccess={onSuccess} />);

    await waitFor(() =>
      expect((container.querySelector("#name") as HTMLInputElement).value).toBe("Kế toán"),
    );

    fireEvent.change(container.querySelector("#name") as HTMLInputElement, {
      target: { value: "Kế toán trưởng" },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(roleAdminApi.updateRole).toHaveBeenCalledWith("role-1", { name: "Kế toán trưởng" }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("role-1"));
  });

  it("disables all fields + submit + shows banner for system role", async () => {
    setCaps({ "update:role": true });
    const { container } = renderWithQuery(<RoleFormPage roleId="role-sys" />);

    await waitFor(() => expect(screen.getByText(/vai trò hệ thống/i)).toBeInTheDocument());
    expect(container.querySelector("#name")).toBeDisabled();
    expect(container.querySelector("#description")).toBeDisabled();
    // S2-FE-SYS-SEC-1: switch requiresTwoFactor cũng DISABLED cho role hệ thống.
    expect(container.querySelector("#requiresTwoFactor")).toBeDisabled();
    expect(screen.getByRole("button", { name: /lưu thay đổi/i })).toBeDisabled();
  });

  // ── S2-FE-SYS-SEC-1: edit → PATCH chứa requiresTwoFactor CHỈ khi dirty (toggle) ──────────
  it("includes requiresTwoFactor in PATCH only when the switch is changed", async () => {
    setCaps({ "update:role": true });
    vi.mocked(roleAdminApi.updateRole).mockResolvedValue({
      id: "role-1",
      companyId: "co1",
      name: "Kế toán",
      description: "Vai trò kế toán",
      isSystem: false,
      requiresTwoFactor: true,
    });
    const { container } = renderWithQuery(<RoleFormPage roleId="role-1" />);

    await waitFor(() =>
      expect((container.querySelector("#name") as HTMLInputElement).value).toBe("Kế toán"),
    );

    // Chỉ đổi switch (name/description KHÔNG dirty) → patch chỉ chứa requiresTwoFactor.
    fireEvent.click(container.querySelector("#requiresTwoFactor") as HTMLInputElement);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(roleAdminApi.updateRole).toHaveBeenCalledWith("role-1", { requiresTwoFactor: true }),
    );
  });
});
