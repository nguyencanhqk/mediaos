import { z } from "zod";
import {
  approvalRequestSchema,
  type SubmitStepRequest,
  type ApproveRequest,
  type RequestRevisionRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./client";

/**
 * Workflow API client for mobile — mirrors the workflow half of apps/web/src/lib/tasks-api.ts.
 * Step start/submit and approve/request-revision are FSM-gated server-side (actor must be the
 * assignee / reviewer); the approval-requests list is already scoped to the caller's pending items,
 * so a non-reviewer simply receives an empty list (server-driven gating — no client hardcoding).
 */
export const workflowApi = {
  /** POST /workflow/steps/:stepId/start — assignee starts the step (FSM enforces actor). */
  startStep: (stepId: string) =>
    apiFetch(`/workflow/steps/${stepId}/start`, z.unknown(), {
      authenticated: true,
      method: "POST",
    }),

  /** POST /workflow/steps/:stepId/submit — submit work (submissionUrl + note) → waiting_review. */
  submitStep: (stepId: string, data: SubmitStepRequest) =>
    apiFetch(`/workflow/steps/${stepId}/submit`, z.unknown(), {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** GET /workflow/approval-requests — caller's pending approvals (server-scoped to reviewer). */
  listApprovalRequests: () =>
    apiFetch("/workflow/approval-requests", z.array(approvalRequestSchema), {
      authenticated: true,
    }),

  /** POST /workflow/approval-requests/:id/approve — reviewer approves (service enforces reviewer). */
  approve: (requestId: string, data: ApproveRequest) =>
    apiFetch(`/workflow/approval-requests/${requestId}/approve`, z.unknown(), {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** POST /workflow/approval-requests/:id/request-revision — reviewer sends it back with a reason. */
  requestRevision: (requestId: string, data: RequestRevisionRequest) =>
    apiFetch(`/workflow/approval-requests/${requestId}/request-revision`, z.unknown(), {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(data),
    }),
};
