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

// ═══════════════════════════════════════════════════════════════════════════════
// G7 Workflow Builder — template / DAG / checklist contracts (FROZEN @ viên 1b)
// Nguồn sự thật DTO cho LUỒNG A (spine) + B (DagValidator) + C (frontend builder).
// Read mirrors khớp 1-1 với bảng DB (migration 0032). Hạn chế đổi sau khi freeze.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── G7 enums ─────────────────────────────────────────────────────────────────

/** Vòng đời template (D4 versioning): published version bất biến, edit clone sang version+1=draft. */
export const templateStatusSchema = z.enum(["draft", "published", "archived"]);
export type TemplateStatusDto = z.infer<typeof templateStatusSchema>;

/** Loại phụ thuộc DAG cạnh (from → to). MVP dùng finish_to_start; phần còn lại dành cho sau. */
export const dependencyTypeSchema = z.enum([
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
]);
export type DependencyTypeDto = z.infer<typeof dependencyTypeSchema>;

// ─── G7 read mirrors (1-1 với hàng DB) ────────────────────────────────────────

/** Mirror workflow_definitions (đã thêm version/status/publishedAt/createdBy ở 0032). */
export const workflowTemplateSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  appliesTo: z.string(),
  maxApprovalLevel: z.number().int().min(1),
  allowParallelSteps: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int().min(1),
  status: templateStatusSchema,
  publishedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type WorkflowTemplateDto = z.infer<typeof workflowTemplateSchema>;

/** Mirror workflow_definition_steps (đã thêm nodeKey/stepType/position/defaultChecklistId ở 0032). */
export const templateStepSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowDefinitionId: z.string().uuid(),
  stepOrder: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  assigneeRoleCode: z.string().nullable(),
  reviewerRoleCode: z.string().nullable(),
  isRequired: z.boolean(),
  defaultTaskTitle: z.string(),
  nodeKey: z.string(),
  stepType: z.string(),
  positionX: z.number().int().nullable(),
  positionY: z.number().int().nullable(),
  defaultChecklistId: z.string().uuid().nullable(),
});
export type TemplateStepDto = z.infer<typeof templateStepSchema>;

/** Mirror workflow_step_dependencies (cạnh DAG ở tầng template). */
export const stepDependencySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowDefinitionId: z.string().uuid(),
  fromStepId: z.string().uuid(),
  toStepId: z.string().uuid(),
  dependencyType: dependencyTypeSchema,
  createdAt: z.string().datetime(),
});
export type StepDependencyDto = z.infer<typeof stepDependencySchema>;

/** Mirror checklists. */
export const checklistSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  workflowDefinitionStepId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type ChecklistDto = z.infer<typeof checklistSchema>;

/** Mirror checklist_items. */
export const checklistItemSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  checklistId: z.string().uuid(),
  label: z.string(),
  isRequired: z.boolean(),
  // Read mirror = shape DB thuần (cột integer, không CHECK); ràng buộc >=0 ở write DTO.
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
});
export type ChecklistItemDto = z.infer<typeof checklistItemSchema>;

/** Composite: 1 template + các bước + cạnh DAG + checklists (cho màn builder/canvas). */
export const templateDetailSchema = z.object({
  template: workflowTemplateSchema,
  steps: z.array(templateStepSchema),
  dependencies: z.array(stepDependencySchema),
  checklists: z.array(checklistSchema),
});
export type TemplateDetailDto = z.infer<typeof templateDetailSchema>;

// ─── G7 DAG validator I/O (LUỒNG B 2a implement theo hợp đồng này) ─────────────

/** Mã lỗi DAG (DV1–DV6): khớp DagValidatorService. */
export const dagErrorCodeSchema = z.enum([
  "cycle", // DV1: tồn tại chu trình
  "self_dependency", // DV2: cạnh trỏ về chính nó
  "cross_template", // DV3: cạnh nối 2 template khác nhau
  "unreachable", // DV4: bước không tới được từ gốc
  "missing_node", // DV5: cạnh tham chiếu node_key không tồn tại
  "no_root", // DV6: không có bước gốc (mọi bước đều có dep vào)
]);
export type DagErrorCodeDto = z.infer<typeof dagErrorCodeSchema>;

/** Cạnh DAG theo node_key (decoupled khỏi step id — dùng cho validate trước khi persist). */
export const dagEdgeSchema = z.object({
  fromNodeKey: z.string().min(1).max(100),
  toNodeKey: z.string().min(1).max(100),
});
export type DagEdgeDto = z.infer<typeof dagEdgeSchema>;

export const dagValidationErrorSchema = z.object({
  code: dagErrorCodeSchema,
  message: z.string(),
  // Luôn là mảng (default []) để DagValidatorService (LUỒNG B) buộc điền node liên quan.
  nodeKeys: z.array(z.string()).default([]),
});
export type DagValidationErrorDto = z.infer<typeof dagValidationErrorSchema>;

export const dagValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(dagValidationErrorSchema),
});
export type DagValidationResultDto = z.infer<typeof dagValidationResultSchema>;

// ─── G7 write DTOs (validate input ở boundary) ────────────────────────────────

