/**
 * S20-TASK-MYTASKS-1 (US-TASK-NV-01, SPEC-06 §13.9 TASK-SCREEN-009) — «Việc của tôi» trả lời «hôm nay
 * làm gì»: nhóm CLIENT-SIDE trên DTO sẵn có của `GET /tasks/my` (không đổi API).
 *
 * Bất biến:
 * - Mỗi việc rơi vào ĐÚNG MỘT nhóm, xét theo thứ tự {@link MY_TASK_GROUP_KEYS}: đã đóng ⇒ «Đã xong»;
 *   `isOverdue` của SERVER ⇒ «Quá hạn» (kể cả hạn 09:00 hôm nay — FE không tự suy quá hạn, nên không
 *   lệch với cờ server tính); hạn hôm nay ⇒ «Hôm nay»; hạn trong {@link MY_TASKS_UPCOMING_DAYS} ngày
 *   kế ⇒ «Sắp đến hạn»; còn lại theo trạng thái.
 * - «Hôm nay» là ngày local theo GIỜ CÔNG TY (`timeZone` truyền vào — màn dùng `companyTimeZone()`),
 *   không bao giờ theo múi máy: hai người cùng phòng phải thấy cùng một nhóm.
 * - Hàm THUẦN: `now` + `timeZone` là tham số, không đọc đồng hồ ⇒ spec chạy được dưới mọi `TZ` máy.
 * - Giữ thứ tự sắp xếp của server trong từng nhóm.
 */
import type { MyTaskItemDto, TaskCoreSourceDto } from "@mediaos/contracts";
import { addDaysToLocalDate, localDateOf, todayLocal } from "@mediaos/web-core";
import { MY_TASKS_UPCOMING_DAYS, TASK_CORE_CLOSED_STATUSES } from "./constants";

/** Thứ tự nhóm trên màn. «done» chỉ hiện khi bật «Hiện việc đã xong». */
export const MY_TASK_GROUP_KEYS = [
  "overdue",
  "today",
  "upcoming",
  "inProgress",
  "inReview",
  "other",
  "done",
] as const;
export type MyTaskGroupKey = (typeof MY_TASK_GROUP_KEYS)[number];

/** Chip nguồn — cùng tập giá trị `source` mà server gắn cho mỗi dòng. */
export const MY_TASK_SOURCE_OPTIONS: readonly TaskCoreSourceDto[] = [
  "assigned",
  "created",
  "watched",
];

export interface MyTaskGroup {
  readonly key: MyTaskGroupKey;
  readonly items: readonly MyTaskItemDto[];
}

export interface GroupMyTasksOptions {
  /** Mốc «bây giờ» (màn truyền thời điểm tải dữ liệu — cùng mốc server tính `isOverdue`). */
  readonly now: Date;
  /** Múi IANA của mốc nghiệp vụ (màn truyền `companyTimeZone()`). */
  readonly timeZone: string;
  readonly showDone: boolean;
}

/** Ngày local của hạn; hạn trống hoặc không đọc được ⇒ null (coi như không có hạn, không làm sập màn). */
function dueLocalDate(item: MyTaskItemDto, timeZone: string): string | null {
  if (!item.dueAt) return null;
  const due = new Date(item.dueAt);
  return Number.isNaN(due.getTime()) ? null : localDateOf(due, timeZone);
}

function classify(
  item: MyTaskItemDto,
  today: string,
  upcomingEnd: string,
  timeZone: string,
): MyTaskGroupKey {
  if (item.status !== null && TASK_CORE_CLOSED_STATUSES.includes(item.status)) return "done";
  if (item.isOverdue) return "overdue";
  const due = dueLocalDate(item, timeZone);
  // So chuỗi `YYYY-MM-DD` = so ngày (cùng độ dài, số đệm 0).
  if (due === today) return "today";
  if (due !== null && due > today && due <= upcomingEnd) return "upcoming";
  if (item.status === "In Progress") return "inProgress";
  if (item.status === "In Review") return "inReview";
  return "other";
}

/** Nhóm theo {@link MY_TASK_GROUP_KEYS}; trả cả nhóm rỗng (màn tự thu gọn). */
export function groupMyTasks(
  items: readonly MyTaskItemDto[],
  { now, timeZone, showDone }: GroupMyTasksOptions,
): MyTaskGroup[] {
  const today = todayLocal(now, timeZone);
  const upcomingEnd = addDaysToLocalDate(today, MY_TASKS_UPCOMING_DAYS);
  const buckets = new Map<MyTaskGroupKey, MyTaskItemDto[]>(
    MY_TASK_GROUP_KEYS.map((key) => [key, []]),
  );
  for (const item of items) buckets.get(classify(item, today, upcomingEnd, timeZone))?.push(item);
  return MY_TASK_GROUP_KEYS.filter((key) => showDone || key !== "done").map((key) => ({
    key,
    items: buckets.get(key) ?? [],
  }));
}

/** Bỏ dấu tiếng Việt + hạ chữ: «Đọc BÁO cáo» ⇒ «doc bao cao». */
function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

export interface MyTasksFilter {
  readonly source?: TaskCoreSourceDto;
  /** Lọc nhanh theo tiêu đề — không phân biệt hoa thường và dấu. */
  readonly query?: string;
}

export function filterMyTasks(
  items: readonly MyTaskItemDto[],
  { source, query }: MyTasksFilter,
): MyTaskItemDto[] {
  const needle = foldText(query?.trim() ?? "");
  return items.filter(
    (item) =>
      (source === undefined || item.source === source) &&
      (needle === "" || foldText(item.title).includes(needle)),
  );
}

// ── Bộ lọc trên URL: `?group=&source=&showDone=` ─────────────────────────────────────────────────

export interface MyTasksSearch {
  group?: MyTaskGroupKey;
  source?: TaskCoreSourceDto;
  /** `?showDone=1` — router đã `JSON.parse` nên tới đây có thể là số 1. */
  showDone?: 1;
}

/** Khoá bộ lọc của trang — «Xoá bộ lọc» bỏ `group` + `source` (công tắc `showDone` giữ nguyên). */
export const MY_TASKS_FILTER_KEYS = [
  "group",
  "source",
] as const satisfies readonly (keyof MyTasksSearch)[];

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function flagParam(value: unknown): 1 | undefined {
  return value === 1 || value === "1" || value === true || value === "true" ? 1 : undefined;
}

/** `validateSearch` của route `/tasks/my-tasks` — rác ⇒ bỏ khoá đó, KHÔNG ném. */
export function validateMyTasksSearch(raw: Record<string, unknown>): MyTasksSearch {
  const entries: [keyof MyTasksSearch, unknown][] = [
    ["group", oneOf(raw.group, MY_TASK_GROUP_KEYS)],
    ["source", oneOf(raw.source, MY_TASK_SOURCE_OPTIONS)],
    ["showDone", flagParam(raw.showDone)],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as MyTasksSearch;
}

type SearchRecord = Record<string, unknown>;

/** Áp thay đổi lên search HIỆN TẠI của URL, giữ tham số khác (vd `?task=` của drawer); undefined ⇒ bỏ khoá. */
export function patchMyTasksSearch(
  prev: SearchRecord,
  patch: Partial<MyTasksSearch>,
): SearchRecord {
  const next: SearchRecord = Object.fromEntries(
    Object.entries(prev ?? {}).filter(([key]) => !(key in patch)),
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}
