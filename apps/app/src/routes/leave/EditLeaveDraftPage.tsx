import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, RefreshCw } from "lucide-react";
import { leaveApi, leaveKeys, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button } from "@mediaos/ui";
import { LeaveRequestForm } from "./LeaveRequestForm";
import { detailToFormValues } from "./leave-form-schema";
import { LEAVE_ENGINE_PAIRS, LEAVE_PATHS, LEAVE_STATUS } from "./constants";

/**
 * LEAVE-SCREEN-002E — Sửa đơn nháp. PATCH /leave/requests/:id (chỉ khi status='Draft', S3-LEAVE-BE-2).
 * Gate: update-draft:leave (LEAVE.REQUEST.UPDATE_DRAFT, Own — mig 0455). Đơn KHÔNG còn Draft (đã gửi/hủy
 * ở tab/phiên khác) → chặn MỀM ở FE trước khi mount form (khớp 409 LEAVE-ERR-INVALID-STATE của BE).
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

  // Own-scoped read (view-own:leave BE-side qua GET /leave/me/requests/:id) — tái dùng đúng endpoint đã
  // dùng để pre-fill (self-locked bởi user_id ở server; 404 nếu không phải chủ đơn / cross-tenant).
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: leaveKeys.requests.detail(requestId),
    queryFn: () => leaveApi.getMyRequest(requestId),
    enabled: canUpdateDraft,
    staleTime: 10_000,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 2;
    },
  });

  function goToDetail() {
    void navigate({ to: LEAVE_PATHS.DETAIL(requestId) as "/" });
  }

  function handleSuccess(id: string, _status: string) {
    void _status; // consumed — server trả 'Draft' nguyên trạng sau PATCH
    void navigate({ to: LEAVE_PATHS.DETAIL(id) as "/" });
  }

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canUpdateDraft) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("form.editForbidden.title")}
          description={t("form.editForbidden.description")}
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

  // ── Error / not found ──────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("detail.error.title")}
          description={t("detail.error.description")}
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

  // ── Draft-only guard (khớp BE 409 INVALID_STATE khi đơn đã Pending/Approved/…) ─────────────
  if (data.status !== LEAVE_STATUS.DRAFT) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("form.editLocked.title")}
          description={t("form.editLocked.description")}
          action={
            <Button variant="outline" size="sm" onClick={goToDetail}>
              {t("detail.backToList")}
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
        initialValues={detailToFormValues(data)}
        onSuccess={handleSuccess}
        onCancel={goToDetail}
      />
    </div>
  );
}
