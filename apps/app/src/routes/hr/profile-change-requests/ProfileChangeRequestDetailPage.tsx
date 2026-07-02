/**
 * S2-FE-HR-4 — HR-SCREEN-019: /hr/profile-change-requests/:id.
 *
 * BE `GET /hr/profile-change-requests/:id` chỉ trả dữ liệu cho CHÍNH CHỦ yêu cầu (Own-scope — xem
 * ghi chú kiến trúc ở ProfileChangeRequestListPage.tsx). Trang này vì vậy phục vụ đúng luồng đó:
 * employee xem lại yêu cầu MÌNH đã gửi (từ /hr/me/change-request) — hiển thị so sánh giá trị
 * cũ/mới đầy đủ + tự hủy (POST /:id/cancel) khi còn Pending. Nếu server trả 404 (thường là HR mở
 * link của yêu cầu người khác — ngoài phạm vi endpoint này), trang hiện EmptyState hướng dẫn quay
 * lại danh sách tương ứng thay vì lỗi mập mờ.
 */
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, RefreshCw } from "lucide-react";
import { hrApi, hrKeys, hrInvalidation, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Dialog } from "@mediaos/ui";
import { useState } from "react";
import { HR_ENGINE_PAIRS } from "../constants";
import { ProfileChangeStatusBadge } from "./status-badge";
import { PROFILE_CHANGE_FIELD_META } from "./field-labels";

type TF = ReturnType<typeof useTranslation<"hr">>["t"];

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function fieldLabel(field: string, t: TF): string {
  const meta = PROFILE_CHANGE_FIELD_META[field as keyof typeof PROFILE_CHANGE_FIELD_META];
  return meta ? t(meta.labelKey) : field;
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

interface ProfileChangeRequestDetailPageProps {
  requestId: string;
}

export function ProfileChangeRequestDetailPage({ requestId }: ProfileChangeRequestDetailPageProps) {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();

  const canCancel = useCan(
    HR_ENGINE_PAIRS.CREATE_PROFILE_CHANGE_REQUEST.action,
    HR_ENGINE_PAIRS.CREATE_PROFILE_CHANGE_REQUEST.resourceType,
  );

  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: hrKeys.profileChangeRequests.detail(requestId),
    queryFn: () => hrApi.getProfileChangeRequestDetail(requestId),
    staleTime: 30_000,
    retry: (failCount, err) => {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 403) return false;
      return failCount < 2;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => hrApi.cancelProfileChangeRequest(requestId),
    onSuccess: async () => {
      for (const queryKey of hrInvalidation.cancelChangeRequest(requestId)) {
        await queryClient.invalidateQueries({ queryKey });
      }
      setConfirmCancelOpen(false);
    },
  });

  const notFound = isError && (error as { status?: number })?.status === 404;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={FileText} />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Not found (self-only endpoint — xem ghi chú kiến trúc ở đầu file) ────────
  if (notFound) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("changeRequest.detail.notFound.title")}
          description={t("changeRequest.detail.notFound.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("changeRequest.detail.error.title")}
          description={t("changeRequest.detail.error.description")}
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

  const canShowCancel = canCancel && data.status === "Pending";

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("changeRequest.detail.title")}
        description={data.employeeFullName}
        icon={FileText}
      />

      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <DetailRow
            label={t("changeRequest.detail.status")}
            value={<ProfileChangeStatusBadge status={data.status} />}
          />
          <DetailRow
            label={t("changeRequest.detail.submittedAt")}
            value={new Date(data.submittedAt).toLocaleString("vi-VN")}
          />
          {data.reason && (
            <DetailRow label={t("changeRequest.detail.reason")} value={data.reason} />
          )}
          {data.rejectionReason && (
            <DetailRow
              label={t("changeRequest.detail.rejectionReason")}
              value={data.rejectionReason}
            />
          )}
          {data.reviewedByName && (
            <DetailRow label={t("changeRequest.detail.reviewedBy")} value={data.reviewedByName} />
          )}
          {data.reviewedAt && (
            <DetailRow
              label={t("changeRequest.detail.reviewedAt")}
              value={new Date(data.reviewedAt).toLocaleString("vi-VN")}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="mb-3 text-sm font-semibold text-foreground">
            {t("changeRequest.detail.diffTitle")}
          </p>
          <div className="divide-y divide-border">
            {data.changedFields.map((field) => (
              <div key={field} className="grid grid-cols-3 gap-2 py-2 text-sm">
                <span className="font-medium text-muted-foreground">{fieldLabel(field, t)}</span>
                <span className="text-muted-foreground line-through">
                  {renderValue(data.oldValues[field])}
                </span>
                <span className="text-foreground">{renderValue(data.newValues[field])}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {canShowCancel && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setConfirmCancelOpen(true)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("changeRequest.detail.cancelRequest")}
          </Button>
        </div>
      )}

      {confirmCancelOpen && (
        <Dialog
          open
          onClose={() => setConfirmCancelOpen(false)}
          title={t("changeRequest.detail.cancelConfirmTitle")}
          footer={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmCancelOpen(false)}
                disabled={cancelMutation.isPending}
              >
                {t("changeRequest.list.actions.back")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending
                  ? t("changeRequest.detail.cancelling")
                  : t("changeRequest.detail.confirmCancel")}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t("changeRequest.detail.cancelConfirmDescription")}</p>
          {cancelMutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {cancelMutation.error instanceof ApiError && cancelMutation.error.status === 409
                ? t("changeRequest.detail.cancelConflict")
                : t("changeRequest.detail.cancelError")}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
