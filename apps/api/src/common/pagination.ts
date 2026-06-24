import type { Pagination } from "@mediaos/contracts";

/**
 * S1-FND-WIRE-DRIFT-1 — pagination block top-level (API-01 §16.1), KHÔNG nhét vào `meta`.
 *
 * Controller trả `paginated(data, pagination)` (tagged) → ResponseEnvelopeInterceptor HOIST `pagination` lên
 * cấp đỉnh envelope: { success, message, data, error, meta, pagination }. Tag bằng Symbol (KHÔNG va field
 * dữ liệu thật) ⇒ endpoint KHÔNG phân trang KHÔNG bao giờ bị hoist nhầm (đổi interceptor ADDITIVE, an toàn).
 */
export const PAGINATED = Symbol("paginated-result");

export interface PaginatedResult<T> {
  readonly [PAGINATED]: true;
  data: T;
  pagination: Pagination;
}

/** Đóng gói kết quả phân trang (tagged) cho interceptor hoist. */
export function paginated<T>(data: T, pagination: Pagination): PaginatedResult<T> {
  return { [PAGINATED]: true, data, pagination };
}

export function isPaginated(value: unknown): value is PaginatedResult<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[PAGINATED] === true
  );
}

/** Dựng block pagination chuẩn (API-01 §16.1) từ total + page + per_page (1-based). */
export function toPagination(total: number, page: number, perPage: number): Pagination {
  const safePer = perPage > 0 ? perPage : 1;
  const totalPages = total > 0 ? Math.ceil(total / safePer) : 0;
  return {
    page,
    per_page: perPage,
    total,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1,
  };
}

/** Tiện ích: dựng pagination từ offset/limit (audit dùng offset). page = floor(offset/limit)+1. */
export function toPaginationFromOffset(total: number, offset: number, limit: number): Pagination {
  const safeLimit = limit > 0 ? limit : 1;
  const page = Math.floor(offset / safeLimit) + 1;
  return toPagination(total, page, limit);
}
