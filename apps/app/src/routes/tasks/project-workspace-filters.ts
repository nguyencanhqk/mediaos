/**
 * S20-TASK-PROJTOOLBARURL-1 (US-TASK-QL-05, phần workspace) — bộ lọc toolbar + rail người phụ trách
 * của workspace dự án sống trên URL: `q · status · priority · overdue · sort · who`.
 *
 * File THUẦN (không React): `router.tsx` import tĩnh làm `validateSearch` của route
 * `/tasks/projects/$projectId`, trang đọc lại qua CÙNG các hàm ⇒ router và trang không thể hiểu bộ
 * lọc khác nhau. `?tab` (S20-TASK-PROJECTENTRY-1) và `?task` (S20-TASK-DRAWER-1) do
 * `validateProjectWorkspaceSearch` (workspace-constants.ts) lo — ở đây chỉ GHÉP thêm.
 *
 * KHÔNG BAO GIỜ NÉM: giá trị rác ⇒ bỏ khoá đó (mặc định), không 404, Back/Forward không vỡ. Bộ lọc
 * chạy phía client trên tập việc server đã ép phạm vi — URL chỉ là bộ lọc, không phải quyền.
 *
 * `who` = danh sách id nhân viên ngăn bởi dấu phẩy, `unassigned` = «Chưa giao» (trên URL không dùng
 * sentinel nội bộ của rail). Chip «Của tôi» bật/tắt employeeId của tôi trong CHÍNH danh sách này.
 */
import { defaultStringifySearch } from "@tanstack/react-router";
import type { TaskCorePriorityDto, TaskCoreStatusDto } from "@mediaos/contracts";
import { TASK_CORE_PRIORITY_OPTIONS, TASK_CORE_STATUS_OPTIONS } from "./constants";
import { flagParam, oneOf, textParam } from "./task-list-search";
import { isTaskUuid } from "./task-drawer-nav";
import {
  DEFAULT_WORKSPACE_FILTERS,
  UNASSIGNED_FILTER_VALUE,
  WORKSPACE_TASK_SORTS,
  validateProjectWorkspaceSearch,
  type ProjectWorkspaceSearch,
  type WorkspaceTaskFilters,
  type WorkspaceTaskSort,
} from "./workspace-constants";

/** Giá trị «Chưa giao» trong `who` trên URL. */
export const WORKSPACE_WHO_UNASSIGNED = "unassigned";
/** Trần số người trong `who` — chặn URL sửa tay phình vô hạn. */
export const WORKSPACE_WHO_MAX = 50;

export interface WorkspaceFilterSearch {
  q?: string;
  status?: TaskCoreStatusDto;
  priority?: TaskCorePriorityDto;
  overdue?: true;
  sort?: Exclude<WorkspaceTaskSort, "default">;
  who?: string;
}

/** Search đầy đủ của route workspace dự án = tab/task/addMembers + bộ lọc. */
export type ProjectWorkspaceRouteSearch = ProjectWorkspaceSearch & WorkspaceFilterSearch;

const SORTS_ON_URL = WORKSPACE_TASK_SORTS.filter(
  (sort): sort is Exclude<WorkspaceTaskSort, "default"> => sort !== "default",
);

function whoItems(raw: unknown): string[] {
  if (typeof raw === "string") return raw.split(",");
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string");
  return [];
}

/**
 * Đọc `who` (chuỗi phẩy hoặc mảng) ⇒ danh sách hợp lệ: uuid chữ thường hoặc `unassigned`, bỏ trùng.
 *
 * Giả định: id phía rail/bộ lọc (`mainAssigneeEmployeeId`, employeeId của /me) là cột `uuid` của
 * Postgres — dạng văn bản LUÔN chữ thường — nên hạ chữ thường ở đây chỉ chuẩn hoá link sửa tay
 * (`?who=ABC…`) cho khớp `Set.has` ở `workspace-constants.ts`/`AssigneeRail.tsx` (so khớp phân biệt
 * hoa thường). Nguồn id nào không chữ thường thì phải chuẩn hoá ở nguồn đó, không nới so khớp.
 */
function whoValues(raw: unknown): string[] {
  const valid = whoItems(raw).flatMap((item) => {
    const value = item.trim();
    if (value === WORKSPACE_WHO_UNASSIGNED) return [value];
    return isTaskUuid(value) ? [value.toLowerCase()] : [];
  });
  return Array.from(new Set(valid)).slice(0, WORKSPACE_WHO_MAX);
}

