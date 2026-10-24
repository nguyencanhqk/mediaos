/**
 * S20-GOAL-LISTURL-1 (US-GOAL-QL-04) — prefill form tạo mục tiêu qua search của `/goals/new`.
 *
 * Khoá: `parentGoalId` · `level` · `departmentId` · `projectId` · `periodType` · `periodStart` ·
 * `periodEnd`. Cơ chế làm MỘT lần, dùng chung: «Thêm mục tiêu con» (tab Mục tiêu con của chi tiết) hôm
 * nay; tab mục tiêu của dự án (`level=project&projectId=`) về sau.
 *
 * Prefill chỉ là GỢI Ý điền sẵn — không phải quyền, không phải ràng buộc: BE vẫn validate
 * GOAL-ERR-001/011/012 và quyền `create:goal` khi lưu. validateSearch KHÔNG BAO GIỜ ném: khoá rác ⇒ bỏ.
 */
import { useMemo } from "react";
import { useRouterState } from "@tanstack/react-router";
import type { GoalPeriodTypeDto } from "@mediaos/contracts";
import { GOAL_LEVEL_OPTIONS, GOAL_PERIOD_TYPE_OPTIONS, type GoalLevelOption } from "./constants";
import type { GoalFormValues } from "./goal-form-schema";
import { isGoalUuid, isLocalDate } from "./goal-list-search";

export interface GoalFormPrefill {
  parentGoalId?: string;
  level?: GoalLevelOption;
  departmentId?: string;
  projectId?: string;
  periodType?: GoalPeriodTypeDto;
  periodStart?: string;
  periodEnd?: string;
}

type SearchRecord = Record<string, unknown>;

/** Cấp gợi ý cho mục tiêu con: phân rã xuống từng người (owner duyệt US-GOAL-QL-04). */
const CHILD_GOAL_LEVEL: GoalLevelOption = "employee";

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function dateParam(value: unknown): string | undefined {
  return typeof value === "string" && isLocalDate(value) ? value : undefined;
}

/** `validateSearch` của `/goals/new` — rác ⇒ bỏ khoá; kỳ ngược chiều ⇒ bỏ cả hai mốc. */
export function validateGoalFormPrefill(raw: SearchRecord): GoalFormPrefill {
  const periodStart = dateParam(raw?.periodStart);
  const periodEnd = dateParam(raw?.periodEnd);
  const reversed = periodStart !== undefined && periodEnd !== undefined && periodStart > periodEnd;
  const entries: [keyof GoalFormPrefill, unknown][] = [
    ["parentGoalId", isGoalUuid(raw?.parentGoalId) ? raw.parentGoalId : undefined],
    ["level", oneOf(raw?.level, GOAL_LEVEL_OPTIONS)],
    ["departmentId", isGoalUuid(raw?.departmentId) ? raw.departmentId : undefined],
    ["projectId", isGoalUuid(raw?.projectId) ? raw.projectId : undefined],
    ["periodType", oneOf(raw?.periodType, GOAL_PERIOD_TYPE_OPTIONS)],
    ["periodStart", reversed ? undefined : periodStart],
    ["periodEnd", reversed ? undefined : periodEnd],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as GoalFormPrefill;
}

/** Search mở form «Thêm mục tiêu con» từ một mục tiêu cha. */
export function childGoalPrefill(parent: {
  id: string;
  departmentId: string | null;
  projectId: string | null;
  periodType: GoalPeriodTypeDto;
  periodStart: string;
  periodEnd: string;
}): GoalFormPrefill {
  return {
    parentGoalId: parent.id,
    level: CHILD_GOAL_LEVEL,
    ...(parent.departmentId ? { departmentId: parent.departmentId } : {}),
    ...(parent.projectId ? { projectId: parent.projectId } : {}),
    periodType: parent.periodType,
    periodStart: parent.periodStart,
    periodEnd: parent.periodEnd,
  };
}

/** Giá trị form khởi đầu = `base` + prefill. Tạo từ cha ⇒ mặc định Active (Nháp là thêm một bước). */
export function applyGoalFormPrefill(
  base: GoalFormValues,
  prefill: GoalFormPrefill,
): GoalFormValues {
  const defined = Object.fromEntries(
    Object.entries(prefill).filter(([, value]) => value !== undefined),
  ) as Partial<GoalFormValues>;
  return {
    ...base,
    ...defined,
    status: prefill.parentGoalId ? "Active" : base.status,
  };
}

/** «Lưu và thêm tiếp»: xoá tên · mô tả · người · chỉ tiêu; giữ cha · kỳ · phòng · cấp · cách đo. */
export function nextGoalFormValues(saved: GoalFormValues): GoalFormValues {
  return {
    ...saved,
    name: "",
    description: "",
    employeeId: "",
    ownerEmployeeId: "",
    targetValue: "",
  };
}

/** Prefill đọc từ `location.search` qua CÙNG hàm validate của route (giá trị rác không lọt vào form). */
export function useGoalFormPrefill(): GoalFormPrefill {
  const raw = useRouterState({ select: (s) => s.location.search });
  return useMemo(() => validateGoalFormPrefill((raw ?? {}) as SearchRecord), [raw]);
}
