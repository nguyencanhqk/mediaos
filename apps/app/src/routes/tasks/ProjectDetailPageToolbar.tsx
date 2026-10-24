import { useTranslation } from "react-i18next";
import { Button, Select } from "@mediaos/ui";
import { TASK_CORE_PRIORITY_OPTIONS, TASK_CORE_STATUS_OPTIONS } from "./constants";
import {
  DEFAULT_WORKSPACE_FILTERS,
  WORKSPACE_TASK_SORTS,
  type WorkspaceTaskFilters,
} from "./workspace-constants";
import { MineChip, TaskSearchBox } from "./TaskFilterControls";

/**
 * Toolbar lọc chung tab Bảng·Danh sách của workspace dự án (tìm · «Của tôi» · trạng thái · ưu tiên ·
 * quá hạn · sắp xếp · đặt lại). Component THUẦN trình bày: giá trị đến từ URL (ProjectDetailPage đọc
 * qua project-workspace-filters.ts), mọi thay đổi trả về qua `onChange` — chọn rời rạc = PUSH (Back
 * hoàn tác), gõ ô tìm = REPLACE sau debounce (không một mục lịch sử mỗi chữ).
 *
 * Chip «Của tôi» = CÙNG chip của Danh sách `/tasks` (TaskFilterControls, employeeId từ /me), ở đây
 * bật/tắt tôi trong selection của rail (`who`) — chip và rail luôn khớp vì đọc chung một nguồn.
 */
export function WorkspaceToolbar({
  filters,
  onChange,
  assigneeSelection,
  onToggleAssignee,
}: {
  filters: WorkspaceTaskFilters;
  onChange: (next: WorkspaceTaskFilters, replace?: boolean) => void;
  assigneeSelection: ReadonlySet<string>;
  onToggleAssignee: (value: string) => void;
}) {
  const { t } = useTranslation("tasks");
  const patch = (part: Partial<WorkspaceTaskFilters>) => onChange({ ...filters, ...part });
  const isDirty =
    filters.q !== "" ||
    filters.status !== "" ||
    filters.priority !== "" ||
    filters.overdueOnly ||
    filters.sort !== "default";

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="workspace-toolbar">
      <TaskSearchBox
        value={filters.q || undefined}
        onCommit={(q) => onChange({ ...filters, q: q ?? "" }, true)}
        label={t("workspace.toolbar.searchPlaceholder")}
        placeholder={t("workspace.toolbar.searchPlaceholder")}
        testId="workspace-search"
        className="w-56"
      />
      <MineChip
        isActive={(myId) => assigneeSelection.has(myId)}
        onToggle={(myId) => onToggleAssignee(myId)}
        testId="workspace-chip-mine"
      />
      <Select
        value={filters.status}
        onChange={(e) => patch({ status: e.target.value as WorkspaceTaskFilters["status"] })}
        aria-label={t("tasks.list.filters.status")}
        className="w-40"
        data-testid="workspace-filter-status"
      >
        <option value="">{t("tasks.list.allStatuses")}</option>
        {TASK_CORE_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {t(`tasks.status.${s}`)}
          </option>
        ))}
      </Select>
      <Select
        value={filters.priority}
        onChange={(e) => patch({ priority: e.target.value as WorkspaceTaskFilters["priority"] })}
        aria-label={t("tasks.list.filters.priority")}
        className="w-36"
        data-testid="workspace-filter-priority"
      >
        <option value="">{t("tasks.list.allPriorities")}</option>
        {TASK_CORE_PRIORITY_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {t(`tasks.priority.${p}`)}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={filters.overdueOnly}
          onChange={(e) => patch({ overdueOnly: e.target.checked })}
          data-testid="workspace-filter-overdue"
        />
        {t("tasks.list.filters.overdue")}
      </label>
      <Select
        value={filters.sort}
        onChange={(e) => patch({ sort: e.target.value as WorkspaceTaskFilters["sort"] })}
        aria-label={t("workspace.toolbar.sortLabel")}
        className="w-44"
        data-testid="workspace-sort"
      >
        {WORKSPACE_TASK_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {t(`workspace.toolbar.sort.${sort}`)}
          </option>
        ))}
      </Select>
      {isDirty && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_WORKSPACE_FILTERS)}
          data-testid="workspace-filters-reset"
        >
          {t("workspace.toolbar.reset")}
        </Button>
      )}
    </div>
  );
}
