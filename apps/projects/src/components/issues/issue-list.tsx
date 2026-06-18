import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";
import { Inbox } from "lucide-react";
import type { BoardTaskDto } from "@mediaos/contracts";
import { Avatar, DataTable, EmptyState } from "@mediaos/ui";
import { PriorityIcon } from "@/components/priority-icon";
import { StateBadge } from "@/components/state-badge";
import { LabelChip } from "@/components/label-chip";
import { useEmployeeMap } from "@/lib/use-members";

interface IssueListProps {
  tasks: BoardTaskDto[];
  isLoading: boolean;
  onOpenIssue: (taskId: string) => void;
}

/**
 * List view kiểu Plane qua @mediaos/ui DataTable (TanStack v8): displayId · tiêu đề · state · ưu tiên ·
 * nhãn · assignee · hạn. Row click mở panel chi tiết. Server là sự thật cho dữ liệu.
 */
export function IssueList({ tasks, isLoading, onOpenIssue }: IssueListProps) {
  const { t } = useTranslation("projects");
  const { labelFor } = useEmployeeMap();

  const columns = useMemo<ColumnDef<BoardTaskDto>[]>(
    () => [
      {
        id: "displayId",
        header: t("list.colId"),
        accessorFn: (row) => row.displayId ?? "",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onOpenIssue(row.original.id)}
            className="font-mono text-xs font-medium text-muted-foreground hover:text-brand"
          >
            {row.original.displayId ?? "—"}
          </button>
        ),
      },
      {
        id: "title",
        header: t("list.colTitle"),
        accessorFn: (row) => row.title,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onOpenIssue(row.original.id)}
            className="max-w-[28rem] truncate text-left text-sm font-medium text-foreground hover:text-brand"
          >
            {row.original.title}
          </button>
        ),
      },
      {
        id: "state",
        header: t("list.colState"),
        accessorFn: (row) => row.stateName ?? "",
        cell: ({ row }) => (
          <StateBadge
            name={row.original.stateName}
            color={row.original.stateColor}
            emptyLabel={t("board.noStateColumn")}
          />
        ),
      },
      {
        id: "priority",
        header: t("list.colPriority"),
        accessorFn: (row) => row.priority,
        cell: ({ row }) => <PriorityIcon priority={row.original.priority} showLabel />,
      },
      {
        id: "labels",
        header: t("list.colLabels"),
        enableGlobalFilter: false,
        cell: ({ row }) =>
          row.original.labels.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.original.labels.map((label) => (
                <LabelChip key={label.id} label={label} />
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "assignee",
        header: t("list.colAssignee"),
        accessorFn: (row) => (row.assigneeUserId ? (labelFor(row.assigneeUserId) ?? "") : ""),
        cell: ({ row }) => {
          const userId = row.original.assigneeUserId;
          if (!userId) return <span className="text-xs text-muted-foreground">—</span>;
          const name = labelFor(userId);
          return (
            <span className="inline-flex items-center gap-2">
              <Avatar name={name ?? userId} size="sm" />
              <span className="max-w-[10rem] truncate text-sm text-foreground">{name}</span>
            </span>
          );
        },
      },
      {
        id: "dueDate",
        header: t("list.colDue"),
        accessorFn: (row) => row.dueDate ?? "",
        cell: ({ row }) =>
          row.original.dueDate ? (
            <span className="text-sm text-foreground">
              {new Date(row.original.dueDate).toLocaleDateString("vi-VN")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [t, onOpenIssue, labelFor],
  );

  return (
    <DataTable
      columns={columns}
      data={tasks}
      isLoading={isLoading}
      pageSize={25}
      emptyState={<EmptyState icon={Inbox} title={t("list.empty")} description={t("list.emptyHint")} />}
    />
  );
}
