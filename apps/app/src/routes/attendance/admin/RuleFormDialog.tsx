/**
 * RuleFormDialog — CRUD tối thiểu cho rule chấm công (S3-FE-ATT-5, nối POST/PATCH /attendance/rules).
 *
 * Gate NÚT ở page (useCanExact config:attendance-rule — cặp sensitive). BE là cổng thật. Edit KHÔNG đổi
 * ruleScope/target (contract updateRuleSchema) → khi edit các field đó read-only. Nâng cao (đủ 20+ cờ auto/
 * gps/photo…) = carry-over CO-S4-007 — form này giữ các cờ cốt lõi (requireCheckIn/Out).
 */
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { AttendanceRuleDto, CreateRuleRequest, UpdateRuleRequest } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { useCreateRule, useUpdateRule } from "../hooks/useAttendanceAdmin";
import { AdminField, adminMapApiError } from "./AdminField";

const ruleFormSchema = z
  .object({
    ruleCode: z.string().min(1).max(50),
    name: z.string().min(1).max(200),
    ruleScope: z.enum(["System", "Company", "Department", "Employee"]),
    departmentId: z.string().optional(),
    employeeId: z.string().optional(),
    priority: z.coerce.number().int(),
    effectiveFrom: z.string().min(1),
    effectiveTo: z.string().optional(),
    requireCheckIn: z.boolean(),
    requireCheckOut: z.boolean(),
    status: z.enum(["Active", "Inactive"]),
  })
  .refine(
    (v) =>
      (v.ruleScope !== "Department" && v.ruleScope !== "Employee") ||
      (v.ruleScope === "Department" ? Boolean(v.departmentId) : Boolean(v.employeeId)),
    { message: "scopeTarget", path: ["ruleScope"] },
  );
type RuleFormValues = z.infer<typeof ruleFormSchema>;

function emptyValues(): RuleFormValues {
  return {
    ruleCode: "",
    name: "",
    ruleScope: "Company",
    departmentId: "",
    employeeId: "",
    priority: 0,
    effectiveFrom: "",
    effectiveTo: "",
    requireCheckIn: true,
    requireCheckOut: true,
    status: "Active",
  };
}

function fromDto(dto: AttendanceRuleDto): RuleFormValues {
  return {
    ruleCode: dto.ruleCode,
    name: dto.name,
    ruleScope: dto.ruleScope,
    departmentId: dto.departmentId ?? "",
    employeeId: dto.employeeId ?? "",
    priority: dto.priority,
    effectiveFrom: dto.effectiveFrom,
    effectiveTo: dto.effectiveTo ?? "",
    requireCheckIn: dto.requireCheckIn,
    requireCheckOut: dto.requireCheckOut,
    status: dto.status,
  };
}

function optStr(v: string | undefined): string | undefined {
  return v && v.trim() !== "" ? v : undefined;
}

export interface RuleFormDialogProps {
  open: boolean;
  onClose: () => void;
  rule?: AttendanceRuleDto;
}

