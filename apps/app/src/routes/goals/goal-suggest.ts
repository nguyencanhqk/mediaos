import type { GoalCoreResponseDto, ListGoalsQueryRequest } from "@mediaos/contracts";
import { companyTimeZone, localDateOf, todayLocal } from "@mediaos/web-core";

/**
 * S20-GOAL-SUGGEST-1 (US-GOAL-NV-92/93) — luật gợi ý «gắn việc vào mục tiêu» khi TẠO việc. Helper THUẦN,
 * không React/IO (dễ suy luận + test). Hook truy vấn nằm ở `use-goal-suggestions.ts`.
 *
 * Ứng viên = mục tiêu server cho gắn mà KHÔNG chặn cứng (GOAL-ERR-008):
 *   · cá nhân  → `employeeId` = người phụ trách chính của việc;
 *   · dự án    → `projectId` = dự án của việc;
 *   · phòng    → `departmentId` = phòng của việc (server chỉ cảnh báo mềm; việc chưa có phòng ⇒ không gợi ý).
 * Và: Active · chưa chốt kỳ · cách đo «theo việc gắn» (`tasks` — gắn việc vào mục tiêu manual/children/
 * project KHÔNG đổi số) · kỳ chứa ngày của hạn việc (không hạn ⇒ hôm nay theo giờ công ty).
 */

/**
 * Q28 (việc con có chọn sẵn «Tính vào mục tiêu của việc cha»?). Chưa được owner chốt trên trang duyệt ⇒
 * dùng khuyến nghị A = KHÔNG chọn sẵn (tránh làm lệch % mà người dùng không để ý). Đổi sang B (chọn sẵn
 * khi việc cha đang gắn) chỉ cần sửa DÒNG NÀY.
 */
export const GOAL_SUGGEST_SUBTASK_PRESELECT = false;

/** Trần mỗi truy vấn hẹp GET /goals (đã lọc kỳ + neo ở server nên 50 là dư). */
export const GOAL_SUGGEST_QUERY_LIMIT = 50;
export const GOAL_SUGGEST_STALE_MS = 60_000;

/** Mã lỗi server dùng để đổi thông điệp «chưa gắn» (SPEC-10 §12). */
export const GOAL_ERR_PERIOD_FINALIZED = "GOAL-ERR-005";
export const GOAL_ERR_ANCHOR_MISMATCH = "GOAL-ERR-008";

export interface GoalSuggestContext {
  readonly projectId: string | null;
  readonly assigneeEmployeeId: string | null;
  readonly departmentId: string | null;
  /** ISO datetime của hạn việc; null ⇒ hôm nay theo giờ công ty. */
  readonly dueAt: string | null;
}

export type SuggestionMode = "none" | "preselect" | "chip" | "dropdown";

const LEVEL_RANK: Readonly<Record<string, number>> = { employee: 0, project: 1, department: 2 };

/** Phạm vi ghi: việc không người phụ trách VÀ không dự án nằm ngoài phạm vi ⇒ bước gắn sẽ 404. */
export function hasWriteAnchor(ctx: GoalSuggestContext): boolean {
  return Boolean(ctx.assigneeEmployeeId) || Boolean(ctx.projectId);
}

export function suggestionDate(ctx: Pick<GoalSuggestContext, "dueAt">, now: Date = new Date()): string {
  const tz = companyTimeZone();
  return ctx.dueAt ? localDateOf(new Date(ctx.dueAt), tz) : todayLocal(now, tz);
}

/** Tối đa 3 truy vấn hẹp (cá nhân · dự án · phòng) — lọc neo + Active + kỳ ngay ở server. */
export function goalQueryParams(
  ctx: GoalSuggestContext,
  date: string,
): Array<Partial<ListGoalsQueryRequest>> {
  if (!hasWriteAnchor(ctx)) return [];
  const base = {
    status: "Active",
    periodFrom: date,
    periodTo: date,
    limit: GOAL_SUGGEST_QUERY_LIMIT,
  } as const;
  const out: Array<Partial<ListGoalsQueryRequest>> = [];
  if (ctx.assigneeEmployeeId) {
    out.push({ ...base, level: "employee", employeeId: ctx.assigneeEmployeeId });
  }
  if (ctx.projectId) out.push({ ...base, level: "project", projectId: ctx.projectId });
  if (ctx.departmentId) out.push({ ...base, level: "department", departmentId: ctx.departmentId });
  return out;
}

