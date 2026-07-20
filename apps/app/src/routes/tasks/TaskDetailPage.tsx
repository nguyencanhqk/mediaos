import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@mediaos/ui";
import { TaskDetailContent } from "./TaskDetailContent";

/**
 * TaskDetailPage — S4-FE-TASK-2/3 (SPEC-06 §13.7, TASK-SCREEN-007). Deep link /tasks/:taskId.
 *
 * S5-TASK-BOARD-UX-1: toàn bộ NỘI DUNG chuyển sang `TaskDetailContent` (dùng chung với panel trượt
 * phải mở từ board — xem TaskDetailDrawer). Trang này giờ chỉ là VỎ: nút quay lại + khung padding.
 * Route/deep-link giữ nguyên — thông báo, danh sách, việc con vẫn trỏ /tasks/:taskId như cũ.
 */
export function TaskDetailPage({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { t } = useTranslation("tasks");

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("tasks.detail.backToList")}
      </Button>

      <TaskDetailContent taskId={taskId} onDeleted={onBack} variant="page" />
    </div>
  );
}
