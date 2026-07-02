/**
 * HolidayFormDialog — CRUD tối thiểu cho Public Holidays (S2-FE-FND-4, nối POST/PATCH
 * /foundation/public-holidays). Gate NÚT ở page (useCan manage:foundation-holiday) — dialog chỉ mở khi
 * có quyền. BE vẫn là cổng thật (@RequirePermission). Chỉ sửa holiday scope 'company' (page đã lọc trước
 * khi truyền `holiday` prop) — form KHÔNG gửi companyId/company_id (server tự gán từ AuthContext).
 */
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { HOLIDAY_TYPES, type HolidayView } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { useCreateHoliday, useUpdateHoliday } from "./useHolidays";
import { AdminField } from "@/routes/attendance/admin/AdminField";

/**
 * Map ApiError status → thông điệp người-đọc (khu vực publicHolidays.form.errors.* — KHÔNG dùng
 * adminMapApiError của ATT vì key namespace khác: "form.errors.*" (ATT) vs "publicHolidays.form.errors.*").
 */
function mapHolidayApiError(err: unknown, t: (k: string) => string): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403) return t("publicHolidays.form.errors.forbidden");
  if (status === 409) return t("publicHolidays.form.errors.conflict");
  if (status === 422 || status === 400) return t("publicHolidays.form.errors.validation");
  if (typeof status === "number" && status >= 500) return t("publicHolidays.form.errors.server");
  return t("publicHolidays.form.errors.generic");
}

const holidayFormSchema = z.object({
  holidayCode: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  holidayDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "publicHolidays.form.validation.dateFormat" }),
  holidayType: z.enum(HOLIDAY_TYPES),
  isPaidHoliday: z.boolean(),
  affectsAttendance: z.boolean(),
  affectsLeaveCalculation: z.boolean(),
  description: z.string().max(2000).optional(),
});
type HolidayFormValues = z.infer<typeof holidayFormSchema>;

function emptyValues(): HolidayFormValues {
  return {
    holidayCode: "",
    name: "",
    holidayDate: "",
    holidayType: "CompanyHoliday",
    isPaidHoliday: true,
    affectsAttendance: true,
    affectsLeaveCalculation: true,
    description: "",
  };
}

function fromView(h: HolidayView): HolidayFormValues {
  return {
    holidayCode: h.holidayCode,
    name: h.name,
    holidayDate: h.holidayDate,
    holidayType: (HOLIDAY_TYPES as readonly string[]).includes(h.holidayType)
      ? (h.holidayType as HolidayFormValues["holidayType"])
      : "CompanyHoliday",
    isPaidHoliday: h.isPaidHoliday,
    affectsAttendance: h.affectsAttendance,
    affectsLeaveCalculation: h.affectsLeaveCalculation,
    description: h.description ?? "",
  };
}

export interface HolidayFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** DTO khi edit (scope 'company'); undefined = tạo mới. */
  holiday?: HolidayView;
}

export function HolidayFormDialog({ open, onClose, holiday }: HolidayFormDialogProps) {
  const { t } = useTranslation("system");
  const isEdit = Boolean(holiday);
  const createMut = useCreateHoliday();
  const updateMut = useUpdateHoliday();

  const form = useForm<HolidayFormValues>({
    resolver: zodResolver(holidayFormSchema),
    defaultValues: holiday ? fromView(holiday) : emptyValues(),
    values: holiday ? fromView(holiday) : emptyValues(),
    mode: "onBlur",
  });
  const { register, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;

  const mutError = createMut.error ?? updateMut.error;

  async function onSubmit(values: HolidayFormValues) {
    const description = values.description?.trim() === "" ? undefined : values.description;
    if (isEdit && holiday) {
      await updateMut.mutateAsync({
        id: holiday.id,
        body: {
          name: values.name,
          holidayDate: values.holidayDate,
          holidayType: values.holidayType,
          isPaidHoliday: values.isPaidHoliday,
          affectsAttendance: values.affectsAttendance,
          affectsLeaveCalculation: values.affectsLeaveCalculation,
          description,
        },
      });
    } else {
      await createMut.mutateAsync({
        holidayCode: values.holidayCode,
        name: values.name,
        holidayDate: values.holidayDate,
        holidayType: values.holidayType,
        isPaidHoliday: values.isPaidHoliday,
        affectsAttendance: values.affectsAttendance,
        affectsLeaveCalculation: values.affectsLeaveCalculation,
        description,
      });
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("publicHolidays.form.editTitle") : t("publicHolidays.form.createTitle")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t("publicHolidays.form.cancel")}
          </Button>
          <Button
            type="submit"
            form="holiday-form"
            disabled={isSubmitting}
            data-testid="holiday-form-submit"
          >
            {isSubmitting ? t("publicHolidays.form.saving") : t("publicHolidays.form.save")}
          </Button>
        </>
      }
    >
      <form
        id="holiday-form"
        noValidate
        onSubmit={handleSubmit((v) => {
          void onSubmit(v);
        })}
        className="space-y-4"
      >
        {mutError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {mapHolidayApiError(mutError, t)}
          </div>
        )}

        <AdminField
          label={t("publicHolidays.form.code")}
          required
          error={errors.holidayCode?.message}
        >
          <Input
            {...register("holidayCode")}
            disabled={isEdit}
            aria-label={t("publicHolidays.form.code")}
          />
        </AdminField>

        <AdminField label={t("publicHolidays.form.name")} required error={errors.name?.message}>
          <Input {...register("name")} aria-label={t("publicHolidays.form.name")} />
        </AdminField>

        <AdminField
          label={t("publicHolidays.form.date")}
          required
          error={errors.holidayDate?.message && t(errors.holidayDate.message)}
        >
          <Input
            type="date"
            {...register("holidayDate")}
            aria-label={t("publicHolidays.form.date")}
          />
        </AdminField>

        <AdminField label={t("publicHolidays.form.type")} error={errors.holidayType?.message}>
          <Select {...register("holidayType")} aria-label={t("publicHolidays.form.type")}>
            {HOLIDAY_TYPES.map((ht) => (
              <option key={ht} value={ht}>
                {ht}
              </option>
            ))}
          </Select>
        </AdminField>

        <AdminField
          label={t("publicHolidays.form.description")}
          error={errors.description?.message}
        >
          <Input {...register("description")} aria-label={t("publicHolidays.form.description")} />
        </AdminField>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("isPaidHoliday")} />
            {t("publicHolidays.form.isPaidHoliday")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("affectsAttendance")} />
            {t("publicHolidays.form.affectsAttendance")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("affectsLeaveCalculation")} />
            {t("publicHolidays.form.affectsLeaveCalculation")}
          </label>
        </div>
      </form>
    </Dialog>
  );
}
