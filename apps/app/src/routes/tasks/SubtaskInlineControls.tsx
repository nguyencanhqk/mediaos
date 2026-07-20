import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import {
  taskCoreApi,
  hrApi,
  hrKeys,
  taskSubtaskInvalidation,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { Avatar, Popover, Input, cn } from "@mediaos/ui";
import type { SubtaskListItemDto, TaskCoreStatusDto } from "@mediaos/contracts";
import {
  localDatetimeToIso,
  isoToLocalDatetime,
  TASK_CORE_ENGINE_PAIRS,
  TASK_CORE_STATUS_OPTIONS,
} from "./constants";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { BadgeSelect } from "./TaskInlineFields";

/**
 * SubtaskInlineControls — sửa NGƯỜI THỰC HIỆN và HẠN của từng việc con NGAY TRÊN DÒNG
 * (S5-TASK-INLINE-1, benchmark UX MISA AMIS: bấm avatar trên dòng việc con là chọn người luôn).
 *
 * Trước đây hai thông tin này là chữ chết trên dòng (TaskSubtaskPanel), muốn đổi phải bấm bút chì mở
 * hộp thoại — ba cú bấm cho một thao tác lặp đi lặp lại hàng chục lần mỗi ngày.
 *
 * ĐƯỜNG GHI: `PATCH /tasks/:id` (gate `update:task`) — ĐÚNG cửa mà hộp thoại "Sửa việc con" đang dùng
 * (TaskSubtaskDialogs), KHÔNG phải route `POST /assign`. Chọn có chủ đích: theo ma trận seed, nhân
 * viên thường có `update:task`@Own nhưng KHÔNG có `assign:task` ⇒ đi cửa assign sẽ LÀM MẤT khả năng
 * tự sửa việc con mà họ đang có. Đổi cửa = đổi ai làm được việc gì, không phải chuyện giao diện.
 *
 * KHÔNG gửi kèm `projectId`/`stateId`: việc con thừa hưởng dự án từ CHA và không có cột trên board
 * (D-36); gửi lệch → BE 400.
 *
 * Invalidate qua `taskSubtaskInvalidation.afterMutate(parentTaskId, projectId)` — chạm đủ danh sách
 * con · chi tiết CHA (tiến độ đổi) · board · báo cáo dự án. Thiếu vế board thì badge tiến độ trên thẻ
 * đứng số cũ.
 */
function inlineErrorTitle(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "tasks.detail.subtasks.errors.forbidden";
    if (err.status === 400 || err.status === 422) return "tasks.detail.subtasks.errors.validation";
  }
  return fallback;
}

