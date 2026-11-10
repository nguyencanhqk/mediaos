/**
 * S20-GOAL-OWNERCHECKIN-1 — «Check-in N ngày trước» + nhãn «Cần check-in» (manual Active quá hạn).
 * Quá hạn ⇒ tô cảnh báo + tooltip ngày giờ theo GIỜ CÔNG TY. Chế độ đo tự động ⇒ KHÔNG nhãn.
 * `now` truyền được để test cố định đồng hồ.
 */
import { useTranslation } from "react-i18next";
import { companyTimeZone } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import { Badge } from "@mediaos/ui";
import {
  checkinAgeDays,
  formatCompanyDateTime,
  GOAL_CHECKIN_STALE_DAYS,
  needsCheckin,
} from "../goal-checkin-freshness";

type CellGoal = Pick<
  GoalCoreResponseDto,
  "id" | "progressMode" | "status" | "lastCheckinAt" | "createdAt"
>;

export function GoalNeedsCheckinBadge({ goal, now }: { goal: CellGoal; now?: Date }) {
  const { t } = useTranslation("goals");
  if (!needsCheckin(goal, now ?? new Date(), companyTimeZone())) return null;
  return (
    <Badge variant="warning" data-testid={`goal-needs-checkin-${goal.id}`}>
      {t("checkinFreshness.needed")}
    </Badge>
  );
}

export function GoalCheckinCell({ goal, now }: { goal: CellGoal; now?: Date }) {
  const { t } = useTranslation("goals");
  const tz = companyTimeZone();
  const clock = now ?? new Date();
  const stale = needsCheckin(goal, clock, tz);
  const unknown = goal.lastCheckinAt === undefined;
  const age = goal.lastCheckinAt ? checkinAgeDays(goal, clock, tz) : null;
  let label = unknown ? "—" : t("checkinFreshness.never");
  if (age !== null) {
    label = age === 0 ? t("checkinFreshness.today") : t("checkinFreshness.daysAgo", { count: age });
  }
  const title = stale
    ? t("checkinFreshness.staleTooltip", {
        at: goal.lastCheckinAt
          ? formatCompanyDateTime(goal.lastCheckinAt, tz)
          : t("checkinFreshness.never"),
        days: GOAL_CHECKIN_STALE_DAYS,
      })
    : goal.lastCheckinAt
      ? formatCompanyDateTime(goal.lastCheckinAt, tz)
      : undefined;
  return (
    <span
      title={title}
      tabIndex={title ? 0 : undefined}
      aria-label={title ? `${label} — ${title}` : undefined}
      role={title ? "group" : undefined}
      data-testid={`goal-lastcheckin-${goal.id}`}
      data-stale={stale ? "true" : undefined}
      className={
        stale
          ? "whitespace-nowrap text-sm font-medium text-warning"
          : "whitespace-nowrap text-sm text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}
