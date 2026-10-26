/**
 * MeGoalsCard — card "Mục tiêu của tôi" trong Tổng quan ME (ME-SCREEN-001 · GOAL-API-013, S5-GOAL-FE-2).
 *
 * Mirror MeTrainingCard: KHÔNG đọc từ `GET /me/overview` mà có QUERY RIÊNG `GET /me/goals`
 * (meApi.getGoals) — endpoint riêng, gate riêng. Vì vậy một nguồn lỗi tự khoanh vùng TRONG card, KHÔNG
 * kéo sập overview (SPEC-09 §18.2 fail-soft).
 *
 * SELF-GATE `access:goal`: card tự ẩn (render null) + KHÔNG fetch khi thiếu quyền (useQuery enabled) —
 * nguồn gating DUY NHẤT, MeOverviewPage chỉ mount vô điều kiện (không hard-code role, CLAUDE.md §5).
 * Check-in nhanh gate CẶP RIÊNG `('checkin','goal')` — người xem được mục tiêu chưa chắc check-in được.
 *
 * S20-GOAL-QUICKSTART-1 (US-GOAL-NV-04) — thẻ liệt kê mọi mục tiêu ĐANG MỞ của tôi trong kỳ hiện tại
 * (quý theo giờ công ty), KỂ CẢ Nháp, 5 dòng + «Xem tất cả (N)» → `/goals?mine=1`. Lọc trạng thái ở
 * SERVER — một request cho Active, một cho Nháp (`meGoalsQuerySchema.status` nhận MỘT giá trị): server xếp
 * `period_start DESC, goal_code ASC`, không ưu tiên mục đang mở, nên một request không lọc với `limit`
 * có thể trả toàn mục đã đóng và đẩy mục đang mở ra ngoài trang. Completed/Cancelled vẫn bị ẩn ở client
 * (phòng hờ). Mục Nháp có badge + «Kích hoạt» (hook dùng chung) và Check-in
 * khoá kèm lý do. Chủ thể vẫn lấy từ token (`meGoalsQuerySchema` không có `employeeId`).
 *
 * "CHƯA ĐO" ≠ "0%" (SPEC-10 §13.2): tiến độ LUÔN đi qua GoalProgressBar, KHÔNG tự định dạng số.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Target, AlertTriangle, RefreshCw, ChevronRight, CheckCircle2, Plus } from "lucide-react";
import { companyTimeZone, meApi, meKeys, quarterRange, useCan } from "@mediaos/web-core";
import type { GoalCoreResponseDto, GoalStatusDto } from "@mediaos/contracts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  EmptyState,
  Button,
} from "@mediaos/ui";
import { GoalProgressBar } from "@/routes/goals/components/GoalProgressBar";
import { GoalCheckinDialog } from "@/routes/goals/components/GoalCheckinDialog";
import { GoalStatusBadge } from "@/routes/goals/components/GoalBadges";
import {
  GoalActivateButton,
  GoalCheckinLockHint,
} from "@/routes/goals/components/GoalStatusQuickActions";
import { useGoalStatusPendingIds } from "@/routes/goals/hooks/use-goal-status-mutation";
import { goalCheckinLockReason, goalPeriodLabel } from "@/routes/goals/goal-format";
import {
  GOAL_ENGINE_PAIRS,
  ME_GOALS_FETCH_LIMIT,
  ME_GOALS_PREVIEW_LIMIT,
} from "@/routes/goals/constants";

/** Trạng thái coi là «đã đóng» — không hiện trên thẻ (vẫn xem được ở /goals). */
const CLOSED_STATUSES: ReadonlySet<GoalCoreResponseDto["status"]> = new Set([
  "Completed",
  "Cancelled",
]);

/** Trạng thái «đang mở» — mỗi trạng thái một request lọc ở server. */
const OPEN_STATUSES: readonly GoalStatusDto[] = ["Active", "Draft"];

/** Thứ tự của server (`period_start DESC, goal_code ASC`) — giữ khi gộp các trang theo trạng thái. */
function compareServerOrder(a: GoalCoreResponseDto, b: GoalCoreResponseDto): number {
  if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? 1 : -1;
  if (a.goalCode === b.goalCode) return 0;
  return a.goalCode < b.goalCode ? -1 : 1;
}

/**
 * Gộp các trang theo trạng thái thành một danh sách đang mở — THUẦN: bỏ trùng theo id (một mục vừa đổi
 * trạng thái có thể còn ở cache cũ trong lúc làm mới), bỏ mục đã đóng, xếp lại theo thứ tự server.
 */
function mergeOpenGoals(pages: readonly (readonly GoalCoreResponseDto[])[]): GoalCoreResponseDto[] {
  const byId = new Map<string, GoalCoreResponseDto>();
  for (const goal of pages.flat()) {
    if (!CLOSED_STATUSES.has(goal.status) && !byId.has(goal.id)) byId.set(goal.id, goal);
  }
  return [...byId.values()].sort(compareServerOrder);
}

