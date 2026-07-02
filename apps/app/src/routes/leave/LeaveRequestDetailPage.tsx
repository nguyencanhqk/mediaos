import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, CheckCircle2, Clock, XCircle, Ban, RotateCcw } from "lucide-react";
import type { LeaveRequestDetailView, LeaveRequestApprovalView } from "@mediaos/contracts";
import { leaveApi, leaveKeys, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Badge } from "@mediaos/ui";
import { LEAVE_ENGINE_PAIRS, LEAVE_PATHS, LEAVE_STATUS, type LeaveStatus } from "./constants";

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, React.ReactNode> = {
  [LEAVE_STATUS.DRAFT]: <Clock className="h-4 w-4 text-muted-foreground" />,
  [LEAVE_STATUS.PENDING]: <Clock className="h-4 w-4 text-amber-500" />,
  [LEAVE_STATUS.APPROVED]: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  [LEAVE_STATUS.REJECTED]: <XCircle className="h-4 w-4 text-destructive" />,
  [LEAVE_STATUS.CANCELLED]: <Ban className="h-4 w-4 text-muted-foreground" />,
  [LEAVE_STATUS.REVOKED]: <RotateCcw className="h-4 w-4 text-destructive" />,
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  [LEAVE_STATUS.DRAFT]: "secondary",
  [LEAVE_STATUS.PENDING]: "default",
  [LEAVE_STATUS.APPROVED]: "default",
  [LEAVE_STATUS.REJECTED]: "destructive",
  [LEAVE_STATUS.CANCELLED]: "outline",
  [LEAVE_STATUS.REVOKED]: "destructive",
};

// ── Status stepper ────────────────────────────────────────────────────────────

const STEPPER_FLOW: LeaveStatus[] = [
  LEAVE_STATUS.DRAFT,
  LEAVE_STATUS.PENDING,
  LEAVE_STATUS.APPROVED,
];
const TERMINAL_STATUSES = new Set<string>([
  LEAVE_STATUS.REJECTED,
  LEAVE_STATUS.CANCELLED,
  LEAVE_STATUS.REVOKED,
]);

