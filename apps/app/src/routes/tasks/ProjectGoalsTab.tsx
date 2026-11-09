import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { goalApi, goalKeys, hrApi, hrKeys, PermissionGate, useCan } from "@mediaos/web-core";
import { GOAL_PAGE_LIMIT_MAX, type GoalCoreResponseDto } from "@mediaos/contracts";
import { Button, Card, EmptyState } from "@mediaos/ui";
import { GOAL_ENGINE_PAIRS } from "../goals/constants";
import { goalPeriodLabel } from "../goals/goal-format";
import { GoalFinalizedBadge, GoalStatusBadge } from "../goals/components/GoalBadges";
import { GoalProgressBar } from "../goals/components/GoalProgressBar";

/** Trần số owner tra thêm theo id (ngoài trang danh bạ đầu) — tránh bắn N request vô hạn. */
const OWNER_LOOKUP_MAX = 20;

/**
 * S7-GOAL-PROJTAB-1 (lát A, US-GOAL-QL-10) — tab «Mục tiêu» của workspace dự án: mục tiêu CẤP DỰ ÁN gắn
 * dự án này, lấy từ `GET /goals?projectId=` SẴN CÓ (không endpoint mới). Gate hiện tab ở
 * ProjectDetailPage (`view:goal` + `access:goal`); ở đây gate lại cho chắc (view:goal + access:goal — cặp route đích đòi) — thiếu quyền ⇒ KHÔNG gọi /goals.
 * Tên người phụ trách: DTO chỉ có UUID ⇒ tra danh bạ nhân viên khi có `read:employee`, không thì «—»
 * (KHÔNG lộ UUID trơ — mẫu GoalDetailPage).
 */
export function ProjectGoalsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation("goals");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  // Cổng của màn KHỚP cổng đường đích: /goals/:id và /goals/new đòi access:goal ⇒ thiếu một trong hai
  // thì không hiện tab (khỏi dẫn vào trang «không có quyền»).
  const canViewGoal = useCan(GOAL_ENGINE_PAIRS.VIEW.action, GOAL_ENGINE_PAIRS.VIEW.resourceType);
  const canAccessGoal = useCan(
    GOAL_ENGINE_PAIRS.ACCESS.action,
    GOAL_ENGINE_PAIRS.ACCESS.resourceType,
  );
  const canView = canViewGoal && canAccessGoal;
  const canReadEmployees = useCan("read", "employee");

  const params = { projectId, limit: GOAL_PAGE_LIMIT_MAX };
  const { data, isLoading, isError, isSuccess, refetch } = useQuery({
    queryKey: goalKeys.list(params),
    queryFn: () => goalApi.listGoals(params),
    enabled: canView,
    staleTime: 30_000,
  });
  const goals: GoalCoreResponseDto[] = data ?? [];
  // Danh bạ chỉ cần khi đã có mục tiêu để tra tên — /goals rỗng hoặc lỗi ⇒ không bắn request thừa.
  const needsOwnerNames = isSuccess && goals.length > 0;
  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100 }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100 }),
    enabled: canView && canReadEmployees && needsOwnerNames,
    staleTime: 60_000,
  });
  const pageNames = useMemo(
    () => new Map((employeesPage?.items ?? []).map((e) => [e.id, e.fullName] as const)),
    [employeesPage],
  );
  // Owner ngoài trang danh bạ (công ty >100 nhân viên / đã nghỉ) ⇒ tra theo đúng id, có trần.
  const missingOwnerIds = useMemo(
    () =>
      employeesPage
        ? [...new Set(goals.map((g) => g.ownerEmployeeId))]
            .filter((id) => !pageNames.has(id))
            .slice(0, OWNER_LOOKUP_MAX)
        : [],
    [employeesPage, goals, pageNames],
  );
  const lookups = useQueries({
    queries: missingOwnerIds.map((id) => ({
      queryKey: hrKeys.employees.detail(id),
      queryFn: () => hrApi.getEmployee(id),
      enabled: canView && canReadEmployees,
      staleTime: 60_000,
      retry: false,
    })),
  });
  const ownerNames = useMemo(() => {
    const names = new Map(pageNames);
    lookups.forEach((q, i) => {
      const id = missingOwnerIds[i];
      if (id && q.data?.fullName) names.set(id, q.data.fullName);
    });
    return names;
  }, [pageNames, lookups, missingOwnerIds]);

  if (!canView) return null;

  const createGoal = () =>
    void navigate({ to: "/goals/new", search: { level: "project", projectId } });
  const openGoal = (id: string) => void navigate({ to: "/goals/$goalId", params: { goalId: id } });

  if (isLoading) {
    return (
      <div
        className="space-y-3"
        data-testid="project-goals-loading"
        role="status"
        aria-busy="true"
      >
        <span className="sr-only">{t("projectTab.loading")}</span>
        <div className="h-16 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title={t("projectTab.error.title")}
        description={t("projectTab.error.description")}
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
        title={t("projectTab.empty.title")}
        description={t("projectTab.empty.description")}
        action={
          <PermissionGate
            action={GOAL_ENGINE_PAIRS.CREATE.action}
            resourceType={GOAL_ENGINE_PAIRS.CREATE.resourceType}
          >
            <Button size="sm" onClick={createGoal} data-testid="project-goals-create">
              <Plus className="mr-2 h-4 w-4" />
              {t("projectTab.create")}
            </Button>
          </PermissionGate>
        }
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="project-goals-tab">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t("projectTab.heading", { count: goals.length })}
        </h3>
        <PermissionGate
          action={GOAL_ENGINE_PAIRS.CREATE.action}
          resourceType={GOAL_ENGINE_PAIRS.CREATE.resourceType}
        >
          <Button
            size="sm"
            variant="outline"
            onClick={createGoal}
            data-testid="project-goals-create"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("projectTab.create")}
          </Button>
        </PermissionGate>
      </div>
      {goals.length >= GOAL_PAGE_LIMIT_MAX && (
        <p className="text-xs text-muted-foreground" data-testid="project-goals-truncated">
          {t("projectTab.truncated", { count: GOAL_PAGE_LIMIT_MAX })}
        </p>
      )}
      <ul className="space-y-2">
        {goals.map((goal) => (
          <li key={goal.id}>
            <Card className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-left text-sm font-medium text-foreground hover:underline"
                  data-testid={`project-goal-open-${goal.id}`}
                  onClick={() => openGoal(goal.id)}
                >
                  <span className="mr-2 text-xs text-muted-foreground">{goal.goalCode}</span>
                  {goal.name}
                </button>
                <div className="flex items-center gap-2">
                  <GoalStatusBadge status={goal.status} />
                  {goal.finalizedAt && <GoalFinalizedBadge />}
                </div>
              </div>
              <GoalProgressBar progressPercent={goal.progressPercent} compact />
              <p className="text-xs text-muted-foreground">
                {t("projectTab.owner")}: {ownerNames.get(goal.ownerEmployeeId) ?? "—"} ·{" "}
                {goalPeriodLabel(goal)}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
