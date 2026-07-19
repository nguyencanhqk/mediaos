import type {
  TaskCorePriorityDto,
  TaskCoreResponseDto,
  TaskCoreStatusDto,
} from "@mediaos/contracts";

/**
 * S5-TASK-WORKSPACE-1 (đợt D1) — hằng số + helper THUẦN cho vỏ workspace dự án (SPEC-06 §13.3
 * TASK-SCREEN-003). File này là NGUỒN DUY NHẤT cho: danh sách tab (deep-link ?tab=), bộ lọc toolbar
 * dùng chung giữa tab Bảng·Danh sách, và tính toán rail avatar — cả TaskKanbanPage lẫn
 * ProjectTaskListTab lọc qua CÙNG các hàm ở đây ⇒ parity filter giữa 2 tab là theo cấu trúc,
 * không phải theo kỷ luật.
 *
 * `TaskKanbanCardDto` = `taskCoreResponseSchema.extend(counts)` (task-collab.ts) ⇒ mọi helper nhận
 * `TaskCoreResponseDto` dùng được cho CẢ hai tab, không cần generic riêng.
 */

// ─── Tab (URL ?tab=) — thứ tự = thứ tự render tab bar ─────────────────────────
export const PROJECT_WORKSPACE_TABS = [
  "overview",
  "board",
  "list",
  "report",
  "activity",
  "members",
] as const;
export type ProjectWorkspaceTab = (typeof PROJECT_WORKSPACE_TABS)[number];

/** Giá trị rác/thiếu trên URL → tab mặc định "overview" (không 404 oan, không vỡ back/forward). */
export function parseWorkspaceTab(raw: unknown): ProjectWorkspaceTab {
  return typeof raw === "string" && (PROJECT_WORKSPACE_TABS as readonly string[]).includes(raw)
    ? (raw as ProjectWorkspaceTab)
    : "overview";
}

// ─── Bộ lọc toolbar dùng chung (tìm · lọc · sắp xếp) ──────────────────────────
export const WORKSPACE_TASK_SORTS = [
  "default",
  "dueAsc",
  "dueDesc",
  "priorityDesc",
  "titleAsc",
  "createdDesc",
] as const;
export type WorkspaceTaskSort = (typeof WORKSPACE_TASK_SORTS)[number];

export interface WorkspaceTaskFilters {
  q: string;
  status: TaskCoreStatusDto | "";
  priority: TaskCorePriorityDto | "";
  overdueOnly: boolean;
  sort: WorkspaceTaskSort;
}

export const DEFAULT_WORKSPACE_FILTERS: WorkspaceTaskFilters = {
  q: "",
  status: "",
  priority: "",
  overdueOnly: false,
  sort: "default",
};

/** Sentinel "Chưa giao" trong selection rail — KHÔNG phải id thật (mainAssigneeEmployeeId là UUID). */
export const UNASSIGNED_FILTER_VALUE = "__unassigned__";

/** So khớp tìm kiếm tiếng Việt không phân biệt hoa-thường + dấu (gõ "bao cao" khớp "Báo cáo"). */
export function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Memo 1-slot RIÊNG cho query: q lặp y hệt cho MỌI dòng trong 1 lượt lọc (500 card board) —
 * không normalize lại per-row. (Memo chung trong normalizeSearchText vô dụng: gọi xen kẽ title/q.) */
let lastQueryInput = "";
let lastQueryNorm = "";
function normalizedQuery(q: string): string {
  if (q !== lastQueryInput) {
    lastQueryInput = q;
    lastQueryNorm = normalizeSearchText(q);
  }
  return lastQueryNorm;
}

export function matchesWorkspaceFilters(
  task: Pick<TaskCoreResponseDto, "title" | "status" | "priority" | "isOverdue">,
  filters: WorkspaceTaskFilters,
): boolean {
  if (filters.q && !normalizeSearchText(task.title).includes(normalizedQuery(filters.q)))
    return false;
  if (filters.status && task.status !== filters.status) return false;
  if (filters.priority && task.priority !== filters.priority) return false;
  if (filters.overdueOnly && !task.isOverdue) return false;
  return true;
}

/** Selection rỗng = không lọc theo người (hiện tất cả). Multi-select: task khớp BẤT KỲ người đã bật. */
export function matchesAssigneeSelection(
  task: Pick<TaskCoreResponseDto, "mainAssigneeEmployeeId">,
  selection: ReadonlySet<string>,
): boolean {
  if (selection.size === 0) return true;
  if (task.mainAssigneeEmployeeId === null) return selection.has(UNASSIGNED_FILTER_VALUE);
  return selection.has(task.mainAssigneeEmployeeId);
}