function StatusStepper({
  status,
  t,
}: {
  status: string;
  t: ReturnType<typeof useTranslation<"leave">>["t"];
}) {
  const isTerminal = TERMINAL_STATUSES.has(status);
  const currentIdx = STEPPER_FLOW.indexOf(status as LeaveStatus);

  if (isTerminal) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
        {STATUS_ICON[status]}
        <span className="text-sm font-medium">
          {t(`detail.statusStepper.${status}`, { defaultValue: status })}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0">
      {STEPPER_FLOW.map((s, i) => {
        const isActive = s === status;
        const isDone = i < currentIdx;
        return (
          <div key={s} className="flex items-center">
            <div
              className={[
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium",
                isDone ? "bg-primary text-primary-foreground" : "",
                isActive ? "bg-primary/20 text-primary ring-2 ring-primary" : "",
                !isDone && !isActive ? "bg-muted text-muted-foreground" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {isDone ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className="ml-1 mr-3 text-xs text-muted-foreground hidden sm:inline">
              {t(`detail.statusStepper.${s}`, { defaultValue: s })}
            </span>
            {i < STEPPER_FLOW.length - 1 && (
              <div className={`mr-3 h-px w-8 ${isDone ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

// ── Approval history ──────────────────────────────────────────────────────────

function ApprovalHistory({
  approvals,
  t,
}: {
  approvals: LeaveRequestApprovalView[];
  t: ReturnType<typeof useTranslation<"leave">>["t"];
}) {
  if (approvals.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("detail.approvalHistory.empty")}</p>;
  }
  return (
    <ol className="space-y-3">
      {approvals.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
            {a.approvalStep}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {t(`detail.approvalHistory.actions.${a.action}`, { defaultValue: a.action })}
              </span>
              {a.toStatus && (
                <Badge
                  variant={STATUS_BADGE_VARIANT[a.toStatus] ?? "secondary"}
                  className="text-xs"
                >
                  {t(`status.${a.toStatus}`, { defaultValue: a.toStatus })}
                </Badge>
              )}
            </div>
            {a.comment && <p className="mt-0.5 text-muted-foreground">{a.comment}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(a.actedAt).toLocaleString("vi-VN")}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Cancel dialog ─────────────────────────────────────────────────────────────

function CancelDialog({
  open,
  onClose,
  onConfirm,
  isLoading,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isLoading: boolean;
  t: ReturnType<typeof useTranslation<"leave">>["t"];
}) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl space-y-4">
        <h3 className="font-semibold">{t("detail.actions.cancelConfirm")}</h3>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("detail.actions.cancelReason")}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t("detail.actions.cancelReasonPlaceholder")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            {t("detail.actions.cancelDismiss")}
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={isLoading}>
            {isLoading ? t("detail.actions.cancelling") : t("detail.actions.cancelSubmit")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface LeaveRequestDetailPageProps {
  requestId: string;
}

export function LeaveRequestDetailPage({ requestId }: LeaveRequestDetailPageProps) {
  const { t } = useTranslation("leave");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const canCancelOwn = useCan(
    LEAVE_ENGINE_PAIRS.CANCEL_OWN.action,
    LEAVE_ENGINE_PAIRS.CANCEL_OWN.resourceType,
  );

  // S3-FE-LEAVE-3 — nút "Sửa" liên kết tới /leave/requests/:id/edit (chỉ khả dụng khi Draft).
  const canUpdateDraft = useCan(
    LEAVE_ENGINE_PAIRS.UPDATE_DRAFT.action,
    LEAVE_ENGINE_PAIRS.UPDATE_DRAFT.resourceType,
  );

  // QA05-LEAVE-004: gate view-own:leave — block fetch + show forbidden when missing
  const canViewRequest = useCan(
    LEAVE_ENGINE_PAIRS.VIEW_OWN_REQUEST.action,
    LEAVE_ENGINE_PAIRS.VIEW_OWN_REQUEST.resourceType,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: leaveKeys.requests.detail(requestId),
    queryFn: () => leaveApi.getMyRequest(requestId),
    enabled: canViewRequest,
    staleTime: 30_000,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 2;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => leaveApi.cancelRequest(requestId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leaveKeys.requests.my() });
      void queryClient.invalidateQueries({ queryKey: leaveKeys.requests.detail(requestId) });
      void queryClient.invalidateQueries({ queryKey: leaveKeys.balances.my() });
      setShowCancelDialog(false);
    },
  });

  function goBack() {
    void navigate({ to: LEAVE_PATHS.MY_REQUESTS as "/" });
  }

  // ── Permission gate ────────────────────────────────────────────────────────
  if (!canViewRequest) {
    return (
      <div className="p-6">
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

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-32 rounded bg-muted" />
          <div className="h-24 rounded bg-muted" />
        </div>
      </div>
    );
  }

  // ── Not found / error ──────────────────────────────────────────────────────
  if (isError) {
    const notFound =
      cancelMutation.error instanceof ApiError && cancelMutation.error.status === 404;
    return (
      <div className="p-6">
        <EmptyState
          title={notFound ? t("detail.notFound.title") : t("detail.error.title")}
          description={notFound ? t("detail.notFound.description") : t("detail.error.description")}
          action={
            !notFound ? (
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("detail.backToList")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  if (!data) return null;

  const req: LeaveRequestDetailView = data;
  const canCancel =
    canCancelOwn && (req.status === LEAVE_STATUS.DRAFT || req.status === LEAVE_STATUS.PENDING);
  const canEdit = canUpdateDraft && req.status === LEAVE_STATUS.DRAFT;
  const cancelError = cancelMutation.error ? t("detail.cancelError") : null;

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

      {/* Status stepper */}
      <Card>
        <CardContent className="pt-5">
          <StatusStepper status={req.status} t={t} />
        </CardContent>
      </Card>

      {/* Cancel error */}
      {cancelError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {cancelError}
        </div>
      )}

      {/* Main info */}
      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow label={t("detail.fields.leaveType")} value={req.leaveTypeName ?? "—"} />
          <FieldRow
            label={t("detail.fields.durationType")}
            value={
              req.durationType
                ? t(`durationType.${req.durationType}`, { defaultValue: req.durationType })
                : "—"
            }
          />
          <FieldRow
            label={t("detail.fields.period")}
            value={
              req.startDate === req.endDate ? req.startDate : `${req.startDate} → ${req.endDate}`
            }
          />
          <FieldRow label={t("detail.fields.calculatedDays")} value={req.totalDays} />
          {req.totalHours != null && (
            <FieldRow label={t("detail.fields.calculatedHours")} value={req.totalHours} />
          )}
          <FieldRow
            label={t("detail.fields.status")}
            value={
              <Badge variant={STATUS_BADGE_VARIANT[req.status] ?? "secondary"}>
                {t(`status.${req.status}`, { defaultValue: req.status })}
              </Badge>
            }
          />
          {req.reason && <FieldRow label={t("detail.fields.reason")} value={req.reason} />}
          {req.handoverNote && (
            <FieldRow label={t("detail.fields.handoverNote")} value={req.handoverNote} />
          )}
          {req.contactDuringLeave && (
            <FieldRow label={t("detail.fields.contact")} value={req.contactDuringLeave} />
          )}
          {req.submittedAt && (
            <FieldRow
              label={t("detail.fields.submittedAt")}
              value={new Date(req.submittedAt).toLocaleString("vi-VN")}
            />
          )}
          <FieldRow
            label={t("detail.fields.createdAt")}
            value={new Date(req.createdAt).toLocaleString("vi-VN")}
          />
        </CardContent>
      </Card>

      {/* Approval history */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <h3 className="text-sm font-semibold">{t("detail.approvalHistory.title")}</h3>
          <ApprovalHistory approvals={req.approvals} t={t} />
        </CardContent>
      </Card>

      {/* Actions */}
      {(canEdit || canCancel) && (
        <div className="flex justify-end gap-3">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate({ to: LEAVE_PATHS.EDIT(requestId) as "/" })}
            >
              {t("detail.actions.edit")}
            </Button>
          )}
          {canCancel && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowCancelDialog(true)}
              disabled={cancelMutation.isPending}
            >
              {t("detail.actions.cancel")}
            </Button>
          )}
        </div>
      )}

      {/* Cancel dialog */}
      <CancelDialog
        open={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        onConfirm={(reason) => cancelMutation.mutate(reason)}
        isLoading={cancelMutation.isPending}
        t={t}
      />
    </div>
  );
}
