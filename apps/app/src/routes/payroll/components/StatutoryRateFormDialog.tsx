import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateStatutoryRateRequest, StatutoryRateDto } from "@mediaos/contracts";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";
import { parsePayrollError, payrollErrorText } from "../payroll-errors";

/** Đúng 7 bậc TNCN (service ép ⇒ 422 022 `statutory-rate-incomplete`); bậc cuối `upTo = null`. */
export const PIT_BRACKET_COUNT = 7;
const MONEY_MAX = 999_999_999_999.99;

export const RATE_PCT_FIELDS = [
  "siEmployeePct",
  "hiEmployeePct",
  "uiEmployeePct",
  "siEmployerPct",
  "hiEmployerPct",
  "uiEmployerPct",
  "unionEmployerPct",
  "unionEmployeePct",
] as const;
/** Tiền DƯƠNG (mirror `POSITIVE_MONEY_INPUT`). */
export const RATE_POSITIVE_MONEY_FIELDS = [
  "siCap",
  "hiCap",
  "uiCap",
  "baseWage",
  "minRegionWage",
] as const;
/** Tiền ≥ 0 (mirror `MONEY_INPUT`). */
export const RATE_MONEY_FIELDS = ["personalDeduction", "dependentDeduction"] as const;

type PctField = (typeof RATE_PCT_FIELDS)[number];
type MoneyField = (typeof RATE_POSITIVE_MONEY_FIELDS)[number] | (typeof RATE_MONEY_FIELDS)[number];

export interface RateFormState {
  effectiveFrom: string;
  values: Record<PctField | MoneyField, string>;
  brackets: { upTo: string; rate: string }[];
  note: string;
}

const emptyValues = (): RateFormState["values"] =>
  Object.fromEntries(
    [...RATE_PCT_FIELDS, ...RATE_POSITIVE_MONEY_FIELDS, ...RATE_MONEY_FIELDS].map((k) => [k, ""]),
  ) as RateFormState["values"];

export function emptyRateForm(): RateFormState {
  return {
    effectiveFrom: "",
    values: emptyValues(),
    brackets: Array.from({ length: PIT_BRACKET_COUNT }, () => ({ upTo: "", rate: "" })),
    note: "",
  };
}

/** Bản có sẵn ⇒ form. `copy=true` ⇒ bỏ ngày hiệu lực (bản mới phải có ngày MỚI — trùng ⇒ 409 033). */
export function rateToForm(rate: StatutoryRateDto, copy: boolean): RateFormState {
  const values = emptyValues();
  for (const k of [...RATE_PCT_FIELDS, ...RATE_POSITIVE_MONEY_FIELDS, ...RATE_MONEY_FIELDS]) {
    values[k] = String(rate[k]);
  }
  const brackets = Array.from({ length: PIT_BRACKET_COUNT }, (_, i) => {
    const b = rate.pitBrackets[i];
    return { upTo: b?.upTo == null ? "" : String(b.upTo), rate: b ? String(b.rate) : "" };
  });
  return {
    effectiveFrom: copy ? "" : rate.effectiveFrom,
    values,
    brackets,
    note: copy ? "" : (rate.note ?? ""),
  };
}

const toCents = (n: number) => Math.round(n * 100) / 100;
const num = (raw: string): number | null => {
  if (raw.trim() === "") return null;
  const n = Number(raw.replace(/\s/g, ""));
  return Number.isFinite(n) ? toCents(n) : null;
};

/**
 * Form ⇒ payload 056. `null` khi còn ô sai HÌNH DẠNG (rỗng · ngoài miền). Tính LIÊN TỤC của 7 bậc KHÔNG kiểm
 * ở đây — server ép và trả `reason` (luật 2 của contracts `payroll-catalog.ts`).
 */
export function formToPayload(form: RateFormState): CreateStatutoryRateRequest | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveFrom)) return null;
  const out: Record<string, number> = {};
  for (const k of RATE_PCT_FIELDS) {
    const v = num(form.values[k]);
    if (v === null || v < 0 || v > 100) return null;
    out[k] = v;
  }
  for (const k of RATE_POSITIVE_MONEY_FIELDS) {
    const v = num(form.values[k]);
    if (v === null || v <= 0 || v > MONEY_MAX) return null;
    out[k] = v;
  }
  for (const k of RATE_MONEY_FIELDS) {
    const v = num(form.values[k]);
    if (v === null || v < 0 || v > MONEY_MAX) return null;
    out[k] = v;
  }
  const pitBrackets: { upTo: number | null; rate: number }[] = [];
  for (const [i, b] of form.brackets.entries()) {
    const rate = num(b.rate);
    if (rate === null || rate < 0 || rate > 100) return null;
    const isLast = i === form.brackets.length - 1;
    const upTo = isLast ? null : num(b.upTo);
    if (!isLast && (upTo === null || upTo <= 0)) return null;
    pitBrackets.push({ upTo, rate });
  }
  return {
    ...(out as Omit<CreateStatutoryRateRequest, "effectiveFrom" | "pitBrackets" | "note">),
    effectiveFrom: form.effectiveFrom,
    pitBrackets,
    note: form.note.trim() === "" ? null : form.note.trim(),
  };
}

