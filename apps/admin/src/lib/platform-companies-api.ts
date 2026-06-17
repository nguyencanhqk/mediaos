import { z } from "zod";
import {
  companySubscriptionSchema,
  companySummarySchema,
  provisionResultSchema,
  type CompanyStatus,
  type CompanySubscriptionDto,
  type CompanySummaryDto,
  type CreateCompanyRequest,
  type SetSubscriptionRequest,
  type UpdateCompanyRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Operator API client cho platform company management (AC-1).
 *
 * Map 1-1 vào `PlatformCompanyController` (`@Controller("admin/platform/companies")`) — các route
 * CHÉO TENANT (escape-hatch `companies` + `withTenant(target)`). `apiFetch` tự gắn Bearer + gỡ
 * envelope + Zod-parse. Mọi schema item TÁI DÙNG từ `@mediaos/contracts` (KHÔNG redefine).
 *
 * Permission (server ép, FE chỉ gate UI):
 *   - list/get      → `view:platform-company`   (is_sensitive)
 *   - create/suspend/configure → `manage:platform-company`   (is_sensitive)
 *   - set-subscription (đổi gói) → `manage:platform-subscription` (is_sensitive)
 *
 * Masking: chỉ render field server gửi về (CompanySummaryDto/CompanySubscriptionDto). Field nhạy cảm
 * server không trả ⇒ client không có để lộ (CLAUDE.md §5 mask-by-server).
 */

const BASE = "/admin/platform/companies";

/** Service trả bare `{ items, total, page, limit }` (KHÔNG bọc paginationMeta envelope). */
export const companyListResultSchema = z.object({
  items: z.array(companySummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type CompanyListResult = z.infer<typeof companyListResultSchema>;

/** POST trả `{ company, provision }` (provision null nếu tạo công ty rỗng / no template). */
export const createCompanyResultSchema = z.object({
  company: companySummarySchema,
  provision: provisionResultSchema.nullable(),
});
export type CreateCompanyResult = z.infer<typeof createCompanyResultSchema>;

/** Tham số list — khớp `listCompaniesQuerySchema` của BE (status/search/page/limit). */
export interface ListCompaniesParams {
  status?: CompanyStatus;
  search?: string;
  page?: number;
  limit?: number;
}

function buildListQuery(params: ListCompaniesParams): string {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.search && params.search.trim()) qs.set("search", params.search.trim());
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const platformCompaniesApi = {
  /** GET danh sách workspace (filter status/search + phân trang). */
  list: (params: ListCompaniesParams = {}): Promise<CompanyListResult> =>
    apiFetch(`${BASE}${buildListQuery(params)}`, companyListResultSchema),

  /** GET 1 workspace theo id. */
  getOne: (id: string): Promise<CompanySummaryDto> =>
    apiFetch(`${BASE}/${id}`, companySummarySchema),

  /** POST tạo workspace mới (+ provision template + gán gói). */
  create: (body: CreateCompanyRequest): Promise<CreateCompanyResult> =>
    apiFetch(`${BASE}`, createCompanyResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST đình chỉ workspace (status='suspended'; KHÔNG hard-delete). */
  suspend: (id: string): Promise<CompanySummaryDto> =>
    apiFetch(`${BASE}/${id}/suspend`, companySummarySchema, { method: "POST" }),

  /** PATCH cấu hình workspace (name/timezone/currency/language/logoUrl). */
  configure: (id: string, body: UpdateCompanyRequest): Promise<CompanySummaryDto> =>
    apiFetch(`${BASE}/${id}`, companySummarySchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** PUT đặt gói cho 1 công ty (cross-tenant). */
  setSubscription: (id: string, body: SetSubscriptionRequest): Promise<CompanySubscriptionDto> =>
    apiFetch(`${BASE}/${id}/subscription`, companySubscriptionSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};
