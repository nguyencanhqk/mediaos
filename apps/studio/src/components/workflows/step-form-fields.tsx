import { useTranslation } from "react-i18next";
import type { CreateStepRequest, UpdateStepRequest } from "@/lib/workflow-builder/contract";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import { STEP_TYPE_OPTIONS, WORKFLOW_ROLE_OPTIONS, stepTypeLabel } from "./constants";

export interface StepFormState {
  code: string;
  name: string;
  stepType: string;
  assigneeRoleCode: string;
  reviewerRoleCode: string;
  isRequired: boolean;
}

export const emptyStepForm: StepFormState = {
  code: "",
  name: "",
  stepType: "task",
  assigneeRoleCode: "",
  reviewerRoleCode: "",
  isRequired: true,
};

/** nodeKey = DAG identity bất biến (gắn cạnh + canvas) — slug ổn định từ code. */
function toNodeKey(code: string): string {
  return (
    code
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "step"
  );
}

/** form state → CreateStepRequest (chuỗi rỗng → null cho role; defaultTaskTitle mặc định = tên bước). */
export function toCreateStepRequest(f: StepFormState): CreateStepRequest {
  const name = f.name.trim();
  const code = f.code.trim();
  return {
    nodeKey: toNodeKey(code),
    code,
    name,
    defaultTaskTitle: name,
    stepType: f.stepType,
    assigneeRoleCode: f.assigneeRoleCode || null,
    reviewerRoleCode: f.reviewerRoleCode || null,
    isRequired: f.isRequired,
  };
}

/** form state → UpdateStepRequest (nodeKey BẤT BIẾN — contract đã omit, không gửi). */
export function toUpdateStepRequest(f: StepFormState): UpdateStepRequest {
  const name = f.name.trim();
  return {
    code: f.code.trim(),
    name,
    defaultTaskTitle: name,
    stepType: f.stepType,
    assigneeRoleCode: f.assigneeRoleCode || null,
    reviewerRoleCode: f.reviewerRoleCode || null,
    isRequired: f.isRequired,
  };
}

interface StepFormFieldsProps {
  value: StepFormState;
  onChange: (patch: Partial<StepFormState>) => void;
}

export function StepFormFields({ value, onChange }: StepFormFieldsProps) {
  const { t } = useTranslation("workflows");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("steps.form.fieldCode")}</span>
          <Input
            value={value.code}
            onChange={(e) => onChange({ code: e.target.value })}
            placeholder={t("steps.form.fieldCodePlaceholder")}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("steps.form.fieldType")}</span>
          <Select
            value={value.stepType}
            onChange={(e) => onChange({ stepType: e.target.value })}
          >
            {STEP_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {stepTypeLabel(opt)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("steps.form.fieldName")}</span>
        <Input
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t("steps.form.fieldNamePlaceholder")}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("steps.form.fieldAssignee")}</span>
          <Select
            value={value.assigneeRoleCode}
            onChange={(e) => onChange({ assigneeRoleCode: e.target.value })}
          >
            <option value="">{t("steps.form.unassigned")}</option>
            {WORKFLOW_ROLE_OPTIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("steps.form.fieldReviewer")}</span>
          <Select
            value={value.reviewerRoleCode}
            onChange={(e) => onChange({ reviewerRoleCode: e.target.value })}
          >
            <option value="">{t("steps.form.unassigned")}</option>
            {WORKFLOW_ROLE_OPTIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.isRequired}
          onChange={(e) => onChange({ isRequired: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span>{t("steps.form.isRequired")}</span>
      </label>
    </div>
  );
}
