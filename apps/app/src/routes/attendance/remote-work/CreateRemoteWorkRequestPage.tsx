/**
 * CreateRemoteWorkRequestPage — /attendance/remote-work-requests/new (S3-FE-ATT-4, ATT-SCREEN-011).
 * Tạo đơn → Draft (KHÔNG Pending) — gửi duyệt (chọn approver/watchers) là hành động RIÊNG ở trang
 * chi tiết. Gate: useCan create-own:remote-request.
 */
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Plane } from "lucide-react";
import { useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Input, Select } from "@mediaos/ui";
import { useCreateRemoteWorkRequest } from "../hooks/useRemoteWorkRequests";
import { ATT_ENGINE_PAIRS, ATT_PATHS } from "../constants";
import {
  remoteWorkFormSchema,
  EMPTY_REMOTE_WORK_FORM,
  toCreateRemoteWorkRequest,
  type RemoteWorkFormValues,
} from "./remote-work-form-schema";

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
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

function submitErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "remoteWork.form.errors.forbidden";
    if (err.status === 422 || err.status === 400) return "remoteWork.form.errors.validation";
    if (err.status >= 500) return "remoteWork.form.errors.server";
  }
  return "remoteWork.form.errors.generic";
}

export function CreateRemoteWorkRequestPage() {
  const { t } = useTranslation("attendance");
  const navigate = useNavigate();
  const canCreate = useCan(
    ATT_ENGINE_PAIRS.REMOTE_CREATE_OWN.action,
    ATT_ENGINE_PAIRS.REMOTE_CREATE_OWN.resourceType,
  );
  const createMutation = useCreateRemoteWorkRequest();

  const form = useForm<RemoteWorkFormValues>({
    resolver: zodResolver(remoteWorkFormSchema),
    defaultValues: EMPTY_REMOTE_WORK_FORM,
    mode: "onSubmit",
  });
  const { register, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;
  const resolveErr = (msg?: string) => (msg ? t(msg) : undefined);

  if (!canCreate) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("remoteWork.forbidden.title")}
          description={t("remoteWork.forbidden.description")}
        />
      </div>
    );
  }

  const busy = isSubmitting || createMutation.isPending;

  async function onSubmit(values: RemoteWorkFormValues) {
    const dto = await createMutation.mutateAsync(toCreateRemoteWorkRequest(values));
    void navigate({ to: ATT_PATHS.REMOTE_WORK_REQUEST_DETAIL(dto.id) as "/" });
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("remoteWork.form.createTitle")}
        description={t("remoteWork.form.createDescription")}
        icon={Plane}
      />
      <Card>
        <CardContent className="pt-6">
          {createMutation.isError && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {t(submitErrorKey(createMutation.error))}
            </p>
          )}
          <form
            noValidate
            className="space-y-4"
            onSubmit={handleSubmit((v) => {
              void onSubmit(v);
            })}
          >
            <Field id="requestType" label={t("remoteWork.form.fields.requestType")} required>
              <Select id="requestType" {...register("requestType")}>
                <option value="Remote">{t("remoteWork.requestType.Remote")}</option>
                <option value="BusinessTrip">{t("remoteWork.requestType.BusinessTrip")}</option>
                <option value="Offsite">{t("remoteWork.requestType.Offsite")}</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field
                id="startDate"
                label={t("remoteWork.form.fields.startDate")}
                required
                error={resolveErr(errors.startDate?.message)}
              >
                <Input id="startDate" type="date" {...register("startDate")} />
              </Field>
              <Field
                id="endDate"
                label={t("remoteWork.form.fields.endDate")}
                required
                error={resolveErr(errors.endDate?.message)}
              >
                <Input id="endDate" type="date" {...register("endDate")} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field id="startTime" label={t("remoteWork.form.fields.startTime")}>
                <Input id="startTime" type="time" {...register("startTime")} />
              </Field>
              <Field id="endTime" label={t("remoteWork.form.fields.endTime")}>
                <Input id="endTime" type="time" {...register("endTime")} />
              </Field>
            </div>
            <Field id="attendanceMode" label={t("remoteWork.form.fields.attendanceMode")}>
              <Select id="attendanceMode" {...register("attendanceMode")}>
                <option value="SELF_CHECK_IN">
                  {t("remoteWork.attendanceMode.SELF_CHECK_IN")}
                </option>
                <option value="AUTO_ATTENDANCE">
                  {t("remoteWork.attendanceMode.AUTO_ATTENDANCE")}
                </option>
                <option value="NO_ATTENDANCE">
                  {t("remoteWork.attendanceMode.NO_ATTENDANCE")}
                </option>
              </Select>
            </Field>
            <Field id="locationText" label={t("remoteWork.form.fields.locationText")}>
              <Input id="locationText" {...register("locationText")} />
            </Field>
            <Field
              id="reason"
              label={t("remoteWork.form.fields.reason")}
              required
              error={resolveErr(errors.reason?.message)}
            >
              <textarea
                id="reason"
                rows={3}
                {...register("reason")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void navigate({ to: ATT_PATHS.REMOTE_WORK_REQUESTS as "/" })}
                disabled={busy}
              >
                {t("remoteWork.form.buttons.cancel")}
              </Button>
              <Button type="submit" disabled={busy} data-testid="remote-work-create-submit">
                {busy
                  ? t("remoteWork.form.buttons.submitting")
                  : t("remoteWork.form.buttons.submit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