export function MeGoalsCard() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const [checkinGoal, setCheckinGoal] = useState<GoalCoreResponseDto | null>(null);

  const canAccess = useCan(GOAL_ENGINE_PAIRS.ACCESS.action, GOAL_ENGINE_PAIRS.ACCESS.resourceType);
  const canCheckin = useCan(
    GOAL_ENGINE_PAIRS.CHECKIN.action,
    GOAL_ENGINE_PAIRS.CHECKIN.resourceType,
  );
  const canCreate = useCan(GOAL_ENGINE_PAIRS.CREATE.action, GOAL_ENGINE_PAIRS.CREATE.resourceType);

  // Kỳ hiện tại = quý chứa «hôm nay» theo giờ CÔNG TY (không phải giờ máy) — đọc một lần lúc mở thẻ.
  const paramsByStatus = useMemo(() => {
    const quarter = quarterRange(new Date(), companyTimeZone());
    return OPEN_STATUSES.map((status) => ({
      periodFrom: quarter.start,
      periodTo: quarter.end,
      limit: ME_GOALS_FETCH_LIMIT,
      status,
    }));
  }, []);
  const results = useQueries({
    queries: paramsByStatus.map((params) => ({
      queryKey: meKeys.goals(params),
      queryFn: () => meApi.getGoals(params),
      enabled: canAccess,
      staleTime: 60_000,
    })),
  });
  const isLoading = results.some((result) => result.isLoading);
  const isError = results.some((result) => result.isError);
  const pages = results.map((result) => result.data);
  const data = pages.every((page): page is GoalCoreResponseDto[] => page !== undefined)
    ? pages
    : undefined;
  const openGoals = data ? mergeOpenGoals(data) : [];
  // Một trang bất kỳ đầy `limit` ⇒ có thể còn nữa ⇒ «N+» (API không trả tổng).
  const mayHaveMore = (data ?? []).some((page) => page.length >= ME_GOALS_FETCH_LIMIT);
  const refetch = () => Promise.all(results.map((result) => result.refetch()));

  // Thiếu access:goal → ẩn hoàn toàn (không chiếm ô lưới, không lộ sự tồn tại của module Mục tiêu).
  if (!canAccess) return null;

  const openDetail = (goalId: string) =>
    void navigate({ to: "/goals/$goalId", params: { goalId } });

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      );
    }

    if (isError || !data) {
      return (
        <EmptyState
          icon={AlertTriangle}
          title={t("goals.error.title")}
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

    if (openGoals.length === 0) {
      return (
        <EmptyState
          title={t("goals.empty")}
          className="py-4"
          action={
            canCreate ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigate({ to: "/goals/new" })}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("goals.create")}
              </Button>
            ) : undefined
          }
        />
      );
    }

    return (
      <ul className="space-y-3">
        {openGoals.slice(0, ME_GOALS_PREVIEW_LIMIT).map((goal) => (
          <MeGoalRow
            key={goal.id}
            goal={goal}
            canCheckin={canCheckin}
            onOpen={() => openDetail(goal.id)}
            onCheckin={() => setCheckinGoal(goal)}
          />
        ))}
      </ul>
    );
  };

  const showViewAll = !isLoading && !isError && openGoals.length > 0;
  const viewAllCount = `${openGoals.length}${mayHaveMore ? "+" : ""}`;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-brand" />
          {t("goals.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pt-0">{renderBody()}</CardContent>
      {showViewAll ? (
        <div className="px-6 pb-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs text-brand hover:bg-transparent"
            onClick={() => void navigate({ to: "/goals", search: { mine: 1 } })}
          >
            {t("goals.viewAllCount", { count: viewAllCount })}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        </div>
      ) : null}

      {checkinGoal && <GoalCheckinDialog goal={checkinGoal} onClose={() => setCheckinGoal(null)} />}
    </Card>
  );
}

/** Một dòng: tên (mở chi tiết) · nhãn kỳ · Nháp + «Kích hoạt» · Check-in (khoá kèm lý do) · tiến độ. */
function MeGoalRow({
  goal,
  canCheckin,
  onOpen,
  onCheckin,
}: {
  goal: GoalCoreResponseDto;
  canCheckin: boolean;
  onOpen: () => void;
  onCheckin: () => void;
}) {
  const { t } = useTranslation("me");
  const lockHintId = `me-goal-lock-${goal.id}`;
  const locked = goalCheckinLockReason(goal) !== null;
  // «Kích hoạt» đang chờ server ⇒ Check-in chờ xác nhận (bản lạc quan có thể bị rollback).
  const statusPending = useGoalStatusPendingIds().has(goal.id);
  return (
    <li className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={goal.name}
          onClick={onOpen}
        >
          {goal.name}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {goal.status === "Draft" && <GoalStatusBadge status={goal.status} />}
          <GoalActivateButton goal={goal} className="h-7 px-2 text-xs" />
          {canCheckin && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto shrink-0 p-1 text-xs text-brand hover:bg-transparent"
              data-testid={`me-goal-checkin-${goal.id}`}
              // Nháp / đã chốt kỳ ⇒ khoá ngay ở client (GOAL-ERR-005/006) thay vì để ăn 422.
              disabled={locked || statusPending}
              aria-busy={statusPending || undefined}
              aria-describedby={locked ? lockHintId : undefined}
              onClick={onCheckin}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              {t("goals.checkin")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{goalPeriodLabel(goal)}</p>
      {/* NULL = "chưa đo" → GoalProgressBar hiện "—" + cảnh báo, KHÔNG vẽ 0%. */}
      <GoalProgressBar progressPercent={goal.progressPercent} compact />
      {canCheckin && <GoalCheckinLockHint goal={goal} id={lockHintId} />}
    </li>
  );
}