const dayOf = (iso: string): string => iso.slice(0, 10);

export function isLinkableGoal(goal: GoalCoreResponseDto, date: string): boolean {
  return (
    goal.status === "Active" &&
    !goal.finalizedAt &&
    goal.progressMode === "tasks" &&
    dayOf(goal.periodStart) <= date &&
    date <= dayOf(goal.periodEnd)
  );
}

function matchesAnchor(goal: GoalCoreResponseDto, ctx: GoalSuggestContext): boolean {
  switch (goal.level) {
    case "employee":
      return goal.employeeId !== null && goal.employeeId === ctx.assigneeEmployeeId;
    case "project":
      return goal.projectId !== null && goal.projectId === ctx.projectId;
    case "department":
      return goal.departmentId !== null && goal.departmentId === ctx.departmentId;
    default:
      return false; // `company`: MVP không tạo được (GOAL-ERR-004)
  }
}

/** Lọc + bỏ trùng + xếp cá nhân > dự án > phòng (cùng cấp: theo mã mục tiêu). */
export function rankCandidates(
  goals: readonly GoalCoreResponseDto[],
  ctx: GoalSuggestContext,
  date: string,
): GoalCoreResponseDto[] {
  if (!hasWriteAnchor(ctx)) return [];
  const seen = new Set<string>();
  const kept: GoalCoreResponseDto[] = [];
  for (const goal of goals) {
    if (seen.has(goal.id)) continue;
    seen.add(goal.id);
    if (isLinkableGoal(goal, date) && matchesAnchor(goal, ctx)) kept.push(goal);
  }
  return kept.sort(
    (a, b) =>
      (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9) || a.goalCode.localeCompare(b.goalCode),
  );
}

/**
 * Trường hợp DUY NHẤT FE chắc server cho ghi: phạm vi Own đòi cả `employeeId` lẫn `ownerEmployeeId` là
 * tôi (useCan không cho biết scope).
 */
export function isOwnPersonalGoal(goal: GoalCoreResponseDto, myEmployeeId: string | null): boolean {
  return (
    myEmployeeId !== null &&
    goal.level === "employee" &&
    goal.employeeId === myEmployeeId &&
    goal.ownerEmployeeId === myEmployeeId
  );
}

export function suggestionMode(
  candidates: readonly GoalCoreResponseDto[],
  myEmployeeId: string | null,
): SuggestionMode {
  if (candidates.length === 0) return "none";
  if (candidates.length > 1) return "dropdown";
  const only = candidates[0];
  return only && isOwnPersonalGoal(only, myEmployeeId) ? "preselect" : "chip";
}

export type SubtaskGoalLock = "personalOwner" | "noWriteScope";

/**
 * Việc con: khoá ô «Tính vào …» kèm lý do (null = mở). Mục tiêu cá nhân chỉ nhận việc do CHÍNH chủ mục
 * tiêu phụ trách (GOAL-ERR-008); việc con không người phụ trách + cha ngoài dự án nằm ngoài phạm vi ghi.
 */
export function subtaskGoalLock(
  goal: GoalCoreResponseDto,
  input: { parentHasProject: boolean; subtaskAssigneeEmployeeId: string | null },
): SubtaskGoalLock | null {
  if (goal.level === "employee" && input.subtaskAssigneeEmployeeId !== goal.employeeId) {
    return "personalOwner";
  }
  if (!input.subtaskAssigneeEmployeeId && !input.parentHasProject) return "noWriteScope";
  return null;
}

/** Ô «Tính vào …» của việc con có hiện không (mục tiêu của cha còn nhận việc)? */
export function isSubtaskGoalOffered(goal: GoalCoreResponseDto): boolean {
  return goal.status === "Active" && !goal.finalizedAt && goal.progressMode === "tasks";
}
