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
import { TASK_CORE_ENGINE_PAIRS } from "@/routes/tasks/constants";
import { NOTI_ENGINE_PAIRS } from "@/routes/notifications/constants";

export const DASH_WIDGET_CODE = {
  MY_TASKS: "MY_TASKS",
  TASK_ALERTS: "TASK_ALERTS",
  NOTIFICATIONS: "NOTIFICATIONS",
} as const;

export type DashWidgetCode = (typeof DASH_WIDGET_CODE)[keyof typeof DASH_WIDGET_CODE];

export const DASH_WIDGET_GATE_PAIR: Readonly<
  Record<DashWidgetCode, { action: string; resourceType: string }>
> = {
  MY_TASKS: TASK_CORE_ENGINE_PAIRS.READ,
  TASK_ALERTS: TASK_CORE_ENGINE_PAIRS.READ,
  NOTIFICATIONS: NOTI_ENGINE_PAIRS.READ,
};

/**
 * Cặp gate DashboardMePage (GET /dashboard/me · /dashboard/widgets) — khớp BE DASH_READ_PAIR (mig 0100,
 * blanket-grant mọi role). Route "/dashboard" (ROUTE_REGISTRY "dashboard") ĐÃ gate ở tầng route qua
 * "DASH.DASHBOARD.VIEW" → PERMISSION_CODE_TO_PAIR → "read:dashboard" (registry.ts); hằng này dùng để page
 * TỰ kiểm lại (defense-in-depth, mirror MyTasksPage/NotificationListPage — mọi page tự gate lại, KHÔNG chỉ
 * dựa route).
 */
export const DASH_READ_PAIR = { action: "read", resourceType: "dashboard" } as const;
