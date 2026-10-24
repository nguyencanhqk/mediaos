/**
 * S20-TASK-DRAWER-1 (US-TASK-QL-05) — bộ lọc của Danh sách công việc (`/tasks`) sống trên URL.
 *
 * Mở một việc rồi đóng, tải lại, Back từ trang chi tiết toàn trang hay gửi link cho người khác đều ra
 * CÙNG bộ lọc (server vẫn ép phạm vi dữ liệu của người xem — URL chỉ là bộ lọc, không phải quyền).
 *
 * 🔴 Giá trị tới đây đã qua `JSON.parse` của router (`?page=2` là SỐ, `?overdue=true` là BOOLEAN,
 * `?search=2024` là SỐ) — mọi bộ đọc dưới đây nhận cả dạng chuỗi lẫn dạng đã parse.
 *
 * KHÔNG BAO GIỜ NÉM: tham số rác (status=abc, assignee không phải uuid, ngày sai) ⇒ bỏ, dùng mặc
 * định — không 404, không màn lỗi, back/forward không vỡ.
 */
import type {
  ListTaskCoreQueryRequest,
  TaskCorePriorityDto,
  TaskCoreStatusDto,
} from "@mediaos/contracts";
import { TASK_CORE_PRIORITY_OPTIONS, TASK_CORE_STATUS_OPTIONS } from "./constants";
import { isTaskUuid } from "./task-drawer-nav";

/** Trần độ dài ô tìm — khớp `search: z.string().trim().min(1).max(200)` của `GET /tasks`. */
export const TASK_LIST_SEARCH_MAX = 200;
/** Trần trang — chặn offset khổng lồ từ URL sửa tay. */
const PAGE_MAX = 10_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TaskListSearch {
  status?: TaskCoreStatusDto;
  priority?: TaskCorePriorityDto;
  assignee?: string;
  project?: string;
  department?: string;
  dueFrom?: string;
  dueTo?: string;
  overdue?: true;
  search?: string;
  page?: number;
}

/** Các khoá bộ lọc (không gồm `page`) — «Xoá bộ lọc» bỏ hết chúng. */
export const TASK_LIST_FILTER_KEYS = [
  "status",
  "priority",
  "assignee",
  "project",
  "department",
  "dueFrom",
  "dueTo",
  "overdue",
  "search",
] as const satisfies readonly (keyof TaskListSearch)[];

export function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function uuidParam(value: unknown): string | undefined {
  return isTaskUuid(value) ? value.toLowerCase() : undefined;
}

function dateParam(value: unknown): string | undefined {
  if (typeof value !== "string" || !DATE_RE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

export function textParam(value: unknown): string | undefined {
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, TASK_LIST_SEARCH_MAX) : undefined;
}

function pageParam(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n >= 2 && n <= PAGE_MAX ? n : undefined;
}

export function flagParam(value: unknown): true | undefined {
  return value === true || value === "true" || value === 1 || value === "1" ? true : undefined;
}

/** `validateSearch` của route `/tasks` — rác ⇒ bỏ khoá đó, không ném. */
export function validateTaskListSearch(raw: Record<string, unknown>): TaskListSearch {
  const entries: [keyof TaskListSearch, unknown][] = [
    ["status", oneOf(raw.status, TASK_CORE_STATUS_OPTIONS)],
    ["priority", oneOf(raw.priority, TASK_CORE_PRIORITY_OPTIONS)],
    ["assignee", uuidParam(raw.assignee)],
    ["project", uuidParam(raw.project)],
    ["department", uuidParam(raw.department)],
    ["dueFrom", dateParam(raw.dueFrom)],
    ["dueTo", dateParam(raw.dueTo)],
    ["overdue", flagParam(raw.overdue)],
    ["search", textParam(raw.search)],
    ["page", pageParam(raw.page)],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as TaskListSearch;
}

export function hasActiveTaskListFilters(search: TaskListSearch): boolean {
  return TASK_LIST_FILTER_KEYS.some((key) => search[key] !== undefined);
}

/** Bộ lọc URL ⇒ query `GET /tasks` (ngày lọc theo nửa đêm giờ trình duyệt, như ô ngày cũ). */
export function toTaskListQuery(
  search: TaskListSearch,
  pageSize: number,
): Partial<ListTaskCoreQueryRequest> {
  const page = search.page ?? 1;
  return {
    status: search.status,
    priority: search.priority,
    assigneeEmployeeId: search.assignee,
    projectId: search.project,
    departmentId: search.department,
    dueFrom: search.dueFrom ? new Date(search.dueFrom).toISOString() : undefined,
    dueTo: search.dueTo ? new Date(search.dueTo).toISOString() : undefined,
    overdue: search.overdue,
    search: search.search,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}

type SearchRecord = Record<string, unknown>;

/**
 * Áp một thay đổi bộ lọc lên search HIỆN TẠI của URL (giữ tham số khác, vd `task` của drawer).
 * Giá trị rỗng/undefined ⇒ bỏ khoá. Đổi bộ lọc ⇒ về trang 1 (bỏ `page`) trừ khi patch đặt `page`.
 */
export function patchTaskListSearch(
  prev: SearchRecord,
  patch: Partial<TaskListSearch>,
): SearchRecord {
  const next: SearchRecord = Object.fromEntries(
    Object.entries(prev ?? {}).filter(([key]) => key !== "page" && !(key in patch)),
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && value !== "") next[key] = value;
  }
  return next;
}

/** «Xoá bộ lọc»: bỏ mọi khoá bộ lọc + `page`, giữ tham số khác. */
export function clearTaskListFilters(prev: SearchRecord): SearchRecord {
  const drop = new Set<string>([...TASK_LIST_FILTER_KEYS, "page"]);
  return Object.fromEntries(Object.entries(prev ?? {}).filter(([key]) => !drop.has(key)));
}
