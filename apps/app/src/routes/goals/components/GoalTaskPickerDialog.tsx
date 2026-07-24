import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  goalApi,
  goalInvalidation,
  taskCoreApi,
  taskKeys,
  taskProjectApi,
} from "@mediaos/web-core";
import type {
  GoalCoreResponseDto,
  GoalTaskLinkResultDto,
  TaskCoreResponseDto,
} from "@mediaos/contracts";
import { Button, Checkbox, Dialog, Select } from "@mediaos/ui";
import { TaskStatusBadge } from "@/routes/tasks/TaskStatusBadge";

/** Trần số việc liệt kê để chọn — cùng cỡ với các picker khác, tránh kéo cả bảng task về client. */
const CANDIDATE_TASK_LIMIT = 100;
const PROJECT_LIMIT = 100;

/**
 * S5-GOAL-FE-2 — chọn việc để gắn BULK vào mục tiêu (GOAL-API-010).
 *
 * NGUỒN ỨNG VIÊN THEO NEO — và GIỚI HẠN API THẬT phải nói thẳng ra:
 *   · mục tiêu cấp `project`  → `GET /tasks?projectId=…` (đúng neo, một phát ăn ngay);
 *   · mục tiêu cấp `employee` → `GET /tasks?assigneeEmployeeId=…`;
 *   · mục tiêu cấp `department` → KHÔNG có đường nào: `listTaskCoreQuerySchema` chỉ có
 *     `projectId`/`assigneeEmployeeId`, KHÔNG có `departmentId` lẫn tìm-kiếm theo tiêu đề. Nên ở cấp
 *     này người dùng BẮT BUỘC chọn một dự án trước rồi mới thấy danh sách việc. Đây là giới hạn của
 *     API hiện có, KHÔNG phải chỗ để lane FE tự chế endpoint mới.
 *
 * 200 KÈM `warnings[]` KHÔNG PHẢI LỖI: với mục tiêu cấp phòng, task không liên quan phòng VẪN ĐƯỢC
 * GẮN (SPEC-10 §12 ghi rõ "không chặn") và server chỉ trả cảnh báo mềm. Coi warnings là lỗi ⇒ hiện đỏ
 * + rollback trong khi dữ liệu ĐÃ ghi = nói dối người dùng. Hai vế CHẶN CỨNG (employee/project sai
 * neo) đi đường 422 GOAL-ERR-008 — nhánh error bên dưới.
 */
