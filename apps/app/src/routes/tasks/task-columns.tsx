import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TaskStatusBadge, TaskPriorityBadge, TaskOverdueBadge } from "./TaskStatusBadge";

/**
 * useTaskReadColumns — 7 cột ĐỌC dùng chung cho bảng công việc (TASK-SCREEN-005 danh sách + SCREEN-010
 * task quá hạn). Trích từ TaskListPage (S5-FE-TASK-6) để KHỎI lặp cột giữa 2 màn (DRY). Cột "actions"
 * (edit/delete — gate riêng, handler theo trang) KHÔNG nằm ở đây: mỗi trang tự nối thêm nếu cần.
 *
 * `t` (ns "tasks") + `navigate` gọi nội bộ trong hook → consumer chỉ cần spread mảng trả về.
 */
export function useTaskReadColumns(): ColumnDef<TaskCoreResponseDto>[] {
  const { t } = useTranslation("tasks");
  const navigate = useNavigate();

  return [
    {
      accessorKey: "title",
      header: t("tasks.list.columns.title"),
      cell: ({ row }) => (
        <button
          type="button"
          className="font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() =>
            void navigate({ to: "/tasks/$taskId", params: { taskId: row.original.id } })
          }
        >
          {row.original.title}
        </button>
      ),
    },
    {
      accessorKey: "projectName",
      header: t("tasks.list.columns.project"),
      cell: ({ row }) => <span className="text-sm">{row.original.projectName ?? "—"}</span>,
    },
    {
      accessorKey: "assigneeName",
      header: t("tasks.list.columns.assignee"),
      cell: ({ row }) => <span className="text-sm">{row.original.assigneeName ?? "—"}</span>,
    },
    {
      accessorKey: "priority",
      header: t("tasks.list.columns.priority"),
      cell: ({ row }) => <TaskPriorityBadge priority={row.original.priority} />,
    },
    {
      accessorKey: "status",
      header: t("tasks.list.columns.status"),
      cell: ({ row }) => <TaskStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "dueAt",
      header: t("tasks.list.columns.dueAt"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="text-sm">
            {row.original.dueAt ? new Date(row.original.dueAt).toLocaleString("vi-VN") : "—"}
          </span>
          <TaskOverdueBadge isOverdue={row.original.isOverdue} />
        </div>
      ),
    },
    {
      accessorKey: "creatorName",
      header: t("tasks.list.columns.creator"),
      cell: ({ row }) => <span className="text-sm">{row.original.creatorName ?? "—"}</span>,
    },
  ];
}
