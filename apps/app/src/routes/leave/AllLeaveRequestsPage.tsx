import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ClipboardList, RefreshCw } from "lucide-react";
import type { LeaveManagementListItemView, LeaveTypeView } from "@mediaos/contracts";
import { leaveApi, leaveKeys, hrApi, hrKeys, useCan } from "@mediaos/web-core";
import {
  PageHeader,
  DataTable,
  EmptyState,
  Button,
  Select,
  Badge,
  Dialog,
  Input,
} from "@mediaos/ui";
import { LEAVE_ENGINE_PAIRS, LEAVE_STATUS } from "./constants";
import { useAllLeaveRequests } from "./use-all-leave-requests";

// ── Status badge (cùng bảng màu với MyLeaveRequestsPage/LeaveApprovalPage) ────────

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

// ── Requester cell (render server-provided fields ONLY — masking là việc của server) ─

function RequesterCell({ requester }: { requester: LeaveManagementListItemView["requester"] }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-medium">{requester.fullName ?? "—"}</span>
      <span className="text-xs text-muted-foreground">
        {[requester.employeeCode, requester.department].filter(Boolean).join(" · ") || "—"}
      </span>
    </div>
  );
}

function DateRange({ start, end }: { start: string; end: string }) {
  if (start === end) return <span className="text-sm">{start}</span>;
  return (
    <span className="text-sm">
      {start} → {end}
    </span>
  );
}

// ── Column definitions ────────────────────────────────────────────────────────

function useColumns(
  t: ReturnType<typeof useTranslation<"leave">>["t"],
  onView: (row: LeaveManagementListItemView) => void,
): ColumnDef<LeaveManagementListItemView>[] {
  return [
    {
      id: "requester",
      header: t("allRequests.columns.requester"),
      cell: ({ row }) => <RequesterCell requester={row.original.requester} />,
    },
    {
      accessorKey: "leaveTypeName",
      header: t("allRequests.columns.leaveType"),
      cell: ({ row }) => <span className="text-sm">{row.original.leaveTypeName ?? "—"}</span>,
    },
    {
      id: "period",
      header: t("allRequests.columns.period"),
      cell: ({ row }) => <DateRange start={row.original.startDate} end={row.original.endDate} />,
    },
    {
      accessorKey: "totalDays",
      header: t("allRequests.columns.days"),
      cell: ({ row }) => <span className="text-sm">{row.original.totalDays}</span>,
    },
    {
      accessorKey: "status",
      header: t("allRequests.columns.status"),
      cell: ({ row }) => <LeaveStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "submittedAt",
      header: t("allRequests.columns.submittedAt"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.submittedAt
            ? new Date(row.original.submittedAt).toLocaleDateString("vi-VN")
            : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: t("allRequests.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView(row.original)}
          aria-label={t("allRequests.actions.view")}
        >
          {t("allRequests.actions.view")}
        </Button>
      ),
    },
  ];
}

// ── Detail field row ──────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

// ── Read-only detail dialog (KHÔNG duyệt/từ chối — đã có ở /leave/approvals) ──────

function RequestDetailDialog({
  request,
  onClose,
  t,
}: {
  request: LeaveManagementListItemView;
  onClose: () => void;
  t: ReturnType<typeof useTranslation<"leave">>["t"];
}) {
  const period =
    request.startDate === request.endDate
      ? request.startDate
      : `${request.startDate} → ${request.endDate}`;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("allRequests.detail.title")}
      footer={
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("allRequests.detail.close")}
        </Button>
      }
    >
      <div className="divide-y divide-border">
        <DetailRow label={t("allRequests.detail.requester")} value={request.requester.fullName} />
        <DetailRow
          label={t("allRequests.detail.employeeCode")}
          value={request.requester.employeeCode}
        />
        <DetailRow
          label={t("allRequests.detail.department")}
          value={request.requester.department}
        />
        <DetailRow label={t("allRequests.detail.leaveType")} value={request.leaveTypeName} />
        <DetailRow label={t("allRequests.detail.period")} value={period} />
        <DetailRow label={t("allRequests.detail.totalDays")} value={request.totalDays} />
        {request.totalHours != null && (
          <DetailRow label={t("allRequests.detail.totalHours")} value={request.totalHours} />
        )}
        <DetailRow
          label={t("allRequests.detail.status")}
          value={<LeaveStatusBadge status={request.status} />}
        />
        {request.reason && (
          <DetailRow label={t("allRequests.detail.reason")} value={request.reason} />
        )}
        {request.submittedAt && (
          <DetailRow
            label={t("allRequests.detail.submittedAt")}
            value={new Date(request.submittedAt).toLocaleString("vi-VN")}
          />
        )}
      </div>
    </Dialog>
  );
}

