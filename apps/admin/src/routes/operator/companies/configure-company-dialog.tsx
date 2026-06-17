import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateCompanySchema, type CompanySummaryDto, type UpdateCompanyRequest } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { platformCompaniesApi } from "@/lib/platform-companies-api";
import { COMPANIES_QUERY_KEY } from "./companies-query";

interface ConfigureCompanyDialogProps {
  /** Công ty đang cấu hình; null = dialog đóng. */
  company: CompanySummaryDto | null;
  onClose: () => void;
}

type FormState = {
  name: string;
  timezone: string;
  currency: "VND" | "USD";
  language: "vi" | "en";
  logoUrl: string;
};

function initFrom(company: CompanySummaryDto | null): FormState {
  return {
    name: company?.name ?? "",
    timezone: company?.timezone ?? "",
    currency: (company?.currency === "USD" ? "USD" : "VND") as FormState["currency"],
    language: (company?.language === "en" ? "en" : "vi") as FormState["language"],
    logoUrl: "",
  };
}

/** Chỉ gửi field THỰC SỰ đổi so với giá trị gốc (PATCH partial). logoUrl không có trong summary
 *  ⇒ chỉ gửi khi người dùng nhập (mask-by-server: ta không đọc lại giá trị cũ). */
function buildPatch(form: FormState, company: CompanySummaryDto): UpdateCompanyRequest {
  const patch: UpdateCompanyRequest = {};
  if (form.name.trim() && form.name.trim() !== company.name) patch.name = form.name.trim();
  if (form.timezone.trim() && form.timezone.trim() !== company.timezone)
    patch.timezone = form.timezone.trim();
  if (form.currency !== company.currency) patch.currency = form.currency;
  if (form.language !== company.language) patch.language = form.language;
  if (form.logoUrl.trim()) patch.logoUrl = form.logoUrl.trim();
  return patch;
}

/** Dialog cấu hình công ty — PATCH partial, validate qua contract Zod. */
export function ConfigureCompanyDialog({ company, onClose }: ConfigureCompanyDialogProps) {
  const { t } = useTranslation("operator-companies");
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initFrom(company));
  const [error, setError] = useState<string | null>(null);

  // Đồng bộ form khi đổi công ty đang chọn.
  useEffect(() => {
    setForm(initFrom(company));
    setError(null);
  }, [company]);

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCompanyRequest }) =>
      platformCompaniesApi.configure(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMPANIES_QUERY_KEY });
      handleClose();
    },
    onError: () => setError(t("error.configureFailed")),
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
    const patch = buildPatch(form, company);
    const parsed = updateCompanySchema.safeParse(patch);
    if (!parsed.success) {
      // refine "cần ít nhất 1 trường" → thông báo no-changes thân thiện.
      setError(t("configure.noChanges"));
      return;
    }
    mutation.mutate({ id: company.id, body: parsed.data });
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog
      open={company !== null}
      onClose={handleClose}
      title={t("configure.title")}
      description={t("configure.description")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button type="submit" form="configure-company-form" disabled={mutation.isPending}>
            {mutation.isPending ? t("common:saving") : t("configure.submit")}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" aria-live="assertive" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form id="configure-company-form" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="conf-name">
            {t("configure.nameLabel")}
          </label>
          <Input id="conf-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="conf-currency">
              {t("configure.currencyLabel")}
            </label>
            <Select
              id="conf-currency"
              value={form.currency}
              onChange={(e) => set("currency", e.target.value as FormState["currency"])}
            >
              <option value="VND">{t("currency.VND")}</option>
              <option value="USD">{t("currency.USD")}</option>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="conf-language">
              {t("configure.languageLabel")}
            </label>
            <Select
              id="conf-language"
              value={form.language}
              onChange={(e) => set("language", e.target.value as FormState["language"])}
            >
              <option value="vi">{t("language.vi")}</option>
              <option value="en">{t("language.en")}</option>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="conf-timezone">
            {t("configure.timezoneLabel")}
          </label>
          <Input
            id="conf-timezone"
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="conf-logo">
            {t("configure.logoUrlLabel")}
          </label>
          <Input
            id="conf-logo"
            type="url"
            value={form.logoUrl}
            onChange={(e) => set("logoUrl", e.target.value)}
            placeholder={t("configure.logoUrlPlaceholder")}
          />
        </div>
      </form>
    </Dialog>
  );
}
