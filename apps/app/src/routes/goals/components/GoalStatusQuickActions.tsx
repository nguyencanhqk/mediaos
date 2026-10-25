/**
 * S20-GOAL-QUICKSTART-1 (US-GOAL-NV-02/04) — đổi trạng thái một chạm, dùng ở header chi tiết và thẻ
 * «Mục tiêu của tôi» (/me):
 *  - `GoalActivateButton`  — «Kích hoạt» mục tiêu Nháp (`PATCH {status:'Active'}`).
 *  - `GoalCheckinLockHint` — lý do Check-in đang khoá (Nháp / Đã chốt kỳ / không còn chạy).
 *  - `GoalCompletionBanner` — «Đã đạt 100%. Đánh dấu Hoàn thành?» + «Để sau»; KHÔNG tự đổi trạng thái.
 *
 * Gate theo cặp `update:goal` như nút Sửa (Q12 = A: chưa có cờ quyền theo bản ghi ⇒ BE 403 ⇒ hook
 * rollback + báo lỗi). Đã chốt kỳ ⇒ không có lối ghi nào (GOAL-ERR-005).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, PartyPopper, PlayCircle } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import type { GoalStatusDto } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { GOAL_ENGINE_PAIRS } from "../constants";
import { goalCheckinLockReason, shouldSuggestCompletion } from "../goal-format";
import { useGoalStatusMutation } from "../hooks/use-goal-status-mutation";

/** Các trường mục tiêu mà nhóm nút này đọc (Core lẫn Detail DTO đều có). */
interface QuickStatusGoal {
  readonly id: string;
  readonly status: GoalStatusDto;
  readonly finalizedAt: string | null;
  readonly progressPercent: number | null;
}

function useCanUpdateGoal(): boolean {
  return useCan(GOAL_ENGINE_PAIRS.UPDATE.action, GOAL_ENGINE_PAIRS.UPDATE.resourceType);
}

/** «Kích hoạt» — chỉ khi Nháp · chưa chốt · có cặp `update:goal`; không thì không render. */
export function GoalActivateButton({
  goal,
  size = "sm",
  className,
  testId,
}: {
  goal: QuickStatusGoal;
  size?: "sm" | "default";
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation("goals");
  const canUpdate = useCanUpdateGoal();
  const { changeStatus, pendingGoalIds } = useGoalStatusMutation();
  if (!canUpdate || goal.status !== "Draft" || goal.finalizedAt) return null;
  return (
    <Button
      size={size}
      variant="outline"
      className={className}
      data-testid={testId}
      disabled={pendingGoalIds.has(goal.id)}
      onClick={() => void changeStatus({ goalId: goal.id, status: "Active" })}
    >
      <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden />
      {t("statusChange.activate")}
    </Button>
  );
}

/** Lý do Check-in đang khoá; null khi check-in được. `id` để nút Check-in trỏ `aria-describedby`. */
export function GoalCheckinLockHint({
  goal,
  id,
  className,
}: {
  goal: QuickStatusGoal;
  id: string;
  className?: string;
}) {
  const { t } = useTranslation("goals");
  const canUpdate = useCanUpdateGoal();
  const reason = goalCheckinLockReason(goal);
  if (!reason) return null;
  const key = reason === "draft" && canUpdate ? "draftHint" : reason;
  return (
    <p
      id={id}
      data-testid="goal-checkin-lock-reason"
      className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ""}`}
    >
      <Lock className="h-3 w-3 shrink-0" aria-hidden />
      {t(`statusChange.lockReason.${key}`)}
    </p>
  );
}

const LATER_KEY_PREFIX = "mediaos.goals.completeSuggest.later.";

/** «Để sau» đã bấm cho mục tiêu này chưa — storage hỏng ⇒ coi như chưa (banner vẫn hiện, không lỗi). */
function readLater(goalId: string): boolean {
  try {
    return window.localStorage.getItem(LATER_KEY_PREFIX + goalId) === "1";
  } catch {
    return false;
  }
}

/** Ghi «Để sau»; storage hỏng ⇒ không nhớ được qua lần tải sau, banner chỉ ẩn trong lượt xem này. */
function writeLater(goalId: string): void {
  try {
    window.localStorage.setItem(LATER_KEY_PREFIX + goalId, "1");
  } catch {
    // Chủ ý: «Để sau» là tiện ích hiển thị — không ghi được thì vẫn ẩn bằng state, không báo lỗi.
  }
}

/** Banner gợi ý Hoàn thành — Active · chưa chốt · đã đo ≥ 100 · có cặp `update:goal` · chưa «Để sau». */
export function GoalCompletionBanner({ goal }: { goal: QuickStatusGoal }) {
  const { t } = useTranslation("goals");
  const canUpdate = useCanUpdateGoal();
  const { changeStatus, pendingGoalIds } = useGoalStatusMutation();
  const [later, setLater] = useState(() => readLater(goal.id));
  if (!canUpdate || later || !shouldSuggestCompletion(goal)) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm text-foreground"
    >
      <span className="flex items-center gap-2">
        <PartyPopper className="h-4 w-4 text-success" aria-hidden />
        {t("statusChange.completeBanner.message")}
      </span>
      <span className="flex gap-2">
        <Button
          size="sm"
          disabled={pendingGoalIds.has(goal.id)}
          onClick={() => void changeStatus({ goalId: goal.id, status: "Completed" })}
        >
          {t("statusChange.completeBanner.confirm")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            writeLater(goal.id);
            setLater(true);
          }}
        >
          {t("statusChange.completeBanner.later")}
        </Button>
      </span>
    </div>
  );
}
