/**
 * S16-SOCIAL-FE-3B (L5) — tham số URL của `/feed/stats` (`SOC-SCREEN-011`) và tham số gửi `052` / `053`.
 *
 * Màn KHÔNG tự suy lại gì ở đây: đọc search, dựng tham số gửi đi, dựng search kế tiếp khi đổi khoảng / đơn vị
 * đều qua các hàm thuần của file này (khuôn `moderation/lib/moderation-route-search.ts` — đọc docblock ở đó).
 *
 * ┌─ BỐN LUẬT ──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ 1. `from` / `to` là MỘT cặp. 052 trả 400 khi lẻ một vế · ngày không tồn tại · `from > to` · quá 26     │
 * │    tuần sau khi nắn về tuần ISO. Cặp nào không qua CHÍNH `feedEngagementQuerySchema` thì bỏ CẢ HAI —   │
 * │    màn rơi về mặc định của server thay vì gọi 052 với tham số chắc chắn 400.                           │
 * │ 2. Mỗi phần (cặp ngày · `orgUnitId`) được xét RIÊNG: phần này hỏng không kéo theo phần kia.            │
 * │ 3. «Bỏ» một khoá = trả nó với `undefined` TƯỜNG MINH. Router gộp `{ ...thô, ...đầuRa }`; khoá vắng     │
 * │    trong đầu ra thì giá trị THÔ sống sót. Mọi hàm trả search ở đây LUÔN trả đủ ba khoá.                │
 * │ 4. Không ném. `validateSearch` ném = màn lỗi thay cho số liệu chỉ vì URL sửa tay.                      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cặp ngày hợp lệ được GIỮ NGUYÊN VĂN (không nắn về thứ Hai / Chủ nhật ở đây): server tự nắn, và nhãn khoảng
 * trên màn lấy từ `range` server trả — không lấy từ URL.
 */
import { feedEngagementQuerySchema } from "@mediaos/contracts";
import type { FeedEngagementParams } from "@mediaos/web-core";

/** Một khoảng ngày lịch `YYYY-MM-DD` (hai đầu đều tính). */
export interface StatsDateRange {
  from: string;
  to: string;
}

export interface StatsRouteSearch {
  from?: string;
  to?: string;
  orgUnitId?: string;
}

/** Cặp ngày của URL nếu nó qua được schema của 052; ngược lại `null` (bỏ cả hai). */
function datePairOf(from: unknown, to: unknown): StatsDateRange | null {
  if (typeof from !== "string" || typeof to !== "string") return null;
  return feedEngagementQuerySchema.safeParse({ from, to }).success ? { from, to } : null;
}

function orgUnitIdOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return feedEngagementQuerySchema.safeParse({ orgUnitId: value }).success ? value : undefined;
}

/** `validateSearch` của route. Không ném; LUÔN trả đủ ba khoá (luật 3). */
export function validateStatsRouteSearch(raw: Record<string, unknown>): StatsRouteSearch {
  const pair = datePairOf(raw.from, raw.to);
  return { from: pair?.from, to: pair?.to, orgUnitId: orgUnitIdOf(raw.orgUnitId) };
}

/** URL đang mang một khoảng tự chọn (khác mặc định «8 tuần tới hết tuần hiện tại» của server). */
export function hasCustomRange(search: StatsRouteSearch): boolean {
  return search.from !== undefined && search.to !== undefined;
}

/**
 * Tham số gửi `052` / `053` (cũng là `params` của khoá cache `socialKeys.stats.engagement`). Khoá không có
 * giá trị thì VẮNG hẳn (không phải `undefined`): mặc định ⇒ `{}`. `from` lẻ ⇒ không gửi vế nào (luật 1).
 */
export function engagementParams(search: StatsRouteSearch): FeedEngagementParams {
  const range =
    search.from !== undefined && search.to !== undefined
      ? { from: search.from, to: search.to }
      : {};
  const unit = search.orgUnitId !== undefined ? { orgUnitId: search.orgUnitId } : {};
  return { ...range, ...unit };
}

/** Phần tử THAM SỐ của khoá `socialKeys.stats.engagement(params)`: object thuần (mặc định là `{}`). */
function isParamsPart(part: unknown): part is Record<string, unknown> {
  return typeof part === "object" && part !== null && !Array.isArray(part);
}

/**
 * `queryKey` có phải khoá `socialKeys.stats.engagement(…)` của CÙNG bộ lọc đơn vị với `params` không (khoảng
 * tuần khác nhau vẫn là cùng bộ lọc). Màn dùng để quyết định giữ số liệu cũ lúc đang tải: dịch tuần thì giữ
 * (nhãn khoảng trên màn lấy từ chính số liệu đang vẽ nên không lệch), đổi ĐƠN VỊ thì không — số của đơn vị
 * cũ đứng dưới ô chọn đơn vị mới đọc như số của đơn vị mới.
 *
 * Tìm phần tử tham số theo HÌNH DẠNG, không theo vị trí (khuôn `isReportListKeyOfSameFilter`): khoá không
 * mang tham số (tiền tố `allOf()`, hoặc `engagement()` không đối số) ⇒ `false` — nếu coi «không đọc được» là
 * `orgUnitId: undefined` thì nó trùng đúng bộ lọc «tất cả đơn vị».
 */
export function isEngagementKeyOfSameUnit(
  queryKey: readonly unknown[] | undefined,
  params: FeedEngagementParams,
): boolean {
  const keyParams = queryKey?.find(isParamsPart);
  if (keyParams === undefined) return false;
  return keyParams.orgUnitId === params.orgUnitId;
}

/** Search kế tiếp khi đổi khoảng:`null` = về mặc định của server (bỏ `from` + `to`). Giữ đơn vị. */
export function searchForRange(
  search: StatsRouteSearch,
  range: StatsDateRange | null,
): StatsRouteSearch {
  return { from: range?.from, to: range?.to, orgUnitId: search.orgUnitId };
}

/** Search kế tiếp khi đổi / bỏ lọc đơn vị. Giữ khoảng. */
export function searchForOrgUnit(
  search: StatsRouteSearch,
  orgUnitId: string | undefined,
): StatsRouteSearch {
  return { from: search.from, to: search.to, orgUnitId };
}
