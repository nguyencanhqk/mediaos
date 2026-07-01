import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, RefreshCw } from "lucide-react";
import type { LeaveManagementListItemView, LeaveTypeView } from "@mediaos/contracts";
import { rejectLeaveRequestSchema } from "@mediaos/contracts";
import { leaveApi, leaveKeys, leaveInvalidation, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select, Badge, Dialog } from "@mediaos/ui";
import { LEAVE_ENGINE_PAIRS, LEAVE_STATUS } from "./constants";

// ── Status badge ──────────────────────────────────────────────────────────────

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

// ── Requester cell (render server-provided fields ONLY — masking is server's job) ─

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

// ── Date range display ────────────────────────────────────────────────────────

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
      header: t("approval.columns.requester"),
      cell: ({ row }) => <RequesterCell requester={row.original.requester} />,
    },
    {
      accessorKey: "leaveTypeName",
      header: t("approval.columns.leaveType"),
      cell: ({ row }) => <span className="text-sm">{row.original.leaveTypeName ?? "—"}</span>,
    },
    {
      id: "period",
      header: t("approval.columns.period"),
      cell: ({ row }) => <DateRange start={row.original.startDate} end={row.original.endDate} />,
    },
    {
      accessorKey: "totalDays",
      header: t("approval.columns.days"),
      cell: ({ row }) => <span className="text-sm">{row.original.totalDays}</span>,
    },
    {
      accessorKey: "status",
      header: t("approval.columns.status"),
      cell: ({ row }) => <LeaveStatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: t("approval.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView(row.original)}
          aria-label={t("approval.actions.view")}
        >
          {t("approval.actions.view")}
        </Button>
      ),
    },
  ];
}

// ── Detail field row ────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

// ── Error → human message ───────────────────────────────────────────────────────

function mapMutationError(
  err: unknown,
  t: ReturnType<typeof useTranslation<"leave">>["t"],
  kind: "approve" | "reject",
): string {
  if (err instanceof ApiError && err.status === 403) {
    return t(`approval.${kind}.forbidden`);
  }
  return t(`approval.${kind}.error`);
}

// ── Approval detail dialog (view → approve | reject) ─────────────────────────────

type DialogMode = "view" | "approve" | "reject";

