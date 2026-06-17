import { z } from "zod";
import type {
  CreateSalaryProfileRequest,
  SalaryProfileListQuery,
  UpdateSalaryProfileRequest,
} from "@mediaos/contracts";
import { salaryProfileListItemSchema, salaryProfileSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * Salary profile REST client (G12-1). Lương NHẠY CẢM (BẤT BIẾN #3): the server masks
 * baseSalary/allowances (→ null) for callers without view-salary-profile. These schemas
 * accept the masked shape (nullable), so the client never needs to decide permission —
 * it renders exactly what the server sent.
 */

function buildQuery(filters: SalaryProfileListQuery = {}): string {
  const qs = new URLSearchParams();
  if (filters.userId) qs.set("userId", filters.userId);
  if (filters.status) qs.set("status", filters.status);
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : "";
}

export const salaryProfileApi = {
  list: (filters?: SalaryProfileListQuery) =>
    apiFetch(`/salary-profiles${buildQuery(filters)}`, z.array(salaryProfileListItemSchema)),

  get: (id: string) => apiFetch(`/salary-profiles/${id}`, salaryProfileSchema),

  create: (data: CreateSalaryProfileRequest) =>
    apiFetch("/salary-profiles", salaryProfileSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: UpdateSalaryProfileRequest) =>
    apiFetch(`/salary-profiles/${id}`, salaryProfileSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  remove: (id: string) => apiFetch(`/salary-profiles/${id}`, z.unknown(), { method: "DELETE" }),
};
