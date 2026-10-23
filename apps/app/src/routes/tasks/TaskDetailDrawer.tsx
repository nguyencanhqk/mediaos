import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Maximize2 } from "lucide-react";
import { ApiError, taskCoreApi, taskKeys, useCan } from "@mediaos/web-core";
import { Sheet, toast } from "@mediaos/ui";
import { useChatDockStore } from "@/components/chat/chat-dock.store";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskDetailContent, TaskDetailActions } from "./TaskDetailContent";
import { isTaskUuid, readTaskDrawerParam, useTaskDrawer } from "./task-drawer-nav";

/**
 * Mã HTTP coi là «không mở được việc này»: không tồn tại / xoá mềm (404), ngoài phạm vi đọc (403),
 * id bị server từ chối (400). Gộp chung MỘT thông điệp để không phân biệt được việc nào có thật.
 * Lỗi khác (5xx, mạng) vẫn hiện trong drawer kèm «Thử lại».
 */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([400, 403, 404]);

function isUnavailableError(error: unknown): boolean {
  return error instanceof ApiError && UNAVAILABLE_STATUSES.has(error.status);
}

/** Màn hẹp hơn `md` (Tailwind 768px): hai drawer không đứng cạnh nhau được. */
const NARROW_SCREEN_QUERY = "(max-width: 767px)";

/**
 * TaskDetailDrawer — S5-TASK-BOARD-UX-1. Mở chi tiết task trong panel TRƯỢT PHẢI thay vì rời trang,
 * để board vẫn nằm đó phía sau (benchmark UX MISA AMIS — xem memory task-ux-reference-benchmark).
 *
 * Nội dung dùng chung `TaskDetailContent` với trang /tasks/:taskId ⇒ không có chuyện hai lối vào
 * lệch tính năng. Trạng thái mở/đóng do URL quản (`?task=<id>`, S20-TASK-DRAWER-1: TOÀN ỨNG DỤNG — xem
 * `GlobalTaskDrawer` cuối file) nên copy link vẫn ra đúng trang + đúng task, và Back đóng panel.
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
  onUnavailable,
}: {
  /** null ⇒ panel đóng. */
  taskId: string | null;
  onClose: () => void;
  /** Mở task hiện tại ở TRANG đầy đủ /tasks/:taskId — parent lo điều hướng (drawer không cần router). */
  onOpenFull?: () => void;
  /**
   * S20-TASK-DRAWER-1 — thiếu `read:task` hoặc server trả 400/403/404: panel KHÔNG vẽ (không lộ
   * tiêu đề/mã việc) và gọi hàm này ĐÚNG một lần cho mỗi `taskId`.
   */
  onUnavailable?: () => void;
}) {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );

  // Cùng key + cùng options với TaskDetailContent ⇒ chia sẻ cache, không gọi thêm request.
  const { data, isError, error } = useQuery({
    queryKey: taskKeys.detail(taskId ?? ""),
    queryFn: () => taskCoreApi.getTask(taskId ?? ""),
    enabled: canView && taskId !== null,
    staleTime: 30_000,
  });

  const unavailable = !canView || (isError && isUnavailableError(error));
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!taskId || !unavailable || reportedRef.current === taskId) return;
    reportedRef.current = taskId;
    onUnavailable?.();
  }, [taskId, unavailable, onUnavailable]);

  if (!taskId || unavailable) return null;

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

/**
 * GlobalTaskDrawer — S20-TASK-DRAWER-1 (US-TASK-NV-04). Drawer việc DUY NHẤT của ứng dụng, mount ở
 * `ProtectedShell` (nạp lười, chỉ khi URL có `?task=`). Đọc `?task=` từ `location.search` — không
 * phụ thuộc `validateSearch` của route đang đứng — nên mở được trên MỌI trang (/goals/G?task=T…).
 *
 * - Giá trị không phải UUID ⇒ KHÔNG gọi API; báo «Không mở được việc này» qua toast và đóng (replace).
 * - Việc không tồn tại / xoá mềm / ngoài phạm vi đọc ⇒ cùng thông điệp, cùng cách đóng.
 * - Màn hẹp hơn md ⇒ cất drawer chat (giữ hội thoại đang mở) để drawer việc ở trên cùng.
 */
export function GlobalTaskDrawer() {
  const { t } = useTranslation("tasks");
  const navigate = useNavigate();
  const { closeTask } = useTaskDrawer();
  const raw = useRouterState({ select: (s) => readTaskDrawerParam(s.location.search) });
  const taskId = isTaskUuid(raw) ? raw : null;

  const reportUnavailable = useCallback(() => {
    toast.error(t("taskDrawer.unavailable"), { key: "task-drawer-unavailable" });
    closeTask();
  }, [t, closeTask]);

  const rejectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (raw === null || taskId !== null || rejectedRef.current === raw) return;
    rejectedRef.current = raw;
    reportUnavailable();
  }, [raw, taskId, reportUnavailable]);

  useEffect(() => {
    if (!taskId || typeof window.matchMedia !== "function") return;
    if (window.matchMedia(NARROW_SCREEN_QUERY).matches) useChatDockStore.getState().closeDrawer();
  }, [taskId]);

  if (!taskId) return null;

  return (
    <TaskDetailDrawer
      taskId={taskId}
      onClose={closeTask}
      onUnavailable={reportUnavailable}
      // Mở toàn trang = PUSH sang /tasks/:id — Back quay về trang cũ với drawer còn mở.
      onOpenFull={() => void navigate({ to: "/tasks/$taskId", params: { taskId } })}
    />
  );
}
