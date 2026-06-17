import type { ListCompaniesParams } from "@/lib/platform-companies-api";

/** Query-key gốc cho danh sách công ty — dùng để invalidate sau mọi mutation. */
export const COMPANIES_QUERY_KEY = ["platform-companies"] as const;

/** Query-key đầy đủ kèm tham số filter/paginate (mỗi tổ hợp params là 1 cache entry riêng). */
export function companiesQueryKey(params: ListCompaniesParams) {
  return [...COMPANIES_QUERY_KEY, params] as const;
}
