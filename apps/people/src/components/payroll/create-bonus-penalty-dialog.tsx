import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { BonusReferenceType, CreateBonusPenaltyRequest } from "@mediaos/contracts";
import { bonusPenaltyApi } from "@/lib/bonus-penalty-api";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import {
  BONUS_KIND_LABELS,
  BONUS_REFERENCE_TYPE_LABELS,
  BONUS_SOURCE_LABELS,
} from "./bonus-penalty-constants";

/** Lý do tối đa (parity createBonusPenaltySchema.reason max 500). */
const REASON_MAX = 500;
/** YYYY-MM (parity periodMonthSchema). */
const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type ReferenceChoice = "" | BonusReferenceType;

/**
 * Form tạo thưởng/phạt. Validate mirror createBonusPenaltySchema:
 *  - userId required, amount > 0, periodMonth = YYYY-MM,
 *  - kind bonus/penalty, source manual/kpi/defect,
 *  - reference ĐÚNG-MỘT-HOẶC-KHÔNG: chọn referenceType ⇒ bắt buộc đúng 1 id; đổi type ⇒ reset id
 *    (giữ duy nhất 1 id để không gửi >1 reference, tránh 400 ở superRefine BE).
 * PARENT bọc trong <PermissionGate manage-bonus-penalty> — nhưng server (@RequirePermission) là
 * chốt thật: thiếu quyền ⇒ 403 khi submit. KHÔNG log/cache số tiền (chỉ giữ state form tới khi gửi).
 */
export function CreateBonusPenaltyDialog() {
  const { t } = useTranslation("payroll");
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<CreateBonusPenaltyRequest["kind"]>("bonus");
  const [source, setSource] = useState<CreateBonusPenaltyRequest["source"]>("manual");
  const [amount, setAmount] = useState("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [reason, setReason] = useState("");
  const [referenceType, setReferenceType] = useState<ReferenceChoice>("");
  const [referenceId, setReferenceId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const resetForm = () => {
    setUserId("");
    setAmount("");
    setPeriodMonth("");
    setReason("");
    setReferenceType("");
    setReferenceId("");
    setError(null);
  };

  const mutation = useMutation({
    mutationFn: (data: CreateBonusPenaltyRequest) => bonusPenaltyApi.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bonus-penalties"] });
      setOpen(false);
      resetForm();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("createBonusPenalty.createError"));
    },
  });

  /** Đổi referenceType ⇒ reset id cũ (đúng-một reference, không để id sót lại). */
  const onReferenceTypeChange = (value: ReferenceChoice) => {
    setReferenceType(value);
    setReferenceId("");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError(t("createBonusPenalty.validationAmount"));
      return;
    }
    if (!PERIOD_MONTH_RE.test(periodMonth)) {
      setError(t("createBonusPenalty.validationPeriod"));
      return;
    }
    if (referenceType !== "" && referenceId.trim() === "") {
      setError(t("createBonusPenalty.validationReferenceId"));
      return;
    }

    // Đúng-một reference: chỉ set đúng cột FK tương ứng referenceType (các cột khác undefined).
    const refFields: Pick<
      CreateBonusPenaltyRequest,
      "referenceType" | "taskId" | "defectId" | "kpiResultId"
    > =
      referenceType === "task"
        ? { referenceType, taskId: referenceId }
        : referenceType === "defect"
          ? { referenceType, defectId: referenceId }
          : referenceType === "kpi_result"
            ? { referenceType, kpiResultId: referenceId }
            : {};

    mutation.mutate({
      userId,
      kind,
      amount: amountNum,
      periodMonth,
      source,
      reason: reason.trim() ? reason.trim() : undefined,
      ...refFields,
    });
  };

  if (!open) {
    return <Button onClick={() => setOpen(true)}>{t("createBonusPenalty.addButton")}</Button>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-medium">{t("createBonusPenalty.formTitle")}</h2>

      <div className="space-y-1">
        <label htmlFor="bp-userId" className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("createBonusPenalty.employeeIdLabel")}
        </label>
        <Input
          id="bp-userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder={t("createBonusPenalty.employeeIdPlaceholder")}
          required
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <label htmlFor="bp-kind" className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("createBonusPenalty.kindLabel")}
          </label>
          <Select
            id="bp-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as CreateBonusPenaltyRequest["kind"])}
          >
            {(Object.keys(BONUS_KIND_LABELS) as Array<keyof typeof BONUS_KIND_LABELS>).map((k) => (
              <option key={k} value={k}>
                {BONUS_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1 space-y-1">
          <label
            htmlFor="bp-source"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t("createBonusPenalty.sourceLabel")}
          </label>
          <Select
            id="bp-source"
            value={source}
            onChange={(e) => setSource(e.target.value as CreateBonusPenaltyRequest["source"])}
          >
            {(Object.keys(BONUS_SOURCE_LABELS) as Array<keyof typeof BONUS_SOURCE_LABELS>).map(
              (s) => (
                <option key={s} value={s}>
                  {BONUS_SOURCE_LABELS[s]}
                </option>
              ),
            )}
          </Select>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <label
            htmlFor="bp-amount"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t("createBonusPenalty.amountLabel")}
          </label>
          {/* Validation tiền > 0 do JS guard ở onSubmit (1 nguồn sự thật, kiểm thử được).
              KHÔNG dùng native min/required ở đây để guard luôn chạy & hiện thông báo thân thiện. */}
          <Input
            id="bp-amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="VND"
          />
        </div>
        <div className="flex-1 space-y-1">
          <label
            htmlFor="bp-period"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t("createBonusPenalty.periodLabel")}
          </label>
          <Input
            id="bp-period"
            type="month"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            placeholder="2026-06"
            required
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <label htmlFor="bp-ref" className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("createBonusPenalty.referenceLabel")}
          </label>
          <Select
            id="bp-ref"
            value={referenceType}
            onChange={(e) => onReferenceTypeChange(e.target.value as ReferenceChoice)}
          >
            <option value="">{t("createBonusPenalty.referenceNone")}</option>
            {(
              Object.keys(BONUS_REFERENCE_TYPE_LABELS) as Array<
                keyof typeof BONUS_REFERENCE_TYPE_LABELS
              >
            ).map((r) => (
              <option key={r} value={r}>
                {BONUS_REFERENCE_TYPE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1 space-y-1">
          <label
            htmlFor="bp-refId"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t("createBonusPenalty.referenceIdLabel")}
          </label>
          <Input
            id="bp-refId"
            value={referenceId}
            onChange={(e) => setReferenceId(e.target.value)}
            placeholder="UUID"
            disabled={referenceType === ""}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="bp-reason" className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("createBonusPenalty.reasonLabel")}
        </label>
        <Input
          id="bp-reason"
          value={reason}
          maxLength={REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("createBonusPenalty.reasonPlaceholder")}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t("createBonusPenalty.saving") : t("createBonusPenalty.save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            resetForm();
          }}
        >
          {t("createBonusPenalty.cancel")}
        </Button>
      </div>
    </form>
  );
}
