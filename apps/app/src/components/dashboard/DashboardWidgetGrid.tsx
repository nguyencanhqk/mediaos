/**
 * DashboardWidgetGrid — layout responsive cho widget dashboard (S4-FE-DASH-1, SPEC-07 §12 DASH-SCREEN-008
 * "Dashboard Mobile View" + §13.1 "Khu vực widget chính").
 *
 * Nhận danh sách widget metadata từ GET /dashboard/me (data=null, chỉ order/widget_code — "shell") và render
 * ĐÚNG component P0 tương ứng theo `widget_code`, sắp theo `layout.order` (server quyết định thứ tự, FE
 * KHÔNG tự ý đổi). widget_code CHƯA có component FE (P1: ATTENDANCE_TODAY/PENDING_LEAVE/PROJECT_PROGRESS/
 * HR_OVERVIEW) bị bỏ qua (KHÔNG render placeholder gãy) — mỗi widget mount RIÊNG (PermissionGate + hook
 * fetch của chính nó) nên lỗi 1 widget không ảnh hưởng widget khác (§16.2.6).
 */
import type { ComponentType } from "react";
import type { DashboardWidgetSummaryDto, DashboardTypeValue } from "@mediaos/contracts";
import { MyTasksWidget } from "./MyTasksWidget";
import { TaskAlertsWidget } from "./TaskAlertsWidget";
import { NotificationsWidget } from "./NotificationsWidget";
import { DASH_WIDGET_CODE } from "@/routes/dashboard/constants";

interface DashboardWidgetProps {
  dashboardType?: DashboardTypeValue;
}

/** widget_code → component P0. Thêm widget mới (P1) = thêm dòng khi component được build. */
const WIDGET_COMPONENTS: Readonly<Record<string, ComponentType<DashboardWidgetProps>>> = {
  [DASH_WIDGET_CODE.MY_TASKS]: MyTasksWidget,
  [DASH_WIDGET_CODE.TASK_ALERTS]: TaskAlertsWidget,
  [DASH_WIDGET_CODE.NOTIFICATIONS]: NotificationsWidget,
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