interface ApprovalDetailDialogProps {
  request: LeaveManagementListItemView;
  canApprove: boolean;
  onClose: () => void;
  onApprove: (note: string) => void;
  onReject: (reason: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
  approveError: unknown;
  rejectError: unknown;
  t: ReturnType<typeof useTranslation<"leave">>["t"];
}

function ApprovalDetailDialog({
  request,
  canApprove,
  onClose,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
  approveError,
  rejectError,
  t,
}: ApprovalDetailDialogProps) {
  const [mode, setMode] = useState<DialogMode>("view");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const isPending = request.status === LEAVE_STATUS.PENDING;

  function submitReject() {
    // Reject reason BẮT BUỘC — validate qua contract (rejectLeaveRequestSchema.reason min1/max2000).
    // Rỗng → chặn submit, KHÔNG gọi API.
    const parsed = rejectLeaveRequestSchema.safeParse({ reason: reason.trim() });
    if (!parsed.success) {
      setReasonError(t("approval.reject.reasonRequired"));
      return;
    }
    setReasonError(null);
    onReject(parsed.data.reason);
  }

  const period =
    request.startDate === request.endDate
      ? request.startDate
      : `${request.startDate} → ${request.endDate}`;

  const footer =
    mode === "view" ? (
      canApprove && isPending ? (
        <>
          {/* Nút reject gate = useCan('approve','leave') (UI-hint). reject:leave là cặp SENSITIVE, KHÔNG
              nằm trong SENSITIVE_CAPABILITY_ALLOWLIST ⇒ useCan('reject','leave') LUÔN false ở FE. BE ép
              reject:leave fail-closed (403 nếu thiếu) — CHỦ Ý dùng approve:leave làm UI-hint, không bỏ sót. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMode("reject")}
            data-testid="btn-open-reject"
          >
            {t("approval.actions.reject")}
          </Button>
          <Button size="sm" onClick={() => setMode("approve")} data-testid="btn-open-approve">
            {t("approval.actions.approve")}
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("approval.actions.back")}
        </Button>
      )
    ) : mode === "approve" ? (
      <>
        <Button variant="ghost" size="sm" onClick={() => setMode("view")} disabled={isApproving}>
          {t("approval.actions.back")}
        </Button>
        <Button
          size="sm"
          onClick={() => onApprove(note.trim())}
          disabled={isApproving}
          data-testid="btn-confirm-approve"
        >
          {isApproving ? t("approval.approve.submitting") : t("approval.approve.submit")}
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" size="sm" onClick={() => setMode("view")} disabled={isRejecting}>
          {t("approval.actions.back")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={submitReject}
          disabled={isRejecting}
          data-testid="btn-confirm-reject"
        >
          {isRejecting ? t("approval.reject.submitting") : t("approval.reject.submit")}
        </Button>
      </>
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        mode === "approve"
          ? t("approval.approve.title")
          : mode === "reject"
            ? t("approval.reject.title")
            : t("approval.detail.title")
      }
      footer={footer}
    >
      {mode === "view" && (
        <div className="divide-y divide-border">
          <DetailRow label={t("approval.detail.requester")} value={request.requester.fullName} />
          <DetailRow
            label={t("approval.detail.employeeCode")}
            value={request.requester.employeeCode}
          />
          <DetailRow label={t("approval.detail.department")} value={request.requester.department} />
          <DetailRow label={t("approval.detail.leaveType")} value={request.leaveTypeName} />
          <DetailRow label={t("approval.detail.period")} value={period} />
          <DetailRow label={t("approval.detail.totalDays")} value={request.totalDays} />
          {request.totalHours != null && (
            <DetailRow label={t("approval.detail.totalHours")} value={request.totalHours} />
          )}
          <DetailRow
            label={t("approval.detail.status")}
            value={<LeaveStatusBadge status={request.status} />}
          />
          {request.reason && (
            <DetailRow label={t("approval.detail.reason")} value={request.reason} />
          )}
          {request.submittedAt && (
            <DetailRow
              label={t("approval.detail.submittedAt")}
              value={new Date(request.submittedAt).toLocaleString("vi-VN")}
            />
          )}
        </div>
      )}

      {mode === "approve" && (
        <div className="space-y-3">
          <p className="text-sm">{t("approval.approve.confirm")}</p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("approval.approve.note")}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={t("approval.approve.notePlaceholder")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {approveError != null && (
            <p role="alert" className="text-sm text-destructive">
              {mapMutationError(approveError, t, "approve")}
            </p>
          )}
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("approval.reject.reason")}</label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
              rows={3}
              aria-invalid={reasonError ? true : undefined}
              placeholder={t("approval.reject.reasonPlaceholder")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {reasonError && (
              <p role="alert" className="text-sm text-destructive">
                {reasonError}
              </p>
            )}
          </div>
          {rejectError != null && (
            <p role="alert" className="text-sm text-destructive">
              {mapMutationError(rejectError, t, "reject")}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ── Status filter options ─────────────────────────────────────────────────────

const STATUS_OPTIONS = Object.values(LEAVE_STATUS);

// ── Main component ────────────────────────────────────────────────────────────

export function LeaveApprovalPage() {
  const { t } = useTranslation("leave");
  const queryClient = useQueryClient();

  // PIN CỔNG: list-load gate = view:leave (LEAVE.REQUEST.VIEW) — khớp BE GET /leave/requests
  // (VIEW_LEAVE, SENSITIVE, mig 0455) + route/sidebar (LEAVE.REQUEST.VIEW). KHÔNG dùng approve:leave.
  const canView = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_REQUEST.action,
    LEAVE_ENGINE_PAIRS.VIEW_REQUEST.resourceType,
  );
  // Nút approve/reject gate = useCan('approve','leave'). approve:leave non-sensitive → có trong capabilities.
  const canApprove = useCan(
    LEAVE_ENGINE_PAIRS.APPROVE_REQUEST.action,
    LEAVE_ENGINE_PAIRS.APPROVE_REQUEST.resourceType,
  );

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>(LEAVE_STATUS.PENDING);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [selected, setSelected] = useState<LeaveManagementListItemView | null>(null);

  const queryParams = useMemo(
    () => ({
      page,
      pageSize: 20,
      status,
      ...(leaveTypeId ? { leaveTypeId } : {}),
    }),
    [page, status, leaveTypeId],
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

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      leaveApi.approveRequest(id, note || undefined),
    onSuccess: (_res, { id }) => {
      // leaveInvalidation.approve = list-prefix + requests.detail(id) (KHÔNG balances — balance thuộc requester).
      for (const queryKey of leaveInvalidation.approve(id)) {
        void queryClient.invalidateQueries({ queryKey });
      }
      setSelected(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      leaveApi.rejectRequest(id, reason),
    onSuccess: (_res, { id }) => {
      for (const queryKey of leaveInvalidation.reject(id)) {
        void queryClient.invalidateQueries({ queryKey });
      }
      setSelected(null);
    },
  });

  const columns = useColumns(t, (row) => {
    approveMutation.reset();
    rejectMutation.reset();
    setSelected(row);
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("approval.forbidden.title")}
          description={t("approval.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("approval.error.title")}
          description={t("approval.error.description")}
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

  const items = data?.items ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("approval.title")}
        description={t("approval.description")}
        icon={CheckCircle2}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={leaveTypeId}
            onChange={(e) => {
              setLeaveTypeId(e.target.value);
              setPage(1);
            }}
            className="w-44"
            aria-label={t("approval.filters.allTypes")}
          >
            <option value="">{t("approval.filters.allTypes")}</option>
            {(leaveTypes ?? []).map((lt: LeaveTypeView) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </Select>

          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-44"
            aria-label={t("approval.filters.allStatuses")}
          >
            <option value="">{t("approval.filters.allStatuses")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("approval.empty.title")}
            description={t("approval.empty.description")}
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
        <ApprovalDetailDialog
          request={selected}
          canApprove={canApprove}
          onClose={() => setSelected(null)}
          onApprove={(note) => approveMutation.mutate({ id: selected.id, note })}
          onReject={(reason) => rejectMutation.mutate({ id: selected.id, reason })}
          isApproving={approveMutation.isPending}
          isRejecting={rejectMutation.isPending}
          approveError={approveMutation.error}
          rejectError={rejectMutation.error}
          t={t}
        />
      )}
    </div>
  );
}
