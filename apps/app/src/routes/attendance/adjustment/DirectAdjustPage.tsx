/**
 * DirectAdjustPage — điều chỉnh trực tiếp 1 bản ghi công (ATT-SCREEN-010, S3-FE-ATT-3, ATT-FUNC-021).
 * KHÔNG qua vòng duyệt Pending — áp dụng NGAY. Permission: adjust-direct:attendance (sensitive KHÔNG
 * allowlisted — KHÔNG front-gate render bằng useCan, xem adjustment/constants.ts). Route reach-gate =
 * view-team/view-company:attendance (allowlisted, xem router.tsx) — cổng thật vẫn ở server (403 nếu thiếu
 * adjust-direct:attendance thật sự).
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Wrench } from "lucide-react";
import type { AdjustmentItemInput } from "@mediaos/contracts";
import { ApiError, formatDateTime } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Input } from "@mediaos/ui";
import { useAttendanceRecordDetail } from "../hooks/useAttendanceRecords";
import { useAdjustRecordDirect } from "./hooks/useAdjustmentRequests";
import { localDatetimeToIso, isoToLocalDatetime } from "./constants";
import { ATT_PATHS } from "../constants";

interface DirectAdjustFormValues {
  checkInAt: string;
  checkOutAt: string;
  reason: string;
}

function buildItems(v: DirectAdjustFormValues): AdjustmentItemInput[] {
  const items: AdjustmentItemInput[] = [];
  const checkInIso = localDatetimeToIso(v.checkInAt);
  const checkOutIso = localDatetimeToIso(v.checkOutAt);
  if (checkInIso) items.push({ fieldName: "checkInAt", newValue: checkInIso });
  if (checkOutIso) items.push({ fieldName: "checkOutAt", newValue: checkOutIso });
  return items;
}

interface DirectAdjustPageProps {
  recordId: string;
}

export function DirectAdjustPage({ recordId }: DirectAdjustPageProps) {
  const { t } = useTranslation("attendance");
  const navigate = useNavigate();
  const [itemsError, setItemsError] = useState<string | null>(null);

  const { data: record, isLoading, isError, error, refetch } = useAttendanceRecordDetail(recordId);
  const adjustMutation = useAdjustRecordDirect(recordId);

  const { register, handleSubmit, formState } = useForm<DirectAdjustFormValues>({
    defaultValues: { checkInAt: "", checkOutAt: "", reason: "" },
  });
  const { errors, isSubmitting } = formState;

  function goBack() {
    void navigate({ to: ATT_PATHS.RECORD_DETAIL(recordId) as "/" });
  }

  function mapApiError(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 403) return t("adjustment.directAdjust.forbidden");
      if (err.status === 409) return t("form.errors.conflict");
      if (err.status === 422 || err.status === 400) return t("form.errors.validation");
      if (err.status >= 500) return t("form.errors.server");
    }
    return t("form.errors.generic");
  }

  async function onSubmit(values: DirectAdjustFormValues) {
    const items = buildItems(values);
    if (items.length === 0) {
      setItemsError(t("adjustment.directAdjust.atLeastOne"));
      return;
    }
    setItemsError(null);
    try {
      const result = await adjustMutation.mutateAsync({
        recordId,
        items,
        reason: values.reason,
      });
      void navigate({ to: ATT_PATHS.ADJUSTMENT_DETAIL(result.id) as "/" });
    } catch {
      // Lỗi đã có trong adjustMutation.error → hiển thị qua globalError bên dưới, KHÔNG throw tiếp.
    }
  }

  if (isLoading) {
    return (
      <div className="p-6" data-testid="direct-adjust-loading">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 rounded bg-muted" />
          <div className="h-32 rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (isError) {
    const isForbidden = error instanceof ApiError && error.status === 403;
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="p-6">
        <EmptyState
          title={
            isForbidden
              ? t("detail.forbidden.title")
              : isNotFound
                ? t("detail.notFound.title")
                : t("detail.error.title")
          }
          description={
            isForbidden
              ? t("detail.forbidden.description")
              : isNotFound
                ? t("detail.notFound.description")
                : t("detail.error.description")
          }
          action={
            !isForbidden && !isNotFound ? (
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                {t("actions.retry", { ns: "common" })}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("detail.backToList")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  if (!record) return null;

  const globalError = adjustMutation.error ? mapApiError(adjustMutation.error) : null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("adjustment.directAdjust.title")}
        description={t("adjustment.directAdjust.description")}
        icon={Wrench}
        actions={
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("detail.backToList")}
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-1 pt-4 text-sm">
          <p>
            <span className="font-medium text-muted-foreground">
              {t("adjustment.directAdjust.currentCheckIn")}:{" "}
            </span>
            {record.checkInAt ? formatDateTime(record.checkInAt) : "—"}
          </p>
          <p>
            <span className="font-medium text-muted-foreground">
              {t("adjustment.directAdjust.currentCheckOut")}:{" "}
            </span>
            {record.checkOutAt ? formatDateTime(record.checkOutAt) : "—"}
          </p>
        </CardContent>
      </Card>

      <form
        onSubmit={handleSubmit((v) => {
          void onSubmit(v);
        })}
        noValidate
      >
        <Card>
          <CardContent className="space-y-4 pt-5">
            {globalError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {globalError}
              </div>
            )}
            {itemsError && (
              <p role="alert" className="text-sm text-destructive">
                {itemsError}
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t("adjustment.directAdjust.newCheckIn")}
              </label>
              <Input
                type="datetime-local"
                defaultValue={isoToLocalDatetime(record.checkInAt)}
                {...register("checkInAt")}
                aria-label={t("adjustment.directAdjust.newCheckIn")}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t("adjustment.directAdjust.newCheckOut")}
              </label>
              <Input
                type="datetime-local"
                defaultValue={isoToLocalDatetime(record.checkOutAt)}
                {...register("checkOutAt")}
                aria-label={t("adjustment.directAdjust.newCheckOut")}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t("adjustment.directAdjust.reason")}
                <span className="ml-0.5 text-destructive">*</span>
              </label>
              <textarea
                {...register("reason", { required: true, minLength: 3, maxLength: 1000 })}
                rows={3}
                placeholder={t("adjustment.directAdjust.reasonPlaceholder")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={t("adjustment.directAdjust.reason")}
              />
              {errors.reason && (
                <p role="alert" className="text-sm text-destructive">
                  {t("form.errors.reasonMin")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={goBack} disabled={isSubmitting}>
            {t("form.buttons.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? t("adjustment.directAdjust.submitting")
              : t("adjustment.directAdjust.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
