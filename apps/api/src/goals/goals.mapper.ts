import type {
  GoalCoreResponseDto,
  GoalLevelDto,
  GoalMeasureTypeDto,
  GoalPeriodTypeDto,
  GoalProgressModeDto,
  GoalStatusDto,
  GoalTreeNodeDto,
} from "@mediaos/contracts";
import type { Goal } from "../db/schema/goals";

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

export function toGoalCoreDto(row: Goal): GoalCoreResponseDto {
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
  };
}

/**
 * Dựng rừng cây từ danh sách PHẲNG (GOAL-API-006). Nút có cha KHÔNG nằm trong tập (ngoài scope/ngoài
 * bộ lọc kỳ) trở thành nút GỐC — cây không bao giờ nuốt mất dữ liệu actor được phép thấy.
 * Cấu trúc dữ liệu chặn độ sâu ở 3 tầng (department → project|employee); vòng lặp dữ liệu lệch được
 * cắt bằng `seen` để KHÔNG treo đệ quy.
 */
export function buildGoalTree(rows: Goal[]): GoalTreeNodeDto[] {
  const nodes = new Map<string, GoalTreeNodeDto>();
  const parentOf = new Map<string, string | null>();
  for (const row of rows) {
    nodes.set(row.id, { ...toGoalCoreDto(row), children: [] });
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
