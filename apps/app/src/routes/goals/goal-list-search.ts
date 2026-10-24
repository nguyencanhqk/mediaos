/**
 * S20-GOAL-LISTURL-1 (US-GOAL-QL-03) — bộ lọc `/goals` và tab `/goals/$goalId` sống trên URL.
 *
 * F5, Back, «Quay lại» từ chi tiết và link gửi đi đều ra CÙNG góc nhìn. URL chỉ là bộ lọc, KHÔNG phải
 * quyền: server vẫn ép phạm vi `view:goal` ở mỗi lời gọi.
 *
 * Khoá trên URL:
 *  - `period`        — `all` (mọi kỳ) hoặc `<từ>..<đến>` (ngày local `YYYY-MM-DD`, được bỏ trống một
 *                      vế). Lưu khoảng tường minh chứ không lưu «quý này»: link gửi đi tuần sau vẫn ra
 *                      đúng kỳ người gửi đang xem.
 *  - `departmentId`  — uuid phòng ban (`GET /goals` + `/goals/tree`).
 *  - `status` · `level` · `view` (`tree` | `list`) · `mine=1` («Của tôi» ⇒ `GET /me/goals`).
 *  - `risk=1`        — chỉ được giữ trên URL; bộ lọc rủi ro thuộc S20-GOAL-RISKFLAG-1.
 *
 * 🔴 Giá trị tới đây đã qua `JSON.parse` của router (`?mine=1` là SỐ) — bộ đọc nhận cả hai dạng.
 * KHÔNG BAO GIỜ NÉM: tham số rác ⇒ bỏ khoá đó, dùng mặc định (không màn lỗi).
 *
 * Mốc «quý này/năm nay/kỳ trước» theo giờ CÔNG TY (`companyTimeZone()`, S20-FE-COMPANYTZ-1), không theo
 * giờ máy.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import {
  addDaysToLocalDate,
  authApi,
  authKeys,
  companyTimeZone,
  createPermissionChecker,
  quarterRange,
  useAuthStore,
  yearRange,
  type DataScope,
} from "@mediaos/web-core";
import type { GoalStatusDto } from "@mediaos/contracts";
import { GOAL_LEVEL_OPTIONS, GOAL_STATUS_OPTIONS, type GoalLevelOption } from "./constants";

export const GOAL_LIST_VIEWS = ["tree", "list"] as const;
export type GoalListView = (typeof GOAL_LIST_VIEWS)[number];

/** `period` = mọi kỳ. */
export const GOAL_PERIOD_ALL = "all";
const PERIOD_SEPARATOR = "..";

export interface GoalListSearch {
  period?: string;
  departmentId?: string;
  status?: GoalStatusDto;
  level?: GoalLevelOption;
  view?: GoalListView;
  mine?: 1;
  risk?: 1;
}

/** Mọi khoá bộ lọc của danh sách. Không khoá nào có mặt ⇒ «URL trống» (áp mặc định). */
export const GOAL_LIST_FILTER_KEYS = [
  "period",
  "departmentId",
  "status",
  "level",
  "view",
  "mine",
  "risk",
] as const satisfies readonly (keyof GoalListSearch)[];

type SearchRecord = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_PER_QUARTER = 3;
const MONTHS_PER_YEAR = 12;

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Chuỗi uuid (dùng chung với prefill `/goals/new`). */
export function isGoalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function uuidParam(value: unknown): string | undefined {
  return isGoalUuid(value) ? value : undefined;
}

function flagParam(value: unknown): 1 | undefined {
  return value === 1 || value === "1" || value === true || value === "true" ? 1 : undefined;
}

