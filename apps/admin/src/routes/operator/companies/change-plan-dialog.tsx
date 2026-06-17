import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  setSubscriptionSchema,
  type CompanySummaryDto,
  type SetSubscriptionRequest,
  type SubscriptionStatus,
} from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { platformCompaniesApi } from "@/lib/platform-companies-api";
import { COMPANIES_QUERY_KEY } from "./companies-query";

interface ChangePlanDialogProps {
  /** Công ty đang đổi gói; null = dialog đóng. */
  company: CompanySummaryDto | null;
  onClose: () => void;
}

const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "canceled",
];

/**
 * Dialog đổi gói công ty (gate `manage:platform-subscription` — KHÁC `manage:platform-company`).
 * Map vào `PUT admin/platform/companies/:id/subscription`.
 */
export function ChangePlanDialog({ company, onClose }: ChangePlanDialogProps) {
  const { t } = useTranslation("operator-companies");
  const queryClient = useQueryClient();
  const [planCode, setPlanCode] = useState("");
  const [status, setStatus] = useState<SubscriptionStatus>("active");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlanCode("");
    setStatus("active");
    setError(null);
  }, [company]);

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetSubscriptionRequest }) =>
      platformCompaniesApi.setSubscription(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMPANIES_QUERY_KEY });
      handleClose();
    },
    onError: () => setError(t("error.planFailed")),
  });

  const handleClose = () => {
    setError(null);
    mutation.reset();
    onClose();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;
    setError(null);
    const parsed = setSubscriptionSchema.safeParse({ planCode: planCode.trim(), status });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? t("error.planFailed"));
      return;
    }
    mutation.mutate({ id: company.id, body: parsed.data });
  };

  const statusLabel = (s: SubscriptionStatus): string => {
    switch (s) {
      case "active":
        return t("plan.statusActive");
      case "trialing":
        return t("plan.statusTrialing");
      case "past_due":
        return t("plan.statusPastDue");
      case "canceled":
        return t("plan.statusCanceled");
    }
  };

  return (
    <Dialog
      open={company !== null}
      onClose={handleClose}
      title={t("plan.title")}
      description={t("plan.description")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="submit"
            form="change-plan-form"
            disabled={mutation.isPending || !planCode.trim()}
          >
            {mutation.isPending ? t("common:saving") : t("plan.submit")}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" aria-live="assertive" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form id="change-plan-form" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="plan-code">
            {t("plan.planCodeLabel")}
          </label>
          <Input
            id="plan-code"
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            placeholder={t("plan.planCodePlaceholder")}
            autoFocus
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="plan-status">
            {t("plan.statusLabel")}
          </label>
          <Select
            id="plan-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
          >
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Dialog>
  );
}
