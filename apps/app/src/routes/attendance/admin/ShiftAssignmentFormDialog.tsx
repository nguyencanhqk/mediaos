/**
 * ShiftAssignmentFormDialog — CRUD tối thiểu cho gán ca (S3-FE-ATT-5, nối POST /attendance/shift-assignments).
 *
 * Chỉ CREATE (contract S3-ATT-BE-3 chỉ có POST cho gán ca; sửa = tạo bản mới ưu tiên cao hơn). Gate NÚT ở
 * page (useCanExact update:shift-assignment — cặp sensitive). shiftId chọn từ danh mục ca đang có (prop).
 */
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { CreateShiftAssignmentRequest, ShiftDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { useCreateShiftAssignment } from "../hooks/useAttendanceAdmin";
import { AdminField, adminMapApiError } from "./AdminField";

const assignmentFormSchema = z
  .object({
    shiftId: z.string().uuid(),
    assignmentScope: z.enum(["Company", "Department", "Employee"]),
    departmentId: z.string().optional(),
    employeeId: z.string().optional(),
    effectiveFrom: z.string().min(1),
    effectiveTo: z.string().optional(),
    priority: z.coerce.number().int(),
    note: z.string().optional(),
  })
  .refine(
    (v) =>
      (v.assignmentScope !== "Department" && v.assignmentScope !== "Employee") ||
      (v.assignmentScope === "Department" ? Boolean(v.departmentId) : Boolean(v.employeeId)),
    { message: "scopeTarget", path: ["assignmentScope"] },
  );
type AssignmentFormValues = z.infer<typeof assignmentFormSchema>;

function emptyValues(defaultShiftId: string): AssignmentFormValues {
  return {
    shiftId: defaultShiftId,
    assignmentScope: "Company",
    departmentId: "",
    employeeId: "",
    effectiveFrom: "",
    effectiveTo: "",
    priority: 0,
    note: "",
  };
}

function optStr(v: string | undefined): string | undefined {
  return v && v.trim() !== "" ? v : undefined;
}

export interface ShiftAssignmentFormDialogProps {
  open: boolean;
  onClose: () => void;
  shifts: ShiftDto[];
}

export function ShiftAssignmentFormDialog({
  open,
  onClose,
  shifts,
}: ShiftAssignmentFormDialogProps) {
  const { t } = useTranslation("attendance");
  const createMut = useCreateShiftAssignment();
  const defaultShiftId = shifts[0]?.id ?? "";

  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentFormSchema),
    defaultValues: emptyValues(defaultShiftId),
    mode: "onBlur",
  });
  const { register, handleSubmit, watch, formState } = form;
  const { errors, isSubmitting } = formState;
  const scope = watch("assignmentScope");

  async function onSubmit(values: AssignmentFormValues) {
    const body: CreateShiftAssignmentRequest = {
      shiftId: values.shiftId,
      assignmentScope: values.assignmentScope,
      departmentId:
        values.assignmentScope === "Department" ? optStr(values.departmentId) : undefined,
      employeeId: values.assignmentScope === "Employee" ? optStr(values.employeeId) : undefined,
      effectiveFrom: values.effectiveFrom,
      effectiveTo: optStr(values.effectiveTo),
      priority: values.priority,
      note: optStr(values.note),
    };
    await createMut.mutateAsync(body);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("shiftAssignments.form.createTitle")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t("form.buttons.cancel")}
          </Button>
          <Button
            type="submit"
            form="assignment-form"
            disabled={isSubmitting || shifts.length === 0}
            data-testid="assignment-form-submit"
          >
            {isSubmitting ? t("form.buttons.saving") : t("form.buttons.save")}
          </Button>
        </>
      }
    >
      <form
        id="assignment-form"
        noValidate
        onSubmit={handleSubmit((v) => {
          void onSubmit(v);
        })}
        className="space-y-4"
      >
        {createMut.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {adminMapApiError(createMut.error, t)}
          </div>
        )}

        <AdminField
          label={t("shiftAssignments.form.shift")}
          required
          error={errors.shiftId?.message}
        >
          <Select {...register("shiftId")} aria-label={t("shiftAssignments.form.shift")}>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shiftCode} — {s.name}
              </option>
            ))}
          </Select>
        </AdminField>

        <AdminField
          label={t("shiftAssignments.form.scope")}
          error={
            errors.assignmentScope?.message === "scopeTarget"
              ? t("shiftAssignments.form.scopeTarget")
              : undefined
          }
        >
          <Select {...register("assignmentScope")} aria-label={t("shiftAssignments.form.scope")}>
            <option value="Company">Company</option>
            <option value="Department">Department</option>
            <option value="Employee">Employee</option>
          </Select>
        </AdminField>

        {scope === "Department" && (
          <AdminField
            label={t("shiftAssignments.form.departmentId")}
            required
            error={errors.departmentId?.message}
          >
            <Input
              {...register("departmentId")}
              aria-label={t("shiftAssignments.form.departmentId")}
            />
          </AdminField>
        )}
        {scope === "Employee" && (
          <AdminField
            label={t("shiftAssignments.form.employeeId")}
            required
            error={errors.employeeId?.message}
          >
            <Input {...register("employeeId")} aria-label={t("shiftAssignments.form.employeeId")} />
          </AdminField>
        )}

        <div className="grid grid-cols-2 gap-4">
          <AdminField
            label={t("shiftAssignments.form.effectiveFrom")}
            required
            error={errors.effectiveFrom?.message}
          >
            <Input
              type="date"
              {...register("effectiveFrom")}
              aria-label={t("shiftAssignments.form.effectiveFrom")}
            />
          </AdminField>
          <AdminField
            label={t("shiftAssignments.form.effectiveTo")}
            error={errors.effectiveTo?.message}
          >
            <Input
              type="date"
              {...register("effectiveTo")}
              aria-label={t("shiftAssignments.form.effectiveTo")}
            />
          </AdminField>
        </div>

        <AdminField label={t("shiftAssignments.form.priority")} error={errors.priority?.message}>
          <Input
            type="number"
            {...register("priority")}
            aria-label={t("shiftAssignments.form.priority")}
          />
        </AdminField>
      </form>
    </Dialog>
  );
}
