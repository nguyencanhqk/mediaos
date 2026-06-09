import type {
  EmployeeListItemDto,
  ProjectPriority,
  ProjectStatus,
  ProjectType,
} from "@mediaos/contracts";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Field label="Tên dự án *">
          <Input
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Tên dự án…"
          />
        </Field>
      </div>

      <Field label="Mã dự án">
        <Input
          value={value.code}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder="VD: PRJ-2026-01"
        />
      </Field>

      <Field label="Loại dự án">
        <Select
          value={value.projectType}
          onChange={(e) => onChange({ projectType: e.target.value as ProjectType | "" })}
        >
          <option value="">— Chưa chọn —</option>
          {PROJECT_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {PROJECT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="col-span-2">
        <Field label="Mô tả">
          <Input
            value={value.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Mô tả ngắn…"
          />
        </Field>
      </div>

      <Field label="Chủ sở hữu (Owner)">
        <Select
          value={value.ownerUserId}
          onChange={(e) => onChange({ ownerUserId: e.target.value })}
        >
          <option value="">— Chưa gán —</option>
          {employees.map((e) => (
            <option key={e.userId} value={e.userId}>
              {employeeLabel(e)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Quản lý dự án (PM)">
        <Select
          value={value.projectManagerId}
          onChange={(e) => onChange({ projectManagerId: e.target.value })}
        >
          <option value="">— Chưa gán —</option>
          {employees.map((e) => (
            <option key={e.userId} value={e.userId}>
              {employeeLabel(e)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Ngày bắt đầu">
        <Input
          type="date"
          value={value.startDate}
          onChange={(e) => onChange({ startDate: e.target.value })}
        />
      </Field>

      <Field label="Ngày kết thúc">
        <Input
          type="date"
          value={value.endDate}
          onChange={(e) => onChange({ endDate: e.target.value })}
        />
      </Field>

      <Field label="Độ ưu tiên">
        <Select
          value={value.priority}
          onChange={(e) => onChange({ priority: e.target.value as ProjectPriority | "" })}
        >
          <option value="">— Chưa chọn —</option>
          {PROJECT_PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {PROJECT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Ngân sách (VND)">
        <Input
          type="number"
          min={0}
          value={value.budget}
          onChange={(e) => onChange({ budget: e.target.value })}
          placeholder="0"
        />
      </Field>

      {showStatus && (
        <Field label="Trạng thái">
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
