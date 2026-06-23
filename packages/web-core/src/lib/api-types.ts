/**
 * api-types.ts — Kiểu dữ liệu chuẩn cho API client (FRONTEND-04 §9).
 *
 * DEDUP: ErrorDetail / Pagination / ResponseMeta được re-export NAMED từ @mediaos/contracts
 * (KHÔNG `export *` — contracts cũng export type `ApiError` trùng tên class ApiError của web-core).
 *
 * Các kiểu RIÊNG web-core (discriminated literals / request opts / list params) được giữ ở đây.
 */

// ── Re-export NAMED từ contracts (KHÔNG wildcard — tránh đụng tên ApiError) ──
// Import cục bộ để DÙNG LẠI trong các interface bên dưới (chống drift DTO — CLAUDE.md §4),
// rồi re-export với alias cho downstream.
import type { ErrorDetail, Pagination, ResponseMeta } from "@mediaos/contracts";

export type {
  ErrorDetail as ApiValidationDetail,
  Pagination as ApiPagination,
  ResponseMeta as ApiMeta,
};

// ── Response envelope (discriminated literal — contracts chỉ có Zod schema, không export dạng này;
//    nhưng meta/pagination/details DÙNG LẠI type contracts, KHÔNG khai lại inline) ──

export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  meta: ResponseMeta;
  pagination?: Pagination;
}

export type ApiListResponse<T> = ApiSuccessResponse<T[]> & {
  pagination: Pagination;
};

// ── Error response envelope ───────────────────────────────────────────────────

export interface ApiErrorPayload {
  code: string;
  /** Tên class exception (API-01 §12.1) — optional, khớp apiErrorSchema của contracts. */
  type?: string;
  details?: ErrorDetail[] | null;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  error: ApiErrorPayload;
  meta: ResponseMeta;
}

// ── Request options ───────────────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequestOptions<TBody = unknown> {
  method?: HttpMethod;
  query?: Record<string, unknown>;
  body?: TBody;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  requireAuth?: boolean;
  idempotencyKey?: string;
  skipRefreshAuth?: boolean;
  responseType?: "json" | "blob" | "text";
}

// ── List params ───────────────────────────────────────────────────────────────

/**
 * Params chuẩn cho API list (FRONTEND-04 §9.5, API-01 §17).
 *
 * Lưu ý: list nghiệp vụ (HR/ATT/LEAVE/TASK/NOTI) dùng `search`.
 * List FOUNDATION/admin (companies, modules, audit-logs) dùng `keyword` (API-09).
 * Module API service phải map `search` → `keyword` khi gọi FOUNDATION endpoint.
 */
export interface ApiListParams {
  page?: number;
  per_page?: number;
  search?: string;
  /** Kết hợp field + direction: `created_at:desc` (API-01 §17.3). */
  sort?: string;
  filters?: Record<string, string | number | boolean | string[] | null | undefined>;
}

/** State table cho TanStack Table — convert sang ApiListParams qua `toApiListParams()`. */
export interface TableQueryState {
  page: number;
  per_page: number;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, unknown>;
}

/** Chuyển TableQueryState sang ApiListParams (FRONTEND-04 §25.2). */
export function toApiListParams(state: TableQueryState): ApiListParams {
  const sort = state.sort ? `${state.sort}:${state.order ?? "asc"}` : undefined;

  return {
    page: state.page,
    per_page: state.per_page,
    search: state.search?.trim() || undefined,
    sort,
    filters: state.filters as ApiListParams["filters"],
  };
}
