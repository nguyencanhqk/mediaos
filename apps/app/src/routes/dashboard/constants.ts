/**
 * Hằng module DASH (SPEC-07) — S4-FE-DASH-1.
 *
 * `DASH_WIDGET_CODE` — mã widget catalog P0 (S4-DASH-SEED-1, apps/api dashboard-widget-catalog.const.ts),
 * dùng làm key thay vì rải chuỗi "MY_TASKS"/"TASK_ALERTS"/"NOTIFICATIONS" tay ở nhiều nơi.
 *
 * `DASH_WIDGET_GATE_PAIR` — cặp engine (action:resourceType) MIRROR đúng BE
 * apps/api/src/dashboard/dashboard-widget-catalog.const.ts (DASH_WIDGET_GATE_PAIR — "Option B: gate widget
 * bằng cặp quyền của MODULE NGUỒN"). Server GET /dashboard/widgets đã OMIT hẳn widget thiếu quyền khỏi catalog
 * — đây là gate PHỤ (defense-in-depth, ẩn shell widget sớm hơn 1 round-trip), KHÔNG phải cổng thật.
 * Tái dùng TASK_CORE_ENGINE_PAIRS/NOTI_ENGINE_PAIRS đã có (DRY, tránh định nghĩa cặp trùng lặp).
 */
import { TASK_CORE_ENGINE_PAIRS, TASK_ENGINE_PAIRS } from "@/routes/tasks/constants";
import { NOTI_ENGINE_PAIRS } from "@/routes/notifications/constants";
import { ATT_ENGINE_PAIRS } from "@/routes/attendance/constants";
import { LEAVE_ENGINE_PAIRS } from "@/routes/leave/constants";
import { HR_ENGINE_PAIRS } from "@/routes/hr/constants";

export const DASH_WIDGET_CODE = {
  MY_TASKS: "MY_TASKS",
  TASK_ALERTS: "TASK_ALERTS",
  NOTIFICATIONS: "NOTIFICATIONS",
  // S4-FE-DASH-2 (APPEND) — 4 widget P1 (IMPLEMENTATION-07 §11.3/§14.2).
  ATTENDANCE_TODAY: "ATTENDANCE_TODAY",
  PENDING_LEAVE: "PENDING_LEAVE",
  PROJECT_PROGRESS: "PROJECT_PROGRESS",
  HR_OVERVIEW: "HR_OVERVIEW",
} as const;

export type DashWidgetCode = (typeof DASH_WIDGET_CODE)[keyof typeof DASH_WIDGET_CODE];

export const DASH_WIDGET_GATE_PAIR: Readonly<
  Record<DashWidgetCode, { action: string; resourceType: string }>
> = {
  MY_TASKS: TASK_CORE_ENGINE_PAIRS.READ,
  TASK_ALERTS: TASK_CORE_ENGINE_PAIRS.READ,
  NOTIFICATIONS: NOTI_ENGINE_PAIRS.READ,
  // S4-FE-DASH-2 (APPEND) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR (dashboard-widget-catalog.const.ts):
  // ATTENDANCE_TODAY→view-own:attendance · PENDING_LEAVE→view:leave · PROJECT_PROGRESS→read:project ·
  // HR_OVERVIEW→read:employee. Tái dùng cặp module nguồn ĐÃ có (DRY, tránh định nghĩa cặp trùng lặp).
  ATTENDANCE_TODAY: ATT_ENGINE_PAIRS.VIEW_OWN,
  PENDING_LEAVE: LEAVE_ENGINE_PAIRS.VIEW_REQUEST,
  PROJECT_PROGRESS: TASK_ENGINE_PAIRS.READ_PROJECT,
  HR_OVERVIEW: HR_ENGINE_PAIRS.READ_EMPLOYEE,
};

/**
 * Cặp gate DashboardMePage (GET /dashboard/me · /dashboard/widgets) — khớp BE DASH_READ_PAIR (mig 0100,
 * blanket-grant mọi role). Route "/dashboard" (ROUTE_REGISTRY "dashboard") ĐÃ gate ở tầng route qua
 * "DASH.DASHBOARD.VIEW" → PERMISSION_CODE_TO_PAIR → "read:dashboard" (registry.ts); hằng này dùng để page
 * TỰ kiểm lại (defense-in-depth, mirror MyTasksPage/NotificationListPage — mọi page tự gate lại, KHÔNG chỉ
 * dựa route).
 */
export const DASH_READ_PAIR = { action: "read", resourceType: "dashboard" } as const;

/**
 * S4-FE-DASH-3 — cặp engine DashboardConfigPage (GET/PATCH /dashboard/configs, nối S4-DASH-BE-3). MIRROR
 * đúng BE DASH_PERMISSION_PAIRS specCode "DASH.CONFIG.VIEW"/"DASH.CONFIG.UPDATE" (apps/api/src/dashboard/
 * dashboard-widget-catalog.const.ts, mig 0484) — literal engine pair trực tiếp (KHÔNG qua
 * PERMISSION_CODE_TO_PAIR, tránh pair-drift đã cắn 3 lần). CẢ 2 cặp is_sensitive=true, Company-scope
 * company-admin (API-10:310-312) ⇒ component PHẢI dùng useCanExact (fail-closed, KHÔNG wildcard '*:*'),
 * mirror NotificationEventsPage/AttendanceRulesPage.
 */
export const DASH_CONFIG_ENGINE_PAIRS = {
  VIEW: { action: "view", resourceType: "dashboard-config" },
  UPDATE: { action: "update", resourceType: "dashboard-config" },
} as const;
