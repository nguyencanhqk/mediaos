import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { taskCoreApi, taskKeys, taskCoreInvalidation, useCan, ApiError } from "@mediaos/web-core";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";

/**
 * KanbanQuickCreate — S5-TASK-BOARD-UX-1. Nút "+" đáy cột pipeline: bấm → ô nhập ngay TRONG cột,
 * gõ tiêu đề, Enter là tạo việc THẲNG vào đúng cột đó (benchmark UX MISA AMIS — nhập hàng loạt
 * không phải mở form).
 *
 * Backend đã dựng sẵn cho đúng luồng này: `createTaskCoreSchema` nhận `stateId` tường minh và
 * task-core.service.ts §3c ghi rõ đây là nút "+ Thêm công việc" đáy cột board — server tự suy
 * `task_status` từ NHÓM của cột (không hardcode 'Todo'), nên FE KHÔNG gửi status.
 *
 * QUYỀN: cần CẢ HAI `create:task` và `update-state:task` — server đòi thêm update-state khi có
 * `stateId` tường minh (403 TRƯỚC khi tạo). Thiếu một trong hai ⇒ ẩn hẳn nút, không hiện-rồi-403.
 *
 * CHỈ dùng cho cột chế độ pipeline (columnMode:'state'). Cột chế độ status cũ KHÔNG có nút này:
 * server từ chối `stateId` ở chế độ đó nên việc tạo ra sẽ rơi vào cột mặc định — sai cột người dùng
 * vừa bấm, tệ hơn là không có nút.
 *
 * Sau khi tạo: ô nhập TỰ XOÁ và GIỮ focus để gõ tiếp việc sau (nhập liên tiếp), Esc để đóng.
 */
export function KanbanQuickCreate({ projectId, stateId }: { projectId: string; stateId: string }) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const canCreate = useCan(
    TASK_CORE_ENGINE_PAIRS.CREATE.action,
    TASK_CORE_ENGINE_PAIRS.CREATE.resourceType,
  );
  const canSetState = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE_STATE.resourceType,
  );

  const createMutation = useMutation({
    mutationFn: (value: string) => taskCoreApi.createTask({ title: value, projectId, stateId }),
    onSuccess: () => {
      // Board KHÔNG nằm trong taskCoreInvalidation.list() ⇒ phải invalidate key kanban TƯỜNG MINH,
      // nếu không thẻ mới chỉ hiện sau khi hết staleTime 15s (refetchOnWindowFocus đang tắt).
      void queryClient.invalidateQueries({ queryKey: taskKeys.kanban(projectId) });
      for (const key of taskCoreInvalidation.list())
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.my())
        void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.status === 403) return setErrorKey("tasks.kanban.quickCreate.errors.forbidden");
        if (err.status === 400) return setErrorKey("tasks.kanban.quickCreate.errors.badRequest");
      }
      setErrorKey("tasks.kanban.quickCreate.errors.generic");
    },
  });

  const close = () => {
    setOpen(false);
    setTitle("");
    setErrorKey(null);
  };

  const submit = () => {
    const value = title.trim();
    if (!value) return;
    setErrorKey(null);
    // Xoá ô NGAY (không đợi server) để gõ tiếp việc kế — lỗi thì báo ở dòng dưới, người dùng gõ lại.
    setTitle("");
    createMutation.mutate(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // stopPropagation: cột nằm trong board, tránh Esc lọt lên đóng panel/modal đang mở ngoài.
      e.stopPropagation();
      close();
    }
  };

  if (!canCreate || !canSetState) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`kanban-quick-create-open-${stateId}`}
        className="flex items-center gap-1.5 rounded-md px-1 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {t("tasks.kanban.quickCreate.button")}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        // Rời ô mà chưa gõ gì ⇒ tự thu lại (không để ô trống lởm chởm trên board). Còn chữ thì GIỮ
        // để không nuốt mất phần người dùng đang soạn dở khi lỡ click ra ngoài.
        onBlur={() => {
          if (!title.trim()) close();
        }}
        maxLength={500}
        placeholder={t("tasks.kanban.quickCreate.placeholder")}
        aria-label={t("tasks.kanban.quickCreate.placeholder")}
        data-testid={`kanban-quick-create-input-${stateId}`}
        className="w-full rounded-md border border-border bg-card px-2.5 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary"
      />
      {errorKey ? (
        <p role="alert" className="px-1 text-xs text-destructive">
          {t(errorKey)}
        </p>
      ) : (
        <p className="px-1 text-[11px] text-muted-foreground">
          {t("tasks.kanban.quickCreate.hint")}
        </p>
      )}
    </div>
  );
}