export function RuleFormDialog({ open, onClose, rule }: RuleFormDialogProps) {
  const { t } = useTranslation("attendance");
  const isEdit = Boolean(rule);
  const createMut = useCreateRule();
  const updateMut = useUpdateRule();

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: rule ? fromDto(rule) : emptyValues(),
    values: rule ? fromDto(rule) : emptyValues(),
    mode: "onBlur",
  });
  const { register, handleSubmit, watch, formState } = form;
  const { errors, isSubmitting } = formState;
  const scope = watch("ruleScope");
  const mutError = createMut.error ?? updateMut.error;

  async function onSubmit(values: RuleFormValues) {
    if (isEdit && rule) {
      const body: UpdateRuleRequest = {
        name: values.name,
        priority: values.priority,
        effectiveFrom: values.effectiveFrom,
        effectiveTo: optStr(values.effectiveTo) ?? null,
        requireCheckIn: values.requireCheckIn,
        requireCheckOut: values.requireCheckOut,
        status: values.status,
      };
      await updateMut.mutateAsync({ id: rule.id, body });
    } else {
      // Các cờ nâng cao (web/mobile/remote/gps/photo/auto…) giữ default contract — form tối thiểu chỉ
      // phơi requireCheckIn/Out; đủ cờ = CO-S4-007.
      const body: CreateRuleRequest = {
        ruleCode: values.ruleCode,
        name: values.name,
        ruleScope: values.ruleScope,
        departmentId: values.ruleScope === "Department" ? optStr(values.departmentId) : undefined,
        employeeId: values.ruleScope === "Employee" ? optStr(values.employeeId) : undefined,
        priority: values.priority,
        effectiveFrom: values.effectiveFrom,
        effectiveTo: optStr(values.effectiveTo),
        requireCheckIn: values.requireCheckIn,
        requireCheckOut: values.requireCheckOut,
        allowWebCheckIn: true,
        allowMobileCheckIn: true,
        allowRemoteCheckIn: false,
        allowAdjustmentRequest: true,
        requireGps: false,
        requireNote: false,
        requirePhoto: false,
        allowHolidayAttendance: false,
        allowWeekendAttendance: false,
        autoAttendanceEnabled: false,
        autoCheckOutEnabled: false,
      };
      await createMut.mutateAsync(body);
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("rules.form.editTitle") : t("rules.form.createTitle")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t("form.buttons.cancel")}
          </Button>
          <Button
            type="submit"
            form="rule-form"
            disabled={isSubmitting}
            data-testid="rule-form-submit"
          >
            {isSubmitting ? t("form.buttons.saving") : t("form.buttons.save")}
          </Button>
        </>
      }
    >
      <form
        id="rule-form"
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

        <AdminField label={t("rules.form.code")} required error={errors.ruleCode?.message}>
          <Input {...register("ruleCode")} disabled={isEdit} aria-label={t("rules.form.code")} />
        </AdminField>

        <AdminField label={t("rules.form.name")} required error={errors.name?.message}>
          <Input {...register("name")} aria-label={t("rules.form.name")} />
        </AdminField>

        <AdminField
          label={t("rules.form.scope")}
          error={
            errors.ruleScope?.message === "scopeTarget" ? t("rules.form.scopeTarget") : undefined
          }
        >
          <Select {...register("ruleScope")} disabled={isEdit} aria-label={t("rules.form.scope")}>
            <option value="System">System</option>
            <option value="Company">Company</option>
            <option value="Department">Department</option>
            <option value="Employee">Employee</option>
          </Select>
        </AdminField>

        {!isEdit && scope === "Department" && (
          <AdminField
            label={t("rules.form.departmentId")}
            required
            error={errors.departmentId?.message}
          >
            <Input {...register("departmentId")} aria-label={t("rules.form.departmentId")} />
          </AdminField>
        )}
        {!isEdit && scope === "Employee" && (
          <AdminField
            label={t("rules.form.employeeId")}
            required
            error={errors.employeeId?.message}
          >
            <Input {...register("employeeId")} aria-label={t("rules.form.employeeId")} />
          </AdminField>
        )}

        <div className="grid grid-cols-2 gap-4">
          <AdminField
            label={t("rules.form.effectiveFrom")}
            required
            error={errors.effectiveFrom?.message}
          >
            <Input
              type="date"
              {...register("effectiveFrom")}
              aria-label={t("rules.form.effectiveFrom")}
            />
          </AdminField>
          <AdminField label={t("rules.form.effectiveTo")} error={errors.effectiveTo?.message}>
            <Input
              type="date"
              {...register("effectiveTo")}
              aria-label={t("rules.form.effectiveTo")}
            />
          </AdminField>
        </div>

        <AdminField label={t("rules.form.priority")} error={errors.priority?.message}>
          <Input type="number" {...register("priority")} aria-label={t("rules.form.priority")} />
        </AdminField>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("requireCheckIn")} />
            {t("rules.form.requireCheckIn")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("requireCheckOut")} />
            {t("rules.form.requireCheckOut")}
          </label>
        </div>

        {isEdit && (
          <AdminField label={t("rules.form.status")} error={errors.status?.message}>
            <Select {...register("status")} aria-label={t("rules.form.status")}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </Select>
          </AdminField>
        )}
      </form>
    </Dialog>
  );
}
