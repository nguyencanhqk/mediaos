/**
 * AttendanceStatusCard — hiển thị trạng thái chấm công hôm nay (ATT-SCREEN-001).
 * S3-FE-ATT-1: render field server trả về; KHÔNG tự ẩn/mask field — masking là việc của server.
 * Không hard-code status text — dùng t("attendance.status.*").
 */
import { useTranslation } from "react-i18next";
import { Clock, Calendar } from "lucide-react";
import type { AttendanceTodayV2Dto } from "@mediaos/contracts";
import { formatDateTime } from "@mediaos/web-core";
import { Card, CardContent, CardHeader, CardTitle } from "@mediaos/ui";
import { AttendanceStatusBadge } from "./AttendanceStatusBadge";

// ── Helper: minutes display ────────────────────────────────────────────────────

function minutesToDisplay(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}p`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}p`;
}

// ── Stat row ──────────────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

interface AttendanceStatusCardProps {
  data: AttendanceTodayV2Dto;
}

export function AttendanceStatusCard({ data }: AttendanceStatusCardProps) {
  const { t } = useTranslation("attendance");

  const record = data.record;
  const shift = data.shift;

  // Display status: prefer attendanceStatus (TitleCase DB-04) over legacy status.
  const displayStatus = record?.attendanceStatus ?? (record ? "Checked-in" : "Not Checked-in");

  return (
    <Card data-testid="attendance-status-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {t("today.statusCard.title")}
          </CardTitle>
          <AttendanceStatusBadge status={displayStatus} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Check-in / Check-out times */}
        <div className="divide-y divide-border rounded-lg border">
          <StatRow
            label={t("today.statusCard.checkIn")}
            value={
              record?.checkInAt ? (
                <span className="tabular-nums">{formatDateTime(record.checkInAt)}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <StatRow
            label={t("today.statusCard.checkOut")}
            value={
              record?.checkOutAt ? (
                <span className="tabular-nums">{formatDateTime(record.checkOutAt)}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
        </div>

        {/* Working time stats (only when record exists) */}
        {record && (
          <div className="divide-y divide-border rounded-lg border">
            {record.workingMinutes != null && (
              <StatRow
                label={t("today.statusCard.workedMinutes", {
                  minutes: record.workingMinutes,
                })}
                value={minutesToDisplay(record.workingMinutes)}
              />
            )}
            {record.requiredWorkingMinutes != null && (
              <StatRow
                label={t("today.statusCard.requiredMinutes", {
                  minutes: record.requiredWorkingMinutes,
                })}
                value={minutesToDisplay(record.requiredWorkingMinutes)}
              />
            )}
            {record.lateMinutes > 0 && (
              <StatRow
                label={t("today.statusCard.lateMinutes", { minutes: record.lateMinutes })}
                value={
                  <span className="text-destructive">{minutesToDisplay(record.lateMinutes)}</span>
                }
              />
            )}
            {record.earlyLeaveMinutes > 0 && (
              <StatRow
                label={t("today.statusCard.earlyLeaveMinutes", {
                  minutes: record.earlyLeaveMinutes,
                })}
                value={
                  <span className="text-destructive">
                    {minutesToDisplay(record.earlyLeaveMinutes)}
                  </span>
                }
              />
            )}
            {record.missingMinutes != null && record.missingMinutes > 0 && (
              <StatRow
                label={t("today.statusCard.missingMinutes", {
                  minutes: record.missingMinutes,
                })}
                value={
                  <span className="text-destructive">
                    {minutesToDisplay(record.missingMinutes)}
                  </span>
                }
              />
            )}
          </div>
        )}

        {/* Shift info */}
        {shift && (
          <div className="flex items-start gap-2 rounded-lg border p-3">
            <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{shift.name}</p>
              {shift.startTime && shift.endTime && (
                <p className="text-xs text-muted-foreground">
                  {t("today.statusCard.shift.startEnd", {
                    start: shift.startTime,
                    end: shift.endTime,
                  })}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
