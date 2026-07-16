/**
 * MeSectionContents — nội dung "ok có dữ liệu" cho từng section của Tổng quan ME (ME-SCREEN-001).
 * Mỗi hàm CHỈ render đúng field server trả (BẤT BIẾN masking — client KHÔNG tự suy field bị ẩn).
 */
import { useTranslation } from "react-i18next";
import { Badge } from "@mediaos/ui";
import { formatTime } from "@mediaos/web-core";
import type {
  MeHrSummary,
  MeAttendanceSummary,
  MeLeaveSummary,
  MeTaskSummary,
  MeNotificationSummary,
} from "@mediaos/contracts";

export function HrSectionContent({ data }: { data: MeHrSummary }) {
  const { t } = useTranslation("me");
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium text-foreground">{data.positionName ?? "—"}</p>
      <p className="text-muted-foreground">{data.departmentName ?? "—"}</p>
      {data.startDate && (
        <p className="text-xs text-muted-foreground">
          {t("hr.startDate", { date: data.startDate })}
        </p>
      )}
    </div>
  );
}

export function AttendanceSectionContent({ data }: { data: MeAttendanceSummary }) {
  const { t } = useTranslation("me");
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium text-foreground">
        {data.checkInAt
          ? t("attendance.checkedInAt", { time: formatTime(data.checkInAt) })
          : t("attendance.empty")}
      </p>
      <p className="text-muted-foreground">
        {data.checkOutAt
          ? t("attendance.checkedOutAt", { time: formatTime(data.checkOutAt) })
          : t("attendance.notCheckedOut")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {data.shiftName && <Badge variant="outline">{data.shiftName}</Badge>}
        {data.isLate && <Badge variant="warning">{t("attendance.late")}</Badge>}
        {data.isEarlyLeave && <Badge variant="warning">{t("attendance.earlyLeave")}</Badge>}
      </div>
    </div>
  );
}

export function LeaveSectionContent({ data }: { data: MeLeaveSummary }) {
  const { t } = useTranslation("me");
  const totalRemaining = data.balances.reduce((sum, b) => sum + b.remainingDays, 0);
  const unit = data.balances[0]?.unit ?? "ngày";
  return (
    <div className="space-y-1 text-sm">
      <p className="text-2xl font-bold tabular-nums text-foreground">
        {totalRemaining} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </p>
      <p className="text-muted-foreground">
        {data.pendingRequestCount > 0
          ? t("leave.pendingRequests", { count: data.pendingRequestCount })
          : t("leave.noPendingRequests")}
      </p>
    </div>
  );
}

export function TaskSectionContent({ data }: { data: MeTaskSummary }) {
  const { t } = useTranslation("me");
  return (
    <div className="flex flex-wrap gap-1.5 text-sm">
      <Badge variant="outline">{t("task.assigned", { count: data.assignedCount })}</Badge>
      <Badge variant={data.dueTodayCount > 0 ? "warning" : "outline"}>
        {t("task.dueToday", { count: data.dueTodayCount })}
      </Badge>
      <Badge variant={data.overdueCount > 0 ? "danger" : "outline"}>
        {t("task.overdue", { count: data.overdueCount })}
      </Badge>
    </div>
  );
}

export function NotificationSectionContent({ data }: { data: MeNotificationSummary }) {
  const { t } = useTranslation("me");
  return (
    <div className="space-y-1 text-sm">
      <p className="text-2xl font-bold tabular-nums text-foreground">{data.unreadCount}</p>
      <p className="text-muted-foreground">
        {t("notification.unread", { count: data.unreadCount })}
      </p>
    </div>
  );
}
