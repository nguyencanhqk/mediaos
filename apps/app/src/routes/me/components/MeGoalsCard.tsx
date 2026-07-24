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
 * "CHƯA ĐO" ≠ "0%" (SPEC-10 §13.2): tiến độ LUÔN đi qua GoalProgressBar, KHÔNG tự định dạng số.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Target, AlertTriangle, RefreshCw, ChevronRight, CheckCircle2 } from "lucide-react";
import { meApi, meKeys, useCan } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
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
import { GOAL_ENGINE_PAIRS, ME_GOALS_PREVIEW_LIMIT } from "@/routes/goals/constants";

const GOALS_PATH = "/goals";

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

  const params = { status: "Active" as const, limit: ME_GOALS_PREVIEW_LIMIT };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: meKeys.goals(params),
    queryFn: () => meApi.getGoals(params),
    enabled: canAccess,
    staleTime: 60_000,
  });

  // Thiếu access:goal → ẩn hoàn toàn (không chiếm ô lưới, không lộ sự tồn tại của module Mục tiêu).
  if (!canAccess) return null;

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

    if (data.length === 0) {
      return <EmptyState title={t("goals.empty")} className="py-4" />;
    }

    return (
      <ul className="space-y-3">
        {data.map((goal) => (
          <li key={goal.id} className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-sm text-foreground" title={goal.name}>
                {goal.name}
              </p>
              {canCheckin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto shrink-0 p-1 text-xs text-brand hover:bg-transparent"
                  data-testid={`me-goal-checkin-${goal.id}`}
                  // Đã chốt kỳ ⇒ khoá ngay ở client (GOAL-ERR-005) thay vì để ăn 422.
                  disabled={Boolean(goal.finalizedAt)}
                  onClick={() => setCheckinGoal(goal)}
                >
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  {t("goals.checkin")}
                </Button>
              )}
            </div>
            {/* NULL = "chưa đo" → GoalProgressBar hiện "—" + cảnh báo, KHÔNG vẽ 0%. */}
            <GoalProgressBar progressPercent={goal.progressPercent} compact />
          </li>
        ))}
      </ul>
    );
  };

  const showDetailLink = !isLoading && !isError && !!data;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-brand" />
          {t("goals.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pt-0">{renderBody()}</CardContent>
      {showDetailLink ? (
        <div className="px-6 pb-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs text-brand hover:bg-transparent"
            // `as "/"`: route /goals tạo qua makeModuleRoute (path widen thành string) nên KHÔNG vào
            // union `to` — cast literal như MeTrainingCard (runtime giữ nguyên path).
            onClick={() => void navigate({ to: GOALS_PATH as "/" })}
          >
            {t("goals.viewAll")}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        </div>
      ) : null}

      {checkinGoal && <GoalCheckinDialog goal={checkinGoal} onClose={() => setCheckinGoal(null)} />}
    </Card>
  );
}