// ── Status filter options ("" = tất cả trạng thái — xem use-all-leave-requests.ts) ──

const STATUS_OPTIONS = Object.values(LEAVE_STATUS);

// ── Main page (LEAVE-SCREEN-006) ──────────────────────────────────────────────

export function AllLeaveRequestsPage() {
  const { t } = useTranslation("leave");

  // PIN CỔNG: gate = view:leave (LEAVE.REQUEST.VIEW) — CÙNG cặp/endpoint với /leave/approvals
  // (GET /leave/requests, VIEW_LEAVE SENSITIVE, mig 0455). Server áp data_scope Team/Company.
  const canView = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_REQUEST.action,
    LEAVE_ENGINE_PAIRS.VIEW_REQUEST.resourceType,
  );

  const [status, setStatus] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [department, setDepartment] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<LeaveManagementListItemView | null>(null);

  const statuses = useMemo(() => (status ? [status] : STATUS_OPTIONS), [status]);

  const { items, isLoading, isError, refetchAll } = useAllLeaveRequests({
    statuses,
    leaveTypeId: leaveTypeId || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    enabled: canView,
  });

  const { data: leaveTypes } = useQuery({
    queryKey: leaveKeys.types.list(),
    queryFn: () => leaveApi.listTypes(),
    staleTime: 5 * 60_000,
    enabled: canView,
  });

  // Lookup phòng ban (read:department, non-sensitive) — lọc CLIENT-SIDE trên tập đã merge (BE
  // GET /leave/requests chưa có tham số departmentId, xem docs/SPEC SPEC-05 §13.6 vs BE hiện có).
  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    staleTime: 5 * 60_000,
    enabled: canView,
  });

  const filteredItems = useMemo(
    () => (department ? items.filter((i) => i.requester.department === department) : items),
    [items, department],
  );

  const columns = useColumns(t, (row) => setSelected(row));

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("allRequests.forbidden.title")}
          description={t("allRequests.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("allRequests.error.title")}
          description={t("allRequests.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={refetchAll}>
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
        title={t("allRequests.title")}
        description={t("allRequests.description")}
        icon={ClipboardList}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
            className="w-44"
            aria-label={t("allRequests.filters.allTypes")}
          >
            <option value="">{t("allRequests.filters.allTypes")}</option>
            {(leaveTypes ?? []).map((lt: LeaveTypeView) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </Select>

          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-44"
            aria-label={t("allRequests.filters.allStatuses")}
          >
            <option value="">{t("allRequests.filters.allStatuses")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>

          <Select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-44"
            aria-label={t("allRequests.filters.allDepartments")}
          >
            <option value="">{t("allRequests.filters.allDepartments")}</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </Select>

          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label={t("allRequests.filters.fromDate")}
            className="w-40"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label={t("allRequests.filters.toDate")}
            className="w-40"
          />
        </div>
      </PageHeader>

      {/* Bảng — phân trang CLIENT-SIDE (DataTable/TanStack Table) trên tập đã merge theo status */}
      <DataTable
        columns={columns}
        data={filteredItems}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("allRequests.empty.title")}
            description={t("allRequests.empty.description")}
          />
        }
        pageSize={20}
      />

      {selected && (
        <RequestDetailDialog request={selected} onClose={() => setSelected(null)} t={t} />
      )}
    </div>
  );
}
