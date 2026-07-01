/**
 * AttendanceRecordDetailPage — chi tiết bản ghi chấm công (ATT-SCREEN-004, S3-FE-ATT-2).
 *
 * KHÔNG gate useCan('view-detail','attendance') — cặp không có trong SENSITIVE_CAPABILITY_ALLOWLIST
 * → luôn false nếu dùng → mọi user bị chặn. Cổng thật là SERVER: ApiError.status 403 → forbidden,
 * 404 → notFound. Client render shell vô điều kiện, rồi xử lý error từ response.
 *
 * locationJson (SENSITIVE) = null khi server không grant view-sensitive — client chỉ render null-safe.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { ApiError, formatDateTime } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent } from "@mediaos/ui";
import { AttendanceStatusBadge } from "./AttendanceStatusBadge";
import { useAttendanceRecordDetail } from "./hooks/useAttendanceRecords";
import { ATT_PATHS } from "./constants";

// ── Helpers ───────────────────────────────────────────────────────────────────

function minutesToHM(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}p`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}p`;
}

function fmtDt(value: string | null | undefined): string {
  if (!value) return "—";
  return formatDateTime(value);
}

// ── Field row ─────────────────────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface AttendanceRecordDetailPageProps {
  recordId: string;
}

export function AttendanceRecordDetailPage({ recordId }: AttendanceRecordDetailPageProps) {
  const { t } = useTranslation("attendance");
  const navigate = useNavigate();

  // KHÔNG gate useCan/useCanExact('view-detail') — cặp không surfaced (luôn false).
  // Server là cổng: 403 → forbidden, 404 → notFound.
  const { data, isLoading, isError, error, refetch } = useAttendanceRecordDetail(recordId);

  function goBack() {
    void navigate({ to: ATT_PATHS.MY_RECORDS as "/" });
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6" data-testid="detail-loading">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 rounded bg-muted" />
          <div className="h-40 rounded bg-muted" />
          <div className="h-24 rounded bg-muted" />
        </div>
      </div>
    );
  }

  // ── Error states (403 forbidden / 404 not-found / generic) ────────────────
  if (isError) {
    const isForbidden = error instanceof ApiError && error.status === 403;
    const isNotFound = error instanceof ApiError && error.status === 404;

    if (isForbidden) {
      return (
        <div className="p-6" data-testid="detail-forbidden">
          <EmptyState
            title={t("detail.forbidden.title")}
            description={t("detail.forbidden.description")}
            action={
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("detail.backToList")}
              </Button>
            }
          />
        </div>
      );
    }

    if (isNotFound) {
      return (
        <div className="p-6" data-testid="detail-not-found">
          <EmptyState
            title={t("detail.notFound.title")}
            description={t("detail.notFound.description")}
            action={
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("detail.backToList")}
              </Button>
            }
          />
        </div>
      );
    }

    return (
      <div className="p-6" data-testid="detail-error">
        <EmptyState
          title={t("detail.error.title")}
          description={t("detail.error.description")}
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

  if (!data) return null;

  // locationJson: SENSITIVE — null khi server không grant view-sensitive:attendance.
  // Client renders null-safe: không cố hiển thị hay suy luận từ giá trị null.
  const locationDisplay = data.locationJson != null ? JSON.stringify(data.locationJson) : null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("detail.title")}
        icon={undefined}
        actions={
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("detail.backToList")}
          </Button>
        }
      />

      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow label={t("detail.fields.date")} value={data.workDate} />
          <FieldRow label={t("detail.fields.shift")} value={data.shiftId ?? "—"} />
          <FieldRow
            label={t("detail.fields.checkIn")}
            value={<span className="tabular-nums">{fmtDt(data.checkInAt)}</span>}
          />
          <FieldRow
            label={t("detail.fields.checkOut")}
            value={<span className="tabular-nums">{fmtDt(data.checkOutAt)}</span>}
          />
          <FieldRow
            label={t("detail.fields.totalHours")}
            value={<span className="tabular-nums">{minutesToHM(data.workingMinutes)}</span>}
          />
          <FieldRow
            label={t("detail.fields.status")}
            value={<AttendanceStatusBadge status={data.attendanceStatus} />}
          />
          <FieldRow
            label={t("detail.fields.source")}
            value={data.attendanceSource ?? data.checkInMethod ?? "—"}
          />
          {/* locationJson: null when view-sensitive not granted — server controls masking */}
          {locationDisplay != null && (
            <FieldRow
              label={t("detail.fields.location")}
              value={
                <span className="break-all text-xs text-muted-foreground">{locationDisplay}</span>
              }
            />
          )}
          {data.fullName && <FieldRow label={t("detail.fields.employee")} value={data.fullName} />}
          {data.orgUnitName && (
            <FieldRow label={t("detail.fields.department")} value={data.orgUnitName} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