function whoParam(raw: unknown): string | undefined {
  const values = whoValues(raw);
  return values.length > 0 ? values.join(",") : undefined;
}

/** Phần bộ lọc của search — rác ⇒ bỏ khoá, không ném. */
export function validateWorkspaceFilterSearch(raw: Record<string, unknown>): WorkspaceFilterSearch {
  const entries: [keyof WorkspaceFilterSearch, unknown][] = [
    ["q", textParam(raw.q)],
    ["status", oneOf(raw.status, TASK_CORE_STATUS_OPTIONS)],
    ["priority", oneOf(raw.priority, TASK_CORE_PRIORITY_OPTIONS)],
    ["overdue", flagParam(raw.overdue)],
    ["sort", oneOf(raw.sort, SORTS_ON_URL)],
    ["who", whoParam(raw.who)],
  ];
  return Object.fromEntries(
    entries.filter(([, value]) => value !== undefined),
  ) as WorkspaceFilterSearch;
}

/** `validateSearch` của route `/tasks/projects/$projectId` (router.tsx). */
export function validateProjectWorkspaceRouteSearch(
  raw: Record<string, unknown>,
): ProjectWorkspaceRouteSearch {
  return { ...validateProjectWorkspaceSearch(raw), ...validateWorkspaceFilterSearch(raw) };
}

/** Search đã validate ⇒ giá trị toolbar (thiếu khoá = mặc định). */
export function workspaceFiltersFromSearch(search: WorkspaceFilterSearch): WorkspaceTaskFilters {
  return {
    q: search.q ?? DEFAULT_WORKSPACE_FILTERS.q,
    status: search.status ?? DEFAULT_WORKSPACE_FILTERS.status,
    priority: search.priority ?? DEFAULT_WORKSPACE_FILTERS.priority,
    overdueOnly: search.overdue ?? DEFAULT_WORKSPACE_FILTERS.overdueOnly,
    sort: search.sort ?? DEFAULT_WORKSPACE_FILTERS.sort,
  };
}

/** `who` trên URL ⇒ selection của rail (`unassigned` ⇒ sentinel nội bộ). */
export function parseWorkspaceWho(raw: unknown): ReadonlySet<string> {
  return new Set(
    whoValues(raw).map((value) =>
      value === WORKSPACE_WHO_UNASSIGNED ? UNASSIGNED_FILTER_VALUE : value,
    ),
  );
}

/** Bật/tắt một người trong selection — trả Set MỚI. */
export function toggleWorkspaceWho(
  selection: ReadonlySet<string>,
  value: string,
): ReadonlySet<string> {
  const next = new Set(selection);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Giá trị toolbar + selection rail ⇒ khoá bộ lọc trên URL (giá trị mặc định KHÔNG ghi). */
export function workspaceFilterSearchFrom(
  filters: WorkspaceTaskFilters,
  selection: ReadonlySet<string>,
): WorkspaceFilterSearch {
  const who = Array.from(selection, (value) =>
    value === UNASSIGNED_FILTER_VALUE ? WORKSPACE_WHO_UNASSIGNED : value,
  );
  return validateWorkspaceFilterSearch({
    q: filters.q,
    status: filters.status,
    priority: filters.priority,
    overdue: filters.overdueOnly,
    sort: filters.sort,
    who: who.join(","),
  });
}

/**
 * URL workspace dự án từ search đã validate. Thứ tự khoá cố định (tab · bộ lọc · task · addMembers)
 * và mã hoá bằng serializer MẶC ĐỊNH của router ⇒ `?q=2024` đọc lại vẫn là chữ, không thành số.
 */
export function buildProjectWorkspaceUrl(
  projectId: string,
  search: ProjectWorkspaceRouteSearch,
): string {
  const ordered: ProjectWorkspaceRouteSearch = {
    tab: search.tab,
    q: search.q,
    status: search.status,
    priority: search.priority,
    overdue: search.overdue,
    sort: search.sort,
    who: search.who,
    task: search.task,
    addMembers: search.addMembers,
  };
  return `/tasks/projects/${projectId}${defaultStringifySearch(ordered)}`;
}
