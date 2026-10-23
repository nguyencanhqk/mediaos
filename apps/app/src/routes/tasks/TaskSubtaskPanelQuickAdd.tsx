import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { taskCoreApi, taskSubtaskInvalidation } from "@mediaos/web-core";
import { subtaskErrorKey } from "./TaskSubtaskDialogs";
import { EMPTY_SUBTASK_FORM, subtaskFormToCreatePayload } from "./subtask-form-schema";

/**
 * Ô nhập inline cuối danh sách việc con — S20-TASK-QUICKENTRY-1 (US-TASK-NV-10), thay hộp thoại
 * «Thêm việc con». Bấm «Thêm việc con» ⇒ ô hiện + focus; Enter tạo (POST /tasks chỉ kèm
 * `parentTaskId` — BE suy dự án/cột từ cha), ô trống và GIỮ focus để gõ tiếp; Esc đóng ô.
 * Người thực hiện / hạn đặt sau ngay trên dòng (SubtaskInlineControls).
 *
 * Ô chỉ `readOnly` khi đang lưu (không `disabled` — disabled làm mất focus). Lỗi (vd. 403) ⇒ ô giữ
 * nguyên nội dung đã gõ + hiện lỗi tại chỗ. Gate `create:task` ở CALLER (TaskSubtaskPanel).
 */
export function SubtaskQuickAdd({
  parentTaskId,
  projectId,
}: {
  parentTaskId: string;
  projectId: string | null;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (value: string) =>
      taskCoreApi.createTask(
        subtaskFormToCreatePayload({ ...EMPTY_SUBTASK_FORM, title: value }, parentTaskId),
      ),
    onSuccess: () => {
      setTitle("");
      for (const queryKey of taskSubtaskInvalidation.afterMutate(parentTaskId, projectId))
        void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => setErrorKey(subtaskErrorKey(err)),
  });

  const close = () => {
    setOpen(false);
    setTitle("");
    setErrorKey(null);
  };

  const submit = () => {
    const value = title.trim();
    if (!value || mutation.isPending) return;
    setErrorKey(null);
    mutation.mutate(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape" && !mutation.isPending) {
      e.preventDefault();
      // Không để Esc lan lên drawer chi tiết việc (Esc ở đó đóng cả drawer).
      e.stopPropagation();
      close();
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-1 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t("tasks.detail.subtasks.addButton")}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <input
        autoFocus
        value={title}
        readOnly={mutation.isPending}
        aria-busy={mutation.isPending}
        maxLength={500}
        aria-label={t("quickEntry.subtasks.inputLabel")}
        placeholder={t("quickEntry.subtasks.placeholder")}
        onChange={(e) => {
          setTitle(e.target.value);
          setErrorKey(null);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
      {errorKey && (
        <p role="alert" className="text-xs text-destructive">
          {t(errorKey)}
        </p>
      )}
    </div>
  );
}
