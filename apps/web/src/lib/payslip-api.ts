import { z } from "zod";
import type { PayslipListQuery, ResolvePayslipDisputeRequest } from "@mediaos/contracts";
import {
  payslipSchema,
  payslipAcknowledgementSchema,
  disputePayslipSchema,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

const reauthWindowSchema = z.object({ expiresAt: z.string().datetime() });

function buildQuery(filters: PayslipListQuery = {}): string {
  const qs = new URLSearchParams();
  if (filters.payrollPeriodId) qs.set("payrollPeriodId", filters.payrollPeriodId);
  if (filters.userId) qs.set("userId", filters.userId);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * Payslip REST client (G12-FE).
 *
 * BẤT BIẾN (mirror salary reveal):
 *  - getOne calls apiFetch DIRECTLY — NOT via useQuery — so monetary values never enter
 *    the React Query cache. Caller must keep the result in ephemeral state and clear on close.
 *  - reauth POSTs step-up; only after that window is open should getOne be called.
 *  - dispute validates reason via Zod BEFORE any network call (fail-fast, no empty reasons).
 */
export const payslipApi = {
  list: (filters?: PayslipListQuery) =>
    apiFetch(`/payslips${buildQuery(filters)}`, z.array(payslipSchema)),

  /** Direct fetch — NOT via useQuery. Keep result ephemeral; clear on close/unmount. */
  getOne: (id: string) => apiFetch(`/payslips/${id}`, payslipSchema),

  /** Step-up: opens a 5-min re-auth window server-side (Valkey). Must precede getOne. */
  reauth: (id: string, password: string) =>
    apiFetch(`/payslips/${id}/reauth`, reauthWindowSchema, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  acknowledge: (id: string) =>
    apiFetch(`/payslips/${id}/acknowledge`, payslipAcknowledgementSchema, { method: "POST" }),

  /**
   * Dispute payslip. Zod validates reason (non-empty, non-whitespace) BEFORE network call.
   * Throws ZodError if reason is blank — caller never needs to reach the server.
   */
  dispute: async (id: string, reason: string) => {
    // Validate before hitting the network (parity with disputePayslipSchema).
    // async so ZodError rejects the Promise (allows await expect(...).rejects.toThrow()).
    const { reason: validatedReason } = disputePayslipSchema.parse({ reason });
    return apiFetch(`/payslips/${id}/dispute`, payslipAcknowledgementSchema, {
      method: "POST",
      body: JSON.stringify({ reason: validatedReason }),
    });
  },

  resolve: (id: string, resolutionNote?: string) => {
    const body: ResolvePayslipDisputeRequest = resolutionNote ? { resolutionNote } : {};
    return apiFetch(`/payslips/${id}/resolve`, payslipAcknowledgementSchema, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
};