export function GoalTaskPickerDialog({
  goal,
  onClose,
}: {
  goal: GoalCoreResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();

  const isDepartmentLevel = goal.level === "department" || goal.level === "company";
  const [projectId, setProjectId] = useState(isDepartmentLevel ? "" : (goal.projectId ?? ""));
  const [selected, setSelected] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<GoalTaskLinkResultDto["warnings"]>([]);

  // Bộ lọc gửi lên server — CHỈ field mà API thật có. Không có filter nào hợp lệ ⇒ KHÔNG gọi
  // (enabled=false): `GET /tasks` trần sẽ trả việc TOÀN công ty trong phạm vi đọc, không liên quan neo.
  const taskFilter = useMemo(() => {
    if (goal.level === "employee" && goal.employeeId) {
      return { assigneeEmployeeId: goal.employeeId, limit: CANDIDATE_TASK_LIMIT };
    }
    const effectiveProjectId = isDepartmentLevel ? projectId : (goal.projectId ?? "");
    if (effectiveProjectId) return { projectId: effectiveProjectId, limit: CANDIDATE_TASK_LIMIT };
    return null;
  }, [goal.level, goal.employeeId, goal.projectId, isDepartmentLevel, projectId]);

  // Không suy được neo nào (mục tiêu cấp phòng/công ty, hoặc dữ liệu neo khuyết) ⇒ phải chọn dự án
  // trước. `GET /tasks` trần sẽ trả việc TOÀN công ty trong phạm vi đọc — không liên quan mục tiêu.
  const needsProjectPick = taskFilter === null;

  const projectsQuery = useQuery({
    queryKey: taskKeys.projects.list({ limit: PROJECT_LIMIT }),
    queryFn: () => taskProjectApi.listProjects({ limit: PROJECT_LIMIT }),
    enabled: needsProjectPick,
    staleTime: 60_000,
  });

  const tasksQuery = useQuery({
    queryKey: taskKeys.list(taskFilter ?? { goalPicker: "idle" }),
    queryFn: () => taskCoreApi.listTasks(taskFilter ?? {}),
    enabled: taskFilter !== null,
    staleTime: 30_000,
  });

  // Việc ĐÃ gắn đúng mục tiêu này thì không phải "gắn thêm" — bỏ khỏi danh sách chọn.
  const candidates = useMemo(
    () => (tasksQuery.data ?? []).filter((task) => task.goalId !== goal.id),
    [tasksQuery.data, goal.id],
  );

  const mutation = useMutation({
    mutationFn: () => goalApi.linkTasks(goal.id, { taskIds: selected }),
    onSuccess: async (result) => {
      // Task đang thuộc mục tiêu KHÁC sẽ được server CHUYỂN sang mục tiêu này và recompute CẢ HAI ⇒
      // phải invalidate luôn mục tiêu cũ của từng task (lấy từ danh sách ứng viên đã tải), nếu không
      // % cũ đọng lại trên chi tiết/card mà người khác đang mở.
      const affected = (tasksQuery.data ?? []).filter((task) => selected.includes(task.id));
      const keys = [
        ...goalInvalidation.linkTasks({
          goalIds: [goal.id, ...affected.map((task) => task.goalId)],
        }),
        // Phía TASK: chip "Mục tiêu" trên panel chi tiết + thẻ trên board dự án tương ứng.
        ...affected.flatMap((task) =>
          goalInvalidation.linkTasks({
            goalIds: [],
            taskId: task.id,
            projectId: task.projectId,
          }),
        ),
      ];
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      setSelected([]);
      if (result.warnings.length > 0) {
        // Đã ghi xong — giữ hộp thoại mở để người dùng ĐỌC cảnh báo mềm (đóng ngay = nuốt thông tin).
        setWarnings(result.warnings);
        return;
      }
      onClose();
    },
  });

  const errorMessage =
    mutation.error instanceof ApiError && mutation.error.message
      ? mutation.error.message
      : mutation.isError
        ? t("taskPicker.error")
        : null;

  function toggle(taskId: string) {
    setSelected((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("taskPicker.title")}
      description={t("taskPicker.description")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("taskPicker.close")}
          </Button>
          <Button
            size="sm"
            data-testid="goal-task-picker-submit"
            disabled={selected.length === 0 || mutation.isPending}
            onClick={() => {
              setWarnings([]);
              mutation.mutate();
            }}
          >
            {mutation.isPending ? t("taskPicker.submitting") : t("taskPicker.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {(isDepartmentLevel || needsProjectPick) && (
          <div className="space-y-1.5">
            <label
              htmlFor="goal-task-picker-project"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("taskPicker.projectLabel")}
            </label>
            <Select
              id="goal-task-picker-project"
              data-testid="goal-task-picker-project"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSelected([]);
              }}
            >
              <option value="">{t("taskPicker.pickProject")}</option>
              {(projectsQuery.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
            {projectsQuery.isError && (
              <p className="text-xs text-destructive">{t("taskPicker.projectsError")}</p>
            )}
          </div>
        )}

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {taskFilter === null ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("taskPicker.pickProjectFirst")}
            </p>
          ) : tasksQuery.isLoading ? (
            <div className="h-24 animate-pulse rounded bg-muted" />
          ) : tasksQuery.isError ? (
            <p className="py-4 text-center text-sm text-destructive" role="alert">
              {t("taskPicker.tasksError")}
            </p>
          ) : candidates.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("taskPicker.empty")}
            </p>
          ) : (
            candidates.map((task: TaskCoreResponseDto) => (
              <label
                key={task.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  data-testid={`goal-task-pick-${task.id}`}
                  checked={selected.includes(task.id)}
                  onChange={() => toggle(task.id)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {task.title}
                </span>
                <TaskStatusBadge status={task.status} />
              </label>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {t("taskPicker.selectedCount", { count: selected.length })}
        </p>

        {warnings.length > 0 && (
          <div
            data-testid="goal-task-picker-warnings"
            className="space-y-1 rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-warning"
          >
            <p className="font-medium">{t("taskPicker.warningsTitle")}</p>
            {warnings.map((warning) => (
              <p key={warning.taskId}>
                {warning.taskCode ? `${warning.taskCode} — ` : ""}
                {warning.message}
              </p>
            ))}
          </div>
        )}

        {errorMessage && (
          <p data-testid="goal-task-picker-error" className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </Dialog>
  );
}
