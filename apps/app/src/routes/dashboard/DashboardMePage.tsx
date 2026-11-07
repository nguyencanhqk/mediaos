/**
 * DashboardMePage — DASH-SCREEN-001 "Dashboard chung" (SPEC-07 §13.1). Route "/dashboard" (S4-FE-DASH-1).
 *
 * "Load shell trước, widget lazy" (§11.3 luồng tải dữ liệu widget): trang CHỈ gọi GET /dashboard/me
 * (dashboardApi.getMyDashboard — registry nhẹ: dashboard_type + widget metadata, `data:null`) để dựng layout
 * NHANH; mỗi <DashboardWidgetGrid> con sau đó tự lazy-load data thật qua GET /dashboard/widgets/:slug (xem
 * useDashboardWidgetData trong từng widget). Widget nào lỗi tự hiển thị lỗi CỤC BỘ (§16.2.6) — page KHÔNG
 * bao giờ sập vì 1 widget lỗi.
 *
 * Quy tắc hiển thị (§13.1): user không có quyền `read:dashboard` → forbidden; danh sách widget rỗng (0 widget
 * ĐƯỢC PHÉP xem, vd role chưa cấu hình dashboard_widget_configs) → empty; lỗi mạng/parse → error + thử lại.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueries, useQuery } from "@tanstack/react-query";
import { LayoutDashboard, RefreshCw } from "lucide-react";
import { dashboardApi, dashboardKeys, useCan } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Skeleton } from "@mediaos/ui";
import type { DashboardTypeValue, DashboardWidgetSummaryDto } from "@mediaos/contracts";
import { DashboardWidgetGrid } from "@/components/dashboard/DashboardWidgetGrid";
import { DashboardTypeSwitcher } from "@/components/dashboard/DashboardTypeSwitcher";
import { GoalCheckinDueBlock } from "@/components/dashboard/GoalCheckinDueBlock";
import { LEAVE_ENGINE_PAIRS } from "@/routes/leave/constants";
import { DASH_READ_PAIR, DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "./constants";

/** Các nguồn của màn «Hôm nay» mà khối mục tiêu cần biết đã rỗng hết chưa (cùng khoá cache với widget). */
const TODAY_SOURCE_CODES: readonly string[] = [
  DASH_WIDGET_CODE.MY_TASKS,
  DASH_WIDGET_CODE.TASK_ALERTS,
  DASH_WIDGET_CODE.PENDING_LEAVE,
];

/**
 * Khối «Mục tiêu cần check-in» của dashboard Employee. Đọc LẠI cùng query của các widget việc/đơn (cùng
 * `queryKey` ⇒ dùng chung cache, không thêm lời gọi) chỉ để biết «xong hết» hay chưa.
 */
function EmployeeTodayBlocks({
  widgets,
  dashboardType,
}: {
  widgets: readonly DashboardWidgetSummaryDto[];
  dashboardType: DashboardTypeValue;
}) {
  // Chỉ đếm nguồn THỰC SỰ hiển thị: cùng cổng với widget (PENDING_LEAVE cần cả view:leave và approve:leave).
  const taskPair = DASH_WIDGET_GATE_PAIR.MY_TASKS;
  const leavePair = DASH_WIDGET_GATE_PAIR.PENDING_LEAVE;
  const canTasks = useCan(taskPair.action, taskPair.resourceType);
  const canLeaveView = useCan(leavePair.action, leavePair.resourceType);
  const canLeaveApprove = useCan(
    LEAVE_ENGINE_PAIRS.APPROVE_REQUEST.action,
    LEAVE_ENGINE_PAIRS.APPROVE_REQUEST.resourceType,
  );
  const sourceVisible = (code: string): boolean =>
    code === DASH_WIDGET_CODE.PENDING_LEAVE ? canLeaveView && canLeaveApprove : canTasks;
  const present = widgets.filter(
    (w) => TODAY_SOURCE_CODES.includes(w.widget_code) && sourceVisible(w.widget_code),
  );
  const results = useQueries({
    queries: present.map((w) => ({
      queryKey: dashboardKeys.widgets.data(w.widget_code, {
        dashboard_type: dashboardType,
        project_id: undefined,
      }),
      queryFn: () =>
        dashboardApi.getWidgetData(w.widget_code, {
          dashboard_type: dashboardType,
          project_id: undefined,
        }),
      staleTime: 15_000,
    })),
  });
  const othersClear =
    results.length > 0 && results.every((r) => r.isSuccess && r.data?.status === "Empty");
  return <GoalCheckinDueBlock othersClear={othersClear} />;
}

function DashboardShellSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function DashboardMePageInner() {
  const { t } = useTranslation("dashboard");
  // S4-FE-DASH-2 — DashboardTypeSwitcher: null = dùng default do server resolve (/dashboard/me);
  // chọn type khác gọi thẳng route tĩnh /dashboard/{type} (đã @RequirePermission view-{type}:dashboard).
  const [selectedType, setSelectedType] = useState<DashboardTypeValue | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: selectedType ? dashboardKeys.byType(selectedType) : dashboardKeys.me(),
    queryFn: () =>
      selectedType ? dashboardApi.getDashboardByType(selectedType) : dashboardApi.getMyDashboard(),
    staleTime: 30_000,
  });

  if (isLoading) return <DashboardShellSkeleton />;

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("shell.error.title")}
          description={t("shell.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          }
        />
      </div>
    );
  }

  const widgets = data?.widgets ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        icon={LayoutDashboard}
        actions={<DashboardTypeSwitcher value={selectedType} onChange={setSelectedType} />}
      />

      {widgets.length === 0 ? (
        <EmptyState title={t("shell.empty.title")} description={t("shell.empty.description")} />
      ) : (
        <DashboardWidgetGrid widgets={widgets} dashboardType={data!.dashboard_type} />
      )}

      {/* S20-DASH-TODAY-1 — chỉ dashboard Employee; tự ẩn khi thiếu access:goal / checkin:goal. */}
      {data?.dashboard_type === "Employee" && (
        <EmployeeTodayBlocks widgets={widgets} dashboardType={data.dashboard_type} />
      )}
    </div>
  );
}

export function DashboardMePage() {
  const { t } = useTranslation("dashboard");
  const canView = useCan(DASH_READ_PAIR.action, DASH_READ_PAIR.resourceType);

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("shell.forbidden.title")}
          description={t("shell.forbidden.description")}
        />
      </div>
    );
  }

  return <DashboardMePageInner />;
}
