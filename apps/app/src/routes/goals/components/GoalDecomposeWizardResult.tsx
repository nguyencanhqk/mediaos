import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import type { DecomposeGoalResultDto } from "@mediaos/contracts";

/**
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-07) — bước «Đã tạo n việc» của wizard phân rã: liệt kê
 * `tasks[{id,taskCode,title}]` từ chính response (không gọi thêm API).
 *
 * Bấm một việc ⇒ `onOpenTask` (wizard đóng rồi mở drawer `?task=` tại chỗ — drawer và hộp thoại
 * modal không chồng nhau được: hộp thoại giữ focus). Không có `read:task` ⇒ tên việc là chữ thường:
 * drawer chỉ báo «Không mở được», vẽ nút là dẫn người dùng vào ngõ cụt.
 */
export function GoalDecomposeWizardResult({
  result,
  canOpenTask,
  onOpenTask,
}: {
  result: DecomposeGoalResultDto;
  canOpenTask: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation("goals");
  const count = result.tasks.length;
  return (
    <div data-testid="goal-decompose-result" className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground" role="status">
        <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
        {t("decompose.result.title", { count })}
      </p>
      <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {result.tasks.map((task) => {
          const content = (
            <>
              {task.taskCode && (
                <span className="font-mono text-xs text-muted-foreground">{task.taskCode}</span>
              )}
              <span className="text-sm text-foreground">{task.title}</span>
            </>
          );
          return (
            <li key={task.id} className="px-3 py-2">
              {canOpenTask ? (
                <button
                  type="button"
                  data-testid={`goal-decompose-result-task-${task.id}`}
                  className="flex w-full items-center gap-2 text-left underline-offset-2 hover:underline"
                  onClick={() => onOpenTask(task.id)}
                >
                  {content}
                </button>
              ) : (
                <span
                  data-testid={`goal-decompose-result-task-${task.id}`}
                  className="flex items-center gap-2"
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t("decompose.result.hint")}</p>
    </div>
  );
}
