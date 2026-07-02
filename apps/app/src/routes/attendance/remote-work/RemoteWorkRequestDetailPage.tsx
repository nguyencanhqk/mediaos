/**
 * RemoteWorkRequestDetailPage — /attendance/remote-work-requests/:id (S3-FE-ATT-4, ATT-SCREEN-013/014).
 *
 * Actions theo STATE-MACHINE (CHỐT 2026-07-02): Draft (chủ đơn) → Gửi duyệt (SubmitRemoteWorkDialog)
 * hoặc Huỷ; Pending → Duyệt/Từ chối (người có quyền approve/reject:remote-request) hoặc Huỷ (chủ đơn).
 * Server là cổng thật — nút chỉ ẩn/hiện theo useCan, KHÔNG tự suy quyền.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useAuthStore, useCanExact } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Badge, Dialog } from "@mediaos/ui";
import {
  useRemoteWorkRequestDetail,
  useApproveRemoteWorkRequest,
  useRejectRemoteWorkRequest,
  useCancelOwnRemoteWorkRequest,
} from "../hooks/useRemoteWorkRequests";
import { ATT_ENGINE_PAIRS, ATT_PATHS, REMOTE_REQUEST_STATUS } from "../constants";
import { SubmitRemoteWorkDialog } from "./SubmitRemoteWorkDialog";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function ApproveDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation("attendance");
  const [note, setNote] = useState("");
  const mutation = useApproveRemoteWorkRequest();
  const busy = mutation.isPending;
  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={t("remoteWork.approveDialog.title")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("remoteWork.approveDialog.cancel")}
          </Button>
          <Button
            onClick={() =>
              mutation.mutate({ id, body: { note: note || undefined } }, { onSuccess: onClose })
            }
            disabled={busy}
          >
            {busy ? t("remoteWork.approveDialog.submitting") : t("remoteWork.approveDialog.submit")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("remoteWork.approveDialog.error")}
        </p>
      )}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          {t("remoteWork.approveDialog.note")}
        </label>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </Dialog>
  );
}

function RejectDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation("attendance");
  const [reason, setReason] = useState("");
  const mutation = useRejectRemoteWorkRequest();
  const busy = mutation.isPending;
  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={t("remoteWork.rejectDialog.title")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("remoteWork.rejectDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              mutation.mutate({ id, body: { rejectReason: reason } }, { onSuccess: onClose })
            }
            disabled={busy || reason.trim().length === 0}
          >
            {busy ? t("remoteWork.rejectDialog.submitting") : t("remoteWork.rejectDialog.submit")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("remoteWork.rejectDialog.error")}
        </p>
      )}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          {t("remoteWork.rejectDialog.reason")}
        </label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {reason.trim().length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("remoteWork.rejectDialog.reasonRequired")}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function CancelDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation("attendance");
  const mutation = useCancelOwnRemoteWorkRequest();
  const busy = mutation.isPending;
  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={t("remoteWork.cancelDialog.title")}
      description={t("remoteWork.cancelDialog.description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("remoteWork.cancelDialog.dismiss")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate(id, { onSuccess: onClose })}
            disabled={busy}
          >
            {busy ? t("remoteWork.cancelDialog.cancelling") : t("remoteWork.cancelDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("remoteWork.cancelDialog.error")}
        </p>
      )}
    </Dialog>
  );
}

export interface RemoteWorkRequestDetailPageProps {
  requestId: string;
}

export function RemoteWorkRequestDetailPage({ requestId }: RemoteWorkRequestDetailPageProps) {
  const { t } = useTranslation("attendance");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const canViewOwn = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_VIEW_OWN.action,
    ATT_ENGINE_PAIRS.REMOTE_VIEW_OWN.resourceType,
  );
  const canViewTeam = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_VIEW_TEAM.action,
    ATT_ENGINE_PAIRS.REMOTE_VIEW_TEAM.resourceType,
  );
  const canViewCompany = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_VIEW_COMPANY.action,
    ATT_ENGINE_PAIRS.REMOTE_VIEW_COMPANY.resourceType,
  );
  const canApprove = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_APPROVE.action,
    ATT_ENGINE_PAIRS.REMOTE_APPROVE.resourceType,
  );
  const canReject = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_REJECT.action,
    ATT_ENGINE_PAIRS.REMOTE_REJECT.resourceType,
  );
  const canCreateOwn = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_CREATE_OWN.action,
    ATT_ENGINE_PAIRS.REMOTE_CREATE_OWN.resourceType,
  );
  const canCancelOwn = useCanExact(
    ATT_ENGINE_PAIRS.REMOTE_CANCEL_OWN.action,
    ATT_ENGINE_PAIRS.REMOTE_CANCEL_OWN.resourceType,
  );

  const canView = canViewOwn || canViewTeam || canViewCompany;
  const { data, isLoading, isError, refetch } = useRemoteWorkRequestDetail(requestId, canView);

  const [dialog, setDialog] = useState<"submit" | "approve" | "reject" | "cancel" | null>(null);

  function goBack() {
    void navigate({ to: ATT_PATHS.REMOTE_WORK_REQUESTS as "/" });
  }

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("remoteWork.forbidden.title")}
          description={t("remoteWork.forbidden.description")}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (isError || !data) {
    const notFound = isError; // getDetail 404 khi ngoài scope — không phân biệt để tránh lộ tồn tại
    return (
      <div className="p-6">
        <EmptyState
          title={t("remoteWork.detail.notFound.title")}
          description={t("remoteWork.detail.notFound.description")}
          action={
            <Button variant="outline" size="sm" onClick={notFound ? goBack : () => void refetch()}>
              {notFound ? (
                <>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("remoteWork.detail.backToList")}
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {tc("actions.retry")}
                </>
              )}
            </Button>
          }
        />
      </div>
    );
  }

  const isOwner = data.requestedBy != null && data.requestedBy === currentUserId;
  const canSubmit = isOwner && canCreateOwn && data.status === REMOTE_REQUEST_STATUS.DRAFT;
  const canCancel =
    isOwner &&
    canCancelOwn &&
    (data.status === REMOTE_REQUEST_STATUS.DRAFT || data.status === REMOTE_REQUEST_STATUS.PENDING);
  const canDecide = data.status === REMOTE_REQUEST_STATUS.PENDING && !isOwner;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("remoteWork.detail.title")}
        actions={
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("remoteWork.detail.backToList")}
          </Button>
        }
      />

      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow label={t("remoteWork.detail.fields.code")} value={data.requestCode} />
          <FieldRow label={t("remoteWork.detail.fields.employee")} value={data.fullName} />
          <FieldRow
            label={t("remoteWork.detail.fields.type")}
            value={t(`remoteWork.requestType.${data.requestType}`, {
              defaultValue: data.requestType,
            })}
          />
          <FieldRow
            label={t("remoteWork.detail.fields.period")}
            value={
              data.startDate === data.endDate
                ? data.startDate
                : `${data.startDate} → ${data.endDate}`
            }
          />
          <FieldRow
            label={t("remoteWork.detail.fields.attendanceMode")}
            value={t(`remoteWork.attendanceMode.${data.attendanceMode}`, {
              defaultValue: data.attendanceMode,
            })}
          />
          <FieldRow label={t("remoteWork.detail.fields.location")} value={data.locationText} />
          <FieldRow label={t("remoteWork.detail.fields.reason")} value={data.reason} />
          <FieldRow
            label={t("remoteWork.detail.fields.status")}
            value={
              <Badge>{t(`remoteWork.status.${data.status}`, { defaultValue: data.status })}</Badge>
            }
          />
          {data.currentApproverUserId && (
            <FieldRow
              label={t("remoteWork.detail.fields.approver")}
              value={data.currentApproverUserId}
            />
          )}
          {data.watcherUserIds.length > 0 && (
            <FieldRow
              label={t("remoteWork.detail.fields.watchers")}
              value={data.watcherUserIds.join(", ")}
            />
          )}
          {data.rejectReason && (
            <FieldRow
              label={t("remoteWork.detail.fields.rejectReason")}
              value={data.rejectReason}
            />
          )}
        </CardContent>
      </Card>

      {(canSubmit || canCancel || (canDecide && (canApprove || canReject))) && (
        <div className="flex justify-end gap-3">
          {canCancel && (
            <Button variant="destructive" size="sm" onClick={() => setDialog("cancel")}>
              {t("remoteWork.actions.cancel")}
            </Button>
          )}
          {canDecide && canReject && (
            <Button variant="outline" size="sm" onClick={() => setDialog("reject")}>
              {t("remoteWork.actions.reject")}
            </Button>
          )}
          {canDecide && canApprove && (
            <Button size="sm" onClick={() => setDialog("approve")}>
              {t("remoteWork.actions.approve")}
            </Button>
          )}
          {canSubmit && (
            <Button
              size="sm"
              onClick={() => setDialog("submit")}
              data-testid="remote-work-submit-btn"
            >
              {t("remoteWork.actions.submit")}
            </Button>
          )}
        </div>
      )}

      {dialog === "submit" && (
        <SubmitRemoteWorkDialog requestId={requestId} onClose={() => setDialog(null)} />
      )}
      {dialog === "approve" && <ApproveDialog id={requestId} onClose={() => setDialog(null)} />}
      {dialog === "reject" && <RejectDialog id={requestId} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && <CancelDialog id={requestId} onClose={() => setDialog(null)} />}
    </div>
  );
}
