/**
 * SYSTEM-SCREEN-COMPANY (S2-FE-FND-1 · FND1-APP) — /system/company view + edit.
 *
 * GET  /foundation/company/current  → render view (gate view:foundation-company).
 * PATCH /foundation/company/current → cập nhật hồ sơ (gate update:foundation-company). KHÔNG gửi company_id
 * (server resolve từ AuthContext — BẤT BIẾN #1). Dirty-form guard + ConfirmDialog TRƯỚC mutation (FRONTEND-13
 * §6.6); invalidate query current-company sau lưu.
 *
 * States: loading · error · empty · forbidden · view · edit. Nút edit/save ẨN khi thiếu update:foundation-company.
 */
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, RefreshCw } from "lucide-react";
import {
  foundationApi,
  foundationInvalidation,
  foundationKeys,
  useCan,
  type UpdateCompanyBody,
} from "@mediaos/web-core";
import type { CompanyView } from "@mediaos/contracts";
import { PageHeader, EmptyState, Button, Input, Card, CardContent } from "@mediaos/ui";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FOUNDATION_ENGINE_PAIRS } from "./constants";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

// ---------------------------------------------------------------------------
// Form schema — chỉ field EDITABLE (allow-list). KHÔNG có id/slug/status/companyCode/company_id.
// ---------------------------------------------------------------------------
const companyFormSchema = z.object({
  name: z.string().trim().min(1, { message: "company.validation.nameRequired" }),
  shortName: z.string().trim(),
  taxCode: z.string().trim(),
  businessType: z.string().trim(),
  address: z.string().trim(),
  phone: z.string().trim(),
  email: z
    .string()
    .trim()
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "company.validation.email",
    }),
  website: z.string().trim(),
});
type CompanyFormValues = z.infer<typeof companyFormSchema>;

const EMPTY_FORM: CompanyFormValues = {
  name: "",
  shortName: "",
  taxCode: "",
  businessType: "",
  address: "",
  phone: "",
  email: "",
  website: "",
};

function toFormValues(c: CompanyView): CompanyFormValues {
  return {
    name: c.name ?? "",
    shortName: c.shortName ?? "",
    taxCode: c.taxCode ?? "",
    businessType: c.businessType ?? "",
    address: c.address ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    website: c.website ?? "",
  };
}

/** Chuẩn hoá "" → null cho các field nullable (giữ name string). KHÔNG bao giờ chứa company_id. */
function toUpdateBody(v: CompanyFormValues): UpdateCompanyBody {
  const nn = (s: string): string | null => (s.trim() === "" ? null : s.trim());
  return {
    name: v.name.trim(),
    shortName: nn(v.shortName),
    taxCode: nn(v.taxCode),
    businessType: nn(v.businessType),
    address: nn(v.address),
    phone: nn(v.phone),
    email: nn(v.email),
    website: nn(v.website),
  };
}

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------
function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only view
// ---------------------------------------------------------------------------
function ReadOnlyRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value?.trim() ? value : "—"}</p>
    </div>
  );
}

