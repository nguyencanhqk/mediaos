import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const stepStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "waiting_review",
  "approved",
  "revision",
  "blocked",
]);
export type StepStatusDto = z.infer<typeof stepStatusSchema>;

export const instanceStatusSchema = z.enum(["active", "completed", "cancelled"]);
export type InstanceStatusDto = z.infer<typeof instanceStatusSchema>;

// ─── Workflow instance ────────────────────────────────────────────────────────

export const workflowInstanceSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowDefinitionId: z.string().uuid(),
  contentItemId: z.string().uuid().nullable(),
  currentStepOrder: z.number().int().min(1),
  status: instanceStatusSchema,
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type WorkflowInstanceDto = z.infer<typeof workflowInstanceSchema>;

// ─── Workflow step ────────────────────────────────────────────────────────────

export const workflowStepSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowInstanceId: z.string().uuid(),
  stepOrder: z.number().int().min(1),
  stepCode: z.string(),
  stepName: z.string(),
  status: stepStatusSchema,
  assigneeUserId: z.string().uuid().nullable(),
  reviewerUserId: z.string().uuid().nullable(),
  startedAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  approvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type WorkflowStepDto = z.infer<typeof workflowStepSchema>;

// ─── Workflow detail (instance + steps) ──────────────────────────────────────

export const workflowDetailSchema = z.object({
  instance: workflowInstanceSchema,
  steps: z.array(workflowStepSchema),
});
export type WorkflowDetailDto = z.infer<typeof workflowDetailSchema>;

// ─── Request schemas ──────────────────────────────────────────────────────────

export const startWorkflowSchema = z.object({
  contentItemId: z.string().uuid(),
});
export type StartWorkflowRequest = z.infer<typeof startWorkflowSchema>;

export const submitStepSchema = z.object({
  submissionUrl: z.string().url().max(2048).optional().nullable(),
  submissionNote: z.string().max(1000).optional().nullable(),
});
export type SubmitStepRequest = z.infer<typeof submitStepSchema>;

/** PM gán người thực hiện (assignee) + người duyệt (reviewer) cho 1 bước. */
export const assignStepSchema = z.object({
  assigneeUserId: z.string().uuid().nullable(),
  reviewerUserId: z.string().uuid().nullable(),
});
export type AssignStepRequest = z.infer<typeof assignStepSchema>;

// ─── Approval request ─────────────────────────────────────────────────────────

export const approvalRequestStatusSchema = z.enum(["pending", "approved", "revision_requested"]);
export type ApprovalRequestStatusDto = z.infer<typeof approvalRequestStatusSchema>;

export const approvalRequestSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowStepId: z.string().uuid(),
  requestedBy: z.string().uuid(),
  assigneeId: z.string().uuid().nullable(),
  status: approvalRequestStatusSchema,
  currentLevel: z.number().int().min(1),
  maxLevel: z.number().int().min(1),
  decidedAt: z.string().datetime().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ApprovalRequestDto = z.infer<typeof approvalRequestSchema>;

export const approveRequestSchema = z.object({
  comment: z.string().max(1000).optional().nullable(),
});
export type ApproveRequest = z.infer<typeof approveRequestSchema>;

export const requestRevisionSchema = z.object({
  description: z.string().min(1).max(2000),
  comment: z.string().max(1000).optional().nullable(),
});
export type RequestRevisionRequest = z.infer<typeof requestRevisionSchema>;
