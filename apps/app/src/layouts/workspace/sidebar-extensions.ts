import type { ComponentType } from "react";
import type { ModuleCode } from "@mediaos/web-core";
import { TaskSidebarTree } from "./TaskSidebarTree";

/**
 * Khe cắm section ĐỘNG theo module cho ModuleSidebar (S5-TASK-NAV-TREE-1).
 *
 * Registry tĩnh (sidebar-registry.ts) chỉ khai item thuần data — section cần data runtime
 * (React Query, permission hook) sống ở component và đăng ký TẠI ĐÂY để ModuleSidebar render
 * sau các group tĩnh. KHÔNG render khi sidebar ở icon-mode (collapsed) — cây cần label.
 */
const SIDEBAR_EXTENSIONS: Partial<Record<ModuleCode, ComponentType>> = {
  TASK: TaskSidebarTree,
};

export function getSidebarExtension(moduleCode: ModuleCode): ComponentType | undefined {
  return SIDEBAR_EXTENSIONS[moduleCode];
}