/** Mutation dùng chung cho cả 2 control — chỉ khác payload. */
function useSubtaskFieldMutation(
  item: SubtaskListItemDto,
  parentTaskId: string,
  projectId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { assigneeEmployeeId?: string | null; dueAt?: string | null }) =>
      taskCoreApi.updateTask(item.id, patch),
    onSettled: () => {
      for (const key of taskSubtaskInvalidation.afterMutate(parentTaskId, projectId))
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

// ── Trạng thái: bấm thẻ → chọn (đường change-status — ĐÚNG cửa màn chi tiết dùng) ────────────────
/**
 * Đổi trạng thái việc con NGAY TRÊN DÒNG — trước đây badge trạng thái là chữ chết, muốn đổi phải mở
 * hẳn việc con ra. Đi route `POST /tasks/:id/change-status` (gate update-status:task) như
 * TaskStatusField của màn chi tiết — KHÔNG đi PATCH (update:task) để không lặng lẽ nới/thắt quyền.
 * `canEdit` = item.canOpen (D-39: GHI không thừa hưởng) — con ngoài phạm vi chỉ xem badge tĩnh.
 */
export function SubtaskStatusControl({
  item,
  parentTaskId,
  projectId,
  canEdit,
}: {
  item: SubtaskListItemDto;
  parentTaskId: string;
  projectId: string | null;
  canEdit: boolean;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const canStatus = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.resourceType,
  );
  const mutation = useMutation({
    mutationFn: (status: TaskCoreStatusDto) => taskCoreApi.changeStatus(item.id, { status }),
    onSettled: () => {
      for (const key of taskSubtaskInvalidation.afterMutate(parentTaskId, projectId))
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (!canEdit || !canStatus) return <TaskStatusBadge status={item.status} />;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <BadgeSelect
        id={`subtask-status-select-${item.id}`}
        ariaLabel={t("tasks.detail.subtasks.inline.statusAction")}
        value={item.status}
        options={TASK_CORE_STATUS_OPTIONS}
        disabled={mutation.isPending}
        onSelect={(status) => mutation.mutate(status)}
        renderBadge={(s) => <TaskStatusBadge status={s} />}
      />
      {mutation.isError && (
        <p role="alert" className="text-xs text-destructive">
          {t(inlineErrorTitle(mutation.error, "tasks.detail.subtasks.errors.saveFailed"))}
        </p>
      )}
    </div>
  );
}

// ── Người thực hiện: bấm avatar → chọn ───────────────────────────────────────
export function SubtaskAssigneeControl({
  item,
  parentTaskId,
  projectId,
  canEdit,
}: {
  item: SubtaskListItemDto;
  parentTaskId: string;
  projectId: string | null;
  canEdit: boolean;
}) {
  const { t } = useTranslation("tasks");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const canReadEmployees = useCan("read", "employee");
  const mutation = useSubtaskFieldMutation(item, parentTaskId, projectId);

  // Chỉ tải danh sách người khi người dùng THỰC SỰ mở picker — panel có thể có hàng chục dòng, tải
  // sẵn cho từng dòng là lãng phí (query key dùng chung nên mở dòng thứ hai là cache-hit).
  const { data: employeesPage, isLoading } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    enabled: open && canReadEmployees,
    staleTime: 60_000,
  });
  const employees = employeesPage?.items ?? [];
  const filtered = search.trim()
    ? employees.filter((e) =>
        (e.fullName ?? "").toLowerCase().includes(search.trim().toLowerCase()),
      )
    : employees;

  const label = item.assigneeName ?? t("tasks.detail.subtasks.unassigned");
  const trigger = (
    <button
      type="button"
      disabled={!canEdit || mutation.isPending}
      onClick={() => setOpen((v) => !v)}
      title={canEdit ? t("tasks.detail.subtasks.inline.assigneeAction", { name: label }) : label}
      aria-label={t("tasks.detail.subtasks.inline.assigneeAction", { name: label })}
      data-testid={`subtask-assignee-trigger-${item.id}`}
      className={cn(
        "rounded-full transition-opacity",
        canEdit ? "hover:opacity-80" : "cursor-default",
        mutation.isPending && "opacity-50",
      )}
    >
      <Avatar size="sm" name={item.assigneeName} src={item.assigneeAvatarUrl} />
    </button>
  );

  if (!canEdit) return trigger;

  const choose = (employeeId: string | null) => {
    setOpen(false);
    setSearch("");
    if (employeeId === item.mainAssigneeEmployeeId) return; // không đổi ⇒ không gọi API
    mutation.mutate({ assigneeEmployeeId: employeeId });
  };

  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} align="end" className="w-64 p-2">
      <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
        {t("tasks.detail.subtasks.inline.assigneeTitle")}
      </p>
      {!canReadEmployees ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          {t("tasks.assign.employeeReadHint")}
        </p>
      ) : (
        <>
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("tasks.detail.subtasks.inline.searchPlaceholder")}
            className="h-8 text-sm"
            data-testid={`subtask-assignee-search-${item.id}`}
          />
          <ul className="mt-1.5 max-h-56 overflow-y-auto">
            {/* Gỡ người thực hiện đi qua PATCH nên KHÔNG bị chặn như route assign — giữ lựa chọn này. */}
            {item.mainAssigneeEmployeeId && (
              <li>
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
                >
                  {t("tasks.detail.subtasks.inline.clearAssignee")}
                </button>
              </li>
            )}
            {isLoading ? (
              <li className="px-2 py-2">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                {t("tasks.detail.subtasks.inline.noMatch")}
              </li>
            ) : (
              filtered.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => choose(e.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                      e.id === item.mainAssigneeEmployeeId && "bg-muted font-medium",
                    )}
                  >
                    <Avatar size="sm" name={e.fullName} src={e.avatarUrl} />
                    <span className="truncate">{e.fullName}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
      {mutation.isError && (
        <p role="alert" className="px-1 pt-1 text-xs text-destructive">
          {t(inlineErrorTitle(mutation.error, "tasks.detail.subtasks.errors.saveFailed"))}
        </p>
      )}
    </Popover>
  );
}

// ── Hạn: bấm ngày → sửa tại chỗ ──────────────────────────────────────────────
export function SubtaskDueControl({
  item,
  parentTaskId,
  projectId,
  canEdit,
}: {
  item: SubtaskListItemDto;
  parentTaskId: string;
  projectId: string | null;
  canEdit: boolean;
}) {
  const { t } = useTranslation("tasks");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => isoToLocalDatetime(item.dueAt));
  const mutation = useSubtaskFieldMutation(item, parentTaskId, projectId);

  const display = item.dueAt ? new Date(item.dueAt).toLocaleDateString("vi-VN") : "—";

  if (!canEdit) {
    return <span className="text-xs text-muted-foreground">{display}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(isoToLocalDatetime(item.dueAt));
          setEditing(true);
        }}
        title={t("tasks.detail.subtasks.inline.dueAction")}
        aria-label={t("tasks.detail.subtasks.inline.dueAction")}
        data-testid={`subtask-due-trigger-${item.id}`}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
          mutation.isPending && "opacity-50",
        )}
      >
        <CalendarDays className="h-3 w-3" aria-hidden="true" />
        {display}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const iso = localDatetimeToIso(draft) ?? null;
    if (iso === item.dueAt) return; // không đổi ⇒ không gọi API
    mutation.mutate({ dueAt: iso });
  };

  return (
    <Input
      autoFocus
      type="datetime-local"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation(); // dòng nằm trong panel/drawer — đừng để Esc lọt lên đóng panel
          setEditing(false);
        }
      }}
      className="h-7 w-auto py-0 text-xs"
      data-testid={`subtask-due-input-${item.id}`}
    />
  );
}
