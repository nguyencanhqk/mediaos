/**
 * CreateAdjustmentRequestPage — tạo đơn điều chỉnh công (ATT-SCREEN-006, S3-FE-ATT-3, P0).
 * Gate: useCan('create-own','adjustment') — NON-sensitive → an toàn dùng useCan (khác các cặp
 * view/approve/reject sensitive-KHÔNG-allowlisted, xem constants.ts).
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { FileEdit } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { PageHeader, EmptyState } from "@mediaos/ui";
import { AdjustmentRequestForm } from "./AdjustmentRequestForm";
import { ADJUSTMENT_ENGINE_PAIRS } from "./constants";
import { ATT_PATHS } from "../constants";

export function CreateAdjustmentRequestPage() {
  const { t } = useTranslation("attendance");
  const navigate = useNavigate();

  const canCreate = useCan(
    ADJUSTMENT_ENGINE_PAIRS.CREATE_OWN.action,
    ADJUSTMENT_ENGINE_PAIRS.CREATE_OWN.resourceType,
  );

  function handleSuccess(id: string) {
    void navigate({ to: ATT_PATHS.ADJUSTMENT_DETAIL(id) as "/" });
  }

  function handleCancel() {
    void navigate({ to: ATT_PATHS.ADJUSTMENT_MY as "/" });
  }

  if (!canCreate) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("adjustment.form.forbidden.title")}
          description={t("adjustment.form.forbidden.description")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("adjustment.form.titleCreate")}
        description={t("adjustment.form.descriptionCreate")}
        icon={FileEdit}
      />
      <AdjustmentRequestForm onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  );
}
