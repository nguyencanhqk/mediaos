import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { UserRoundCheck } from "lucide-react";
import { Button, Select, cn } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import {
  EMPTY_OVERDUE_FILTERS,
  hasOverdueFilters,
  OVERDUE_FILTER_NONE,
  overdueFilterOptions,
  type OverdueDeskFilters,
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
      <Field label={t("overdueDesk.filters.project")}>
        <Select
          value={filters.project ?? ""}
          onChange={(e) => onChange({ ...filters, project: toFilterValue(e.target.value) })}
          className="w-48"
          data-testid="overdue-filter-project"
        >
          <option value="">{t("overdueDesk.filters.allProjects")}</option>
          {options.hasNoProject && (
            <option value={OVERDUE_FILTER_NONE}>{t("overdueDesk.filters.noProject")}</option>
          )}
          {options.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("overdueDesk.filters.assignee")}>
        <Select
          value={filters.assignee ?? ""}
          onChange={(e) => onChange({ ...filters, assignee: toFilterValue(e.target.value) })}
          className="w-48"
          data-testid="overdue-filter-assignee"
        >
          <option value="">{t("overdueDesk.filters.allAssignees")}</option>
          {options.hasUnassigned && (
            <option value={OVERDUE_FILTER_NONE}>{t("overdueDesk.filters.unassigned")}</option>
          )}
          {options.assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
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
