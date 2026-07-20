import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { taskCoreApi, taskCoreInvalidation, useCan, ApiError } from "@mediaos/web-core";
import { Input, Popover, cn } from "@mediaos/ui";
import type {
  TaskCoreResponseDto,
  TaskCoreStatusDto,
  TaskCorePriorityDto,
} from "@mediaos/contracts";
import {
  TASK_CORE_ENGINE_PAIRS,
  TASK_CORE_STATUS_OPTIONS,
  TASK_CORE_PRIORITY_OPTIONS,
  localDatetimeToIso,
  isoToLocalDatetime,
} from "./constants";
import { TaskStatusBadge, TaskPriorityBadge } from "./TaskStatusBadge";
import { useTaskActionMutation } from "./hooks/use-task-action-mutation";
import { EmployeePicker } from "./EmployeePicker";

/**
 * TaskInlineFields — bộ ô SỬA-TẠI-CHỖ của màn chi tiết task (S5-TASK-INLINE-1; tách từ
 * TaskStatusSelect + TaskAssignControl cũ của S4-FE-TASK-2).
 *
 * Vì sao tách thành 4 ô RỜI thay vì 2 khối gộp: bố cục mới đặt trạng thái/ưu tiên lên DẢI ĐẦU (cạnh
 * tên dự án) còn người phụ trách/deadline nằm trong lưới thông tin — hai chỗ khác nhau trên màn hình.
 * Khối gộp cũ ép cả ba control phải đứng cùng một hàng, và khiến lưới bên dưới phải LẶP LẠI cùng
 * thông tin ở dạng chỉ-đọc (người dùng thấy "Trạng thái" hai lần).
 *
 * Luật chung cho cả 4 ô (giữ nguyên từ bản cũ, KHÔNG nới):
 *   - Mỗi ô gate bằng ĐÚNG cặp permission của endpoint nó gọi — thiếu quyền thì render giá trị
 *     READ-ONLY, không render control (SPEC-06 §14, UI-02 §5.3).
 *   - Lưu NGAY khi đổi (không nút "Lưu"), optimistic + rollback qua useTaskActionMutation.
 *   - Bốn endpoint action RIÊNG (assign · change-status · change-priority · change-deadline), KHÔNG
 *     đi PATCH /tasks/:id — PATCH chỉ đòi `update:task` nên dùng nó ở đây là lặng lẽ NỚI quyền so
 *     với bản cũ (xem bảng pair: employee có update:task@Own nhưng KHÔNG có assign/update-priority/
 *     update-deadline). Giữ đúng cửa cũ = giữ đúng ranh giới quyền.
 */
function mutationErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "tasks.statusSelect.errors.conflict";
    if (err.status === 400 || err.status === 422) return "tasks.statusSelect.errors.validation";
    if (err.status === 403) return "tasks.statusSelect.errors.forbidden";
    if (err.status >= 500) return "tasks.statusSelect.errors.server";
  }
  return "tasks.statusSelect.errors.generic";
}

function FieldError({ error }: { error: unknown }) {
  const { t } = useTranslation("tasks");
  return (
    <p role="alert" className="text-xs text-destructive">
      {t(mutationErrorKey(error))}
    </p>
  );
}

/** Khung nhãn + control dùng chung, để 4 ô canh đều nhau trong lưới. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Chọn-theo-thẻ (badge) cho trạng thái/ưu tiên ─────────────────────────────
/**
 * Vá UI 2026-07-20 (owner): trạng thái/ưu tiên hiển thị DẠNG THẺ MÀU thay vì <select> trần —
 * cùng mặt chữ với badge trên board/danh sách (TaskStatusBadge/TaskPriorityBadge) nên nhìn phát
 * biết ngay "việc đang ở đâu". Có quyền ⇒ thẻ bấm được, mở popover chọn (vẫn LƯU NGAY khi chọn);
 * thiếu quyền ⇒ ai gọi component này tự render badge tĩnh — ranh giới quyền không đổi.
 */
