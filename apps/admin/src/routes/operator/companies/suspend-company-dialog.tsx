import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CompanySummaryDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { platformCompaniesApi } from "@/lib/platform-companies-api";
import { COMPANIES_QUERY_KEY } from "./companies-query";

interface SuspendCompanyDialogProps {
  /** Công ty đang chọn để đình chỉ; null = dialog đóng. */
  company: CompanySummaryDto | null;
  onClose: () => void;
}

/** Dialog xác nhận đình chỉ công ty (status='suspended', KHÔNG hard-delete). */
export function SuspendCompanyDialog({ company, onClose }: SuspendCompanyDialogProps) {
  const { t } = useTranslation("operator-companies");
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => platformCompaniesApi.suspend(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMPANIES_QUERY_KEY });
      handleClose();
    },
    onError: () => setError(t("error.suspendFailed")),
  });

  const handleClose = () => {
    setError(null);
    mutation.reset();
    onClose();
  };

  return (
    <Dialog
      open={company !== null}
      onClose={handleClose}
      title={t("suspend.title")}
      description={t("suspend.description")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending || !company}
            onClick={() => company && mutation.mutate(company.id)}
          >
            {mutation.isPending ? t("common:saving") : t("suspend.submit")}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" aria-live="assertive" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {company && <p className="text-sm">{t("suspend.confirm", { name: company.name })}</p>}
    </Dialog>
  );
}
