import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDateTime } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { useTaskReadColumns } from "./task-columns";
import { TaskRowDeadlineControl } from "./TaskRowQuickEdit";
import { TaskRowAssigneeControl } from "./TaskInlineFields";
import { OVERDUE_DEADLINE_PRESETS, overdueDaysOf } from "./overdue-desk";

/**
 * S20-TASK-OVERDUEDESK-1 (US-TASK-QL-07) — cột của trang Quá hạn: CÙNG bộ cột đọc của Danh sách
 * (`useTaskReadColumns` — tiêu đề mở drawer `?task=`, trạng thái sửa tại dòng…), thêm cột «Trễ» ngay
 * sau tiêu đề và thay hai ô:
 *   - Người phụ trách ⇒ picker gọi route `assign` (`TaskRowAssigneeControl`).
 *   - Hạn ⇒ `DeadlineQuickPicker` với mốc riêng của trang (+1 ngày · +3 ngày · Thứ Sáu · Tuỳ chỉnh)
 *     qua route change-deadline; lưu xong báo việc server đã xác nhận cho trang (`onDeadlineSaved`).
 * Thiếu cặp quyền của ô nào ⇒ ô đó chỉ đọc (gate nằm trong từng control, đo bằng useCan).
 */
type Column = ColumnDef<TaskCoreResponseDto>;
type Cell = NonNullable<Column["cell"]>;

function accessorKeyOf(column: Column): string | undefined {
  return "accessorKey" in column ? String(column.accessorKey) : undefined;
}

function LateCell({
  task,
  now,
  timeZone,
}: {
  task: TaskCoreResponseDto;
  now: Date;
  timeZone: string;
}) {
  const { t } = useTranslation("tasks");
  const days = overdueDaysOf(task.dueAt, now, timeZone);
  const label =
    days === null
      ? "—"
      : days === 0
        ? t("overdueDesk.lateUnderDay")
        : t("overdueDesk.lateDays", { days });
  return (
    <span
      data-testid={`overdue-late-${task.id}`}
      className="whitespace-nowrap text-sm font-medium text-destructive"
    >
      {label}
    </span>
  );
}

export function useOverdueDeskColumns({
  now,
  timeZone,
  onDeadlineSaved,
}: {
  now: Date;
  timeZone: string;
  onDeadlineSaved: (saved: TaskCoreResponseDto) => void;
}): Column[] {
  const { t } = useTranslation("tasks");
  const base = useTaskReadColumns();

  const cells: Record<string, Cell> = {
    assigneeName: ({ row }) => <TaskRowAssigneeControl task={row.original} />,
    dueAt: ({ row }) => (
      <TaskRowDeadlineControl
        task={row.original}
        presets={OVERDUE_DEADLINE_PRESETS}
        onSaved={onDeadlineSaved}
        readOnly={
          <span className="text-sm">
            {row.original.dueAt ? formatDateTime(row.original.dueAt, timeZone) : "—"}
          </span>
        }
      />
    ),
  };
  const columns = base.map((column) => {
    const cell = cells[accessorKeyOf(column) ?? ""];
    return cell ? { ...column, cell } : column;
  });
  const late: Column = {
    id: "late",
    header: t("overdueDesk.lateColumn"),
    cell: ({ row }) => <LateCell task={row.original} now={now} timeZone={timeZone} />,
  };
  const [title, ...rest] = columns;
  return title ? [title, late, ...rest] : [late];
}
