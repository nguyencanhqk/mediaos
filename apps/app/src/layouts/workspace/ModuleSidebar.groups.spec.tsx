/**
 * ModuleSidebar — NHÓM GẬP ĐƯỢC v1.1 (S15-UI-SHELL-1 · DEC-020 · UI-07 §9.2/§9.5).
 *
 * Spec RIÊNG file vì `ModuleSidebar.spec.tsx` khoá `useRouterState` ở `/tasks` bằng `vi.mock` cấp
 * module — ca ở đây cần đứng ở ĐƯỜNG DẪN KHÁC để đo luật «nhóm chứa mục đang xem thì luôn mở».
 *
 * Ba luật được neo:
 *  1. `defaultCollapsed: true` ⇒ gập SẴN lần đầu (không phải mở như mọi nhánh trước S15).
 *  2. Đứng TRONG nhóm ⇒ nhóm MỞ dù `defaultCollapsed`, và chevron bị vô hiệu (không để nút chết).
 *  3. `collapsible: false` ⇒ nhóm TĨNH: con luôn hiện, KHÔNG có chevron.
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

const { pathnameRef, ITEMS } = vi.hoisted(() => {
  const pathnameRef = { current: "/payroll/periods" };
  const ITEMS = [
    {
      sidebarKey: "payroll.calc",
      moduleCode: "PAYROLL",
      label: "Tính lương",
      group: "operation",
      order: 10,
      collapsible: true,
      defaultCollapsed: true,
      requiredAnyPermissions: ["PAYROLL.ACCESS"],
      children: [
        {
          sidebarKey: "payroll.periods",
          moduleCode: "PAYROLL",
          label: "Kỳ lương",
          path: "/payroll/periods",
          order: 11,
          requiredAnyPermissions: ["PAYROLL.ACCESS"],
        },
      ],
    },
    {
      sidebarKey: "payroll.components",
      moduleCode: "PAYROLL",
      label: "Thành phần lương",
      group: "master-data",
      order: 20,
      collapsible: false,
      requiredAnyPermissions: ["PAYROLL.ACCESS"],
      children: [
        {
          sidebarKey: "payroll.templates",
          moduleCode: "PAYROLL",
          label: "Mẫu bảng lương",
          path: "/payroll/templates",
          order: 21,
          requiredAnyPermissions: ["PAYROLL.ACCESS"],
        },
      ],
    },
  ];
  return { pathnameRef, ITEMS };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: pathnameRef.current } }),
  };
});

vi.mock("./sidebar-registry", () => ({ getSidebarItems: () => ITEMS }));
vi.mock("./sidebar-extensions", () => ({ getSidebarExtension: () => undefined }));

const session: SessionContext = {
  status: "authenticated",
  user: { id: "u1", email: "a@b.com", status: "Active", companyId: "c1" },
  company: { id: "c1", name: "Acme", status: "Active" },
  modules: [{ moduleCode: "PAYROLL", status: "active" }],
};

function makePerms(permissions: string[]): UserPermission[] {
  return permissions.map((p) => ({ permission: p, scopes: [] as never }));
}

const permission = createPermissionChecker(makePerms(["PAYROLL.ACCESS"]));

function renderSidebar() {
  return render(<ModuleSidebar moduleCode="PAYROLL" session={session} permission={permission} />);
}

beforeEach(() => {
  window.localStorage.clear();
  pathnameRef.current = "/payroll/reports"; // NGOÀI mọi nhóm, trừ khi ca tự đổi
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ModuleSidebar — nhóm gập được (v1.1)", () => {
  it("defaultCollapsed: true ⇒ gập SẴN lần đầu (mục con không render)", () => {
    renderSidebar();
    expect(screen.getByText("Tính lương")).toBeInTheDocument();
    expect(screen.queryByText("Kỳ lương")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mở rộng Tính lương" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("mở tay rồi remount ⇒ VẪN mở (trạng thái «khác mặc định» được lưu)", () => {
    const first = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Mở rộng Tính lương" }));
    expect(screen.getByText("Kỳ lương")).toBeInTheDocument();
    first.unmount();

    renderSidebar();
    expect(screen.getByText("Kỳ lương")).toBeInTheDocument();
  });

  it("đứng TRONG nhóm ⇒ nhóm MỞ dù defaultCollapsed, và chevron bị vô hiệu (không phải nút chết)", () => {
    pathnameRef.current = "/payroll/periods";
    renderSidebar();

    expect(screen.getByText("Kỳ lương")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Thu gọn Tính lương" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("title", "Nhóm đang chứa mục bạn xem");
  });

  it("đã gập TAY từ trước, nay điều hướng VÀO nhóm ⇒ vẫn MỞ (không giấu mất chỗ đang đứng)", () => {
    // Người dùng mở rồi gập lại nhóm ở màn khác ⇒ trạng thái lưu = «gập».
    const first = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Mở rộng Tính lương" }));
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn Tính lương" }));
    expect(screen.queryByText("Kỳ lương")).not.toBeInTheDocument();
    first.unmount();

    pathnameRef.current = "/payroll/periods";
    renderSidebar();
    expect(screen.getByText("Kỳ lương")).toBeInTheDocument();
  });

  it("collapsible: false ⇒ nhóm TĨNH: con luôn hiện, KHÔNG có chevron", () => {
    renderSidebar();
    expect(screen.getByText("Mẫu bảng lương")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thành phần lương/ })).not.toBeInTheDocument();
  });
});