export const createTemplateSchema = z.object({
  code: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  appliesTo: z.string().min(1).max(50).default("content_item"),
});
export type CreateTemplateRequest = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});
export type UpdateTemplateRequest = z.infer<typeof updateTemplateSchema>;

export const createTemplateStepSchema = z.object({
  nodeKey: z.string().min(1).max(100),
  code: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  defaultTaskTitle: z.string().min(1).max(200),
  stepType: z.string().min(1).max(50).default("task"),
  assigneeRoleCode: z.string().max(100).optional().nullable(),
  reviewerRoleCode: z.string().max(100).optional().nullable(),
  isRequired: z.boolean().default(true),
  stepOrder: z.number().int().min(1).optional(),
  positionX: z.number().int().optional().nullable(),
  positionY: z.number().int().optional().nullable(),
});
export type CreateTemplateStepRequest = z.infer<typeof createTemplateStepSchema>;

// nodeKey = DAG identity bất biến (gắn cạnh + canvas) → KHÔNG cho đổi qua update.
export const updateTemplateStepSchema = createTemplateStepSchema.partial().omit({ nodeKey: true });
export type UpdateTemplateStepRequest = z.infer<typeof updateTemplateStepSchema>;

export const createDependencySchema = z.object({
  fromStepId: z.string().uuid(),
  toStepId: z.string().uuid(),
  dependencyType: dependencyTypeSchema.default("finish_to_start"),
});
export type CreateDependencyRequest = z.infer<typeof createDependencySchema>;

export const createChecklistSchema = z.object({
  name: z.string().min(1).max(200),
  workflowDefinitionStepId: z.string().uuid().optional().nullable(),
});
export type CreateChecklistRequest = z.infer<typeof createChecklistSchema>;

export const createChecklistItemSchema = z.object({
  checklistId: z.string().uuid(),
  label: z.string().min(1).max(500),
  isRequired: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});
export type CreateChecklistItemRequest = z.infer<typeof createChecklistItemSchema>;

// ─── G7-4b checklist enforcement (instance tick state) — ADDITIVE (sau freeze 1b) ─────────────
// Mirror workflow_step_checklist_states (1 row = item đã tick; bỏ tick = DELETE). FE (LUỒNG C) đọc để
// render checklist trong task detail. Tick/untick KHÔNG có request body (stepId + itemId ở path param).
export const workflowStepChecklistStateSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowStepId: z.string().uuid(),
  checklistItemId: z.string().uuid(),
  checkedBy: z.string().uuid().nullable(),
  checkedAt: z.string().datetime(),
});
export type WorkflowStepChecklistStateDto = z.infer<typeof workflowStepChecklistStateSchema>;

/** Kết quả tick/untick (service trả) — phản ánh trạng thái sau thao tác (idempotent).
 * `changed`=false → no-op replay (đã ở trạng thái đó rồi); =true → vừa đổi thật (có audit). */
export const toggleChecklistItemResultSchema = z.object({
  stepId: z.string().uuid(),
  checklistItemId: z.string().uuid(),
  checked: z.boolean(),
  changed: z.boolean(),
});
export type ToggleChecklistItemResult = z.infer<typeof toggleChecklistItemResultSchema>;

// ─── G7-4b checklist READ (instance step → items + tick state) — ADDITIVE ─────────────────────
// GET /workflow/steps/:stepId/checklist. Server resolves per ĐƯỜNG A: instance-step.node_key →
// def-step (workflow_definition_id + node_key) → checklists → items, LEFT JOIN this step's ticked
// rows (workflow_step_checklist_states). FE (LUỒNG C) reads this to render the checklist and mirror
// the submit gate. Frozen 1b schemas untouched.

/** One checklist item of an instance step + its current tick state. `checked`=true ⇔ a state row
 * exists for (step,item). `isRequired` items are what the submit gate enforces. */
export const stepChecklistItemStateSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  isRequired: z.boolean(),
  checked: z.boolean(),
});
export type StepChecklistItemStateDto = z.infer<typeof stepChecklistItemStateSchema>;

/** GET /workflow/steps/:stepId/checklist result. Empty `items` = the step has no resolvable
 * checklist (no node_key / no def-step items) → submit is never gated by the checklist. */
export const stepChecklistSchema = z.object({
  stepId: z.string().uuid(),
  items: z.array(stepChecklistItemStateSchema),
});
export type StepChecklistDto = z.infer<typeof stepChecklistSchema>;

// Áp 1 template (published) lên ĐÚNG-MỘT target: content_item HOẶC project (khớp wf_instances target check).
// Thêm sau freeze 1b nhưng ADDITIVE (không sửa schema cũ) → không ép B/C rebase.
export const applyTemplateSchema = z
  .object({
    contentItemId: z.string().uuid().optional().nullable(),
    projectId: z.string().uuid().optional().nullable(),
  })
  .refine((d) => (d.contentItemId ? 1 : 0) + (d.projectId ? 1 : 0) === 1, {
    message: "Provide exactly one target: contentItemId or projectId",
  });
export type ApplyTemplateRequest = z.infer<typeof applyTemplateSchema>;