export type RateFormMode =
  | { kind: "create" }
  | { kind: "edit"; rate: StatutoryRateDto }
  | { kind: "copy"; rate: StatutoryRateDto };

/**
 * PAY-SCREEN-011 — tạo (056) / sửa (058) một bản tỉ lệ luật định (`manage:statutory-rate`).
 *
 * «Sao chép thành bản mới» (D14) là đường chuẩn khi luật đổi: bản đã có kỳ dùng (`inUse`) KHÔNG sửa tại chỗ
 * được (409 `rate-in-use`) — sửa nó là đổi tiền của kỳ đã tính.
 */
export function StatutoryRateFormDialog({
  open,
  onClose,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  mode: RateFormMode;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RateFormState>(emptyRateForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(mode.kind === "create" ? emptyRateForm() : rateToForm(mode.rate, mode.kind === "copy"));
    setError(null);
  }, [open, mode]);

  const payload = formToPayload(form);

  const mutation = useMutation({
    mutationFn: () => {
      if (!payload) throw new Error("invalid-form");
      if (mode.kind === "edit") return payrollApi.updateStatutoryRate(mode.rate.id, payload);
      return payrollApi.createStatutoryRate(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.catalog.allOf() });
      onClose();
    },
    onError: (e) => setError(payrollErrorText(t, parsePayrollError(e))),
  });

  const setValue = (key: PctField | MoneyField, v: string) =>
    setForm((prev) => ({ ...prev, values: { ...prev.values, [key]: v } }));
  const setBracket = (i: number, key: "upTo" | "rate", v: string) =>
    setForm((prev) => ({
      ...prev,
      brackets: prev.brackets.map((b, j) => (j === i ? { ...b, [key]: v } : b)),
    }));

  const title =
    mode.kind === "edit"
      ? t("rateForm.editTitle")
      : mode.kind === "copy"
        ? t("rateForm.copyTitle")
        : t("rateForm.title");

  const field = (key: PctField | MoneyField, suffix: string) => (
    <label key={key} className="block text-xs">
      <span className="mb-1 block text-muted-foreground">{t(`rateFields.${key}`)}</span>
      <div className="flex items-center gap-1">
        <Input
          value={form.values[key]}
          inputMode="decimal"
          onChange={(e) => setValue(key, e.target.value)}
          className="h-8 tabular-nums"
        />
        <span className="text-muted-foreground">{suffix}</span>
      </div>
    </label>
  );

  return (
    <Dialog
      open={open}
      onClose={mutation.isPending ? () => {} : onClose}
      title={title}
      className="max-w-3xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!payload || mutation.isPending}>
            {t("rateForm.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="rounded-md border border-warning/40 bg-warning-muted/40 px-3 py-2 text-sm">
          {t("statutoryRates.disclaimer")}
        </p>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("rateForm.effectiveFrom")}</span>
          <Input
            type="date"
            value={form.effectiveFrom}
            onChange={(e) => setForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
            className="w-48"
          />
        </label>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t("rateForm.pctTitle")}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RATE_PCT_FIELDS.map((k) => field(k, "%"))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t("rateForm.moneyTitle")}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[...RATE_POSITIVE_MONEY_FIELDS, ...RATE_MONEY_FIELDS].map((k) => field(k, "₫"))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t("rateForm.bracketsTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("rateForm.bracketsHint")}</p>
          <div className="grid gap-2">
            {form.brackets.map((b, i) => {
              const isLast = i === form.brackets.length - 1;
              return (
                <div key={i} className="grid grid-cols-[4rem_1fr_8rem] items-center gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {t("rateForm.bracket", { n: i + 1 })}
                  </span>
                  {isLast ? (
                    <span className="text-muted-foreground">{t("rateForm.lastBracket")}</span>
                  ) : (
                    <Input
                      value={b.upTo}
                      inputMode="decimal"
                      placeholder={t("rateForm.upTo")}
                      aria-label={t("rateForm.upToFor", { n: i + 1 })}
                      onChange={(e) => setBracket(i, "upTo", e.target.value)}
                      className="h-8 tabular-nums"
                    />
                  )}
                  <div className="flex items-center gap-1">
                    <Input
                      value={b.rate}
                      inputMode="decimal"
                      aria-label={t("rateForm.rateFor", { n: i + 1 })}
                      onChange={(e) => setBracket(i, "rate", e.target.value)}
                      className="h-8 tabular-nums"
                    />
                    <span className="text-muted-foreground">%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("rateForm.note")}</span>
          <textarea
            rows={2}
            value={form.note}
            maxLength={1000}
            onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        {!payload && <p className="text-xs text-muted-foreground">{t("rateForm.incomplete")}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
