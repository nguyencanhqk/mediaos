/**
 * ShiftFormDialog — CRUD tối thiểu cho ca làm việc (S3-FE-ATT-5, nối POST/PATCH /attendance/shifts).
 *
 * Gate NÚT ở page (useCan create/update:shift) — dialog chỉ mở khi có quyền. BE vẫn là cổng thật
 * (@RequirePermission). Validation Zod client (RHF) là UX; ZodValidationPipe của BE là ranh giới thật.
 * Nâng cao (break window / flexible window / workDays picker) = carry-over CO-S4-007.
 */
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { CreateShiftRequest, ShiftDto, UpdateShiftRequest } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { useCreateShift, useUpdateShift } from "../hooks/useAttendanceAdmin";
import { AdminField, adminMapApiError } from "./AdminField";

const shiftFormSchema = z.object({
  shiftCode: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  shiftType: z.enum(["Fixed", "Flexible"]),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  requiredWorkingMinutes: z.coerce.number().int().positive(),
  breakMinutes: z.coerce.number().int().min(0),
  isDefault: z.boolean(),
  status: z.enum(["Active", "Inactive"]),
});
type ShiftFormValues = z.infer<typeof shiftFormSchema>;

function emptyValues(): ShiftFormValues {
  return {
    shiftCode: "",
    name: "",
    shiftType: "Fixed",
    startTime: "",
    endTime: "",
    requiredWorkingMinutes: 480,
    breakMinutes: 0,
    isDefault: false,
    status: "Active",
  };
}

function fromDto(dto: ShiftDto): ShiftFormValues {
  return {
    shiftCode: dto.shiftCode,
    name: dto.name,
    shiftType: dto.shiftType === "Flexible" ? "Flexible" : "Fixed",
    startTime: dto.startTime ?? "",
    endTime: dto.endTime ?? "",
    requiredWorkingMinutes: dto.requiredWorkingMinutes,
    breakMinutes: dto.breakMinutes,
    isDefault: dto.isDefault,
    status: dto.status,
  };
}

/** Bỏ chuỗi rỗng của trường giờ optional (không gửi lên BE). */
function optTime(v: string | undefined): string | undefined {
  return v && v.trim() !== "" ? v : undefined;
}

export interface ShiftFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** DTO khi edit; undefined = tạo mới. */
  shift?: ShiftDto;
}

export function ShiftFormDialog({ open, onClose, shift }: ShiftFormDialogProps) {
  const { t } = useTranslation("attendance");
  const isEdit = Boolean(shift);
  const createMut = useCreateShift();
  const updateMut = useUpdateShift();

  const form = useForm<ShiftFormValues>({
    resolver: zodResolver(shiftFormSchema),
    defaultValues: shift ? fromDto(shift) : emptyValues(),
    values: shift ? fromDto(shift) : emptyValues(),
    mode: "onBlur",
  });
  const { register, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;

  const mutError = createMut.error ?? updateMut.error;

  async function onSubmit(values: ShiftFormValues) {
    if (isEdit && shift) {
      const body: UpdateShiftRequest = {
        name: values.name,
        shiftType: values.shiftType,
        startTime: optTime(values.startTime),
        endTime: optTime(values.endTime),
        requiredWorkingMinutes: values.requiredWorkingMinutes,
        breakMinutes: values.breakMinutes,
        isDefault: values.isDefault,
        status: values.status,
      };
      await updateMut.mutateAsync({ id: shift.id, body });
    } else {
      const body: CreateShiftRequest = {
        shiftCode: values.shiftCode,
        name: values.name,
        shiftType: values.shiftType,
        startTime: optTime(values.startTime),
        endTime: optTime(values.endTime),
        requiredWorkingMinutes: values.requiredWorkingMinutes,
        breakMinutes: values.breakMinutes,
        graceLateMinutes: 0,
        graceEarlyLeaveMinutes: 0,
        allowEarlyCheckIn: true,
        allowLateCheckOut: true,
        crossDay: false,
        isDefault: values.isDefault,
      };
      await createMut.mutateAsync(body);
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("shifts.form.editTitle") : t("shifts.form.createTitle")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t("form.buttons.cancel")}
          </Button>
          <Button
            type="submit"
            form="shift-form"
            disabled={isSubmitting}
            data-testid="shift-form-submit"
          >
            {isSubmitting ? t("form.buttons.saving") : t("form.buttons.save")}
          </Button>
        </>
      }
    >
      <form
        id="shift-form"
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
            {adminMapApiError(mutError, t)}
          </div>
        )}

        <AdminField label={t("shifts.form.code")} required error={errors.shiftCode?.message}>
          <Input {...register("shiftCode")} disabled={isEdit} aria-label={t("shifts.form.code")} />
        </AdminField>

        <AdminField label={t("shifts.form.name")} required error={errors.name?.message}>
          <Input {...register("name")} aria-label={t("shifts.form.name")} />
        </AdminField>

        <AdminField label={t("shifts.form.type")} error={errors.shiftType?.message}>
          <Select {...register("shiftType")} aria-label={t("shifts.form.type")}>
            <option value="Fixed">Fixed</option>
            <option value="Flexible">Flexible</option>
          </Select>
        </AdminField>

        <div className="grid grid-cols-2 gap-4">
          <AdminField label={t("shifts.form.startTime")} error={errors.startTime?.message}>
            <Input type="time" {...register("startTime")} aria-label={t("shifts.form.startTime")} />
          </AdminField>
          <AdminField label={t("shifts.form.endTime")} error={errors.endTime?.message}>
            <Input type="time" {...register("endTime")} aria-label={t("shifts.form.endTime")} />
          </AdminField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <AdminField
            label={t("shifts.form.requiredMinutes")}
            required
            error={errors.requiredWorkingMinutes?.message}
          >
            <Input
              type="number"
              min={1}
              {...register("requiredWorkingMinutes")}
              aria-label={t("shifts.form.requiredMinutes")}
            />
          </AdminField>
          <AdminField label={t("shifts.form.breakMinutes")} error={errors.breakMinutes?.message}>
            <Input
              type="number"
              min={0}
              {...register("breakMinutes")}
              aria-label={t("shifts.form.breakMinutes")}
            />
          </AdminField>
        </div>

        {isEdit && (
          <AdminField label={t("shifts.form.status")} error={errors.status?.message}>
            <Select {...register("status")} aria-label={t("shifts.form.status")}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </Select>
          </AdminField>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("isDefault")} />
          {t("shifts.form.isDefault")}
        </label>
      </form>
    </Dialog>
  );
}
