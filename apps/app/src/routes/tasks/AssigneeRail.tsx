import { useTranslation } from "react-i18next";
import { UserX, Users } from "lucide-react";
import { Avatar, cn } from "@mediaos/ui";
import { UNASSIGNED_FILTER_VALUE, type AssigneeRailSummary } from "./workspace-constants";

/**
 * AssigneeRail — rail avatar DỌC bên phải board/danh sách (S5-TASK-WORKSPACE-1, benchmark MISA AMIS):
 * lọc theo người thực hiện + "Chưa giao", BẬT/TẮT NHIỀU người (Set), đếm theo tập task đã lọc
 * toolbar (đếm KHÔNG tự triệt tiêu khi chọn người — summary do caller build TRƯỚC lọc assignee,
 * và caller GHIM entry đang chọn qua pinSelectedInSummary để nút toggle không biến mất).
 *
 * Component THUẦN trình bày: selection sống ở vỏ workspace (ProjectDetailPage) để đổi tab không mất
 * (done_when #2). Nút đầu rail = "Tất cả" (xoá selection). Nút "Chưa giao" vẫn hiện khi ĐANG được
 * chọn dù count về 0 (đường gỡ selection — mirror pinSelectedInSummary).
 */
function CountBadge({ count, testId }: { count: number; testId: string }) {
  return (
    <span
      data-testid={testId}
      className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border"
    >
      {count}
    </span>
  );
}

export function AssigneeRail({
  summary,
  selection,
  onToggle,
  onClear,
}: {
  summary: AssigneeRailSummary;
  selection: ReadonlySet<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation("tasks");
  const unassignedSelected = selection.has(UNASSIGNED_FILTER_VALUE);
  const showUnassigned = summary.unassignedCount > 0 || unassignedSelected;
  if (summary.assignees.length === 0 && !showUnassigned && selection.size === 0) return null;

  const itemClass = (active: boolean) =>
    cn(
      "relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
      active
        ? "border-brand ring-2 ring-brand/40"
        : "border-transparent hover:border-border hover:bg-muted",
    );

  return (
    <div
      role="group"
      aria-label={t("workspace.rail.label")}
      data-testid="assignee-rail"
      className="flex w-12 shrink-0 flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-1.5"
    >
      <button
        type="button"
        onClick={onClear}
        aria-pressed={selection.size === 0}
        title={t("workspace.rail.all")}
        data-testid="assignee-rail-all"
        className={itemClass(selection.size === 0)}
      >
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </button>
      {summary.assignees.map((assignee) => {
        const active = selection.has(assignee.id);
        const label = assignee.name ?? t("tasks.kanban.unassigned");
        return (
          <button
            key={assignee.id}
            type="button"
            onClick={() => onToggle(assignee.id)}
            aria-pressed={active}
            title={t("workspace.rail.assigneeTitle", { name: label, count: assignee.count })}
            data-testid={`assignee-rail-item-${assignee.id}`}
            className={itemClass(active)}
          >
            <Avatar size="sm" name={assignee.name} src={assignee.avatarUrl} />
            <CountBadge count={assignee.count} testId={`assignee-rail-count-${assignee.id}`} />
          </button>
        );
      })}
      {showUnassigned && (
        <button
          type="button"
          onClick={() => onToggle(UNASSIGNED_FILTER_VALUE)}
          aria-pressed={unassignedSelected}
          title={t("workspace.rail.unassignedTitle", { count: summary.unassignedCount })}
          data-testid="assignee-rail-unassigned"
          className={itemClass(unassignedSelected)}
        >
          <UserX className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CountBadge count={summary.unassignedCount} testId="assignee-rail-count-unassigned" />
        </button>
      )}
    </div>
  );
}
