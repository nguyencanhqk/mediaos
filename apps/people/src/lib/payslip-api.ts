import { z } from "zod";
import type {
  PayslipEntryKind,
  PayslipListQuery,
  PayslipSummaryDto,
  ResolvePayslipDisputeRequest,
} from "@mediaos/contracts";
import {
  payslipSchema,
  payslipSummarySchema,
  payslipAcknowledgementSchema,
  disputePayslipSchema,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

const reauthWindowSchema = z.object({ expiresAt: z.string().datetime() });

/**
 * Money-FREE projection of a payslip for the list view (G12-FE employee self-service).
 *
 * BẤT BIẾN #3 (a): the list must NOT carry net/gross/base — only kỳ/trạng thái/ngày. The server
 * `GET /payslips` still returns the full snapshot, so we strip every monetary field at THIS boundary
 * (in listSummary) before the value can reach component state or the React Query cache. Detailed
 * money is only ever obtained via reauth → getOne (direct fetch, never cached).
 */
export interface PayslipSummary {
  id: string;
  payrollPeriodId: string;
  entryKind: PayslipEntryKind;
  createdAt: string;
}

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

  /**
   * Money-FREE list for the self-service page. Fetches the full snapshot then STRIPS every
   * monetary field at the boundary so net/gross/base never enter component state or the RQ cache
   * (BẤT BIẾN #3 (a)). Pass `userId` to scope to the caller's own payslips ("Phiếu lương của tôi").
   */
  listSummary: async (filters?: PayslipListQuery): Promise<PayslipSummary[]> => {
    const slips = await apiFetch(`/payslips${buildQuery(filters)}`, z.array(payslipSchema));
    return slips.map((s) => ({
      id: s.id,
      payrollPeriodId: s.payrollPeriodId,
      entryKind: s.entryKind,
      createdAt: s.createdAt,
    }));
  },

  /** Direct fetch — NOT via useQuery. Keep result ephemeral; clear on close/unmount. */
  getOne: (id: string) => apiFetch(`/payslips/${id}`, payslipSchema),

  /**
   * B1 own-payslip LIST ("Phiếu lương của tôi"). Server is the source of truth for money-stripping:
   * GET /payslips/me/list returns a money-FREE projection (parsed via payslipSummarySchema — a schema
   * that has NO monetary field, so net/gross can never enter component state or the RQ cache). Ownership
   * (user_id = self) is enforced SERVER-SIDE — the client passes no userId. BẤT BIẾN #3a.
   */
  listOwn: (): Promise<PayslipSummaryDto[]> =>
    apiFetch(`/payslips/me/list`, z.array(payslipSummarySchema)),

  /** B1 own step-up: opens a 5-min re-auth window for the caller's OWN payslip. Must precede getOwn. */
  reauthOwn: (id: string, password: string) =>
    apiFetch(`/payslips/me/${id}/reauth`, reauthWindowSchema, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  /**
   * B1 own getOWN — full money for the caller's OWN payslip, ONLY after reauthOwn. Direct fetch — NOT
   * via useQuery. Keep result ephemeral; clear on close/unmount. Server enforces ownership + re-auth.
   */
  getOwn: (id: string) => apiFetch(`/payslips/me/${id}`, payslipSchema),

  /**
   * Acknowledgements for a payslip (money-FREE — only status + reason). The employee sees their own
   * (ownership enforced server-side via 'acknowledge-own-payslip'); HR sees all. Used to render the
   * current ack state alongside PayslipAckActions.
   */
  listAcknowledgements: (id: string) =>
    apiFetch(`/payslips/${id}/acknowledgements`, z.array(payslipAcknowledgementSchema)),

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
