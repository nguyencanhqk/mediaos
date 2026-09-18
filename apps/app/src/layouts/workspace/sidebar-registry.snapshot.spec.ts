// @vitest-environment node
/**
 * [S15-UI-SHELL-2] GHIM cây sidebar — hàng rào của việc TÁCH `sidebar-registry.ts` (1439 dòng) thành
 * các file theo module.
 *
 * Việc tách là thao tác thuần cơ học: **không** một mục, một thứ tự, một cặp quyền nào được đổi. Cái
 * duy nhất chứng minh được điều đó là một bản chụp sinh TRƯỚC khi tách và so lại SAU khi tách — nên
 * spec này chạy trên chính `SIDEBAR_REGISTRY` (đường dẫn import GIỮ NGUYÊN, barrel) và chốt:
 *
 * 1. `__snapshots__/sidebar-tree.raw.txt` — toàn bộ cây KHAI BÁO theo đúng thứ tự khai báo, kèm mọi
 *    trường quyết định hiển thị (path · icon · group · order · cặp quyền · badge · collapsible…).
 *    Thứ tự khoá của `SIDEBAR_REGISTRY` cũng bị ghim ở đây (mỗi module một khối `### <MODULE>`).
 * 2. `__snapshots__/sidebar-tree.by-permission.txt` — cây THẤY ĐƯỢC sau `filterSidebarItems` theo
 *    từng bộ quyền, tức là thứ người dùng thật nhìn thấy (đã lọc + đã sắp theo `order` + đã cắt hàng
 *    đại diện nhóm rỗng).
 *
 * Đổi sidebar có CHỦ Ý ⇒ chạy `pnpm --filter @mediaos/app test -u` rồi ĐỌC diff của hai file .txt:
 * diff đó chính là thay đổi điều hướng mà PR đang đề nghị.
 */
import { describe, expect, it } from "vitest";
import {
  createPermissionChecker,
  filterSidebarItems,
  type ModuleAccessItem,
  type ModuleCode,
  type SessionContext,
  type SidebarItemMeta,
  type UserPermission,
} from "@mediaos/web-core";
import { SIDEBAR_REGISTRY } from "./sidebar-registry";

const MODULES = Object.keys(SIDEBAR_REGISTRY) as ModuleCode[];

/** Mọi module «active» — spec này đo tầng quyền, không đo tầng bật/tắt module. */
const SESSION: SessionContext = {
  status: "authenticated",
  user: null,
  company: null,
  modules: MODULES.map((moduleCode): ModuleAccessItem => ({ moduleCode, status: "active" })),
};

function collectPermissions(items: readonly SidebarItemMeta[], out: Set<string>): void {
  for (const item of items) {
    for (const p of item.requiredPermissions ?? []) out.add(p);
    for (const p of item.requiredAnyPermissions ?? []) out.add(p);
    if (item.children) collectPermissions(item.children, out);
  }
}

/** Mọi cặp quyền xuất hiện trong registry — bộ «thấy hết», dùng để ghim cây đầy đủ. */
function allPermissionsInRegistry(): string[] {
  const acc = new Set<string>();
  for (const moduleCode of MODULES) collectPermissions(SIDEBAR_REGISTRY[moduleCode] ?? [], acc);
  return [...acc].sort();
}

function checkerFor(permissions: readonly string[]) {
  const granted: UserPermission[] = permissions.map((permission) => ({
    permission,
    scopes: ["Company"],
  }));
  return createPermissionChecker(granted);
}

function rawDump(items: readonly SidebarItemMeta[], depth = 0): string[] {
  return items.flatMap((item): string[] => {
    const fields = [
      `${"  ".repeat(depth)}${item.sidebarKey}`,
      `mod=${item.moduleCode}`,
      `label=${item.label}`,
      `path=${item.path ?? "-"}`,
      `icon=${item.icon ?? "-"}`,
      `group=${item.group ?? "-"}`,
      `order=${item.order}`,
    ];
    if (item.requiredPermissions?.length)
      fields.push(`all=[${item.requiredPermissions.join(",")}]`);
    if (item.requiredAnyPermissions?.length) {
      fields.push(`any=[${item.requiredAnyPermissions.join(",")}]`);
    }
    if (item.badgeKey) fields.push(`badge=${item.badgeKey}`);
    if (item.collapsible) fields.push("collapsible");
    if (item.defaultCollapsed) fields.push("defaultCollapsed");
    if (item.featureFlag) fields.push(`flag=${item.featureFlag}`);
    if (item.isDivider) fields.push("divider");
    return [fields.join(" | "), ...(item.children ? rawDump(item.children, depth + 1) : [])];
  });
}

