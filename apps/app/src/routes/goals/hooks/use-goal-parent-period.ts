/**
 * S20-GOAL-PARENTPICKER-1 (US-GOAL-NV-12) — cha của form mục tiêu + kỳ theo cha.
 *
 * Kỳ theo cha CHỈ khi kỳ còn mặc định: cờ «đã sửa tay» bật khi người dùng đổi một trong ba ô kỳ; form
 * SỬA mang kỳ của bản ghi ⇒ coi như đã sửa. Kỳ con ngoài kỳ cha ⇒ `periodOutsideParent` (cảnh báo mềm,
 * không chặn lưu). Cha chưa biết kỳ (form SỬA, hoặc cha điền sẵn chưa tải) ⇒ đọc chi tiết cha để so kỳ
 * + hiện nhãn.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseFormSetValue } from "react-hook-form";
import { goalApi, goalKeys, useAuthStore } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import type { GoalFormValues } from "../goal-form-schema";
import { isPeriodOutsideParent, parentPeriodValues } from "../goal-form-defaults";
import type { GoalParentLabel } from "../components/GoalParentCombobox";

export interface GoalParentPeriodInput {
  readonly isEdit: boolean;
  /** Giá trị `parentGoalId` hiện tại của form ("" = mục tiêu gốc). */
  readonly parentGoalId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Cha điền sẵn đã kiểm (tồn tại + chưa chốt kỳ) — S20-GOAL-LISTURL-1. */
  readonly validParent: GoalCoreResponseDto | null;
  /** Breadcrumb cha của bản ghi đang SỬA (chỉ để hiện nhãn khi chi tiết cha chưa tới). */
  readonly editParent: GoalParentLabel | null | undefined;
  readonly setValue: UseFormSetValue<GoalFormValues>;
}

export interface GoalParentPeriod {
  /** Phòng của mình — bộ lọc gợi ý mặc định của ô chọn cha; null ⇒ không lọc phòng. */
  readonly selfDepartmentId: string | null;
  /** Nhãn cha đang chọn; null khi chưa có cha hoặc chưa biết nhãn. */
  readonly parentLabel: GoalParentLabel | null;
  readonly periodOutsideParent: boolean;
  readonly selectParent: (goal: GoalCoreResponseDto | null) => void;
  /** Gắn vào onChange của ba ô kỳ. */
  readonly markPeriodTouched: () => void;
}

export function useGoalParentPeriod({
  isEdit,
  parentGoalId,
  periodStart,
  periodEnd,
  validParent,
  editParent,
  setValue,
}: GoalParentPeriodInput): GoalParentPeriod {
  const periodTouchedRef = useRef(isEdit);
  const selfDepartmentId = useAuthStore((s) => s.user?.employee?.departmentId ?? null);
  const [pickedParent, setPickedParent] = useState<GoalCoreResponseDto | null>(null);
  const knownParent =
    [pickedParent, validParent].find((g) => g !== null && g.id === parentGoalId) ?? null;
  const parentDetailQuery = useQuery({
    queryKey: goalKeys.detail(parentGoalId),
    queryFn: () => goalApi.getGoal(parentGoalId),
    enabled: Boolean(parentGoalId) && !knownParent,
    staleTime: 15_000,
  });
  const parentFacts =
    knownParent ?? (parentDetailQuery.data?.id === parentGoalId ? parentDetailQuery.data : null);
  const parentLabel = parentFacts ?? (editParent?.id === parentGoalId ? editParent : null);
  const periodOutsideParent =
    parentFacts !== null && isPeriodOutsideParent({ periodStart, periodEnd }, parentFacts);

  const selectParent = (goal: GoalCoreResponseDto | null) => {
    setPickedParent(goal);
    setValue("parentGoalId", goal?.id ?? "");
    if (!goal || periodTouchedRef.current) return;
    const period = parentPeriodValues(goal);
    setValue("periodType", period.periodType);
    setValue("periodStart", period.periodStart);
    setValue("periodEnd", period.periodEnd);
  };
  const markPeriodTouched = () => {
    periodTouchedRef.current = true;
  };

  return { selfDepartmentId, parentLabel, periodOutsideParent, selectParent, markPeriodTouched };
}
