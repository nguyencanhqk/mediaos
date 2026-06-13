import { z } from "zod";

/**
 * G8-1 — Multi-level approval (APR-001/002) contracts. Source of truth for the inbox + approve/reject
 * DTOs shared by FE + API. approval_requests = source of truth (ADR-0016); inbox only ever exposes a
 * request at the level the actor approves (never a future level).
 */

// Body of POST /approval/requests/:id/approve — approve at the request's current level.
export const approveLevelSchema = z.object({
  comment: z.string().max(1000).optional().nullable(),
});
export type ApproveLevel = z.infer<typeof approveLevelSchema>;

// Body of POST /approval/requests/:id/reject — reject at the current level (closes the request).
export const rejectLevelSchema = z.object({
  description: z.string().min(1).max(2000),
  comment: z.string().max(1000).optional().nullable(),
});
export type RejectLevel = z.infer<typeof rejectLevelSchema>;

// One inbox item — a pending request awaiting the current actor's decision at its current level.
export const approvalInboxItemSchema = z.object({
  requestId: z.string().uuid(),
  workflowStepId: z.string().uuid(),
  currentLevel: z.number().int().min(1),
  maxLevel: z.number().int().min(1),
  status: z.string(),
  createdAt: z.coerce.date(),
});
export type ApprovalInboxItem = z.infer<typeof approvalInboxItemSchema>;
