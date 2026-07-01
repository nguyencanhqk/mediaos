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
  Input,
  Badge,
  Dialog,
} from "@mediaos/ui";
import { LEAVE_ENGINE_PAIRS, LEAVE_STATUS } from "./constants";

/**
 * LEAVE-SCREEN-006 — Tất cả đơn nghỉ phép (HR/Admin quản lý toàn bộ đơn trong phạm vi quyền).
 *
 * Cổng: view:leave (LEAVE.REQUEST.VIEW) — CÙNG cặp với BE GET /leave/requests (SENSITIVE, mig 0455,
 * scope Team/Department/Company do server áp theo DataScopeService — client KHÔNG tự lọc scope).
 * Đây là màn hình ĐỌC (xem toàn bộ + chi tiết) — hành động Duyệt/Từ chối thuộc LEAVE-SCREEN-APPROVALS
 * (LeaveApprovalPage, /leave/approvals). Không lặp lại luồng approve/reject ở đây.
 *
 * Giới hạn BE đã biết (server pendingConds luôn `eq(status, filters.status)` — KHÔNG có tuỳ chọn
 * "tất cả trạng thái" trong 1 lần gọi): dropdown Trạng thái chọn ĐÚNG 1 giá trị mỗi lần, mặc định
 * 'Pending'. TODO(BE): cân nhắc thêm status=ALL hoặc bỏ qua điều kiện khi rỗng nếu nghiệp vụ cần.
 *
 * Bộ lọc "Phòng ban" gọi SERVER-SIDE qua query param `departmentId` (PendingLeaveRequestListQuery,
 * S3-FE-LEAVE-3-FIX-BE) — repo AND departmentId vào org_unit_id SAU scopeCond, chỉ THU HẸP trong
 * phạm vi data-scope hiện có (không mở rộng ngoài Team/Department/Company). Options đổ từ
 * hrApi.listDepartments() (danh mục phòng ban, non-sensitive) — KHÔNG suy từ items trang hiện tại.
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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

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

const STATUS_OPTIONS = Object.values(LEAVE_STATUS);

// ── Detail dialog (READ-ONLY — không approve/reject; xem LeaveApprovalPage) ─────

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
          {t("allRequests.actions.back")}
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
        {request.approvedAt && (
          <DetailRow
            label={t("allRequests.detail.approvedAt")}
            value={new Date(request.approvedAt).toLocaleString("vi-VN")}
          />
        )}
        {request.rejectedAt && (
          <DetailRow
            label={t("allRequests.detail.rejectedAt")}
            value={new Date(request.rejectedAt).toLocaleString("vi-VN")}
          />
        )}
        {request.rejectionReason && (
          <DetailRow
            label={t("allRequests.detail.rejectionReason")}
            value={request.rejectionReason}
          />
        )}
      </div>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AllLeaveRequestsPage() {
  const { t } = useTranslation("leave");

  // PIN CỔNG: gate = view:leave (LEAVE.REQUEST.VIEW) — khớp BE GET /leave/requests (mig 0455) +
  // route/sidebar "leave.all-requests". KHÔNG gate approve/reject ở đây (màn hình chỉ ĐỌC).
  const canView = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_REQUEST.action,
    LEAVE_ENGINE_PAIRS.VIEW_REQUEST.resourceType,
  );

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>(LEAVE_STATUS.PENDING);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [selected, setSelected] = useState<LeaveManagementListItemView | null>(null);

  const queryParams = useMemo(
    () => ({
      page,
      pageSize: 20,
      status,
      ...(leaveTypeId ? { leaveTypeId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    }),
    [page, status, leaveTypeId, departmentId, fromDate, toDate],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: leaveKeys.requests.list(queryParams),
    queryFn: () => leaveApi.listRequests(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const { data: leaveTypes } = useQuery({
    queryKey: leaveKeys.types.list(),
    queryFn: () => leaveApi.listTypes(),
    staleTime: 5 * 60_000,
    enabled: canView,
  });

  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    staleTime: 5 * 60_000,
    enabled: canView,
  });

  const items = data?.items ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

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

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("allRequests.error.title")}
          description={t("allRequests.error.description")}
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
        title={t("allRequests.title")}
        description={t("allRequests.description")}
        icon={ClipboardList}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-44"
            aria-label={t("allRequests.filters.status")}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>

          <Select
            value={leaveTypeId}
            onChange={(e) => {
              setLeaveTypeId(e.target.value);
              setPage(1);
            }}
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
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setPage(1);
            }}
            className="w-44"
            aria-label={t("allRequests.filters.allDepartments")}
          >
            <option value="">{t("allRequests.filters.allDepartments")}</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>

          <Input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            aria-label={t("allRequests.filters.fromDate")}
            className="w-40"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            aria-label={t("allRequests.filters.toDate")}
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
            title={t("allRequests.empty.title")}
            description={t("allRequests.empty.description")}
          />
        }
        pageSize={meta?.pageSize ?? 20}
      />

      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
          <span>
            {meta
              ? `${(page - 1) * meta.pageSize + 1}–${Math.min(page * meta.pageSize, meta.total)} / ${meta.total}`
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("pagination.prev", { ns: "common" })}
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta?.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("pagination.next", { ns: "common" })}
            </Button>
          </div>
        </div>
      )}

      {selected && (
        <RequestDetailDialog request={selected} onClose={() => setSelected(null)} t={t} />
      )}
    </div>
  );
}
