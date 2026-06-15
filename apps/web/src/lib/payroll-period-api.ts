import { z } from "zod";
import type { CreatePayrollPeriodRequest, PayrollPeriodListQuery } from "@mediaos/contracts";
import { payrollPeriodSchema } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

function buildQuery(filters: PayrollPeriodListQuery = {}): string {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * Payroll period REST client (G12-FE).
 * approve/publish: POST without body — actor resolved from JWT server-side.
 */
export const payrollPeriodApi = {
  list: (filters?: PayrollPeriodListQuery) =>
    apiFetch(`/payroll-periods${buildQuery(filters)}`, z.array(payrollPeriodSchema)),

  create: (data: CreatePayrollPeriodRequest) =>
    apiFetch("/payroll-periods", payrollPeriodSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  approve: (id: string) =>
    apiFetch(`/payroll-periods/${id}/approve`, payrollPeriodSchema, { method: "POST" }),

  publish: (id: string) =>
    apiFetch(`/payroll-periods/${id}/publish`, payrollPeriodSchema, { method: "POST" }),

  remove: (id: string) =>
    apiFetch(`/payroll-periods/${id}`, z.unknown(), { method: "DELETE" }),
};
