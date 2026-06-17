import type {
  EmployeeListItemDto,
  ProjectPriority,
  ProjectStatus,
  ProjectType,
} from "@mediaos/contracts";
import { useTranslation } from "react-i18next";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import {
  PROJECT_PRIORITY_LABELS,
  PROJECT_PRIORITY_OPTIONS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_OPTIONS,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPE_OPTIONS,
} from "./constants";

/** State chung của form tạo/sửa dự án — string-based để bind thẳng input/select. */
export interface ProjectFormState {
  name: string;
  code: string;
  projectType: ProjectType | "";
  description: string;
  ownerUserId: string;
  projectManagerId: string;
  startDate: string;
  endDate: string;
  priority: ProjectPriority | "";
  budget: string;
  status: ProjectStatus;
}

export const emptyProjectForm: ProjectFormState = {
  name: "",
  code: "",
  projectType: "",
  description: "",
  ownerUserId: "",
  projectManagerId: "",
  startDate: "",
  endDate: "",
  priority: "",
  budget: "",
  status: "active",
};

function employeeLabel(e: EmployeeListItemDto): string {
  return e.userFullName ?? e.userEmail ?? e.userId;
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

interface ProjectFormFieldsProps {
  value: ProjectFormState;
  onChange: (patch: Partial<ProjectFormState>) => void;
  employees: EmployeeListItemDto[];
  /** Hiện ô trạng thái (chỉ form sửa). */
  showStatus?: boolean;
}

export function ProjectFormFields({
  value,
  onChange,
  employees,
  showStatus = false,
}: ProjectFormFieldsProps) {
  const { t } = useTranslation("projects");
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Field label={t("form.fieldName")}>
          <Input
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t("form.namePlaceholder")}
          />
        </Field>
      </div>

      <Field label={t("form.fieldCode")}>
        <Input
          value={value.code}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder="VD: PRJ-2026-01"
        />
      </Field>

      <Field label={t("form.fieldType")}>
        <Select
          value={value.projectType}
          onChange={(e) => onChange({ projectType: e.target.value as ProjectType | "" })}
        >
          <option value="">{t("common:notSelected")}</option>
          {PROJECT_TYPE_OPTIONS.map((typ) => (
            <option key={typ} value={typ}>
              {PROJECT_TYPE_LABELS[typ]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="col-span-2">
        <Field label={t("form.fieldDescription")}>
          <Input
            value={value.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={t("form.descriptionPlaceholder")}
          />
        </Field>
      </div>

      <Field label={t("form.fieldOwner")}>
        <Select
          value={value.ownerUserId}
          onChange={(e) => onChange({ ownerUserId: e.target.value })}
        >
          <option value="">{t("common:unassigned")}</option>
          {employees.map((emp) => (
            <option key={emp.userId} value={emp.userId}>
              {employeeLabel(emp)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("form.fieldPM")}>
        <Select
          value={value.projectManagerId}
          onChange={(e) => onChange({ projectManagerId: e.target.value })}
        >
          <option value="">{t("common:unassigned")}</option>
          {employees.map((emp) => (
            <option key={emp.userId} value={emp.userId}>
              {employeeLabel(emp)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("form.fieldStartDate")}>
        <Input
          type="date"
          value={value.startDate}
          onChange={(e) => onChange({ startDate: e.target.value })}
        />
      </Field>

      <Field label={t("form.fieldEndDate")}>
        <Input
          type="date"
          value={value.endDate}
          onChange={(e) => onChange({ endDate: e.target.value })}
        />
      </Field>

      <Field label={t("form.fieldPriority")}>
        <Select
          value={value.priority}
          onChange={(e) => onChange({ priority: e.target.value as ProjectPriority | "" })}
        >
          <option value="">{t("common:notSelected")}</option>
          {PROJECT_PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {PROJECT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("form.fieldBudget")}>
        <Input
          type="number"
          min={0}
          value={value.budget}
          onChange={(e) => onChange({ budget: e.target.value })}
          placeholder="0"
        />
      </Field>

      {showStatus && (
        <Field label={t("form.fieldStatus")}>
          <Select
            value={value.status}
            onChange={(e) => onChange({ status: e.target.value as ProjectStatus })}
          >
            {PROJECT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}
