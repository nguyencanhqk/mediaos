/**
 * DepartmentGoalCell — S5-GOAL-DASH-1: khối "Mục tiêu kỳ này" trong trang phòng ban HR (DepartmentsPage).
 * Mỗi dòng phòng ban tự fetch `GET /goals/tree?departmentId&periodFrom&periodTo` (kỳ = ngày hôm nay,
 * mirror BE fetchGoalProgress — "kỳ này" = period_start<=today<=period_end) rồi lấy đúng nút cấp
 * `department` (nếu có) hiển thị thanh tiến độ + drill-down sang trang chi tiết mục tiêu.
 *
 * Gate: PermissionGate(view:goal) — HR không có view:goal (chỉ read:department) vẫn không render (403
 * server-side vẫn chặn nếu cố tình fetch — client-side gate chỉ để tránh gọi API vô ích).
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { goalApi, goalKeys, PermissionGate } from "@mediaos/web-core";
import { GoalProgressBar } from "@/routes/goals/components/GoalProgressBar";
import { GOAL_ENGINE_PAIRS } from "@/routes/goals/constants";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function DepartmentGoalCellInner({ departmentId }: { departmentId: string }) {
  const { t } = useTranslation("hr");
  const navigate = useNavigate();
  const today = todayIsoDate();
  const { data, isLoading } = useQuery({
    queryKey: goalKeys.tree({ departmentId, periodFrom: today, periodTo: today }),
    queryFn: () => goalApi.getTree({ departmentId, periodFrom: today, periodTo: today }),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <span className="text-xs text-muted-foreground">…</span>;
  }
  const deptGoal = (data ?? []).find((n) => n.level === "department");
  if (!deptGoal) {
    return <span className="text-xs text-muted-foreground">{t("departments.goals.empty")}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => void navigate({ to: "/goals/$goalId", params: { goalId: deptGoal.id } })}
      className="w-full max-w-[180px] text-left"
      title={deptGoal.name}
    >
      <GoalProgressBar progressPercent={deptGoal.progressPercent} compact />
    </button>
  );
}

export function DepartmentGoalCell({ departmentId }: { departmentId: string }) {
  return (
    <PermissionGate
      action={GOAL_ENGINE_PAIRS.VIEW.action}
      resourceType={GOAL_ENGINE_PAIRS.VIEW.resourceType}
    >
      <DepartmentGoalCellInner departmentId={departmentId} />
    </PermissionGate>
  );
}
