import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { PageHeader, EmptyState } from "@mediaos/ui";
import { LeaveRequestForm } from "./LeaveRequestForm";
import { LEAVE_ENGINE_PAIRS, LEAVE_PATHS } from "./constants";

export function CreateLeaveRequestPage() {
  const { t } = useTranslation("leave");
  const navigate = useNavigate();
  const canCreate = useCan(
    LEAVE_ENGINE_PAIRS.CREATE_REQUEST.action,
    LEAVE_ENGINE_PAIRS.CREATE_REQUEST.resourceType,
  );

  function handleSuccess(id: string, status: string) {
    // Navigate to detail; for Pending (submitted) show detail, for Draft also show detail
    void navigate({ to: LEAVE_PATHS.DETAIL(id) as "/" });
    // Optionally show a toast – the detail page itself shows the new status
    void status; // consumed
  }

  function handleCancel() {
    void navigate({ to: LEAVE_PATHS.MY_REQUESTS as "/" });
  }

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canCreate) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("form.forbidden.title")}
          description={t("form.forbidden.description")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("form.titleCreate")}
        description={t("form.descriptionCreate")}
        icon={CalendarDays}
      />
      <LeaveRequestForm onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  );
}
