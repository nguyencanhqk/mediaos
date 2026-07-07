/**
 * CloneRoleDialog — S2-AUTH-PERMUX-1 (#3).
 * Flow: createRole → getRolePermissions(source) → assignPermission tuần tự cho grant ALLOW ≤ Company;
 * SKIP có báo: DENY + System-scope. Lỗi 1 dòng không chặn các dòng sau.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { roleAdminApi } from "@mediaos/web-core";
import { CloneRoleDialog } from "./CloneRoleDialog";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    roleAdminApi: {
      ...actual.roleAdminApi,
      createRole: vi.fn(),
      getRolePermissions: vi.fn(),
      assignPermission: vi.fn(),
    },
  };
});

const GRANTS = {
  grants: [
    { action: "view", resourceType: "employee", effect: "ALLOW" as const, dataScope: "Company", isSensitive: false },
    { action: "update", resourceType: "employee", effect: "ALLOW" as const, dataScope: "Own", isSensitive: false },
    { action: "export", resourceType: "leave", effect: "DENY" as const, dataScope: "Company", isSensitive: true },
    { action: "run", resourceType: "foundation-seed", effect: "ALLOW" as const, dataScope: "System", isSensitive: true },
  ],
};

describe("CloneRoleDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(roleAdminApi.createRole).mockResolvedValue({
      id: "new-role-1",
      companyId: "co1",
      name: "Bản sao",
      description: null,
      isSystem: false,
      requiresTwoFactor: false,
    });
    vi.mocked(roleAdminApi.getRolePermissions).mockResolvedValue(GRANTS);
    vi.mocked(roleAdminApi.assignPermission).mockResolvedValue({
      roleId: "new-role-1",
      permissionId: "p",
      action: "view",
      resourceType: "employee",
      effect: "ALLOW",
      dataScope: "Company",
    });
  });

  it("tạo role mới + copy ĐÚNG grants ALLOW ≤ Company; SKIP DENY + System-scope; mở role mới", async () => {
    const onCloned = vi.fn();
    render(
      <CloneRoleDialog
        open
        onClose={() => {}}
        sourceRoleId="src-1"
        sourceRoleName="Kế toán"
        onCloned={onCloned}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/tên vai trò mới/i), {
      target: { value: "Kế toán 2" },
    });
    fireEvent.click(screen.getByText("Tạo + sao chép quyền"));

    await waitFor(() => {
      expect(roleAdminApi.createRole).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Kế toán 2" }),
      );
    });
    await waitFor(() => {
      // CHỈ 2 grant ALLOW ≤ Company được copy — DENY + System-scope bị skip.
      expect(roleAdminApi.assignPermission).toHaveBeenCalledTimes(2);
    });
    expect(roleAdminApi.assignPermission).toHaveBeenCalledWith("new-role-1", {
      action: "view",
      resourceType: "employee",
      dataScope: "Company",
    });
    expect(roleAdminApi.assignPermission).toHaveBeenCalledWith("new-role-1", {
      action: "update",
      resourceType: "employee",
      dataScope: "Own",
    });

    // Skip lines hiển thị rõ lý do.
    expect(await screen.findByText(/quyền DENY — không sao chép/)).toBeInTheDocument();
    expect(screen.getByText(/vượt trần gán qua API/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Mở vai trò mới"));
    expect(onCloned).toHaveBeenCalledWith("new-role-1");
  });

  it("lỗi 1 dòng assign KHÔNG chặn dòng sau — báo lỗi từng dòng", async () => {
    vi.mocked(roleAdminApi.assignPermission)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        roleId: "new-role-1",
        permissionId: "p",
        action: "update",
        resourceType: "employee",
        effect: "ALLOW",
        dataScope: "Own",
      });
    render(
      <CloneRoleDialog
        open
        onClose={() => {}}
        sourceRoleId="src-1"
        sourceRoleName="Kế toán"
        onCloned={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/tên vai trò mới/i), {
      target: { value: "Kế toán 3" },
    });
    fireEvent.click(screen.getByText("Tạo + sao chép quyền"));

    await waitFor(() => expect(roleAdminApi.assignPermission).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/✗/)).toBeInTheDocument();
    expect(screen.getByText(/✓/)).toBeInTheDocument();
  });
});
