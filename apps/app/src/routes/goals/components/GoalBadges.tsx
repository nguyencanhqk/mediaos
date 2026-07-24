import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@mediaos/ui";
import type { GoalLevelDto, GoalStatusDto } from "@mediaos/contracts";
import { goalStatusBadgeVariant } from "../goal-format";

/** Badge trạng thái goal (Draft/Active/Completed/Cancelled) — variant theo goalStatusBadgeVariant. */
export function GoalStatusBadge({ status }: { status: GoalStatusDto }) {
  const { t } = useTranslation("goals");
  return <Badge variant={goalStatusBadgeVariant(status)}>{t(`status.${status}`)}</Badge>;
}

/** Badge cấp mục tiêu (phòng ban/dự án/nhân viên). */
export function GoalLevelBadge({ level }: { level: GoalLevelDto }) {
  const { t } = useTranslation("goals");
  return <Badge variant="outline">{t(`level.${level}`)}</Badge>;
}

/** Badge "đã chốt kỳ" (khóa) — hiển thị khi finalizedAt != null (SPEC-10 §13.4, GOAL-ERR-005). */
export function GoalFinalizedBadge() {
  const { t } = useTranslation("goals");
  return (
    <Badge variant="warning">
      <Lock className="h-3 w-3" aria-hidden />
      {t("finalizedBadge")}
    </Badge>
  );
}
