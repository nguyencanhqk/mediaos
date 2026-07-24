import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, goalApi, goalInvalidation, taskCoreApi, taskKeys } from "@mediaos/web-core";
import type {
  GoalCoreResponseDto,
  GoalTaskLinkResultDto,
  ListTaskCoreQueryRequest,
  TaskCoreResponseDto,
} from "@mediaos/contracts";
import { Button, Checkbox, Dialog, Input } from "@mediaos/ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { TaskStatusBadge } from "@/routes/tasks/TaskStatusBadge";

/** Trần số việc liệt kê để chọn — cùng cỡ với các picker khác, tránh kéo cả bảng task về client. */
const CANDIDATE_TASK_LIMIT = 100;

/**
 * S5-GOAL-FE-2 — chọn việc để gắn BULK vào mục tiêu (GOAL-API-010).
 *
 * NGUỒN ỨNG VIÊN THEO NEO (S5-TASK-DEPTFILTER-1 đã gỡ nợ #272 — `GET /tasks` nay có `departmentId` +
 * `search`, nên cấp phòng KHÔNG còn phải chọn dự án trước):
 *   · mục tiêu cấp `project`    → `GET /tasks?projectId=…`;
 *   · mục tiêu cấp `employee`   → `GET /tasks?assigneeEmployeeId=…`;
 *   · mục tiêu cấp `department` → `GET /tasks?departmentId=…` (neo thẳng theo phòng, + ô tìm để lọc);
 *   · mục tiêu cấp `company`    → KHÔNG có neo tự nhiên ⇒ CHỈ tìm theo từ khoá (không nhập gì thì
 *     KHÔNG query — `GET /tasks` trần trả việc TOÀN công ty trong phạm vi đọc, không liên quan mục tiêu).
 *
 * Filter chỉ THU HẸP trong phạm vi đọc của người xem (BE vẫn áp data-scope read:task) — không phải lớp quyền.
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

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);
  const [selected, setSelected] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<GoalTaskLinkResultDto["warnings"]>([]);

  // Neo TỰ NHIÊN theo cấp mục tiêu. null = không suy được neo (cấp công ty, hoặc dữ liệu neo khuyết)
  // ⇒ phải dựa vào ô tìm. `search` cho phép LỌC THÊM trong neo (đặc biệt cấp phòng nhiều việc).
  const anchorFilter = useMemo((): Partial<ListTaskCoreQueryRequest> | null => {
    if (goal.level === "employee" && goal.employeeId) {
      return { assigneeEmployeeId: goal.employeeId };
    }
    if (goal.level === "project" && goal.projectId) {
      return { projectId: goal.projectId };
    }
    if (goal.level === "department" && goal.departmentId) {
      return { departmentId: goal.departmentId };
    }
    return null;
  }, [goal.level, goal.employeeId, goal.projectId, goal.departmentId]);

  // Ô tìm hiện cho cấp có thể quét rộng (phòng ban / công ty). Cấp employee/project neo đã đủ hẹp.
  const showSearch = goal.level === "department" || goal.level === "company";

  // Bộ lọc gửi lên server. Có neo ⇒ query ngay (search chỉ thu hẹp thêm). Không neo (cấp công ty) ⇒
  // CHỈ query khi có từ khoá — tránh trả việc toàn công ty không liên quan mục tiêu.
  const taskFilter = useMemo((): Partial<ListTaskCoreQueryRequest> | null => {
    const base: Partial<ListTaskCoreQueryRequest> = { limit: CANDIDATE_TASK_LIMIT };
    if (anchorFilter) return { ...base, ...anchorFilter, ...(search ? { search } : {}) };
    if (search) return { ...base, search };
    return null;
  }, [anchorFilter, search]);

  const needsSearchTerm = anchorFilter === null && !search;

  const tasksQuery = useQuery({
    queryKey: taskKeys.list(taskFilter ?? {}),
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
        {showSearch && (
          <div className="space-y-1.5">
            <label
              htmlFor="goal-task-picker-search"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("taskPicker.searchLabel")}
            </label>
            <Input
              id="goal-task-picker-search"
              data-testid="goal-task-picker-search"
              type="search"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setSelected([]);
              }}
              placeholder={t("taskPicker.searchPlaceholder")}
              aria-label={t("taskPicker.searchLabel")}
            />
          </div>
        )}

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {taskFilter === null ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {needsSearchTerm ? t("taskPicker.enterSearchTerm") : t("taskPicker.noAnchor")}
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
