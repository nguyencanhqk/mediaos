import { useCallback, useState } from "react";
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

  const handleCreated = useCallback(
    (task: TaskCoreResponseDto) => {
      if (task.projectId) writeRecentProjectId(task.projectId);
      toast.success(t("quickCreate.created"), {
        key: TOAST_KEY,
        action: { label: t("quickCreate.open"), onClick: () => openTask(task.id) },
      });
      close();
      setFullDraft(null);
    },
    [close, openTask, t],
  );

  if (!canCreate) return null;
  if (fullDraft) {
    return (
      <TaskFormDrawer
        mode="create"
        onClose={() => setFullDraft(null)}
        onSuccess={handleCreated}
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
      onCreated={handleCreated}
      onExpand={(draft) => {
        close();
        setFullDraft(draft);
      }}
    />
  );
}
