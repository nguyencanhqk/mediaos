/**
 * api-params.ts — Serialise query params thành URL query string (FRONTEND-04 §12).
 *
 * Hỗ trợ:
 * - Giá trị đơn (string, number, boolean)
 * - Array → multi-value: `status=a&status=b`
 * - Object lồng → bracket notation: `filters[dept]=uuid`
 * - Bỏ qua undefined/null/chuỗi rỗng
 */

/**
 * Thêm 1 cặp key-value vào URLSearchParams (đệ quy cho array + object).
 * @internal
 */
function appendQueryParam(
  params: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null || value === "") return;

  if (Array.isArray(value)) {
    for (const item of value) appendQueryParam(params, key, item);
    return;
  }

  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      appendQueryParam(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  params.append(key, String(value));
}

/**
 * Chuyển object params thành query string (có dấu `?` ở đầu, trả `""` nếu rỗng).
 *
 * @example
 * buildQueryString({ page: 1, search: 'Nguyen', filters: { status: 'active' } })
 * // → "?page=1&search=Nguyen&filters%5Bstatus%5D=active"
 */
export function buildQueryString(query?: Record<string, unknown>): string {
  if (!query) return "";

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    appendQueryParam(params, key, value);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}
