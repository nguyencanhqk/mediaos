import type { EmployeeListItemDto } from "@mediaos/contracts";
import type { ProjectFilters } from "@/lib/projects-api";
import { Button } from "@/components/ui/button";
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

interface ProjectFilterBarProps {
  filters: ProjectFilters;
  onChange: (patch: Partial<ProjectFilters>) => void;
  onClear: () => void;
  employees: EmployeeListItemDto[];
}

const hasAnyFilter = (f: ProjectFilters): boolean =>
  Boolean(f.status || f.projectType || f.priority || f.managerId || f.q);

export function ProjectFilterBar({ filters, onChange, onClear, employees }: ProjectFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={filters.q ?? ""}
        onChange={(e) => onChange({ q: e.target.value || undefined })}
        placeholder="Tìm theo tên…"
        className="max-w-xs"
      />

      <Select
        value={filters.projectType ?? ""}
        onChange={(e) => onChange({ projectType: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">Mọi loại</option>
        {PROJECT_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {PROJECT_TYPE_LABELS[t]}
          </option>
        ))}
      </Select>

      <Select
        value={filters.status ?? ""}
        onChange={(e) => onChange({ status: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">Mọi trạng thái</option>
        {PROJECT_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {PROJECT_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>

      <Select
        value={filters.priority ?? ""}
        onChange={(e) => onChange({ priority: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">Mọi ưu tiên</option>
        {PROJECT_PRIORITY_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {PROJECT_PRIORITY_LABELS[p]}
          </option>
        ))}
      </Select>

      <Select
        value={filters.managerId ?? ""}
        onChange={(e) => onChange({ managerId: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">Mọi PM</option>
        {employees.map((e) => (
          <option key={e.userId} value={e.userId}>
            {e.userFullName ?? e.userEmail ?? e.userId}
          </option>
        ))}
      </Select>

      {hasAnyFilter(filters) && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Xoá lọc
        </Button>
      )}
    </div>
  );
}
