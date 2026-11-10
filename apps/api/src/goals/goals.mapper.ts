import type {
  GoalCoreResponseDto,
  GoalUpdateResponseDto,
  GoalUpdateTypeDto,
  GoalLevelDto,
  GoalMeasureTypeDto,
  GoalPeriodTypeDto,
  GoalProgressModeDto,
  GoalStatusDto,
  GoalTreeNodeDto,
} from "@mediaos/contracts";
import type { Goal, GoalUpdate } from "../db/schema/goals";

/**
 * S5-GOAL-BE-1 — projection row Drizzle → DTO contracts. CẤM controller/service trả row thô.
 *
 * Cột `numeric` của Postgres về JS dạng CHUỖI ("1.00") ⇒ ép số ở ĐÂY, một chỗ. `progress_percent`
 * NULL giữ nguyên NULL — "chưa đo" KHÁC 0% (SPEC-10 §13.2); tuyệt đối không `?? 0`.
 */

const toNumber = (v: string | number | null): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const toIso = (v: Date | string | null): string | null => {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
};

/**
 * S20-GOAL-OWNERCHECKIN-1 (Q14 = B) — phần làm giàu danh tính. CHỈ hai trường: tên hiển thị + mốc check-in.
 * Vắng extra ⇒ vắng cả khoá (không `null` giả) để phản hồi ghi/dashboard giữ nguyên hình cũ.
 */
export interface GoalIdentityExtra {
  ownerName?: string | null;
  lastCheckinAt?: string | null;
}

/** Hàng `goal_updates` kèm tên người check-in (JOIN `users` ở repository). */
export type GoalUpdateRowWithActor = GoalUpdate & { actorName?: string | null };

export function toGoalCoreDto(row: Goal, extra?: GoalIdentityExtra): GoalCoreResponseDto {
  return {
    id: row.id,
    companyId: row.companyId,
    goalCode: row.goalCode,
    name: row.name,
    description: row.description,
    level: row.level as GoalLevelDto,
    departmentId: row.departmentId,
    projectId: row.projectId,
    employeeId: row.employeeId,
    parentGoalId: row.parentGoalId,
    ownerEmployeeId: row.ownerEmployeeId,
    periodType: row.periodType as GoalPeriodTypeDto,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    measureType: row.measureType as GoalMeasureTypeDto,
    targetValue: toNumber(row.targetValue),
    currentValue: toNumber(row.currentValue),
    unit: row.unit,
    progressMode: row.progressMode as GoalProgressModeDto,
    progressPercent: toNumber(row.progressPercent),
    weight: toNumber(row.weight) ?? 1,
    status: row.status as GoalStatusDto,
    finalizedAt: toIso(row.finalizedAt),
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
    ...(extra && extra.ownerName !== undefined ? { ownerName: extra.ownerName } : {}),
    ...(extra && extra.lastCheckinAt !== undefined ? { lastCheckinAt: extra.lastCheckinAt } : {}),
  };
}

/**
 * S5-GOAL-BE-2 — một dòng sổ `goal_updates` → DTO. Cột `numeric` về CHUỖI ⇒ ép số ở đây (một chỗ).
 * `null` giữ NULL: "check-in không đổi số" và "check-in về 0" là hai chuyện khác nhau, y hệt luật
 * "chưa đo ≠ 0%" của `progress_percent` (SPEC-10 §13.2).
 */
export function toGoalUpdateDto(row: GoalUpdateRowWithActor): GoalUpdateResponseDto {
  return {
    id: row.id,
    goalId: row.goalId,
    updateType: row.updateType as GoalUpdateTypeDto,
    actorUserId: row.actorUserId,
    oldCurrentValue: toNumber(row.oldCurrentValue),
    newCurrentValue: toNumber(row.newCurrentValue),
    oldProgressPercent: toNumber(row.oldProgressPercent),
    newProgressPercent: toNumber(row.newProgressPercent),
    confidence: row.confidence === null ? null : Number(row.confidence),
    note: row.note,
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    ...(row.actorName !== undefined ? { actorName: row.actorName } : {}),
  };
}

/**
 * Dựng rừng cây từ danh sách PHẲNG (GOAL-API-006). Nút có cha KHÔNG nằm trong tập (ngoài scope/ngoài
 * bộ lọc kỳ) trở thành nút GỐC — cây không bao giờ nuốt mất dữ liệu actor được phép thấy.
 * Cấu trúc dữ liệu chặn độ sâu ở 3 tầng (department → project|employee); vòng lặp dữ liệu lệch được
 * cắt bằng `seen` để KHÔNG treo đệ quy.
 */
export function buildGoalTree(
  rows: Goal[],
  extraOf?: (row: Goal) => GoalIdentityExtra,
): GoalTreeNodeDto[] {
  const nodes = new Map<string, GoalTreeNodeDto>();
  const parentOf = new Map<string, string | null>();
  for (const row of rows) {
    nodes.set(row.id, { ...toGoalCoreDto(row, extraOf?.(row)), children: [] });
    parentOf.set(row.id, row.parentGoalId);
  }

  const roots: GoalTreeNodeDto[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;
    const parentId = row.parentGoalId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && parentId && !createsLoop(parentOf, parentId, row.id)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Gắn `nodeId` dưới `parentId` có tạo vòng không (dữ liệu lệch) — đi ngược chuỗi cha, có trần bước. */
function createsLoop(
  parentOf: Map<string, string | null>,
  parentId: string,
  nodeId: string,
): boolean {
  let cursor: string | null | undefined = parentId;
  for (let hop = 0; hop < 32 && cursor; hop += 1) {
    if (cursor === nodeId) return true;
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}
