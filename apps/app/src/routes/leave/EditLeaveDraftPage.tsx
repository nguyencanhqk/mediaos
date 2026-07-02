import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, RefreshCw } from "lucide-react";
import { leaveApi, leaveKeys, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button } from "@mediaos/ui";
import { LeaveRequestForm } from "./LeaveRequestForm";
import { fromDraftDetailToFormValues } from "./leave-form-schema";
import { LEAVE_ENGINE_PAIRS, LEAVE_PATHS, LEAVE_STATUS } from "./constants";

/**
 * LEAVE-SCREEN-002E — sửa đơn nghỉ NHÁP (Draft-only) — S3-FE-LEAVE-3.
 *
 * Cổng: update-draft:leave (LEAVE.REQUEST.UPDATE_DRAFT). Server (S3-LEAVE-BE-2 updateDraft) chỉ cho
 * sửa đơn CỦA CHÍNH MÌNH (request.userId === actor.id, khác → 404) VÀ đang ở status='Draft' (khác →
 * 409 LEAVE-ERR-INVALID-STATE). FE dùng lại GET /leave/me/requests/:id (leaveApi.getMyRequest) để tải
 * dữ liệu hiện tại — route edit không có tham số quyền riêng ngoài update-draft; xem-được-đơn-nào vẫn
 * do server quyết (fail-closed nếu không phải chủ đơn).
 */
interface EditLeaveDraftPageProps {
  requestId: string;
}

export function EditLeaveDraftPage({ requestId }: EditLeaveDraftPageProps) {
  const { t } = useTranslation("leave");
  const navigate = useNavigate();

  const canUpdateDraft = useCan(
    LEAVE_ENGINE_PAIRS.UPDATE_DRAFT.action,
    LEAVE_ENGINE_PAIRS.UPDATE_DRAFT.resourceType,
  );

  const { data, error, isLoading, isError, refetch } = useQuery({
    queryKey: leaveKeys.requests.detail(requestId),
    queryFn: () => leaveApi.getMyRequest(requestId),
    enabled: canUpdateDraft,
    staleTime: 0, // luôn lấy bản mới nhất trước khi sửa — tránh ghi đè dữ liệu cũ
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 2;
    },
  });

  function goToDetail() {
    void navigate({ to: LEAVE_PATHS.DETAIL(requestId) as "/" });
  }

  function handleSuccess(id: string) {
    void navigate({ to: LEAVE_PATHS.DETAIL(id) as "/" });
  }

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canUpdateDraft) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("editForm.forbidden.title")}
          description={t("editForm.forbidden.description")}
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
          <div className="h-64 rounded bg-muted" />
        </div>
      </div>
    );
  }

  // ── Not found / error ──────────────────────────────────────────────────────
  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="p-6">
        <EmptyState
          title={notFound ? t("editForm.notFound.title") : t("editForm.error.title")}
          description={
            notFound ? t("editForm.notFound.description") : t("editForm.error.description")
          }
          action={
            !notFound ? (
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigate({ to: LEAVE_PATHS.MY_REQUESTS as "/" })}
              >
                {t("detail.backToList")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  // ── Business rule: chỉ sửa được đơn Draft (server cũng ép, đây là hint UX) ──
  if (data.status !== LEAVE_STATUS.DRAFT) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("editForm.notDraft.title")}
          description={t("editForm.notDraft.description")}
          action={
            <Button variant="outline" size="sm" onClick={goToDetail}>
              {t("editForm.backToDetail")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("form.titleEdit")}
        description={t("form.descriptionEdit")}
        icon={CalendarDays}
      />
      <LeaveRequestForm
        mode="edit"
        requestId={requestId}
        initialValues={fromDraftDetailToFormValues(data)}
        onSuccess={handleSuccess}
        onCancel={goToDetail}
      />
    </div>
  );
}
