import { useTranslation } from "react-i18next";
import { CheckCircle2, Lock } from "lucide-react";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import { cn } from "@mediaos/ui";

/**
 * S20-GOAL-QUICKCHECKIN-1 (US-GOAL-NV-91) — biểu tượng Check-in trên dòng /goals và nút cây.
 *
 * Phía gọi tự gate cặp RIÊNG `('checkin','goal')` (như `MeGoalsCard`) — không có cặp thì KHÔNG dựng
 * component này. Ở đây chỉ còn trạng thái của chính mục tiêu: Nháp / đã chốt kỳ / đã đóng ⇒ biểu tượng
 * khoá, `aria-disabled` (vẫn focus được để đọc lý do qua `title`), bấm không làm gì. Server vẫn là
 * cổng thật (GOAL-ERR-005/006) — khoá ở đây chỉ để khỏi bấm-rồi-422.
 *
 * Mọi click đều `stopPropagation`: biểu tượng nằm TRONG dòng bảng có `onRowClick` (mở chi tiết) —
 * không chặn thì bấm Check-in là rời trang.
 */
export function GoalCheckinDialogTrigger({
  goal,
  onCheckin,
  className,
}: {
  goal: GoalCoreResponseDto;
  onCheckin: (goal: GoalCoreResponseDto) => void;
  className?: string;
}) {
  const { t } = useTranslation("goals");
  const lockReason = goal.finalizedAt
    ? t("checkinDialog.locked.finalized")
    : goal.status === "Draft"
      ? t("checkinDialog.locked.draft")
      : goal.status !== "Active"
        ? t("checkinDialog.locked.notActive")
        : null;
  const Icon = lockReason ? Lock : CheckCircle2;

  return (
    <button
      type="button"
      aria-label={t("checkinDialog.trigger", { name: goal.name })}
      aria-disabled={lockReason ? true : undefined}
      title={lockReason ?? t("checkinDialog.trigger", { name: goal.name })}
      data-testid={`goal-checkin-trigger-${goal.id}`}
      onClick={(event) => {
        event.stopPropagation();
        if (!lockReason) onCheckin(goal);
      }}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        lockReason ? "cursor-not-allowed opacity-60" : "hover:bg-muted hover:text-brand",
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}
