import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { useQuickCreateHotkey } from "@/hooks/use-quick-create-hotkey";
import { TaskFormDrawer } from "@/routes/tasks/TaskFormDrawer";
import { useTaskDrawer } from "@/routes/tasks/task-drawer-nav";
import { TASK_CORE_ENGINE_PAIRS } from "@/routes/tasks/constants";
import { QuickCreateDialog } from "./QuickCreateDialog";
import { useQuickCreateStore } from "./quick-create.store";
import { writeRecentProjectId } from "./recent-project";

const TOAST_KEY = "quick-create:created";
const TOPBAR_BUTTON_SELECTOR = '[data-testid="topbar-quick-create"]';

interface FullFormDraft {
  title: string;
  project: { id: string; name: string } | null;
}

/**
 * S20-X-QUICKCREATE-1 — gắn một lần ở ProtectedShell: phím tắt + hộp gọn + form đầy đủ («Thêm chi tiết»).
 * Gate `create:task` bằng useCan: thiếu quyền ⇒ không listener, không hộp (nút «+» cũng ẩn ở topbar).
 */
export function QuickCreateHost() {
  const { t } = useTranslation("tasks");
  const { CREATE } = TASK_CORE_ENGINE_PAIRS;
  const canCreate = useCan(CREATE.action, CREATE.resourceType);
  const isOpen = useQuickCreateStore((s) => s.isOpen);
  const open = useQuickCreateStore((s) => s.open);
  const close = useQuickCreateStore((s) => s.close);
  const { openTask } = useTaskDrawer();
  const [fullDraft, setFullDraft] = useState<FullFormDraft | null>(null);

  useQuickCreateHotkey(canCreate && !isOpen && fullDraft === null, open);

  const announceCreated = useCallback(
    (task: TaskCoreResponseDto) => {
      if (task.projectId) writeRecentProjectId(task.projectId);
      toast.success(t("quickCreate.created"), {
        key: TOAST_KEY,
        action: { label: t("quickCreate.open"), onClick: () => openTask(task.id) },
      });
    },
    [openTask, t],
  );
  // Hộp gọn: KHÔNG đụng form đầy đủ — request cũ của hộp gọn có thể về sau khi người dùng đã mở form đầy đủ.
  const handleQuickCreated = useCallback(
    (task: TaskCoreResponseDto) => {
      announceCreated(task);
      close();
    },
    [announceCreated, close],
  );
  const handleFullCreated = useCallback(
    (task: TaskCoreResponseDto) => {
      announceCreated(task);
      close();
      setFullDraft(null);
    },
    [announceCreated, close],
  );
  // Hộp CÒN mở ⇒ dòng lỗi tại ô đã đủ (không toast trùng). Hộp ĐÃ đóng khi server lỗi ⇒ toast để người
  // dùng biết việc CHƯA được tạo (kèm tiêu đề).
  const handleCreateError = useCallback(
    (message: string, title: string) => {
      if (useQuickCreateStore.getState().isOpen) return;
      toast.error(t("quickCreate.createFailed", { title, reason: message }));
    },
    [t],
  );

  // Đóng hộp (Esc / lưu xong) ⇒ trả focus về phần tử đã focus lúc mở (còn trong DOM), không thì nút topbar.
  // Bỏ qua khi chuyển sang form đầy đủ (form tự giữ focus).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current || fullDraft !== null) return;
    wasOpen.current = false;
    const target = useQuickCreateStore.getState().returnFocusTo;
    const fallback = document.querySelector<HTMLElement>(TOPBAR_BUTTON_SELECTOR);
    (target?.isConnected ? target : fallback)?.focus();
  }, [isOpen, fullDraft]);

  if (!canCreate) return null;
  if (fullDraft) {
    return (
      <TaskFormDrawer
        mode="create"
        onClose={() => setFullDraft(null)}
        onSuccess={handleFullCreated}
        defaultProject={fullDraft.project ?? undefined}
        initialValues={{ title: fullDraft.title }}
        defaultAssigneeMe
      />
    );
  }
  if (!isOpen) return null;
  return (
    <QuickCreateDialog
      onClose={close}
      onCreated={handleQuickCreated}
      onCreateError={handleCreateError}
      onExpand={(draft) => {
        close();
        setFullDraft(draft);
      }}
    />
  );
}
