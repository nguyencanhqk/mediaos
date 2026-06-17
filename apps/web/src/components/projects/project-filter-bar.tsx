import type { EmployeeListItemDto } from "@mediaos/contracts";
import type { ProjectFilters } from "@/lib/projects-api";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
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

interface ProjectFilterBarProps {
  filters: ProjectFilters;
  onChange: (patch: Partial<ProjectFilters>) => void;
  onClear: () => void;
  employees: EmployeeListItemDto[];
}

const hasAnyFilter = (f: ProjectFilters): boolean =>
  Boolean(f.status || f.projectType || f.priority || f.managerId || f.q);

export function ProjectFilterBar({ filters, onChange, onClear, employees }: ProjectFilterBarProps) {
  const { t } = useTranslation("projects");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={filters.q ?? ""}
        onChange={(e) => onChange({ q: e.target.value || undefined })}
        placeholder={t("filterBar.searchPlaceholder")}
        className="max-w-xs"
      />

      <Select
        value={filters.projectType ?? ""}
        onChange={(e) => onChange({ projectType: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">{t("filterBar.anyType")}</option>
        {PROJECT_TYPE_OPTIONS.map((typ) => (
          <option key={typ} value={typ}>
            {PROJECT_TYPE_LABELS[typ]}
          </option>
        ))}
      </Select>

      <Select
        value={filters.status ?? ""}
        onChange={(e) => onChange({ status: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">{t("common:anyStatus")}</option>
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
        <option value="">{t("filterBar.anyPriority")}</option>
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
        <option value="">{t("filterBar.anyPM")}</option>
        {employees.map((emp) => (
          <option key={emp.userId} value={emp.userId}>
            {emp.userFullName ?? emp.userEmail ?? emp.userId}
          </option>
        ))}
      </Select>

      {hasAnyFilter(filters) && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t("filterBar.clearFilters")}
        </Button>
      )}
    </div>
  );
}
