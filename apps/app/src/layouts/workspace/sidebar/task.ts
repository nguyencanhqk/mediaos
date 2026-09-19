import { type SidebarItemMeta } from "@mediaos/web-core";

// ---------------------------------------------------------------------------
// TASK — Công việc
//
// Doc CHUẨN sidebar TASK = FRONTEND-11 §8.1 (bản hợp nhất S5-TASK-NAV-TREE-1 — UI-09 §11.2 và
// UI-02 §9.8 trỏ về đó, KHÔNG tự khai bố cục riêng). 4 item tĩnh dưới đây + section ĐỘNG "Dự án
// theo phòng ban" (TaskSidebarTree, đăng ký ở sidebar-extensions.ts — cần React Query nên không
// khai được ở registry data thuần). ROUTE_REGISTRY (web-core) đồng bộ 4 routeKey cùng tên;
// showInSidebar ở đó là metadata chết — ModuleSidebar CHỈ đọc registry này.
// ---------------------------------------------------------------------------
export const TASK_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "task.overview",
    moduleCode: "TASK",
    // S5-FE-TASK-NAV-1: /tasks render TaskListPage (TASK-SCREEN-005) — label cũ "Tổng quan" gây hiểu nhầm.
    label: "Danh sách công việc",
    path: "/tasks",
    icon: "kanban-square",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["TASK.TASK.VIEW", "TASK.PROJECT.VIEW"],
  },
  {
    sidebarKey: "task.my-tasks",
    moduleCode: "TASK",
    label: "Việc của tôi",
    path: "/tasks/my-tasks",
    icon: "check-square",
    group: "operation",
    order: 20,
    requiredAnyPermissions: ["TASK.TASK.VIEW"],
  },
  // S5-FE-TASK-6 — Task quá hạn (TASK-SCREEN-010). Gate TASK.TASK.VIEW (như danh sách). icon
  // "alert-triangle" CÓ trong DynamicIcon.ICON_MAP (tránh fallback Circle).
  {
    sidebarKey: "task.overdue",
    moduleCode: "TASK",
    label: "Task quá hạn",
    path: "/tasks/overdue",
    icon: "alert-triangle",
    group: "operation",
    order: 25,
    requiredAnyPermissions: ["TASK.TASK.VIEW"],
  },
  // S5-FE-TASK-NAV-1: route task.projects.list có trong ROUTE_REGISTRY web-core (showInSidebar) nhưng
  // ModuleSidebar dựng menu từ registry NÀY — phải khai item ở đây mới thấy (SCREEN-001 trước đó mồ côi).
  {
    sidebarKey: "task.projects",
    moduleCode: "TASK",
    label: "Dự án",
    path: "/tasks/projects",
    icon: "folder-kanban",
    group: "operation",
    order: 30,
    requiredAnyPermissions: ["TASK.PROJECT.VIEW"],
  },
];
