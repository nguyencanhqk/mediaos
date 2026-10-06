/**
 * S16-SOCIAL-FE-3B (L5) — phép gộp số liệu của màn Thống kê tương tác (plan D12). Hàm thuần, không sửa đầu vào.
 *
 * Hình dạng 052 (`apps/api/src/social/social-stats.repository.ts`):
 *  · `weekTotals` DÀY — mỗi tuần của khoảng đúng một hàng (tuần không hoạt động là hàng số 0), xếp tăng dần.
 *  · `rows` THƯA — chỉ ô tuần × đơn vị CÓ hoạt động. Đơn vị không có hàng nào vẫn phải hiện với số 0.
 *  · `units` — mọi đơn vị trong phạm vi của người xem, KỂ CẢ khi đang lọc một đơn vị.
 *
 * ┌─ 🔴 `activeMembers` KHÔNG CỘNG ĐƯỢC ───────────────────────────────────────────────────────────────┐
 * │ Đó là số người DISTINCT của một tuần (hoặc một ô tuần × đơn vị). Cộng qua các tuần / các đơn vị là   │
 * │ đếm một người nhiều lần. Vì vậy: thẻ «thành viên hoạt động» lấy hàng `weekTotals` CUỐI             │
 * │ (`latestWeek`), và bảng «Theo đơn vị» KHÔNG có cột thành viên (`EngagementTotals` không mang nó).   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import type {
  FeedEngagementResponseDto,
  FeedEngagementRowDto,
  FeedEngagementWeekDto,
} from "@mediaos/contracts";

/** Ba số đếm cộng dồn được. */
export interface EngagementTotals {
  posts: number;
  comments: number;
  reactions: number;
}

/**
 * Loại hàng của bảng «Theo đơn vị»:
 *  · `unit` — một đơn vị của `units`;
 *  · `unassigned` — các hàng `orgUnitId: null` (người chưa gán đơn vị — chỉ có ở phạm vi công ty);
 *  · `unknown` — hàng mang đơn vị KHÔNG có trong `units`. Server không sinh ca này; giữ lại để số liệu lệch
 *    hợp đồng hiện ra thành một hàng thay vì biến mất (tổng bảng vẫn khớp ba thẻ tổng).
 */
export type UnitTotalKind = "unit" | "unassigned" | "unknown";

export interface UnitTotalRow extends EngagementTotals {
  /** Khoá hàng cho React: `orgUnitId` của đơn vị, hoặc chính `kind` với hai hàng đặc biệt. */
  key: string;
  kind: UnitTotalKind;
  /** Tên đơn vị; `null` với `unassigned` / `unknown` (nhãn là việc của i18n). */
  name: string | null;
  isDeleted: boolean;
}

type EngagementData = Pick<FeedEngagementResponseDto, "units" | "rows">;

const ZERO: EngagementTotals = { posts: 0, comments: 0, reactions: 0 };

const NUMBER_FORMAT = new Intl.NumberFormat("vi-VN");

function add(total: EngagementTotals, part: EngagementTotals): EngagementTotals {
  return {
    posts: total.posts + part.posts,
    comments: total.comments + part.comments,
    reactions: total.reactions + part.reactions,
  };
}

function sum(parts: readonly EngagementTotals[]): EngagementTotals {
  return parts.reduce(add, { ...ZERO });
}

/** Ba thẻ tổng: cộng bài · bình luận · cảm xúc qua các tuần của khoảng. */
export function sumWeekTotals(weekTotals: readonly FeedEngagementWeekDto[]): EngagementTotals {
  return sum(weekTotals);
}

/**
 * Tuần GẦN NHẤT của khoảng (hàng `weekTotals` cuối) — nguồn của thẻ «thành viên hoạt động». Tuần cuối không
 * ai hoạt động thì vẫn là tuần đó với số 0: không lùi về tuần có số. `null` khi không có tuần nào.
 */
export function latestWeek(
  weekTotals: readonly FeedEngagementWeekDto[],
): FeedEngagementWeekDto | null {
  return weekTotals.at(-1) ?? null;
}

/** Tổng tương tác của một tuần (bài + bình luận + cảm xúc) — giá trị vẽ trên biểu đồ xu hướng. */
export function weekInteractions(week: EngagementTotals): number {
  return week.posts + week.comments + week.reactions;
}

function specialRow(
  kind: Exclude<UnitTotalKind, "unit">,
  rows: readonly FeedEngagementRowDto[],
): UnitTotalRow[] {
  return rows.length === 0 ? [] : [{ key: kind, kind, name: null, isDeleted: false, ...sum(rows) }];
}

/**
 * Hàng của bảng «Theo đơn vị»: gộp `rows` theo đơn vị qua mọi tuần. Thứ tự = `units` của server, rồi
 * `unknown`, rồi `unassigned`.
 *
 * `onlyOrgUnitId` = đơn vị đang LỌC: chỉ trả hàng của đơn vị đó — `units` vẫn mang mọi đơn vị trong phạm vi
 * còn `rows` chỉ có đơn vị đang lọc, vẽ cả bảng thì các đơn vị khác hiện như thể bằng 0.
 */
export function unitTotals(data: EngagementData, onlyOrgUnitId?: string): UnitTotalRow[] {
  const units =
    onlyOrgUnitId === undefined
      ? data.units
      : data.units.filter((unit) => unit.orgUnitId === onlyOrgUnitId);
  const unitRows = units.map(
    (unit): UnitTotalRow => ({
      key: unit.orgUnitId,
      kind: "unit",
      name: unit.name,
      isDeleted: unit.isDeleted,
      ...sum(data.rows.filter((row) => row.orgUnitId === unit.orgUnitId)),
    }),
  );
  if (onlyOrgUnitId !== undefined) return unitRows;

  const knownIds = new Set(data.units.map((unit) => unit.orgUnitId));
  const unassigned = data.rows.filter((row) => row.orgUnitId === null);
  const unknown = data.rows.filter((row) => row.orgUnitId !== null && !knownIds.has(row.orgUnitId));
  return [...unitRows, ...specialRow("unknown", unknown), ...specialRow("unassigned", unassigned)];
}

/**
 * 200 RỖNG: người xem chưa có đơn vị nào trong phạm vi thống kê. KHÁC «không có quyền» (403) và khác «có đơn
 * vị nhưng chưa có hoạt động» (khi đó vẫn vẽ bảng số 0).
 */
export function isEngagementEmpty(data: EngagementData): boolean {
  return data.units.length === 0 && data.rows.length === 0;
}

/** Số đếm viết kiểu Việt (dấu chấm ngăn nghìn). */
export function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}