/** Ngày local `YYYY-MM-DD` CÓ THẬT (loại 2026-02-30). */
export function isLocalDate(value: string): boolean {
  const match = LOCAL_DATE_RE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Khoảng kỳ; vế vắng = không chặn phía đó. `{}` = mọi kỳ. */
export interface GoalPeriodRange {
  from?: string;
  to?: string;
}

/** `period` trên URL ⇒ khoảng. Rác (sai dạng, ngày không có thật, từ > đến) ⇒ undefined. */
export function parseGoalPeriod(value: unknown): GoalPeriodRange | undefined {
  if (value === GOAL_PERIOD_ALL) return {};
  if (typeof value !== "string") return undefined;
  const parts = value.split(PERIOD_SEPARATOR);
  if (parts.length !== 2) return undefined;
  const [from = "", to = ""] = parts;
  if (from === "" && to === "") return undefined;
  if ((from !== "" && !isLocalDate(from)) || (to !== "" && !isLocalDate(to))) return undefined;
  if (from !== "" && to !== "" && from > to) return undefined;
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function formatGoalPeriod(range: GoalPeriodRange): string {
  return !range.from && !range.to
    ? GOAL_PERIOD_ALL
    : `${range.from ?? ""}${PERIOD_SEPARATOR}${range.to ?? ""}`;
}

/** `validateSearch` của route `/goals` — rác ⇒ bỏ khoá đó, không ném. */
export function validateGoalListSearch(raw: SearchRecord): GoalListSearch {
  const period = parseGoalPeriod(raw?.period);
  const entries: [keyof GoalListSearch, unknown][] = [
    ["period", period ? formatGoalPeriod(period) : undefined],
    ["departmentId", uuidParam(raw?.departmentId)],
    ["status", oneOf(raw?.status, GOAL_STATUS_OPTIONS)],
    ["level", oneOf(raw?.level, GOAL_LEVEL_OPTIONS)],
    ["view", oneOf(raw?.view, GOAL_LIST_VIEWS)],
    ["mine", flagParam(raw?.mine)],
    ["risk", flagParam(raw?.risk)],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as GoalListSearch;
}

export function hasGoalListFilters(search: GoalListSearch): boolean {
  return GOAL_LIST_FILTER_KEYS.some((key) => search[key] !== undefined);
}

// ── Kỳ chọn nhanh ───────────────────────────────────────────────────────────────────────────────

export type GoalPeriodChip = "previous" | "quarter" | "year";
export const GOAL_PERIOD_CHIPS: readonly GoalPeriodChip[] = ["previous", "quarter", "year"];

/** Ngày đầu quý TRƯỚC quý bắt đầu ở `quarterStart` (`YYYY-MM-01`) — thuần chuỗi. */
function previousQuarterStart(quarterStart: string): string {
  const [y, m] = quarterStart.split("-").map(Number) as [number, number];
  const month = m - MONTHS_PER_QUARTER;
  const [year, mm] = month < 1 ? [y - 1, month + MONTHS_PER_YEAR] : [y, month];
  return `${year}-${String(mm).padStart(2, "0")}-01`;
}

/** Giá trị `period` của ba chip «Kỳ trước / Quý này / Năm nay» tại `now` theo tz công ty. */
export function goalPeriodChips(now: Date, timeZone: string): Record<GoalPeriodChip, string> {
  const quarter = quarterRange(now, timeZone);
  const year = yearRange(now, timeZone);
  return {
    previous: formatGoalPeriod({
      from: previousQuarterStart(quarter.start),
      to: addDaysToLocalDate(quarter.start, -1),
    }),
    quarter: formatGoalPeriod({ from: quarter.start, to: quarter.end }),
    year: formatGoalPeriod({ from: year.start, to: year.end }),
  };
}

// ── Mặc định khi URL trống ─────────────────────────────────────────────────────────────────────

const GOAL_VIEW_PAIR_KEY = "view:goal";

/**
 * Phạm vi `view:goal` rộng hơn Own (Team/Department/Company/System — chuỗi tuyến tính của registry;
 * `Project` là phạm vi ngang nên không tính). Đọc từ `/auth/me.scopes`, khoá vắng ⇒ false.
 */
export function goalViewScopeBeyondOwn(
  scopes: Readonly<Record<string, readonly DataScope[]>>,
): boolean {
  const pairScopes = scopes[GOAL_VIEW_PAIR_KEY];
  if (!pairScopes || pairScopes.length === 0) return false;
  return createPermissionChecker([
    { permission: GOAL_VIEW_PAIR_KEY, scopes: [...pairScopes] },
  ]).hasScope(GOAL_VIEW_PAIR_KEY, "Team");
}

export interface GoalListDefaultsInput {
  /** `period` của quý hiện tại. */
  readonly currentQuarter: string;
  /** Lựa chọn gần nhất đã nhớ (không gồm `period`), null = chưa nhớ. */
  readonly remembered: GoalListSearch | null;
  /** Phòng của tôi — chỉ truyền khi phạm vi `view:goal` rộng hơn Own. */
  readonly myDepartmentId: string | null;
}

/**
 * Bộ lọc cần GHI lên URL (replace) — null nếu URL đã đủ.
 *  - URL trống ⇒ lựa chọn gần nhất (nếu có), không thì phòng của tôi; kỳ luôn là quý hiện tại.
 *  - URL có lọc nhưng thiếu `period` (vd link `?mine=1`) ⇒ chỉ bổ sung quý hiện tại.
 */
export function resolveGoalListDefaults(
  search: GoalListSearch,
  input: GoalListDefaultsInput,
): GoalListSearch | null {
  if (!hasGoalListFilters(search)) {
    const { period: _ignored, ...remembered } = input.remembered ?? {};
    const base: GoalListSearch = input.remembered
      ? remembered
      : input.myDepartmentId
        ? { departmentId: input.myDepartmentId }
        : {};
    return { ...base, period: input.currentQuarter };
  }
  return search.period === undefined ? { ...search, period: input.currentQuarter } : null;
}

// ── Nhớ lựa chọn (localStorage, try/catch) ─────────────────────────────────────────────────────

export const GOAL_LIST_REMEMBER_KEY = "mediaos.goals.list.last";

/** Bộ lọc gần nhất (ĐỦ cả `period`) — nguồn của «Quay lại» từ chi tiết. Bị chặn/hỏng ⇒ null. */
export function readLastGoalListSearch(): GoalListSearch | null {
  try {
    const raw = window.localStorage.getItem(GOAL_LIST_REMEMBER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return validateGoalListSearch(parsed as SearchRecord);
  } catch {
    // Trình duyệt chặn storage hoặc giá trị hỏng: coi như chưa nhớ (URL vẫn là nguồn chính).
    return null;
  }
}

export function rememberGoalListSearch(search: GoalListSearch): void {
  try {
    window.localStorage.setItem(GOAL_LIST_REMEMBER_KEY, JSON.stringify(search));
  } catch {
    // Storage bị chặn/đầy: bỏ nhớ, không ảnh hưởng màn hình.
  }
}

// ── Ghi URL ────────────────────────────────────────────────────────────────────────────────────

/** Áp patch lên search HIỆN TẠI (giữ khoá khác, vd `task` của drawer). undefined ⇒ bỏ khoá. */
export function patchGoalListSearch(
  prev: SearchRecord,
  patch: Partial<GoalListSearch>,
): SearchRecord {
  const next: SearchRecord = Object.fromEntries(
    Object.entries(prev ?? {}).filter(([key]) => !(key in patch)),
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

/** Thay TOÀN BỘ khoá lọc (kể cả giá trị rác còn trên URL) bằng `filters`, giữ khoá khác. */
export function replaceGoalListFilters(prev: SearchRecord, filters: GoalListSearch): SearchRecord {
  const drop = new Set<string>(GOAL_LIST_FILTER_KEYS);
  const rest = Object.fromEntries(Object.entries(prev ?? {}).filter(([key]) => !drop.has(key)));
  return { ...rest, ...filters };
}

/**
 * Bộ lọc ĐỌC/GHI trên URL — đọc search qua CÙNG hàm validate của route (giá trị rác không lọt tới API);
 * `update` = PUSH (Back hoàn tác), `replaceFilters` = REPLACE (áp mặc định).
 *
 * 🔴 Đọc search của MATCH `/goals` (match gần nhất của trang), KHÔNG đọc `location` toàn cục: khi rời
 * trang (Back, bấm dòng, link) router đổi `location` TRƯỚC khi gỡ trang danh sách. Đọc `location` lúc đó
 * thấy search rỗng của trang đích ⇒ tưởng «URL trống» ⇒ ghi mặc định (replace) đè lên URL trang đích
 * (`/goals/{id}?departmentId…`, `/home?period…`). Match giữ search của chính nó tới lúc trang bị gỡ.
 */
export function useGoalListSearch() {
  const navigate = useNavigate();
  const raw = useSearch({ strict: false }) as SearchRecord | undefined;
  const search = useMemo(() => validateGoalListSearch((raw ?? {}) as SearchRecord), [raw]);
  const update = useCallback(
    (patch: Partial<GoalListSearch>) =>
      void navigate({
        to: ".",
        search: ((prev: SearchRecord) => patchGoalListSearch(prev, patch)) as never,
        resetScroll: false,
      }),
    [navigate],
  );
  const replaceFilters = useCallback(
    (filters: GoalListSearch) =>
      void navigate({
        to: ".",
        search: ((prev: SearchRecord) => replaceGoalListFilters(prev, filters)) as never,
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  );
  return { search, update, replaceFilters };
}

/**
 * Áp mặc định khi URL trống/thiếu kỳ rồi nhớ lựa chọn. Trả `true` khi URL đã có `period` — trang chỉ
 * tải dữ liệu từ lúc đó (không có lượt tải «mọi kỳ» thừa trước khi mặc định được ghi).
 *
 * `enabled=false` (thiếu `view:goal`) ⇒ không đọc storage, không gọi `/auth/me`, không ghi URL.
 */
export function useGoalListDefaults(
  search: GoalListSearch,
  replaceFilters: (filters: GoalListSearch) => void,
  enabled: boolean,
): boolean {
  const scopes = useAuthStore((s) => s.scopes);
  const beyondOwn = goalViewScopeBeyondOwn(scopes);
  const needsDefaults = enabled && !hasGoalListFilters(search);
  const remembered = useMemo(
    () => (needsDefaults ? readLastGoalListSearch() : null),
    [needsDefaults],
  );
  const needsDepartment = needsDefaults && remembered === null && beyondOwn;
  const meQuery = useQuery({
    queryKey: authKeys.me(),
    queryFn: () => authApi.me(),
    enabled: needsDepartment,
    staleTime: 300_000,
  });
  const waitingForMe = needsDepartment && !meQuery.isSuccess && !meQuery.isError;
  const currentQuarter = useMemo(() => goalPeriodChips(new Date(), companyTimeZone()).quarter, []);

  const next = useMemo(() => {
    if (!enabled || waitingForMe) return null;
    const myDepartmentId = needsDepartment ? (meQuery.data?.employee?.departmentId ?? null) : null;
    return resolveGoalListDefaults(search, { currentQuarter, remembered, myDepartmentId });
  }, [enabled, waitingForMe, needsDepartment, meQuery.data, search, currentQuarter, remembered]);

  useEffect(() => {
    if (next) replaceFilters(next);
  }, [next, replaceFilters]);

  const ready = enabled && search.period !== undefined;
  useEffect(() => {
    if (ready) rememberGoalListSearch(search);
  }, [ready, search]);
  return ready;
}

// ── Chi tiết: tab trên URL ─────────────────────────────────────────────────────────────────────

export const GOAL_DETAIL_TABS = ["overview", "linked", "children", "checkins"] as const;
export type GoalDetailTab = (typeof GOAL_DETAIL_TABS)[number];
const DEFAULT_DETAIL_TAB: GoalDetailTab = "overview";

export interface GoalDetailSearch {
  tab?: GoalDetailTab;
}

/** `validateSearch` của `/goals/$goalId` — tab rác ⇒ bỏ (về Tổng quan), không ném. */
export function validateGoalDetailSearch(raw: SearchRecord): GoalDetailSearch {
  const tab = oneOf(raw?.tab, GOAL_DETAIL_TABS);
  return tab && tab !== DEFAULT_DETAIL_TAB ? { tab } : {};
}

/** Đặt `tab` lên search hiện tại (Tổng quan ⇒ bỏ khoá), giữ khoá khác. */
export function withDetailTab(prev: SearchRecord, tab: GoalDetailTab): SearchRecord {
  const rest = Object.fromEntries(Object.entries(prev ?? {}).filter(([key]) => key !== "tab"));
  return tab === DEFAULT_DETAIL_TAB ? rest : { ...rest, tab };
}

/** Tab đang mở + đổi tab (REPLACE: Back từ chi tiết về thẳng danh sách, không đi lùi qua từng tab). */
export function useGoalDetailTab(): [GoalDetailTab, (tab: GoalDetailTab) => void] {
  const navigate = useNavigate();
  const raw = useRouterState({ select: (s) => s.location.search });
  const tab = validateGoalDetailSearch((raw ?? {}) as SearchRecord).tab ?? DEFAULT_DETAIL_TAB;
  const setTab = useCallback(
    (next: GoalDetailTab) =>
      void navigate({
        to: ".",
        search: ((prev: SearchRecord) => withDetailTab(prev, next)) as never,
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  );
  return [tab, setTab];
}

/** Search của «Quay lại» từ chi tiết: bộ lọc gần nhất của danh sách (rỗng ⇒ trang tự áp mặc định). */
export function goalListBackSearch(): GoalListSearch {
  return readLastGoalListSearch() ?? {};
}
