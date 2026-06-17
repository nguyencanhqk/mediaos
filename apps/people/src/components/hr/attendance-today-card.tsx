import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { attendanceApi } from "@/lib/attendance-api";
import { PermissionGate } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import {
  ATTENDANCE_STATUS_COLORS,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_METHOD_LABELS,
  formatTime,
} from "./constants";

/**
 * Card chấm công hôm nay: hiển thị trạng thái, giờ vào/ra,
 * nút Check-in / Check-out theo trạng thái.
 */
export function AttendanceTodayCard() {
  const { t } = useTranslation("hr");
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["attendance", "today"],
    queryFn: () => attendanceApi.getToday(),
  });

  const checkIn = useMutation({
    mutationFn: () => attendanceApi.checkIn({ method: "web" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["attendance", "today"] }),
  });

  const checkOut = useMutation({
    mutationFn: () => attendanceApi.checkOut({ method: "web" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["attendance", "today"] }),
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">{t("today.loading")}</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-destructive">{t("today.loadError")}</p>
      </div>
    );
  }

  const { record, schedule, periodLocked, workDate } = data;
  const hasCheckedIn = !!record?.checkInAt;
  const hasCheckedOut = !!record?.checkOutAt;
  const status = record?.status;

  const [y, m, d] = workDate.split("-");
  const displayDate = `${d}/${m}/${y}`;

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("today.heading")}</h2>
          <p className="text-sm text-muted-foreground">{displayDate}</p>
        </div>
        {status && (
          <span className={`text-sm font-medium ${ATTENDANCE_STATUS_COLORS[status]}`}>
            {ATTENDANCE_STATUS_LABELS[status]}
          </span>
        )}
      </div>

      {schedule && (
        <div className="text-sm text-muted-foreground">
          {t("today.shiftLabel")} <span className="text-foreground font-medium">{schedule.name}</span>
          {" · "}{schedule.startTime} – {schedule.endTime}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Check-in</p>
          <p className="text-xl font-semibold tabular-nums">
            {formatTime(record?.checkInAt)}
          </p>
          {record?.checkInMethod && (
            <p className="text-xs text-muted-foreground">
              {ATTENDANCE_METHOD_LABELS[record.checkInMethod]}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Check-out</p>
          <p className="text-xl font-semibold tabular-nums">
            {formatTime(record?.checkOutAt)}
          </p>
          {record?.checkOutMethod && (
            <p className="text-xs text-muted-foreground">
              {ATTENDANCE_METHOD_LABELS[record.checkOutMethod]}
            </p>
          )}
        </div>
      </div>

      {(record?.lateMinutes ?? 0) > 0 && (
        <p className="text-sm text-orange-500">
          {t("today.late", { minutes: record!.lateMinutes })}
        </p>
      )}
      {(record?.earlyLeaveMinutes ?? 0) > 0 && (
        <p className="text-sm text-yellow-600">
          {t("today.earlyLeave", { minutes: record!.earlyLeaveMinutes })}
        </p>
      )}

      {periodLocked && (
        <p className="text-xs text-muted-foreground italic">{t("today.periodLocked")}</p>
      )}

      {!periodLocked && (
        <div className="flex gap-3">
          <PermissionGate action="check-in" resourceType="attendance">
            {!hasCheckedIn && (
              <Button
                onClick={() => checkIn.mutate()}
                disabled={checkIn.isPending}
              >
                {checkIn.isPending ? t("today.checkingIn") : "Check-in"}
              </Button>
            )}
            {hasCheckedIn && !hasCheckedOut && (
              <Button
                variant="outline"
                onClick={() => checkOut.mutate()}
                disabled={checkOut.isPending}
              >
                {checkOut.isPending ? t("today.checkingIn") : "Check-out"}
              </Button>
            )}
          </PermissionGate>
        </div>
      )}

      {checkIn.isError && (
        <p className="text-sm text-destructive">
          {checkIn.error instanceof Error ? checkIn.error.message : t("today.checkInError")}
        </p>
      )}
      {checkOut.isError && (
        <p className="text-sm text-destructive">
          {checkOut.error instanceof Error ? checkOut.error.message : t("today.checkOutError")}
        </p>
      )}
    </div>
  );
}
