/**
 * AdjustmentRequestDetailPage — chi tiết đơn điều chỉnh + duyệt/từ chối (ATT-SCREEN-009, S3-FE-ATT-3).
 *
 * KHÔNG gate render bằng useCan('view-own'/'view-team'/'view-company'/'approve'/'reject','adjustment') —
 * sensitive KHÔNG allowlisted (constants.ts) → luôn false nếu dùng, chặn oan cả người có quyền thật. Server
 * là cổng thật: fetch vô điều kiện; 403 → forbidden, 404 → notFound. Nút Duyệt/Từ chối hiện khi status=Pending
 * (đã xem được đơn ⇒ có ít nhất 1 quyền view) — request POST approve/reject là điểm enforce thật (403 ⇒ hiển
 * thị lỗi inline, KHÔNG throw ra ngoài).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { AttendanceAdjustmentItemDto } from "@mediaos/contracts";
import { ApiError, formatDateTime } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Dialog } from "@mediaos/ui";
import { AdjustmentStatusBadge } from "./AdjustmentStatusBadge";
import {
  useAdjustmentRequestDetail,
  useApproveAdjustmentRequest,
  useRejectAdjustmentRequest,
} from "./hooks/useAdjustmentRequests";
import { ADJUSTMENT_STATUS } from "./constants";
import { ATT_PATHS } from "../constants";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

// ── Items ledger (attendance_adjustment_items — append-only) ─────────────────

function ItemsLedger({
  items,
  t,
}: {
  items: AttendanceAdjustmentItemDto[];
  t: ReturnType<typeof useTranslation<"attendance">>["t"];
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("adjustment.detail.itemsEmpty")}</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-1.5 pr-2">{t("adjustment.detail.itemsColumns.field")}</th>
          <th className="py-1.5 pr-2">{t("adjustment.detail.itemsColumns.oldValue")}</th>
          <th className="py-1.5 pr-2">{t("adjustment.detail.itemsColumns.newValue")}</th>
          <th className="py-1.5">{t("adjustment.detail.itemsColumns.applied")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b last:border-0">
            <td className="py-1.5 pr-2">{item.fieldName}</td>
            <td className="py-1.5 pr-2 text-muted-foreground">{String(item.oldValue ?? "—")}</td>
            <td className="py-1.5 pr-2">{String(item.newValue ?? "—")}</td>
            <td className="py-1.5">
              {item.isApplied ? t("adjustment.detail.applied") : t("adjustment.detail.notApplied")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Approve/Reject dialogs ────────────────────────────────────────────────────

function ApproveDialog({
  open,
  onClose,
  onConfirm,
  isLoading,
  error,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
  isLoading: boolean;
  error: unknown;
  t: ReturnType<typeof useTranslation<"attendance">>["t"];
}) {
  const [note, setNote] = useState("");
  if (!open) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("adjustment.approve.title")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
            {t("adjustment.actions.dismiss")}
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(note.trim())}
            disabled={isLoading}
            data-testid="btn-confirm-approve"
          >
            {isLoading ? t("adjustment.approve.submitting") : t("adjustment.approve.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm">{t("adjustment.approve.confirm")}</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder={t("adjustment.approve.notePlaceholder")}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {error != null && (
          <p role="alert" className="text-sm text-destructive">
            {error instanceof ApiError && error.status === 403
              ? t("adjustment.approve.forbidden")
              : t("adjustment.approve.error")}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function RejectDialog({
  open,
  onClose,
  onConfirm,
  isLoading,
  error,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isLoading: boolean;
  error: unknown;
  t: ReturnType<typeof useTranslation<"attendance">>["t"];
}) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  if (!open) return null;

  function submit() {
    if (reason.trim().length === 0) {
      setReasonError(t("adjustment.reject.reasonRequired"));
      return;
    }
    setReasonError(null);
    onConfirm(reason.trim());
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("adjustment.reject.title")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
            {t("adjustment.actions.dismiss")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={submit}
            disabled={isLoading}
            data-testid="btn-confirm-reject"
          >
            {isLoading ? t("adjustment.reject.submitting") : t("adjustment.reject.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <textarea
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (reasonError) setReasonError(null);
          }}
          rows={3}
          aria-invalid={reasonError ? true : undefined}
          placeholder={t("adjustment.reject.reasonPlaceholder")}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {reasonError && (
          <p role="alert" className="text-sm text-destructive">
            {reasonError}
          </p>
        )}
        {error != null && (
          <p role="alert" className="text-sm text-destructive">
            {error instanceof ApiError && error.status === 403
              ? t("adjustment.reject.forbidden")
              : t("adjustment.reject.error")}
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface AdjustmentRequestDetailPageProps {
  requestId: string;
}

export function AdjustmentRequestDetailPage({ requestId }: AdjustmentRequestDetailPageProps) {
  const { t } = useTranslation("attendance");
  const navigate = useNavigate();
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);

  const { data, isLoading, isError, error, refetch } = useAdjustmentRequestDetail(requestId);
  const approveMutation = useApproveAdjustmentRequest(requestId);
  const rejectMutation = useRejectAdjustmentRequest(requestId);

  function goBack() {
    void navigate({ to: ATT_PATHS.ADJUSTMENT_MY as "/" });
  }

  if (isLoading) {
    return (
      <div className="p-6" data-testid="detail-loading">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 rounded bg-muted" />
          <div className="h-40 rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (isError) {
    const isForbidden = error instanceof ApiError && error.status === 403;
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="p-6" data-testid={isForbidden ? "detail-forbidden" : "detail-error"}>
        <EmptyState
          title={
            isForbidden
              ? t("adjustment.detail.forbidden.title")
              : isNotFound
                ? t("adjustment.detail.notFound.title")
                : t("adjustment.detail.error.title")
          }
          description={
            isForbidden
              ? t("adjustment.detail.forbidden.description")
              : isNotFound
                ? t("adjustment.detail.notFound.description")
                : t("adjustment.detail.error.description")
          }
          action={
            isForbidden || isNotFound ? (
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("adjustment.detail.backToList")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            )
          }
        />
      </div>
    );
  }

  if (!data) return null;

  const isPending = data.status === ADJUSTMENT_STATUS.PENDING;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("adjustment.detail.title")}
        actions={
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("adjustment.detail.backToList")}
          </Button>
        }
      />

      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow label={t("adjustment.detail.fields.requestCode")} value={data.requestCode} />
          <FieldRow label={t("adjustment.detail.fields.employee")} value={data.fullName} />
          <FieldRow label={t("adjustment.detail.fields.workDate")} value={data.workDate} />
          <FieldRow
            label={t("adjustment.detail.fields.requestType")}
            value={t(`adjustment.requestType.${data.requestType}`)}
          />
          <FieldRow
            label={t("adjustment.detail.fields.status")}
            value={<AdjustmentStatusBadge status={data.status} />}
          />
          <FieldRow label={t("adjustment.detail.fields.reason")} value={data.reason} />
          {data.requestedCheckInAt && (
            <FieldRow
              label={t("adjustment.detail.fields.requestedCheckInAt")}
              value={formatDateTime(data.requestedCheckInAt)}
            />
          )}
          {data.requestedCheckOutAt && (
            <FieldRow
              label={t("adjustment.detail.fields.requestedCheckOutAt")}
              value={formatDateTime(data.requestedCheckOutAt)}
            />
          )}
          {data.submittedAt && (
            <FieldRow
              label={t("adjustment.detail.fields.submittedAt")}
              value={formatDateTime(data.submittedAt)}
            />
          )}
          {data.reviewedAt && (
            <FieldRow
              label={t("adjustment.detail.fields.reviewedAt")}
              value={formatDateTime(data.reviewedAt)}
            />
          )}
          {data.reviewNote && (
            <FieldRow label={t("adjustment.detail.fields.reviewNote")} value={data.reviewNote} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 space-y-3">
          <h3 className="text-sm font-semibold">{t("adjustment.detail.itemsTitle")}</h3>
          <ItemsLedger items={data.items} t={t} />
        </CardContent>
      </Card>

      {isPending && (
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowReject(true)}
            data-testid="btn-open-reject"
          >
            {t("adjustment.actions.reject")}
          </Button>
          <Button size="sm" onClick={() => setShowApprove(true)} data-testid="btn-open-approve">
            {t("adjustment.actions.approve")}
          </Button>
        </div>
      )}

      <ApproveDialog
        open={showApprove}
        onClose={() => setShowApprove(false)}
        onConfirm={(note) =>
          approveMutation.mutate(
            { note: note || undefined },
            { onSuccess: () => setShowApprove(false) },
          )
        }
        isLoading={approveMutation.isPending}
        error={approveMutation.error}
        t={t}
      />
      <RejectDialog
        open={showReject}
        onClose={() => setShowReject(false)}
        onConfirm={(reason) =>
          rejectMutation.mutate({ reason }, { onSuccess: () => setShowReject(false) })
        }
        isLoading={rejectMutation.isPending}
        error={rejectMutation.error}
        t={t}
      />
    </div>
  );
}
