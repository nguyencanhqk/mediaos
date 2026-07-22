import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import { taskCoreApi, taskKeys, useCan } from "@mediaos/web-core";
import { Sheet } from "@mediaos/ui";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskDetailContent, TaskDetailActions } from "./TaskDetailContent";

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
 *
 * Header panel (owner chỉnh 2026-07-20): menu ⋯ + nút "mở toàn trang" nằm CÙNG HÀNG với nút đóng
 * (slot `actions` của Sheet) — không thả trong thân để khỏi rớt xuống dưới nút X. Bề rộng nới ra
 * NỬA màn hình trên màn rộng (max(42rem,50%) — không hẹp hơn mức 2xl cũ trên màn nhỏ).
 */
export function TaskDetailDrawer({
  taskId,
  onClose,
  onOpenFull,
}: {
  /** null ⇒ panel đóng. */
  taskId: string | null;
  onClose: () => void;
  /** Mở task hiện tại ở TRANG đầy đủ /tasks/:taskId — parent lo điều hướng (drawer không cần router). */
  onOpenFull?: () => void;
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
      className="max-w-[max(42rem,50%)]"
      actions={
        <>
          {onOpenFull && (
            <button
              type="button"
              onClick={onOpenFull}
              aria-label={t("tasks.detail.drawer.openFull")}
              title={t("tasks.detail.drawer.openFull")}
              data-testid="task-drawer-open-full"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {/* Xoá task từ panel ⇒ đóng panel (task không còn để hiện). Chờ data vì dialog Sửa/Xoá cần
              full DTO — trước đó menu chưa hiện, khớp lúc thân còn skeleton. */}
          {data && <TaskDetailActions task={data} onDeleted={onClose} />}
        </>
      }
      data-testid="task-detail-drawer"
    >
      <TaskDetailContent taskId={taskId} onDeleted={onClose} variant="drawer" />
    </Sheet>
  );
}
