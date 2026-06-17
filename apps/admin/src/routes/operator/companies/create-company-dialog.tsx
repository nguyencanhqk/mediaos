import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createCompanySchema, type CreateCompanyRequest } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api-client";
import { platformCompaniesApi } from "@/lib/platform-companies-api";
import { COMPANIES_QUERY_KEY } from "./companies-query";

interface CreateCompanyDialogProps {
  open: boolean;
  onClose: () => void;
}

type FormState = {
  name: string;
  slug: string;
  timezone: string;
  currency: "VND" | "USD";
  language: "vi" | "en";
  templateCode: string;
  planCode: string;
};

const INITIAL: FormState = {
  name: "",
  slug: "",
  timezone: "",
  currency: "VND",
  language: "vi",
  templateCode: "",
  planCode: "",
};

/** Build payload — bỏ field rỗng để BE dùng default (template 'starter', plan 'free'). */
function toRequest(form: FormState): CreateCompanyRequest {
  const body: CreateCompanyRequest = { name: form.name.trim(), slug: form.slug.trim() };
  if (form.timezone.trim()) body.timezone = form.timezone.trim();
  body.currency = form.currency;
  body.language = form.language;
  if (form.templateCode.trim()) body.templateCode = form.templateCode.trim();
  if (form.planCode.trim()) body.planCode = form.planCode.trim();
  return body;
}

/** Dialog tạo công ty mới — validate qua contract Zod TRƯỚC khi gọi API (fail fast). */
export function CreateCompanyDialog({ open, onClose }: CreateCompanyDialogProps) {
  const { t } = useTranslation("operator-companies");
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: CreateCompanyRequest) => platformCompaniesApi.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMPANIES_QUERY_KEY });
      handleClose();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("error.slugConflict"));
        return;
      }
      setError(t("error.createFailed"));
    },
  });

  const handleClose = () => {
    setForm(INITIAL);
    setError(null);
    mutation.reset();
    onClose();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = createCompanySchema.safeParse(toRequest(form));
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? t("error.createFailed"));
      return;
    }
    mutation.mutate(parsed.data);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("create.title")}
      description={t("create.description")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button type="submit" form="create-company-form" disabled={mutation.isPending}>
            {mutation.isPending ? t("common:saving") : t("create.submit")}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" aria-live="assertive" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form id="create-company-form" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="cc-name">
            {t("create.nameLabel")}
          </label>
          <Input
            id="cc-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={t("create.namePlaceholder")}
            autoFocus
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="cc-slug">
            {t("create.slugLabel")}
          </label>
          <Input
            id="cc-slug"
            value={form.slug}
            onChange={(e) => set("slug", e.target.value)}
            placeholder={t("create.slugPlaceholder")}
            aria-describedby="cc-slug-hint"
            required
          />
          <p id="cc-slug-hint" className="text-xs text-muted-foreground">
            {t("create.slugHint")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="cc-currency">
              {t("create.currencyLabel")}
            </label>
            <Select
              id="cc-currency"
              value={form.currency}
              onChange={(e) => set("currency", e.target.value as FormState["currency"])}
            >
              <option value="VND">{t("currency.VND")}</option>
              <option value="USD">{t("currency.USD")}</option>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="cc-language">
              {t("create.languageLabel")}
            </label>
            <Select
              id="cc-language"
              value={form.language}
              onChange={(e) => set("language", e.target.value as FormState["language"])}
            >
              <option value="vi">{t("language.vi")}</option>
              <option value="en">{t("language.en")}</option>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="cc-timezone">
            {t("create.timezoneLabel")}
          </label>
          <Input
            id="cc-timezone"
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            placeholder="Asia/Ho_Chi_Minh"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="cc-template">
              {t("create.templateLabel")}
            </label>
            <Input
              id="cc-template"
              value={form.templateCode}
              onChange={(e) => set("templateCode", e.target.value)}
              placeholder={t("create.templatePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="cc-plan">
              {t("create.planLabel")}
            </label>
            <Input
              id="cc-plan"
              value={form.planCode}
              onChange={(e) => set("planCode", e.target.value)}
              placeholder={t("create.planPlaceholder")}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
}
