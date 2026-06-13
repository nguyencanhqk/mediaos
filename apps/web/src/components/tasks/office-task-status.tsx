import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OfficeTaskStatusDto, TaskDto } from "@mediaos/contracts";
import { tasksApi } from "@/lib/tasks-api";
import { PermissionGate } from "@/components/permission-gate";
import { TASK_STATUS_LABELS } from "./task-status-constants";

/**
 * Control luồng rút gọn (G9-3) cho task KHÔNG vòng duyệt: Chưa bắt đầu → Đang làm → Hoàn thành.
 *
 * - CHỈ 3 status office (OfficeTaskStatusDto) — KHÔNG render nút status workflow (waiting_review/
 *   approved/revision); mirror BE officeTaskStatusSchema + SEC-2 guard (server vẫn là sự thật).
 * - Bọc <PermissionGate update:task> → ẩn UX khi thiếu quyền; BE vẫn gate `update:task`.
 *
 * Caller chỉ render component này cho task đi luồng rút gọn (isShortenedFlowTask) — xem TaskBoardPage.
 */
const SHORTENED_STEPS: ReadonlyArray<OfficeTaskStatusDto> = [
  "not_started",
  "in_progress",
  "completed",
];

interface OfficeTaskStatusProps {
  task: TaskDto;
}

export function OfficeTaskStatus({ task }: OfficeTaskStatusProps) {
  const qc = useQueryClient();

  const mutate = useMutation({
    mutationFn: (status: OfficeTaskStatusDto) => tasksApi.updateTaskStatus(task.id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks", "board"] }),
  });

  return (
    <PermissionGate action="update" resourceType="task">
      <div className="flex flex-wrap gap-1">
        {SHORTENED_STEPS.map((status) => {
          const isCurrent = task.status === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => {
                if (!isCurrent) mutate.mutate(status);
              }}
              disabled={isCurrent || mutate.isPending}
              aria-pressed={isCurrent}
              className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                isCurrent
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {TASK_STATUS_LABELS[status]}
            </button>
          );
        })}
      </div>
    </PermissionGate>
  );
}