// ─── Rail avatar (lọc theo người thực hiện + "Chưa giao", đếm theo tập ĐÃ lọc toolbar) ──
export interface AssigneeRailOption {
  id: string;
  name: string | null;
  count: number;
}

export interface AssigneeRailSummary {
  assignees: AssigneeRailOption[];
  unassignedCount: number;
}

/**
 * Suy dải avatar + đếm TỪ tập task truyền vào (caller đã áp bộ lọc toolbar nhưng CHƯA áp lọc
 * assignee — nhờ vậy bật 1 người không triệt tiêu số đếm của người khác). Sắp theo count desc
 * rồi tên asc cho rail ổn định.
 */
export function buildAssigneeSummary(
  tasks: ReadonlyArray<Pick<TaskCoreResponseDto, "mainAssigneeEmployeeId" | "assigneeName">>,
): AssigneeRailSummary {
  const byId = new Map<string, { name: string | null; count: number }>();
  let unassignedCount = 0;
  for (const task of tasks) {
    if (task.mainAssigneeEmployeeId === null) {
      unassignedCount += 1;
      continue;
    }
    const existing = byId.get(task.mainAssigneeEmployeeId);
    if (existing) {
      byId.set(task.mainAssigneeEmployeeId, {
        name: existing.name ?? task.assigneeName,
        count: existing.count + 1,
      });
    } else {
      byId.set(task.mainAssigneeEmployeeId, { name: task.assigneeName, count: 1 });
    }
  }
  const assignees = Array.from(byId.entries())
    .map(([id, v]) => ({ id, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count || (a.name ?? "").localeCompare(b.name ?? "", "vi"));
  return { assignees, unassignedCount };
}

/**
 * GHIM người ĐANG được chọn vào rail kể cả khi bộ lọc toolbar làm count của họ về 0 — nếu không,
 * nút toggle biến mất trong khi selection vẫn lọc ⇒ view rỗng không có đường gỡ (finding gate D1).
 * Tên tra từ TẬP GỐC (allTasks, chưa lọc toolbar); entry ghim đứng cuối rail với count 0.
 */
export function pinSelectedInSummary(
  summary: AssigneeRailSummary,
  selection: ReadonlySet<string>,
  allTasks: ReadonlyArray<Pick<TaskCoreResponseDto, "mainAssigneeEmployeeId" | "assigneeName">>,
): AssigneeRailSummary {
  if (selection.size === 0) return summary;
  const present = new Set(summary.assignees.map((a) => a.id));
  const missing = Array.from(selection).filter(
    (id) => id !== UNASSIGNED_FILTER_VALUE && !present.has(id),
  );
  if (missing.length === 0) return summary;
  const nameById = new Map<string, string | null>();
  for (const task of allTasks) {
    if (task.mainAssigneeEmployeeId && !nameById.has(task.mainAssigneeEmployeeId)) {
      nameById.set(task.mainAssigneeEmployeeId, task.assigneeName);
    }
  }
  return {
    assignees: [
      ...summary.assignees,
      ...missing.map((id) => ({ id, name: nameById.get(id) ?? null, count: 0 })),
    ],
    unassignedCount: summary.unassignedCount,
  };
}

// ─── Sắp xếp (client-side, áp cho list + trong từng cột board) ────────────────
const PRIORITY_RANK: Record<TaskCorePriorityDto, number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

function compareNullableIso(a: string | null, b: string | null, dir: 1 | -1): number {
  // null luôn xuống cuối bất kể chiều sắp — hàng thiếu deadline không chen lên đầu.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 * dir : a > b ? 1 * dir : 0;
}

/** Trả MẢNG MỚI đã sắp (không mutate input). `default` giữ nguyên thứ tự server. */
export function sortWorkspaceTasks<
  T extends Pick<TaskCoreResponseDto, "title" | "priority" | "dueAt" | "createdAt">,
>(tasks: ReadonlyArray<T>, sort: WorkspaceTaskSort): T[] {
  const copy = [...tasks];
  switch (sort) {
    case "default":
      return copy;
    case "dueAsc":
      return copy.sort((a, b) => compareNullableIso(a.dueAt, b.dueAt, 1));
    case "dueDesc":
      return copy.sort((a, b) => compareNullableIso(a.dueAt, b.dueAt, -1));
    case "priorityDesc":
      return copy.sort(
        (a, b) =>
          (a.priority ? PRIORITY_RANK[a.priority] : 4) -
          (b.priority ? PRIORITY_RANK[b.priority] : 4),
      );
    case "titleAsc":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "vi"));
    case "createdDesc":
      return copy.sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      );
  }
}
