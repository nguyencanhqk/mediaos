import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { taskCoreApi, taskKeys, useCan } from "@mediaos/web-core";
import { Sheet } from "@mediaos/ui";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskDetailContent } from "./TaskDetailContent";

/**
 * TaskDetailDrawer — S5-TASK-BOARD-UX-1. Mở chi tiết task trong panel TRƯỢT PHẢI thay vì rời trang,
 * để board vẫn nằm đó phía sau (benchmark UX MISA AMIS — xem memory task-ux-reference-benchmark).
 *
 * Nội dung dùng chung `TaskDetailContent` với trang /tasks/:taskId ⇒ không có chuyện hai lối vào
 * lệch tính năng. Trạng thái mở/đóng do URL quản (`?task=<id>` ở vỏ workspace) nên copy link vẫn ra
 * đúng board + đúng task, và Back của trình duyệt đóng panel.
 *
 * Tiêu đề panel cần title/tên dự án ⇒ đọc CÙNG query key `taskKeys.detail(taskId)` mà
 * `TaskDetailContent` dùng: React Query gộp hai observer chung một request, KHÔNG gọi API hai lần.
 */
export function TaskDetailDrawer({
  taskId,
  onClose,
}: {
  /** null ⇒ panel đóng. */
  taskId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );

  // Cùng key + cùng options với TaskDetailContent ⇒ chia sẻ cache, không gọi thêm request.
  const { data } = useQuery({
    queryKey: taskKeys.detail(taskId ?? ""),
    queryFn: () => taskCoreApi.getTask(taskId ?? ""),
    enabled: canView && taskId !== null,
    staleTime: 30_000,
  });

  if (!taskId) return null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={data?.title ?? t("tasks.detail.drawer.loading")}
      description={data?.projectName ?? undefined}
      data-testid="task-detail-drawer"
    >
      {/* Xoá task từ panel ⇒ đóng panel (task không còn để hiện). */}
      <TaskDetailContent taskId={taskId} onDeleted={onClose} variant="drawer" />
    </Sheet>
  );
}
