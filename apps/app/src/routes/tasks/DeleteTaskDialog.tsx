import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { taskCoreApi, taskCoreInvalidation, taskKeys } from "@mediaos/web-core";
import { Dialog, Button } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";

/**
 * DeleteTaskDialog — xác nhận soft-delete task core (delete:task, sensitive). Dùng chung bởi
 * TaskListPage (xóa từ dòng bảng) + TaskDetailPage (xóa từ trang chi tiết) — tránh trôi logic xác nhận.
 * BẤT BIẾN #2: server chỉ set deleted_at/by (soft-delete), KHÔNG hard-delete.
 */
export function DeleteTaskDialog({
  task,
  onClose,
  onDeleted,
}: {
  task: TaskCoreResponseDto;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => taskCoreApi.deleteTask(task.id),
    onSuccess: async () => {
      // `taskKeys.kanban` KHÔNG nằm dưới prefix `tasks/list` ⇒ list() KHÔNG chạm board. Thiếu vế này:
      // xoá task từ panel trượt trên board ⇒ panel đóng nhưng THẺ ĐÃ XOÁ VẪN NẰM trên board, kéo-thả
      // nó là 404. Cũng invalidate báo cáo dự án (số liệu đếm task đổi) — mirror taskSubtaskInvalidation.
      const keys = [
        ...taskCoreInvalidation.list(),
        ...(task.projectId
          ? [taskKeys.kanban(task.projectId), taskKeys.projects.report(task.projectId)]
          : []),
      ];
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onDeleted?.();
      onClose();
    },
  });
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("tasks.detail.deleteDialog.title")}
      description={t("tasks.detail.deleteDialog.description", { title: task.title })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("tasks.detail.deleteDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {t("tasks.detail.deleteDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("tasks.form.errors.generic")}
        </p>
      )}
    </Dialog>
  );
}
