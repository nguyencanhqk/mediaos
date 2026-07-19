/**
 * ModuleSidebar — S5-TASK-NAV-TREE-1 (đợt B): dựng CÂY ĐỆ QUY từ SidebarItemMeta.children.
 *
 * Phủ done_when:
 *  - Cây sâu 3 cấp render đủ label (không vỡ).
 *  - Gập/mở từng nhánh (aria-expanded), GIỮ trạng thái qua localStorage (remount vẫn gập).
 *  - Icon-mode (collapsed): chỉ cấp 1 — nhánh con không render.
 *
 * Registry + extension mock tại chỗ — spec này kiểm CƠ CHẾ render đệ quy, không kiểm data TASK
 * (cây phòng ban động có spec riêng TaskSidebarTree.spec.tsx).
 */
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPermissionChecker,
  type SessionContext,
  type UserPermission,
} from "@mediaos/web-core";
import { ModuleSidebar } from "./ModuleSidebar";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: "/tasks" } }),
  };
});

// vi.mock bị hoist lên đầu file → data cho factory phải khai qua vi.hoisted.
const { NESTED_ITEMS } = vi.hoisted(() => {
  const NESTED_ITEMS = [
    {
      sidebarKey: "task.lv1",
      moduleCode: "TASK",
      label: "Cấp 1",
      path: "/tasks",
      icon: "kanban-square",
      group: "operation",
      order: 10,
      requiredAnyPermissions: ["TASK.TASK.VIEW"],
      children: [
        {
          sidebarKey: "task.lv2",
          moduleCode: "TASK",
          label: "Cấp 2",
          path: "/tasks/lv2",
          order: 10,
          requiredAnyPermissions: ["TASK.TASK.VIEW"],
          children: [
            {
              sidebarKey: "task.lv3",
              moduleCode: "TASK",
              label: "Cấp 3",
              path: "/tasks/lv3",
              order: 10,
              requiredAnyPermissions: ["TASK.TASK.VIEW"],
            },
          ],
        },
      ],
    },
  ];
  return { NESTED_ITEMS };
});

vi.mock("./sidebar-registry", () => ({
  getSidebarItems: () => NESTED_ITEMS,
}));

vi.mock("./sidebar-extensions", () => ({
  getSidebarExtension: () => undefined,
}));

const session: SessionContext = {
  status: "authenticated",
  user: { id: "u1", email: "a@b.com", status: "Active", companyId: "c1" },
  company: { id: "c1", name: "Acme", status: "Active" },
  modules: [{ moduleCode: "TASK", status: "active" }],
};

function makePerms(permissions: string[]): UserPermission[] {
  return permissions.map((p) => ({ permission: p, scopes: [] as never }));
}

const permission = createPermissionChecker(makePerms(["TASK.TASK.VIEW"]));

function renderSidebar(collapsed = false) {
  return render(
    <ModuleSidebar
      moduleCode="TASK"
      session={session}
      permission={permission}
      collapsed={collapsed}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ModuleSidebar — cây đệ quy từ children", () => {
  it("render đủ 3 cấp lồng nhau (mặc định MỞ)", () => {
    renderSidebar();
    expect(screen.getByText("Cấp 1")).toBeInTheDocument();
    expect(screen.getByText("Cấp 2")).toBeInTheDocument();
    expect(screen.getByText("Cấp 3")).toBeInTheDocument();
  });

  it("gập nhánh cấp 1 → cấp 2/3 biến mất; mở lại → hiện lại", () => {
    renderSidebar();
    const toggle = screen.getByRole("button", { name: "Thu gọn Cấp 1" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(screen.queryByText("Cấp 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Cấp 3")).not.toBeInTheDocument();
    expect(screen.getByText("Cấp 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mở rộng Cấp 1" }));
    expect(screen.getByText("Cấp 2")).toBeInTheDocument();
  });

  it("GIỮ trạng thái gập qua remount (localStorage)", () => {
    const first = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn Cấp 2" }));
    expect(screen.queryByText("Cấp 3")).not.toBeInTheDocument();
    first.unmount();

    renderSidebar();
    expect(screen.getByText("Cấp 2")).toBeInTheDocument();
    expect(screen.queryByText("Cấp 3")).not.toBeInTheDocument();
  });

  it("icon-mode (collapsed): chỉ cấp 1, không render nhánh con", () => {
    renderSidebar(true);
    expect(screen.queryByText("Cấp 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Cấp 3")).not.toBeInTheDocument();
  });
});