function keyDump(items: readonly SidebarItemMeta[], depth = 0): string[] {
  return items.flatMap((item): string[] => [
    `${"  ".repeat(depth)}${item.sidebarKey}`,
    ...(item.children ? keyDump(item.children, depth + 1) : []),
  ]);
}

/**
 * Bộ quyền đo. `ALL` sinh từ chính registry (thấy hết); các bộ còn lại là lát cắt THẬT của người
 * dùng — cặp engine lấy y như registry khai, KHÔNG suy diễn role.
 */
const PERMISSION_SETS: Record<string, readonly string[]> = {
  ALL: allPermissionsInRegistry(),
  ME_ONLY: ["access:me"],
  EMPLOYEE: ["access:me", "access:goal", "TASK.TASK.VIEW", "DASH.DASHBOARD.VIEW"],
  HR_ISH: ["access:me", "HR.EMPLOYEE.VIEW", "read:department", "view:audit-log"],
  /**
   * PAYROLL là module DUY NHẤT có nhóm 2 cấp (`payroll.inputData` · `payroll.calculation`), nên đây là
   * chỗ duy nhất đo được hai nhánh khó của `filterSidebarItems`:
   * - nhóm GIỮ lại khi CHỈ MỘT SỐ con hiện (calculation: thấy «Kỳ lương» + «Ngân sách», ẩn «Tạm ứng»);
   * - hàng đại diện nhóm BIẾN MẤT khi mọi con đều ẩn dù bản thân nó qua gate `access:payroll`
   *   (inputData: chỉ có «Thưởng / phạt», thiếu `view:bonus-penalty` ⇒ cả nhóm không hiện).
   * Bộ ALL không đo được vế nào trong hai vế đó vì nó thấy hết.
   */
  PAYROLL_PARTIAL: ["access:payroll", "view:payroll-period", "view:payroll-budget"],
};

describe("[S15-UI-SHELL-2] snapshot cây sidebar", () => {
  it("cây khai báo (thứ tự + gate) không đổi", async () => {
    const lines = MODULES.flatMap((moduleCode) => [
      `### ${moduleCode}`,
      ...rawDump(SIDEBAR_REGISTRY[moduleCode] ?? []),
    ]);
    await expect(`${lines.join("\n")}\n`).toMatchFileSnapshot(
      "./__snapshots__/sidebar-tree.raw.txt",
    );
  });

  it("cây thấy được theo từng bộ quyền không đổi", async () => {
    const lines: string[] = [];
    for (const [name, permissions] of Object.entries(PERMISSION_SETS)) {
      const checker = checkerFor(permissions);
      lines.push(`## ${name}`);
      for (const moduleCode of MODULES) {
        const visible = filterSidebarItems(SIDEBAR_REGISTRY[moduleCode] ?? [], checker, SESSION);
        lines.push(`### ${moduleCode}`, ...(visible.length ? keyDump(visible) : ["(trống)"]));
      }
    }
    await expect(`${lines.join("\n")}\n`).toMatchFileSnapshot(
      "./__snapshots__/sidebar-tree.by-permission.txt",
    );
  });

  it("không quyền nào ⇒ mọi module rỗng (không mục nào lọt cổng)", () => {
    const checker = checkerFor([]);
    for (const moduleCode of MODULES) {
      const visible = filterSidebarItems(SIDEBAR_REGISTRY[moduleCode] ?? [], checker, SESSION);
      expect(visible, `module ${moduleCode} phải rỗng khi không có quyền`).toEqual([]);
    }
  });
});
