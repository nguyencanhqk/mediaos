/**
 * GoalCheckinDueBlock — khối FE «Mục tiêu cần check-in» ngay dưới lưới widget của dashboard Employee
 * (S20-DASH-TODAY-1, US-X-03). KHÔNG phải widget BE: không thêm mã widget, không seed cấu hình.
 *
 * Nguồn = `GET /me/goals` (cùng khuôn `MeGoalsCard`; chủ thể lấy từ token). Lọc trạng thái ở SERVER, mỗi
 * trạng thái «đang mở» một request (Active · Draft) — xem lý do ở doc-block MeGoalsCard.
 *
 * Gate: `access:goal` (xem) + `checkin:goal` (check-in) — thiếu MỘT ⇒ không render và 0 lời gọi
 * (`enabled` tắt). Mục Nháp: nút Check-in khoá kèm lý do (`goalCheckinLockReason`, cùng nguồn với
 * MeGoalsCard). Lỗi riêng khối ⇒ báo lỗi + Thử lại, các widget khác vẫn sống.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, Target } from "lucide-react";
import { companyTimeZone, meApi, meKeys, quarterRange, useCan } from "@mediaos/web-core";
import type { GoalCoreResponseDto, GoalStatusDto } from "@mediaos/contracts";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from "@mediaos/ui";
import { GoalCheckinDialog } from "@/routes/goals/components/GoalCheckinDialog";
import { GoalCheckinLockHint } from "@/routes/goals/components/GoalStatusQuickActions";
import { GoalStatusBadge } from "@/routes/goals/components/GoalBadges";
import { GoalProgressBar } from "@/routes/goals/components/GoalProgressBar";
import { goalCheckinLockReason, goalPeriodLabel } from "@/routes/goals/goal-format";
import {
  GOAL_ENGINE_PAIRS,
  ME_GOALS_FETCH_LIMIT,
  ME_GOALS_PREVIEW_LIMIT,
} from "@/routes/goals/constants";

const OPEN_STATUSES: readonly GoalStatusDto[] = ["Active", "Draft"];
const CLOSED_STATUSES: ReadonlySet<GoalCoreResponseDto["status"]> = new Set([
  "Completed",
  "Cancelled",
]);

/** Gộp các trang theo trạng thái: bỏ trùng id, bỏ mục đã đóng, giữ thứ tự server (kỳ mới trước, mã tăng). */
function mergeOpenGoals(pages: readonly (readonly GoalCoreResponseDto[])[]): GoalCoreResponseDto[] {
  const byId = new Map<string, GoalCoreResponseDto>();
  for (const goal of pages.flat()) {
    if (!CLOSED_STATUSES.has(goal.status) && !byId.has(goal.id)) byId.set(goal.id, goal);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? 1 : -1;
    return a.goalCode === b.goalCode ? 0 : a.goalCode < b.goalCode ? -1 : 1;
  });
}

export interface GoalCheckinDueBlockProps {
  /** Mọi nguồn khác của màn «Hôm nay» đã rỗng ⇒ khi khối này cũng rỗng, hiện «Hôm nay bạn đã xong hết». */
  othersClear?: boolean;
}

export function GoalCheckinDueBlock({ othersClear = false }: GoalCheckinDueBlockProps) {
  const { t } = useTranslation("dashboard");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const [checkinGoal, setCheckinGoal] = useState<GoalCoreResponseDto | null>(null);
  const canAccess = useCan(GOAL_ENGINE_PAIRS.ACCESS.action, GOAL_ENGINE_PAIRS.ACCESS.resourceType);
  const canCheckin = useCan(
    GOAL_ENGINE_PAIRS.CHECKIN.action,
    GOAL_ENGINE_PAIRS.CHECKIN.resourceType,
  );
  const enabled = canAccess && canCheckin;

  // Kỳ hiện tại = quý chứa «hôm nay» theo giờ CÔNG TY (máy đặt UTC cho cùng kết quả).
  // Tính MỖI lần render (rẻ) ⇒ qua mốc đổi quý, queryKey đổi theo, tab mở lâu không kẹt quý cũ.
  const quarter = quarterRange(new Date(), companyTimeZone());
  const paramsByStatus = OPEN_STATUSES.map((status) => ({
    periodFrom: quarter.start,
    periodTo: quarter.end,
    limit: ME_GOALS_FETCH_LIMIT,
    status,
  }));
  const results = useQueries({
    queries: paramsByStatus.map((params) => ({
      queryKey: meKeys.goals(params),
      queryFn: () => meApi.getGoals(params),
      enabled,
      staleTime: 60_000,
    })),
  });

  if (!enabled) return null;

  const isLoading = results.some((r) => r.isLoading);
  const isError = results.some((r) => r.isError);
  const pages = results.map((r) => r.data);
  const loaded = pages.every((p): p is GoalCoreResponseDto[] => p !== undefined);
  const goals = loaded ? mergeOpenGoals(pages) : [];
  const refetch = () => Promise.all(results.map((r) => r.refetch()));

  const renderBody = () => {
    if (isLoading) return <Skeleton className="h-16 w-full" />;
    if (isError || !loaded) {
      return (
        <EmptyState
          icon={AlertTriangle}
          title={t("goalCheckin.error")}
          className="py-4"
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      );
    }
    if (goals.length === 0) {
      return (
        <EmptyState
          icon={othersClear ? CheckCircle2 : undefined}
          title={othersClear ? t("goalCheckin.allClear") : t("goalCheckin.empty")}
          className="py-4"
        />
      );
    }
    return (
      <ul className="space-y-3">
        {goals.slice(0, ME_GOALS_PREVIEW_LIMIT).map((goal) => (
          <GoalDueRow key={goal.id} goal={goal} onCheckin={() => setCheckinGoal(goal)} />
        ))}
      </ul>
    );
  };

  return (
    <Card data-testid="goal-checkin-due-block">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-brand" />
          {t("goalCheckin.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{renderBody()}</CardContent>
      {!isLoading && !isError && goals.length > 0 ? (
        <div className="px-6 pb-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs text-brand hover:bg-transparent"
            onClick={() => void navigate({ to: "/goals", search: { mine: 1 } })}
          >
            {t("goalCheckin.viewAll")}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        </div>
      ) : null}
      {checkinGoal && <GoalCheckinDialog goal={checkinGoal} onClose={() => setCheckinGoal(null)} />}
    </Card>
  );
}

function GoalDueRow({ goal, onCheckin }: { goal: GoalCoreResponseDto; onCheckin: () => void }) {
  const { t } = useTranslation("me");
  const { t: td } = useTranslation("dashboard");
  const lockHintId = `dash-goal-lock-${goal.id}`;
  const locked = goalCheckinLockReason(goal) !== null;
  return (
    <li className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={goal.name}>
          {goal.name}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {goal.status === "Draft" && <GoalStatusBadge status={goal.status} />}
          <Button
            variant="ghost"
            size="sm"
            className="h-auto shrink-0 p-1 text-xs text-brand hover:bg-transparent"
            data-testid={`dash-goal-checkin-${goal.id}`}
            disabled={locked}
            aria-label={td("goalCheckin.checkinFor", { name: goal.name })}
            aria-describedby={locked ? lockHintId : undefined}
            onClick={onCheckin}
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            {t("goals.checkin")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{goalPeriodLabel(goal)}</p>
      <GoalProgressBar progressPercent={goal.progressPercent} compact />
      <GoalCheckinLockHint goal={goal} id={lockHintId} />
    </li>
  );
}