function CompanyReadOnly({ company, t }: { company: CompanyView; t: TF }) {
  return (
    <Card>
      <CardContent className="grid gap-5 pt-5 sm:grid-cols-2">
        <ReadOnlyRow label={t("company.fields.name")} value={company.name} />
        <ReadOnlyRow label={t("company.fields.shortName")} value={company.shortName} />
        <ReadOnlyRow label={t("company.fields.companyCode")} value={company.companyCode} />
        <ReadOnlyRow label={t("company.fields.slug")} value={company.slug} />
        <ReadOnlyRow label={t("company.fields.status")} value={company.status} />
        <ReadOnlyRow label={t("company.fields.taxCode")} value={company.taxCode} />
        <ReadOnlyRow label={t("company.fields.businessType")} value={company.businessType} />
        <ReadOnlyRow label={t("company.fields.address")} value={company.address} />
        <ReadOnlyRow label={t("company.fields.phone")} value={company.phone} />
        <ReadOnlyRow label={t("company.fields.email")} value={company.email} />
        <ReadOnlyRow label={t("company.fields.website")} value={company.website} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function CompanyProfilePage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();

  const canView = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_COMPANY.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_COMPANY.resourceType,
  );
  const canUpdate = useCan(
    FOUNDATION_ENGINE_PAIRS.UPDATE_COMPANY.action,
    FOUNDATION_ENGINE_PAIRS.UPDATE_COMPANY.resourceType,
  );

  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery({
    queryKey: foundationKeys.company.current(),
    queryFn: foundationApi.getCompany,
    enabled: canView,
    staleTime: 30_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isDirty },
  } = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    mode: "onSubmit",
    defaultValues: EMPTY_FORM,
  });

  // Pre-fill ONCE khi detail về (guard ref chống refetch nền ghi đè edit đang dở).
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (query.data && !prefilledRef.current) {
      prefilledRef.current = true;
      reset(toFormValues(query.data));
    }
  }, [query.data, reset]);

  useDirtyFormGuard({ isDirty: editing && isDirty });

  const mutation = useMutation({
    mutationFn: (values: CompanyFormValues) => foundationApi.updateCompany(toUpdateBody(values)),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: foundationInvalidation.updateCompany()[0] });
      reset(toFormValues(updated));
      setEditing(false);
      setConfirmOpen(false);
    },
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("company.forbidden.title")}
          description={t("company.forbidden.description")}
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("company.title")}
          description={t("company.description")}
          icon={Building2}
        />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (query.isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("company.error.title")}
          description={t("company.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (!query.data) {
    return (
      <div className="p-6">
        <EmptyState title={t("company.empty.title")} description={t("company.empty.description")} />
      </div>
    );
  }

  const company = query.data;
  const busy = mutation.isPending;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("company.title")}
        description={t("company.description")}
        icon={Building2}
        actions={
          // Nút edit ẨN khi thiếu update:foundation-company (chỉ đọc).
          canUpdate && !editing ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              {t("company.edit")}
            </Button>
          ) : null
        }
      />

      {!editing ? (
        <CompanyReadOnly company={company} t={t} />
      ) : (
        <form onSubmit={handleSubmit(() => setConfirmOpen(true))} noValidate className="space-y-6">
          {mutation.isError && (
            <p
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {t("company.saveError")}
            </p>
          )}

          <Card>
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
              <Field
                id="name"
                label={t("company.fields.name")}
                error={errors.name && t(errors.name.message ?? "")}
              >
                <Input id="name" {...register("name")} />
              </Field>
              <Field id="shortName" label={t("company.fields.shortName")}>
                <Input id="shortName" {...register("shortName")} />
              </Field>
              <Field id="taxCode" label={t("company.fields.taxCode")}>
                <Input id="taxCode" {...register("taxCode")} />
              </Field>
              <Field id="businessType" label={t("company.fields.businessType")}>
                <Input id="businessType" {...register("businessType")} />
              </Field>
              <Field id="phone" label={t("company.fields.phone")}>
                <Input id="phone" {...register("phone")} />
              </Field>
              <Field
                id="email"
                label={t("company.fields.email")}
                error={errors.email && t(errors.email.message ?? "")}
              >
                <Input id="email" type="email" {...register("email")} />
              </Field>
              <Field id="website" label={t("company.fields.website")}>
                <Input id="website" {...register("website")} />
              </Field>
              <Field id="address" label={t("company.fields.address")}>
                <Input id="address" {...register("address")} />
              </Field>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{t("company.readOnlyNote")}</p>

          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                reset(toFormValues(company));
                setEditing(false);
              }}
            >
              {t("company.cancel")}
            </Button>
            {/* Nút save chỉ hiện khi có update (đã bao trong editing=canUpdate-only path). */}
            <Button type="submit" disabled={busy}>
              {busy ? t("company.saving") : t("company.save")}
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t("company.confirm.title")}
        description={t("company.confirm.description")}
        confirmLabel={t("company.confirm.confirmLabel")}
        cancelLabel={t("company.confirm.cancelLabel")}
        busy={busy}
        busyLabel={t("company.saving")}
        onConfirm={() => mutation.mutate(getValues())}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