function BadgeSelect<T extends string>({
  id,
  ariaLabel,
  value,
  options,
  disabled,
  onSelect,
  renderBadge,
}: {
  id: string;
  ariaLabel: string;
  value: T | null;
  options: readonly T[];
  disabled: boolean;
  onSelect: (next: T) => void;
  renderBadge: (v: T | null) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="min-w-[10rem] p-1"
      trigger={
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          data-testid={id}
          className="flex items-center gap-1 rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {renderBadge(value)}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      }
    >
      <ul role="listbox" aria-label={ariaLabel} className="space-y-0.5">
        {options.map((opt) => (
          <li key={opt}>
            <button
              type="button"
              role="option"
              aria-selected={opt === value}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-muted",
                opt === value && "bg-muted",
              )}
              onClick={() => {
                setOpen(false);
                // Chọn lại đúng giá trị đang giữ = no-op, không bắn request thừa.
                if (opt !== value) onSelect(opt);
              }}
            >
              {renderBadge(opt)}
              {opt === value && (
                <Check className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

// ── Trạng thái ───────────────────────────────────────────────────────────────
export function TaskStatusField({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const canStatus = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS.resourceType,
  );
  const mutation = useTaskActionMutation<TaskCoreStatusDto>({
    taskId: task.id,
    mutationFn: (status) => taskCoreApi.changeStatus(task.id, { status }),
    toPatch: (status) => ({ status }),
  });

  const control = canStatus ? (
    <BadgeSelect
      id="task-status-select"
      ariaLabel={t("tasks.statusSelect.statusLabel")}
      value={task.status ?? null}
      options={TASK_CORE_STATUS_OPTIONS}
      disabled={mutation.isPending}
      onSelect={(status) => mutation.mutate(status)}
      renderBadge={(s) => <TaskStatusBadge status={s} />}
    />
  ) : (
    <div>
      <TaskStatusBadge status={task.status} />
    </div>
  );

  return (
    <Field label={t("tasks.statusSelect.statusLabel")} htmlFor="task-status-select">
      {control}
      {mutation.isError && <FieldError error={mutation.error} />}
    </Field>
  );
}

// ── Ưu tiên ──────────────────────────────────────────────────────────────────
export function TaskPriorityField({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const canPriority = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_PRIORITY.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_PRIORITY.resourceType,
  );
  const mutation = useTaskActionMutation<TaskCorePriorityDto>({
    taskId: task.id,
    mutationFn: (priority) => taskCoreApi.changePriority(task.id, { priority }),
    toPatch: (priority) => ({ priority }),
  });

  const control = canPriority ? (
    <BadgeSelect
      id="task-priority-select"
      ariaLabel={t("tasks.statusSelect.priorityLabel")}
      value={task.priority ?? null}
      options={TASK_CORE_PRIORITY_OPTIONS}
      disabled={mutation.isPending}
      onSelect={(priority) => mutation.mutate(priority)}
      renderBadge={(p) => <TaskPriorityBadge priority={p} />}
    />
  ) : (
    <div>
      <TaskPriorityBadge priority={task.priority} />
    </div>
  );

  return (
    <Field label={t("tasks.statusSelect.priorityLabel")} htmlFor="task-priority-select">
      {control}
      {mutation.isError && <FieldError error={mutation.error} />}
    </Field>
  );
}

// ── Deadline ─────────────────────────────────────────────────────────────────
export function TaskDeadlineField({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const canDeadline = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_DEADLINE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_DEADLINE.resourceType,
  );
  const [draft, setDraft] = useState(() => isoToLocalDatetime(task.dueAt));
  const mutation = useTaskActionMutation<string | null>({
    taskId: task.id,
    mutationFn: (dueAt) => taskCoreApi.changeDeadline(task.id, { dueAt }),
    toPatch: (dueAt) => ({ dueAt }),
  });

  return (
    <Field label={t("tasks.statusSelect.deadlineLabel")} htmlFor="task-deadline-input">
      {canDeadline ? (
        <Input
          id="task-deadline-input"
          type="datetime-local"
          value={draft}
          disabled={mutation.isPending}
          onChange={(e) => setDraft(e.target.value)}
          // Lưu khi RỜI ô (không phải mỗi lần gõ): input datetime-local bắn onChange cho từng mảnh
          // ngày/giờ người dùng chỉnh ⇒ lưu-theo-gõ sẽ bắn một chuỗi request với ngày dở dang.
          onBlur={() => {
            const iso = localDatetimeToIso(draft) ?? null;
            if (iso === task.dueAt) return;
            mutation.mutate(iso);
          }}
        />
      ) : (
        <p className="text-sm text-foreground">
          {task.dueAt ? new Date(task.dueAt).toLocaleString("vi-VN") : "—"}
        </p>
      )}
      {mutation.isError && <FieldError error={mutation.error} />}
    </Field>
  );
}

// ── Người phụ trách ──────────────────────────────────────────────────────────
/**
 * Đổi người phụ trách NGAY khi chọn (bản cũ đòi bấm thêm nút "Đổi").
 *
 * KHÔNG gỡ được người phụ trách ở đây — `assignTaskSchema` đòi `assigneeEmployeeId` là uuid
 * (contracts task-actions.ts) nên route assign không nhận giá trị rỗng. Bản cũ cũng không gỡ được
 * (nút disable khi để trống); giữ nguyên giới hạn thay vì lặng lẽ chuyển sang PATCH — PATCH chỉ đòi
 * `update:task` nên đó sẽ là một cửa quyền KHÁC, phải là quyết định có chủ đích chứ không phải hệ quả
 * phụ của việc đổi giao diện. Ô rỗng chỉ hiện khi task CHƯA có người, và chọn nó là no-op.
 */
export function TaskAssigneeField({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const canAssign = useCan(
    TASK_CORE_ENGINE_PAIRS.ASSIGN.action,
    TASK_CORE_ENGINE_PAIRS.ASSIGN.resourceType,
  );

  const mutation = useTaskActionMutation<string>({
    taskId: task.id,
    mutationFn: (assigneeEmployeeId) => taskCoreApi.assign(task.id, { assigneeEmployeeId }),
    // Chưa biết tên/ảnh người mới cho tới khi server trả (picker không nâng dữ liệu lên đây) —
    // optimistic chỉ đổi id, tên/ảnh về đúng sau response. Ngắn hơn là đoán rồi hiện sai tên.
    toPatch: (assigneeEmployeeId) => ({ mainAssigneeEmployeeId: assigneeEmployeeId }),
  });

  return (
    <Field label={t("tasks.assign.label")}>
      <EmployeePicker
        employeeId={task.mainAssigneeEmployeeId}
        name={task.assigneeName}
        avatarUrl={task.assigneeAvatarUrl}
        canEdit={canAssign}
        // KHÔNG cho gỡ: `assignTaskSchema` đòi uuid nên route assign không nhận giá trị rỗng.
        allowClear={false}
        showName
        pending={mutation.isPending}
        testId="task-assignee-picker"
        emptyLabel={t("tasks.detail.subtasks.unassigned")}
        onSelect={(employeeId) => {
          if (employeeId) mutation.mutate(employeeId);
        }}
      />
      {mutation.isError && <FieldError error={mutation.error} />}
    </Field>
  );
}

// ── Tiêu đề (sửa tại chỗ) ────────────────────────────────────────────────────
/**
 * S5-TASK-LAYOUT-1 — tiêu đề + mô tả sửa TẠI CHỖ, mở đường cho việc BỎ nút "Sửa công việc".
 *
 * Cả hai đi `PATCH /tasks/:id` (`update:task`) — KHÔNG có route action riêng cho hai trường này.
 * Đây là cửa quyền khác với status/ưu tiên/hạn/người phụ trách (4 route action), đúng như BE phân chia.
 */
export function TaskTitleField({ task }: { task: TaskCoreResponseDto }) {
  const queryClient = useQueryClient();
  const canUpdate = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  const mutation = useMutation({
    mutationFn: (title: string) => taskCoreApi.updateTask(task.id, { title }),
    onSuccess: async () => {
      await Promise.all(
        taskCoreInvalidation
          .detail(task.id)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });

  if (!canUpdate) {
    return <h2 className="text-lg font-semibold text-foreground">{task.title}</h2>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(task.title);
          setEditing(true);
        }}
        data-testid="task-title-trigger"
        className="w-full rounded px-1 py-0.5 text-left text-lg font-semibold text-foreground transition-colors hover:bg-muted"
      >
        {task.title}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // Rỗng KHÔNG lưu (server 400 vì title min 1) — giữ tiêu đề cũ thay vì báo lỗi cho một thao tác
    // mà người dùng hầu như chắc chắn là bấm nhầm rồi xoá hết.
    if (!next || next === task.title) return;
    mutation.mutate(next);
  };

  return (
    <div className="space-y-1">
      <Input
        autoFocus
        value={draft}
        maxLength={500}
        disabled={mutation.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation(); // đang trong drawer — đừng để Esc lọt lên đóng panel
            setEditing(false);
          }
        }}
        className="text-lg font-semibold"
        data-testid="task-title-input"
      />
      {mutation.isError && <FieldError error={mutation.error} />}
    </div>
  );
}

// ── Mô tả (sửa tại chỗ) ──────────────────────────────────────────────────────
export function TaskDescriptionField({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const canUpdate = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.description ?? "");

  const mutation = useMutation({
    mutationFn: (description: string | null) => taskCoreApi.updateTask(task.id, { description }),
    onSuccess: async () => {
      await Promise.all(
        taskCoreInvalidation
          .detail(task.id)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });

  const body = task.description?.trim();

  if (!canUpdate) {
    return (
      <p className="whitespace-pre-wrap text-sm text-foreground">
        {body || t("tasks.detail.descriptionEmpty")}
      </p>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(task.description ?? "");
          setEditing(true);
        }}
        data-testid="task-description-trigger"
        className="w-full rounded px-1 py-1 text-left text-sm transition-colors hover:bg-muted"
      >
        {body ? (
          <span className="whitespace-pre-wrap text-foreground">{body}</span>
        ) : (
          <span className="text-muted-foreground">{t("tasks.detail.descriptionPlaceholder")}</span>
        )}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === (task.description ?? "").trim()) return;
    // Xoá sạch = gỡ mô tả (null), khác với tiêu đề: mô tả được phép rỗng.
    mutation.mutate(next || null);
  };

  return (
    <div className="space-y-1">
      <textarea
        autoFocus
        rows={4}
        value={draft}
        maxLength={20000}
        disabled={mutation.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // KHÔNG bắt Enter (mô tả nhiều dòng) — chỉ Esc để huỷ.
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setEditing(false);
          }
        }}
        placeholder={t("tasks.detail.descriptionPlaceholder")}
        data-testid="task-description-input"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
      {mutation.isError && <FieldError error={mutation.error} />}
    </div>
  );
}
