import { addDaysToLocalDate, localDateOf, todayLocal } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import {
  DEFAULT_DEADLINE_TIME,
  THIS_FRIDAY_PRESET,
  type DeadlinePresetDefinition,
} from "./deadline-presets";

/**
 * S20-TASK-OVERDUEDESK-1 (US-TASK-QL-07) — hàm THUẦN của trang Việc quá hạn («bàn xử lý»).
 *
 * Mọi phép tính ngày nhận `now` + `timeZone` làm tham số (không đọc đồng hồ, không đọc múi máy):
 * «trễ bao nhiêu ngày» là khoảng cách NGÀY LỊCH theo giờ công ty giữa hạn và hôm nay — cùng quy ước
 * với cờ quá hạn và nhóm «Việc của tôi» (S20-FE-COMPANYTZ-1).
 *
 * Lọc Dự án / Người / «Tôi giao» chạy trên các dòng ĐÃ TẢI (trang tải trọn tối đa 200 dòng): bộ lọc
 * chỉ THU HẸP thứ server đã trả trong phạm vi đọc của người xem, không mở thêm dữ liệu nào.
 */

const DAY_MS = 86_400_000;

/** Giá trị lọc «Không thuộc dự án» / «Chưa giao» (không trùng được uuid). */
export const OVERDUE_FILTER_NONE = "__none__";

/** So sánh `dueAt` TĂNG DẦN — việc trễ lâu nhất lên đầu; không có hạn xuống cuối. */
export function byDueAtAsc(a: TaskCoreResponseDto, b: TaskCoreResponseDto): number {
  if (!a.dueAt) return b.dueAt ? 1 : 0;
  if (!b.dueAt) return -1;
  return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
}

/** Số thứ tự ngày của một ngày local `YYYY-MM-DD` — thuần chuỗi qua `Date.UTC`, không đụng múi. */
function dayNumber(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/**
 * Việc trễ bao nhiêu NGÀY theo giờ công ty: `0` = hạn đã qua nhưng vẫn trong hôm nay. `null` khi
 * không có hạn, hạn hỏng, hoặc hạn còn ở tương lai (vừa dời xong, đang chờ server xác nhận).
 */
export function overdueDaysOf(dueAt: string | null, now: Date, timeZone: string): number | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime()) || due.getTime() > now.getTime()) return null;
  return Math.max(0, dayNumber(todayLocal(now, timeZone)) - dayNumber(localDateOf(due, timeZone)));
}

/** «+N ngày» = hôm nay (giờ công ty) cộng N ngày, 17:00 — dời TỪ HÔM NAY, không từ hạn đã trễ. */
function plusDaysPreset(id: string, days: number, labelKey: string): DeadlinePresetDefinition {
  return {
    id,
    resolve: (ctx) => ({
      localDate: addDaysToLocalDate(ctx.today, days),
      time: DEFAULT_DEADLINE_TIME,
      labelKey,
    }),
  };
}

export const PLUS_ONE_DAY_PRESET = plusDaysPreset("plus1d", 1, "plusOneDay");
export const PLUS_THREE_DAYS_PRESET = plusDaysPreset("plus3d", 3, "plusThreeDays");

/** Mốc riêng của trang Quá hạn — truyền vào `DeadlineQuickPicker` (kèm «Tuỳ chỉnh» = chọn ngày). */
export const OVERDUE_DEADLINE_PRESETS: readonly DeadlinePresetDefinition[] = [
  PLUS_ONE_DAY_PRESET,
  PLUS_THREE_DAYS_PRESET,
  THIS_FRIDAY_PRESET,
];

export interface OverdueDeskFilters {
  /** `projectId`, {@link OVERDUE_FILTER_NONE} (không thuộc dự án) hoặc `null` (mọi dự án). */
  readonly project: string | null;
  /** `mainAssigneeEmployeeId`, {@link OVERDUE_FILTER_NONE} (chưa giao) hoặc `null` (mọi người). */
  readonly assignee: string | null;
  /** «Tôi giao» — `creatorUserId` là người đang đăng nhập. */
  readonly mine: boolean;
}

export const EMPTY_OVERDUE_FILTERS: OverdueDeskFilters = {
  project: null,
  assignee: null,
  mine: false,
};

export function hasOverdueFilters(filters: OverdueDeskFilters): boolean {
  return filters.project !== null || filters.assignee !== null || filters.mine;
}

function matchesValue(value: string | null, wanted: string | null): boolean {
  if (wanted === null) return true;
  return wanted === OVERDUE_FILTER_NONE ? value === null : value === wanted;
}

/**
 * Lọc các dòng đã tải, giữ nguyên thứ tự. «Tôi giao» khi chưa biết tôi là ai (`myUserId` null) ⇒ rỗng
 * — không đoán, không bỏ qua bộ lọc.
 */
export function filterOverdueRows(
  rows: readonly TaskCoreResponseDto[],
  filters: OverdueDeskFilters,
  myUserId: string | null,
): TaskCoreResponseDto[] {
  if (filters.mine && !myUserId) return [];
  return rows.filter(
    (row) =>
      matchesValue(row.projectId, filters.project) &&
      matchesValue(row.mainAssigneeEmployeeId, filters.assignee) &&
      (!filters.mine || row.creatorUserId === myUserId),
  );
}

export interface OverdueFilterOption {
  readonly id: string;
  readonly name: string;
}

export interface OverdueFilterOptions {
  readonly projects: OverdueFilterOption[];
  readonly assignees: OverdueFilterOption[];
  readonly hasNoProject: boolean;
  readonly hasUnassigned: boolean;
}

function collect(entries: ReadonlyArray<readonly [string | null, string | null]>) {
  const byId = new Map<string, string>();
  let hasEmpty = false;
  for (const [id, name] of entries) {
    if (id === null) hasEmpty = true;
    else if (!byId.has(id)) byId.set(id, name ?? id);
  }
  const options = [...byId].map(([id, name]) => ({ id, name }));
  options.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return { options, hasEmpty };
}

/**
 * Lựa chọn của MỘT ô lọc, luôn chứa giá trị đang lọc. Việc cuối cùng mang giá trị đó vừa rời danh
 * sách (dời hạn xong) thì bộ lọc VẪN áp dụng ⇒ ô phải hiện đúng thứ đang lọc, không nhảy về «Tất cả».
 * Tên lấy từ `remembered` (lựa chọn lúc người dùng chọn) khi đúng id; không có thì hiện id.
 */
export function keepSelectedOption(
  options: readonly OverdueFilterOption[],
  hasEmpty: boolean,
  selected: string | null,
  remembered: OverdueFilterOption | undefined,
): { options: OverdueFilterOption[]; hasEmpty: boolean } {
  if (selected === OVERDUE_FILTER_NONE) return { options: [...options], hasEmpty: true };
  if (selected === null || options.some((option) => option.id === selected)) {
    return { options: [...options], hasEmpty };
  }
  const name = remembered?.id === selected ? remembered.name : selected;
  return { options: [...options, { id: selected, name }], hasEmpty };
}

/** Lựa chọn của hai ô lọc — lấy từ chính các dòng đã tải (không gọi thêm API, không cần quyền khác). */
export function overdueFilterOptions(rows: readonly TaskCoreResponseDto[]): OverdueFilterOptions {
  const projects = collect(rows.map((r) => [r.projectId, r.projectName] as const));
  const assignees = collect(rows.map((r) => [r.mainAssigneeEmployeeId, r.assigneeName] as const));
  return {
    projects: projects.options,
    assignees: assignees.options,
    hasNoProject: projects.hasEmpty,
    hasUnassigned: assignees.hasEmpty,
  };
}
