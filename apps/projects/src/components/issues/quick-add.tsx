import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { CreateTaskRequest } from "@mediaos/contracts";
import { tasksApi } from "@/lib/tasks-api";
import { cn } from "@/lib/utils";

interface QuickAddProps {
  projectId: string;
  /** State gán cho task mới (cột này). undefined = không gán state (cột "Chưa có trạng thái"). */
  stateId?: string;
}

/**
 * Quick-add inline đầu mỗi cột Kanban (kiểu Plane): mở 1 input, Enter để tạo work item office với
 * state của cột + ưu tiên mặc định "none". Server gated create:task. Invalidate board sau khi tạo.
 */
export function QuickAdd({ projectId, stateId }: QuickAddProps) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const body: CreateTaskRequest = {
        title: title.trim(),
        taskType: "office",
        projectId,
        priority: "none",
      };
      if (stateId) body.stateId = stateId;
      return tasksApi.createTask(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["board", projectId] });
      setTitle("");
      // Giữ ô mở để thêm liên tiếp (UX Plane).
    },
  });

  const submit = () => {
    if (title.trim() && !create.isPending) create.mutate();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
        {t("board.quickAdd")}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2 shadow-sm">
      <textarea
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
        rows={2}
        placeholder={t("board.quickAddPlaceholder")}
        className="w-full resize-none rounded-md border-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className={cn("text-[10px]", create.isError ? "text-destructive" : "text-muted-foreground")}>
          {create.isError ? t("board.quickAddError") : t("board.quickAddHint")}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!title.trim() || create.isPending}
          className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {create.isPending ? t("board.quickAddSubmitting") : t("board.quickAddSubmit")}
        </button>
      </div>
    </div>
  );
}
