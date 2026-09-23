/**
 * Sidebar registry MVP — khai báo NavItem[] cho mỗi module.
 *
 * Quy tắc (FRONTEND-05 §16):
 * - Label tiếng Việt trực tiếp (sidebar render nhanh, không qua i18n key).
 * - requiredAnyPermissions theo hằng MODULE.RESOURCE.ACTION (SPEC-01 §9).
 * - Không hard-code role — filterSidebarItems() lọc theo permission + module status.
 * - Tối đa 2 cấp trong MVP.
 *
 * ---------------------------------------------------------------------------
 * S15-UI-SHELL-2 — file này giờ là BARREL, dữ liệu nằm ở `./sidebar/<module>.ts`.
 * ---------------------------------------------------------------------------
 *
 * Trước đây mọi module ở chung một file 1439 dòng (trần dự án là 800). Mỗi module nay một file; file
 * này giữ NGUYÊN đường dẫn import (`@/layouts/workspace/sidebar-registry`) và NGUYÊN danh sách export
 * nên không consumer/spec/vi.mock nào phải đổi.
 *
 * Thêm một module = thêm `./sidebar/<module>.ts` + một dòng import + một dòng trong
 * `SIDEBAR_REGISTRY` (thứ tự khoá ở đó là thứ tự đã ghim trong snapshot, xem dưới).
 *
 * ⚠️ Cây sidebar được GHIM bằng `sidebar-registry.snapshot.spec.ts` (hai file
 * `__snapshots__/sidebar-tree.*.txt`): cả cây khai báo (thứ tự + gate từng mục) lẫn cây THẤY ĐƯỢC
 * theo từng bộ quyền. Đổi có chủ ý ⇒ `pnpm --filter @mediaos/app test -u` rồi đọc diff hai file đó
 * như đọc chính thay đổi điều hướng của PR.
 */
import { type ModuleCode, type SidebarItemMeta } from "@mediaos/web-core";
import { ASSET_SIDEBAR } from "./sidebar/asset";
import { ATT_SIDEBAR } from "./sidebar/att";
import { DASH_SIDEBAR } from "./sidebar/dash";
import { GOAL_SIDEBAR } from "./sidebar/goal";
import { HR_SIDEBAR } from "./sidebar/hr";
import { LEAVE_SIDEBAR } from "./sidebar/leave";
import { ME_SIDEBAR } from "./sidebar/me";
import { NOTI_SIDEBAR } from "./sidebar/noti";
import { PAYROLL_SIDEBAR, PAYROLL_SIDEBAR_V2 } from "./sidebar/payroll";
import { pruneUnbuiltScreens } from "./sidebar/prune-unbuilt";
import { RECRUIT_SIDEBAR } from "./sidebar/recruit";
import { ROOM_SIDEBAR } from "./sidebar/room";
import { SOCIAL_SIDEBAR, SOCIAL_SIDEBAR_V2 } from "./sidebar/social";
import { SYSTEM_SIDEBAR } from "./sidebar/system";
import { TASK_SIDEBAR } from "./sidebar/task";

export {
  ASSET_SIDEBAR,
  ATT_SIDEBAR,
  DASH_SIDEBAR,
  GOAL_SIDEBAR,
  HR_SIDEBAR,
  LEAVE_SIDEBAR,
  ME_SIDEBAR,
  NOTI_SIDEBAR,
  PAYROLL_SIDEBAR,
  PAYROLL_SIDEBAR_V2,
  pruneUnbuiltScreens,
  RECRUIT_SIDEBAR,
  ROOM_SIDEBAR,
  SOCIAL_SIDEBAR,
  SOCIAL_SIDEBAR_V2,
  SYSTEM_SIDEBAR,
  TASK_SIDEBAR,
};

// ---------------------------------------------------------------------------
// Map moduleCode → sidebar items
// ---------------------------------------------------------------------------
export const SIDEBAR_REGISTRY: Partial<Record<ModuleCode, readonly SidebarItemMeta[]>> = {
  DASH: DASH_SIDEBAR,
  HR: HR_SIDEBAR,
  ATT: ATT_SIDEBAR,
  LEAVE: LEAVE_SIDEBAR,
  TASK: TASK_SIDEBAR,
  NOTI: NOTI_SIDEBAR,
  FOUNDATION: SYSTEM_SIDEBAR,
  ME: ME_SIDEBAR,
  GOAL: GOAL_SIDEBAR,
  ASSET: ASSET_SIDEBAR,
  ROOM: ROOM_SIDEBAR,
  RECRUIT: RECRUIT_SIDEBAR,
  PAYROLL: PAYROLL_SIDEBAR,
  SOCIAL: SOCIAL_SIDEBAR,
};

export function getSidebarItems(moduleCode: ModuleCode): readonly SidebarItemMeta[] {
  return SIDEBAR_REGISTRY[moduleCode] ?? [];
}
