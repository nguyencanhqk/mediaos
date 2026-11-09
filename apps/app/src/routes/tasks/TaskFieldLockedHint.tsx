import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { taskLockReason } from "./task-patch-field-locks";

/**
 * S20-SEC-TASKPATCHGATE-1 — dòng gợi ý dưới ô bị khoá vì thiếu cặp quyền chuyên trách của trường
 * (xem `task-patch-field-locks.ts`). Gắn vào ô qua `aria-describedby={id}`.
 */
export function TaskFieldLockedHint({
  id,
  reason,
}: {
  id: string;
  /** S20-TASK-ALLOWEDACTIONS-1 — `"watcher"` ⇒ «Bạn chỉ theo dõi việc này»; vắng ⇒ lời chung. */
  reason?: "watcher" | null;
}) {
  const { t } = useTranslation("tasks");
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {reason === "watcher" ? t("fieldGate.watcherOnly") : t("fieldGate.locked")}
    </p>
  );
}

/**
 * Lý do khoá của ô CHI TIẾT việc theo `allowedActions.lockReason` của server. Chỉ hiện khi ô đang khoá
 * VÀ server nêu lý do (người chỉ theo dõi); không lý do ⇒ giữ nguyên hành vi cũ (không thêm chữ).
 */
export function TaskLockedReasonHint({
  task,
  locked,
  id,
}: {
  task: Pick<TaskCoreResponseDto, "allowedActions">;
  locked: boolean;
  id: string;
}) {
  const reason = taskLockReason(task);
  if (!locked || !reason) return null;
  return <TaskFieldLockedHint id={id} reason={reason} />;
}

/**
 * a11y của ô CHI TIẾT bị khoá: id lời lý do sinh bằng `useId` (không trùng khi hai chi tiết cùng hiện,
 * vd ngăn kéo đè trang) + thuộc tính cho khung giá trị chỉ-đọc — `role="group"`, nhãn «Chỉ đọc»,
 * `aria-describedby` trỏ lời lý do CHỈ KHI lời đó thật sự được vẽ (tham chiếu id không tồn tại là rác).
 */
export function useLockedFieldA11y(
  task: Pick<TaskCoreResponseDto, "allowedActions">,
  locked: boolean,
): {
  hintId: string;
  groupProps: { role?: "group"; "aria-label"?: string; "aria-describedby"?: string };
} {
  const { t } = useTranslation("tasks");
  const hintId = useId();
  if (!locked) return { hintId, groupProps: {} };
  const hasHint = taskLockReason(task) !== null;
  return {
    hintId,
    groupProps: {
      role: "group",
      "aria-label": t("fieldGate.readOnly"),
      ...(hasHint ? { "aria-describedby": hintId } : {}),
    },
  };
}
