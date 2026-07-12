/**
 * DashboardWidgetGrid — layout responsive cho widget dashboard (S4-FE-DASH-1, SPEC-07 §12 DASH-SCREEN-008
 * "Dashboard Mobile View" + §13.1 "Khu vực widget chính").
 *
 * Nhận danh sách widget metadata từ GET /dashboard/me (data=null, chỉ order/widget_code — "shell") và render
 * ĐÚNG component tương ứng theo `widget_code`, sắp theo `layout.order` (server quyết định thứ tự, FE KHÔNG
 * tự ý đổi). widget_code CHƯA có component FE trong Grid (vd PROJECT_PROGRESS — cần project context, xem
 * doc-block WIDGET_COMPONENTS; hoặc widget Catalog-only chưa build) bị bỏ qua (KHÔNG render placeholder
 * gãy) — mỗi widget mount RIÊNG (PermissionGate + hook fetch của chính nó) nên lỗi 1 widget không ảnh hưởng
 * widget khác (§16.2.6).
 */
import type { ComponentType } from "react";
import type { DashboardWidgetSummaryDto, DashboardTypeValue } from "@mediaos/contracts";
import { MyTasksWidget } from "./MyTasksWidget";
import { TaskAlertsWidget } from "./TaskAlertsWidget";
import { NotificationsWidget } from "./NotificationsWidget";
import { AttendanceTodayWidget } from "./AttendanceTodayWidget";
import { PendingLeaveWidget } from "./PendingLeaveWidget";
import { HrOverviewWidget } from "./HrOverviewWidget";
import { DASH_WIDGET_CODE } from "@/routes/dashboard/constants";

interface DashboardWidgetProps {
  dashboardType?: DashboardTypeValue;
}

/**
 * widget_code → component. P0 (MY_TASKS/TASK_ALERTS/NOTIFICATIONS) + S4-FE-DASH-2 P1 (ATTENDANCE_TODAY/
 * PENDING_LEAVE/HR_OVERVIEW — viewer-independent hoặc self-locked, KHÔNG cần tham số ngoài dashboardType).
 *
 * CỐ Ý KHÔNG có PROJECT_PROGRESS ở đây: BE bắt buộc `project_id` (gateProjectProgress, dashboard-widget-
 * data.const.ts) và KHÔNG có default dashboard_widget_configs cho widget này (dashboard-widget-
 * catalog.const.ts DASH_DEFAULT_CONFIG) — Grid không có project context để truyền, wire nhầm sẽ luôn 400.
 * <ProjectProgressWidget projectId=...> dùng ở nơi ĐÃ biết project (vd ProjectDetailPage), ngoài Grid này.
 */
const WIDGET_COMPONENTS: Readonly<Record<string, ComponentType<DashboardWidgetProps>>> = {
  [DASH_WIDGET_CODE.MY_TASKS]: MyTasksWidget,
  [DASH_WIDGET_CODE.TASK_ALERTS]: TaskAlertsWidget,
  [DASH_WIDGET_CODE.NOTIFICATIONS]: NotificationsWidget,
  [DASH_WIDGET_CODE.ATTENDANCE_TODAY]: AttendanceTodayWidget,
  [DASH_WIDGET_CODE.PENDING_LEAVE]: PendingLeaveWidget,
  [DASH_WIDGET_CODE.HR_OVERVIEW]: HrOverviewWidget,
};

interface DashboardWidgetGridProps {
  widgets: readonly DashboardWidgetSummaryDto[];
  dashboardType: DashboardTypeValue;
}

export function DashboardWidgetGrid({ widgets, dashboardType }: DashboardWidgetGridProps) {
  const ordered = [...widgets]
    .filter((w) => WIDGET_COMPONENTS[w.widget_code])
    .sort((a, b) => a.layout.order - b.layout.order);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {ordered.map((w) => {
        const Widget = WIDGET_COMPONENTS[w.widget_code];
        return <Widget key={w.widget_code} dashboardType={dashboardType} />;
      })}
    </div>
  );
}
