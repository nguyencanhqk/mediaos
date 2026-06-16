import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CreateSalaryProfileRequest } from "@mediaos/contracts";
import { salaryProfileApi } from "@/lib/salary-profile-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SALARY_TYPE_LABELS, PAY_CYCLE_LABELS } from "./salary-constants";

/** Today as an ISO date (yyyy-mm-dd) for the default effective date. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create-salary-profile form. The PARENT wraps this in <PermissionGate> — but the real
 * authority is the server: a caller without manage-salary-profile gets 403 on submit.
 * We never persist or display salary client-side beyond the value the user just typed.
 */
export function CreateSalaryProfileDialog() {
  const { t } = useTranslation("payroll");
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [salaryType, setSalaryType] = useState<CreateSalaryProfileRequest["salaryType"]>("monthly");
  const [payCycle, setPayCycle] = useState<CreateSalaryProfileRequest["payCycle"]>("monthly");
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [baseSalary, setBaseSalary] = useState("");
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: CreateSalaryProfileRequest) => salaryProfileApi.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["salary-profiles"] });
      setOpen(false);
      setUserId("");
      setBaseSalary("");
      setError(null);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("createSalaryProfile.createError"));
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = Number(baseSalary);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t("createSalaryProfile.validationBaseSalary"));
      return;
    }
    mutation.mutate({
      userId,
      salaryType,
      payCycle,
      effectiveDate,
      baseSalary: amount,
      allowances: [],
    });
  };

  if (!open) {
    return <Button onClick={() => setOpen(true)}>{t("createSalaryProfile.addButton")}</Button>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-medium">{t("createSalaryProfile.formTitle")}</h2>

      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("createSalaryProfile.employeeIdLabel")}
        </label>
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder={t("createSalaryProfile.employeeIdPlaceholder")}
          required
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("createSalaryProfile.salaryTypeLabel")}
          </label>
          <Select
            value={salaryType}
            onChange={(e) =>
              setSalaryType(e.target.value as CreateSalaryProfileRequest["salaryType"])
            }
          >
            {(Object.keys(SALARY_TYPE_LABELS) as Array<keyof typeof SALARY_TYPE_LABELS>).map(
              (t) => (
                <option key={t} value={t}>
                  {SALARY_TYPE_LABELS[t]}
                </option>
              ),
            )}
          </Select>
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("createSalaryProfile.payCycleLabel")}
          </label>
          <Select
            value={payCycle}
            onChange={(e) => setPayCycle(e.target.value as CreateSalaryProfileRequest["payCycle"])}
          >
            {(Object.keys(PAY_CYCLE_LABELS) as Array<keyof typeof PAY_CYCLE_LABELS>).map((c) => (
              <option key={c} value={c}>
                {PAY_CYCLE_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("createSalaryProfile.effectiveDateLabel")}
          </label>
          <Input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            required
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("createSalaryProfile.baseSalaryLabel")}
          </label>
          <Input
            type="number"
            min={1}
            value={baseSalary}
            onChange={(e) => setBaseSalary(e.target.value)}
            placeholder="VND"
            required
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t("createSalaryProfile.saving") : t("createSalaryProfile.save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t("createSalaryProfile.cancel")}
        </Button>
      </div>
    </form>
  );
}
