import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { CalendarDays, RefreshCw } from "lucide-react";
import type { LeaveCalendarEntryDto, LeaveCalendarScope } from "@mediaos/contracts";
import { leaveApi, leaveKeys, useCan, useCanExact } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Badge } from "@mediaos/ui";
import { LEAVE_ENGINE_PAIRS, LEAVE_STATUS, LEAVE_CALENDAR_SCOPE } from "./constants";

/**
 * LEAVE-SCREEN-007/008/009 — Lịch nghỉ (own/team/company), S3-FE-LEAVE-4.
 *
 * Cổng route (workspace-level, xem router.tsx "leave.calendar") = CHỈ view-own:leave-calendar
 * (mọi role đều có ở Own). Toggle sang scope=team/company đòi hỏi cặp SENSITIVE riêng
 * (view-team:leave-calendar / view-company:leave-calendar) — gate bằng useCanExact (KHÔNG wildcard
 * fallback), mirror pattern TeamAttendanceRecordsPage/AttendanceCompanyRecordsPage. Server GATE THẬT
 * chạy 2 tầng trong LeaveCalendarService (coarse decorator + dataScope.resolveAndAssert theo scope
 * query) — client chỉ ẨN option scope người dùng không có quyền, KHÔNG tự quyết định gì thay server.
 *
 * MASK: `reason` server chỉ trả cho dòng của chính người gọi — mọi dòng khác LUÔN null (xem
 * apps/api/src/leave/leave-calendar.mappers.ts). Client render field CHÍNH XÁC những gì server trả,
 * KHÔNG suy đoán / KHÔNG tự ẩn thêm — nếu null thì hiển thị placeholder trung tính.
 */

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  [LEAVE_STATUS.DRAFT]: "secondary",
  [LEAVE_STATUS.PENDING]: "default",
  [LEAVE_STATUS.APPROVED]: "default",
  [LEAVE_STATUS.REJECTED]: "destructive",
  [LEAVE_STATUS.CANCELLED]: "outline",
  [LEAVE_STATUS.REVOKED]: "destructive",
};

function LeaveStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("leave");
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
      {t(`status.${status}`, { defaultValue: status })}
    </Badge>
  );
}

function DateRange({ start, end }: { start: string; end: string }) {
  if (start === end) return <span className="text-sm tabular-nums">{start}</span>;
  return (
    <span className="text-sm tabular-nums">
      {start} → {end}
    </span>
  );
}

function EmployeeCell({ entry }: { entry: LeaveCalendarEntryDto }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-medium">{entry.userFullName ?? "—"}</span>
      {entry.employeeCode && (
        <span className="text-xs text-muted-foreground">{entry.employeeCode}</span>
      )}
    </div>
  );
}

function useColumns(
  t: ReturnType<typeof useTranslation<"leave">>["t"],
): ColumnDef<LeaveCalendarEntryDto>[] {
  return [
    {
      id: "period",
      header: t("calendar.columns.date"),
      cell: ({ row }) => <DateRange start={row.original.startDate} end={row.original.endDate} />,
    },
    {
      id: "employee",
      header: t("calendar.columns.employee"),
      cell: ({ row }) => <EmployeeCell entry={row.original} />,
    },
    {
      accessorKey: "leaveTypeName",
      header: t("calendar.columns.leaveType"),
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.leaveTypeName ?? row.original.leaveTypeCode ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: t("calendar.columns.status"),
      cell: ({ row }) => <LeaveStatusBadge status={row.original.status} />,
    },
    {
      id: "reason",
      // Server mask: reason null cho MỌI dòng ngoài chính người gọi — client KHÔNG tự suy đoán,
      // chỉ hiển thị placeholder trung tính khi server trả null.
      header: t("calendar.columns.reason"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.reason ?? t("calendar.reasonMasked")}
        </span>
      ),
    },
  ];
}

// ── Scope toggle (chỉ hiện option người dùng CÓ quyền — server vẫn là cổng thật) ────

interface ScopeOption {
  value: LeaveCalendarScope;
  labelKey: string;
  allowed: boolean;
}

