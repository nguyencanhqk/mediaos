import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { UserRoundCheck } from "lucide-react";
import { Button, Select, cn } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import {
  EMPTY_OVERDUE_FILTERS,
  hasOverdueFilters,
  keepSelectedOption,
  OVERDUE_FILTER_NONE,
  overdueFilterOptions,
  type OverdueDeskFilters,
  type OverdueFilterOption,
} from "./overdue-desk";

/**
 * S20-TASK-OVERDUEDESK-1 (US-TASK-QL-07) — thanh lọc của trang Quá hạn: Dự án · Người phụ trách ·
 * «Tôi giao». Lọc CLIENT-SIDE trên các dòng đã tải (≤ 200); lựa chọn lấy từ chính các dòng đó nên
 * không gọi thêm API và không cần quyền đọc danh mục dự án / nhân viên.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const toFilterValue = (value: string): string | null => (value === "" ? null : value);

/**
 * Một ô lọc. Nhớ tên của lựa chọn lúc người dùng chọn: dòng cuối mang giá trị đó rời danh sách thì
 * lựa chọn vẫn hiện (`keepSelectedOption`) — ô không nhảy về «Tất cả» trong khi bộ lọc vẫn áp dụng.
 */
function FilterSelect({
  label,
  allLabel,
  emptyLabel,
  options,
  hasEmpty,
  value,
  onSelect,
  testId,
}: {
  label: string;
  allLabel: string;
  emptyLabel: string;
  options: readonly OverdueFilterOption[];
  hasEmpty: boolean;
  value: string | null;
  onSelect: (next: string | null) => void;
  testId: string;
}) {
  const [remembered, setRemembered] = useState<OverdueFilterOption | undefined>(undefined);
  const shown = keepSelectedOption(options, hasEmpty, value, remembered);
  return (
    <Field label={label}>
      <Select
        value={value ?? ""}
        onChange={(e) => {
          const next = toFilterValue(e.target.value);
          setRemembered(options.find((option) => option.id === next));
          onSelect(next);
        }}
        className="w-48"
        data-testid={testId}
      >
        <option value="">{allLabel}</option>
        {shown.hasEmpty && <option value={OVERDUE_FILTER_NONE}>{emptyLabel}</option>}
        {shown.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function OverdueDeskToolbar({
  rows,
  filters,
  onChange,
  canFilterMine,
}: {
  rows: readonly TaskCoreResponseDto[];
  filters: OverdueDeskFilters;
  onChange: (next: OverdueDeskFilters) => void;
  /** Biết được tôi là ai (`/auth/me`) — chưa biết thì «Tôi giao» không bấm được. */
  canFilterMine: boolean;
}) {
  const { t } = useTranslation("tasks");
  const options = useMemo(() => overdueFilterOptions(rows), [rows]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <FilterSelect
        label={t("overdueDesk.filters.project")}
        allLabel={t("overdueDesk.filters.allProjects")}
        emptyLabel={t("overdueDesk.filters.noProject")}
        options={options.projects}
        hasEmpty={options.hasNoProject}
        value={filters.project}
        onSelect={(project) => onChange({ ...filters, project })}
        testId="overdue-filter-project"
      />
      <FilterSelect
        label={t("overdueDesk.filters.assignee")}
        allLabel={t("overdueDesk.filters.allAssignees")}
        emptyLabel={t("overdueDesk.filters.unassigned")}
        options={options.assignees}
        hasEmpty={options.hasUnassigned}
        value={filters.assignee}
        onSelect={(assignee) => onChange({ ...filters, assignee })}
        testId="overdue-filter-assignee"
      />
      <button
        type="button"
        aria-pressed={filters.mine}
        disabled={!canFilterMine}
        onClick={() => onChange({ ...filters, mine: !filters.mine })}
        data-testid="overdue-filter-mine"
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          filters.mine
            ? "border-primary bg-primary/10 text-foreground"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        <UserRoundCheck className="h-4 w-4" aria-hidden="true" />
        {t("overdueDesk.filters.mine")}
      </button>
      {hasOverdueFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_OVERDUE_FILTERS)}>
          {t("overdueDesk.filters.clear")}
        </Button>
      )}
    </div>
  );
}
