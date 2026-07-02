/**
 * S2-FE-HR-4 — HR-SCREEN-018: /hr/profile-change-requests. HR/Admin xem + duyệt/từ chối yêu cầu
 * cập nhật hồ sơ (approve:profile-change-request, Company scope — server áp).
 *
 * KIẾN TRÚC (ghi chú quan trọng): BE `GET /hr/profile-change-requests/:id` CHỈ mở cho chính chủ yêu
 * cầu xem (Own-scope — xem profile-change-request.service.ts#getRequestDetail: so khớp
 * emp.id === req.employeeId của NGƯỜI GỌI, không có nhánh cho approve:profile-change-request).
 * HR gọi endpoint này với id của người khác sẽ luôn nhận 404 — đây là hành vi CHỦ Ý của BE (comment
 * "HR detail access is out-of-scope for this endpoint"), không phải bug FE. Vì vậy trang này KHÔNG
 * điều hướng sang /hr/profile-change-requests/:id để duyệt — nó dùng lại pattern đã có ở
 * LeaveApprovalPage: Dialog xem+duyệt+từ chối dựng từ DỮ LIỆU DÒNG ĐÃ TẢI (list item), POST
 * approve/reject gọi thẳng bằng id — không phụ thuộc GET chi tiết. SPEC-03 §13.16 kỳ vọng HR xem được
 * "theo quyền và scope" qua GET :id — đây là spec/BE drift cần vá ở tầng BE (theo dõi riêng, không sửa
 * trong WO FE này).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import type { ProfileChangeRequestListItem, ProfileChangeStatus } from "@mediaos/contracts";
import { PROFILE_CHANGE_STATUSES, rejectProfileChangeRequestSchema } from "@mediaos/contracts";
import { hrApi, hrKeys, hrInvalidation, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select, Dialog } from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
import { ProfileChangeStatusBadge } from "./status-badge";

type TF = ReturnType<typeof useTranslation<"hr">>["t"];

// ── Detail row ──────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function mapMutationError(err: unknown, t: TF, kind: "approve" | "reject"): string {
  if (err instanceof ApiError && err.status === 403)
    return t(`changeRequest.list.${kind}.forbidden`);
  return t(`changeRequest.list.${kind}.error`);
}

// ── Action dialog (view → approve | reject) ──────────────────────────────────

type DialogMode = "view" | "approve" | "reject";

interface ActionDialogProps {
  request: ProfileChangeRequestListItem;
  canApprove: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
  approveError: unknown;
  rejectError: unknown;
  t: TF;
}

function ActionDialog({
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
}: ActionDialogProps) {
  const [mode, setMode] = useState<DialogMode>("view");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const isPending = request.status === "Pending";

  function submitReject() {
    const parsed = rejectProfileChangeRequestSchema.safeParse({ rejectionReason: reason.trim() });
    if (!parsed.success) {
      setReasonError(t("changeRequest.list.reject.reasonRequired"));
      return;
    }
    setReasonError(null);
    onReject(parsed.data.rejectionReason);
  }

  const footer =
    mode === "view" ? (
      canApprove && isPending ? (
        <>
          <Button variant="outline" size="sm" onClick={() => setMode("reject")}>
            {t("changeRequest.list.actions.reject")}
          </Button>
          <Button size="sm" onClick={() => setMode("approve")}>
            {t("changeRequest.list.actions.approve")}
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("changeRequest.list.actions.back")}
        </Button>
      )
    ) : mode === "approve" ? (
      <>
        <Button variant="ghost" size="sm" onClick={() => setMode("view")} disabled={isApproving}>
          {t("changeRequest.list.actions.back")}
        </Button>
        <Button size="sm" onClick={onApprove} disabled={isApproving}>
          {isApproving
            ? t("changeRequest.list.approve.submitting")
            : t("changeRequest.list.approve.submit")}
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" size="sm" onClick={() => setMode("view")} disabled={isRejecting}>
          {t("changeRequest.list.actions.back")}
        </Button>
        <Button variant="destructive" size="sm" onClick={submitReject} disabled={isRejecting}>
          {isRejecting
            ? t("changeRequest.list.reject.submitting")
            : t("changeRequest.list.reject.submit")}
        </Button>
      </>
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        mode === "approve"
          ? t("changeRequest.list.approve.title")
          : mode === "reject"
            ? t("changeRequest.list.reject.title")
            : t("changeRequest.list.detail.title")
      }
      footer={footer}
    >
      {mode === "view" && (
        <div className="divide-y divide-border">
          <DetailRow
            label={t("changeRequest.list.detail.employee")}
            value={request.employeeFullName}
          />
          <DetailRow
            label={t("changeRequest.list.detail.employeeCode")}
            value={request.employeeCode}
          />
          <DetailRow
            label={t("changeRequest.list.detail.changedFields")}
            value={request.changedFields.join(", ")}
          />
          <DetailRow
            label={t("changeRequest.list.detail.status")}
            value={<ProfileChangeStatusBadge status={request.status} />}
          />
          {request.reason && (
            <DetailRow label={t("changeRequest.list.detail.reason")} value={request.reason} />
          )}
          <DetailRow
            label={t("changeRequest.list.detail.submittedAt")}
            value={new Date(request.submittedAt).toLocaleString("vi-VN")}
          />
        </div>
      )}

      {mode === "approve" && (
        <div className="space-y-3">
          <p className="text-sm">{t("changeRequest.list.approve.confirm")}</p>
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
            <label className="text-sm font-medium">{t("changeRequest.list.reject.reason")}</label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
              rows={3}
              aria-invalid={reasonError ? true : undefined}
              placeholder={t("changeRequest.list.reject.reasonPlaceholder")}
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

// ── Columns ────────────────────────────────────────────────────────────────

function useColumns(
  t: TF,
  onView: (row: ProfileChangeRequestListItem) => void,
): ColumnDef<ProfileChangeRequestListItem>[] {
  return [
    {
      accessorKey: "employeeFullName",
      header: t("changeRequest.columns.employee"),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium">{row.original.employeeFullName}</span>
          <span className="text-xs text-muted-foreground">{row.original.employeeCode ?? "—"}</span>
        </div>
      ),
    },
    {
      accessorKey: "changedFields",
      header: t("changeRequest.columns.changedFields"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.changedFields.join(", ")}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: t("changeRequest.columns.status"),
      cell: ({ row }) => <ProfileChangeStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "submittedAt",
      header: t("changeRequest.columns.submittedAt"),
      cell: ({ row }) => (
        <span className="text-sm">
          {new Date(row.original.submittedAt).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      accessorKey: "reviewedByName",
      header: t("changeRequest.columns.reviewedBy"),
      cell: ({ row }) => <span className="text-sm">{row.original.reviewedByName ?? "—"}</span>,
    },
    {
      id: "actions",
      header: t("changeRequest.columns.actions"),
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onView(row.original)}>
          {t("changeRequest.actions.view")}
        </Button>
      ),
    },
  ];
}

const STATUS_OPTIONS: readonly ProfileChangeStatus[] = PROFILE_CHANGE_STATUSES;

// ── Main page ──────────────────────────────────────────────────────────────

export function ProfileChangeRequestListPage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();

  const canView = useCan(
    HR_ENGINE_PAIRS.APPROVE_PROFILE_CHANGE_REQUEST.action,
    HR_ENGINE_PAIRS.APPROVE_PROFILE_CHANGE_REQUEST.resourceType,
  );
  const canApprove = canView; // cùng cặp — controller gate list + approve/reject bằng approve:profile-change-request.

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("Pending");
  const [selected, setSelected] = useState<ProfileChangeRequestListItem | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: hrKeys.profileChangeRequests.list({ page, status }),
    queryFn: () =>
      hrApi.listProfileChangeRequests({
        page,
        status: status ? (status as ProfileChangeStatus) : undefined,
      }),
    enabled: canView,
    staleTime: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => hrApi.approveProfileChangeRequest(id),
    onSuccess: async (_res, id) => {
      for (const queryKey of hrInvalidation.approveChangeRequest(id)) {
        await queryClient.invalidateQueries({ queryKey });
      }
      setSelected(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      hrApi.rejectProfileChangeRequest(id, reason),
    onSuccess: async (_res, { id }) => {
      for (const queryKey of hrInvalidation.rejectChangeRequest(id)) {
        await queryClient.invalidateQueries({ queryKey });
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
          title={t("changeRequest.list.forbidden.title")}
          description={t("changeRequest.list.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("changeRequest.list.error.title")}
          description={t("changeRequest.list.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
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
        title={t("changeRequest.list.title")}
        description={t("changeRequest.list.description")}
        icon={ClipboardCheck}
      >
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-48"
          aria-label={t("changeRequest.list.filters.allStatuses")}
        >
          <option value="">{t("changeRequest.list.filters.allStatuses")}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`changeRequest.status.${s}`)}
            </option>
          ))}
        </Select>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("changeRequest.list.empty.title")}
            description={t("changeRequest.list.empty.description")}
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
        <ActionDialog
          request={selected}
          canApprove={canApprove}
          onClose={() => setSelected(null)}
          onApprove={() => approveMutation.mutate(selected.id)}
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