function ScopeToggle({
  value,
  onChange,
  options,
  t,
}: {
  value: LeaveCalendarScope;
  onChange: (v: LeaveCalendarScope) => void;
  options: ScopeOption[];
  t: ReturnType<typeof useTranslation<"leave">>["t"];
}) {
  const visible = options.filter((o) => o.allowed);
  if (visible.length <= 1) return null;
  return (
    <div className="flex items-center gap-1 rounded-md border border-input bg-background p-1">
      {visible.map((opt) => (
        <Button
          key={opt.value}
          type="button"
          size="sm"
          variant={value === opt.value ? "default" : "ghost"}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
        >
          {t(opt.labelKey)}
        </Button>
      ))}
    </div>
  );
}

// ── Default date range: tháng hiện tại ────────────────────────────────────────

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: fmt(from), to: fmt(to) };
}

// ── Main component ────────────────────────────────────────────────────────────

export function LeaveCalendarPage() {
  const { t } = useTranslation("leave");

  // Own: coarse pair, mọi role có → useCan (không cần fail-closed thêm, route đã gate).
  const canViewOwn = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_OWN_CALENDAR.action,
    LEAVE_ENGINE_PAIRS.VIEW_OWN_CALENDAR.resourceType,
  );
  // Team/Company: SENSITIVE — useCanExact, KHÔNG wildcard fallback (khớp BE reject wildcard cho pair này).
  const canViewTeam = useCanExact(
    LEAVE_ENGINE_PAIRS.VIEW_TEAM_CALENDAR.action,
    LEAVE_ENGINE_PAIRS.VIEW_TEAM_CALENDAR.resourceType,
  );
  const canViewCompany = useCanExact(
    LEAVE_ENGINE_PAIRS.VIEW_COMPANY_CALENDAR.action,
    LEAVE_ENGINE_PAIRS.VIEW_COMPANY_CALENDAR.resourceType,
  );

  const scopeOptions: ScopeOption[] = [
    { value: LEAVE_CALENDAR_SCOPE.OWN, labelKey: "calendar.scope.own", allowed: canViewOwn },
    { value: LEAVE_CALENDAR_SCOPE.TEAM, labelKey: "calendar.scope.team", allowed: canViewTeam },
    {
      value: LEAVE_CALENDAR_SCOPE.COMPANY,
      labelKey: "calendar.scope.company",
      allowed: canViewCompany,
    },
  ];

  const defaultRange = useMemo(() => currentMonthRange(), []);
  const [scope, setScope] = useState<LeaveCalendarScope>(LEAVE_CALENDAR_SCOPE.OWN);
  const [fromDate, setFromDate] = useState(defaultRange.from);
  const [toDate, setToDate] = useState(defaultRange.to);

  // Scope hiện tại có được phép không — fail-closed, KHÔNG rơi về own âm thầm nếu người dùng đổi
  // scope qua URL/state race trước khi options tính lại.
  const scopeAllowed =
    (scope === LEAVE_CALENDAR_SCOPE.OWN && canViewOwn) ||
    (scope === LEAVE_CALENDAR_SCOPE.TEAM && canViewTeam) ||
    (scope === LEAVE_CALENDAR_SCOPE.COMPANY && canViewCompany);

  const queryParams = { scope, from: fromDate, to: toDate };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: leaveKeys.calendar.list(queryParams),
    queryFn: () => leaveApi.getCalendar(queryParams),
    enabled: scopeAllowed && !!fromDate && !!toDate,
    staleTime: 60_000,
  });

  const columns = useColumns(t);
  const items = data?.items ?? [];

  // ── Forbidden (không có quyền ở bất kỳ scope nào) ─────────────────────────────
  if (!canViewOwn && !canViewTeam && !canViewCompany) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("calendar.forbidden.title")}
          description={t("calendar.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("calendar.error.title")}
          description={t("calendar.error.description")}
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

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("calendar.title")}
        description={t("calendar.description")}
        icon={CalendarDays}
      >
        <div className="flex flex-wrap items-center gap-3">
          <ScopeToggle value={scope} onChange={setScope} options={scopeOptions} t={t} />

          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label={t("calendar.filters.fromDate")}
            className="w-40"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label={t("calendar.filters.toDate")}
            className="w-40"
          />
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("calendar.empty.title")}
            description={t("calendar.empty.description")}
          />
        }
        pageSize={items.length || 20}
      />
    </div>
  );
}
