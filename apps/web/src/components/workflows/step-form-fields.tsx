import type { CreateStepRequest, StepType } from "@/lib/workflow-builder/contract";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { STEP_TYPE_LABELS, STEP_TYPE_OPTIONS, WORKFLOW_ROLE_OPTIONS } from "./constants";

export interface StepFormState {
  code: string;
  title: string;
  stepType: StepType;
  assigneeRoleCode: string;
  reviewerRoleCode: string;
  isRequired: boolean;
}

export const emptyStepForm: StepFormState = {
  code: "",
  title: "",
  stepType: "task",
  assigneeRoleCode: "",
  reviewerRoleCode: "",
  isRequired: true,
};

/** form state → request payload (chuỗi rỗng → null cho role). */
export function toStepRequest(f: StepFormState): CreateStepRequest {
  return {
    code: f.code.trim(),
    title: f.title.trim(),
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
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Mã bước *</span>
          <Input
            value={value.code}
            onChange={(e) => onChange({ code: e.target.value })}
            placeholder="VD: script"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Loại bước</span>
          <Select
            value={value.stepType}
            onChange={(e) => onChange({ stepType: e.target.value as StepType })}
          >
            {STEP_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {STEP_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Tên bước *</span>
        <Input
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="VD: Viết kịch bản"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Vai trò thực hiện</span>
          <Select
            value={value.assigneeRoleCode}
            onChange={(e) => onChange({ assigneeRoleCode: e.target.value })}
          >
            <option value="">— Chưa gán —</option>
            {WORKFLOW_ROLE_OPTIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Vai trò duyệt</span>
          <Select
            value={value.reviewerRoleCode}
            onChange={(e) => onChange({ reviewerRoleCode: e.target.value })}
          >
            <option value="">— Chưa gán —</option>
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
        <span>Bắt buộc (workflow chỉ hoàn thành khi bước này được duyệt)</span>
      </label>
    </div>
  );
}
