import { z } from "zod";

/**
 * Workflow Builder contract — MIRROR cục bộ của `packages/contracts/src/workflow.ts`
 * sau khi LUỒNG A đóng băng (G7-1b: templateSchema/stepSchema+nodeKey/dependencySchema…).
 *
 * ⚠️ ĐÂY LÀ SEAM ĐỒNG BỘ DUY NHẤT. Track C build trước khi A freeze contract → mirror các
 * Zod schema theo plan §3 (0032) + §4 (1b). Khi A push "freeze contracts" và ta `git merge
 * feat/g7-workflow`, thay TOÀN BỘ file này bằng:
 *     export * from "@mediaos/contracts";   // re-export các workflow-builder schema đã freeze
 * (hoặc re-export chọn lọc các tên dưới đây). Mọi UI import từ MODULE NÀY → đổi 1 file là xong.
 *
 * camelCase = DTO convention của repo (DB snake_case map sang camelCase ở serializer).
 */

// ─── Enums / hằng số ──────────────────────────────────────────────────────────

export const templateStatusSchema = z.enum(["draft", "published", "archived"]);
export type TemplateStatus = z.infer<typeof templateStatusSchema>;

/** Loại mục tiêu áp template (erd §9.1 — content XOR project). */
export const templateAppliesToSchema = z.enum(["content", "project"]);
export type TemplateAppliesTo = z.infer<typeof templateAppliesToSchema>;

/** Loại node bước trên canvas (mặc định 'task'; 'approval'/'evaluation' để dành G8). */
export const stepTypeSchema = z.enum(["task", "approval", "evaluation"]);
export type StepType = z.infer<typeof stepTypeSchema>;

export const dependencyTypeSchema = z.enum([
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
]);
export type DependencyType = z.infer<typeof dependencyTypeSchema>;

/** Trạng thái bước ở INSTANCE (tái dùng từ workflow.ts đã có — phục vụ 3d read-only). */
export const stepInstanceStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "waiting_review",
  "approved",
  "revision",
  "blocked",
]);
export type StepInstanceStatus = z.infer<typeof stepInstanceStatusSchema>;

// ─── Template (workflow_definitions mở rộng) ──────────────────────────────────

export const templateSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int().min(1),
  status: templateStatusSchema,
  appliesTo: templateAppliesToSchema,
  publishedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  /** Số bước — chỉ có ở list summary (server tính sẵn). */
  stepCount: z.number().int().nonnegative().optional(),
});
export type TemplateDto = z.infer<typeof templateSchema>;

// ─── Step (workflow_definition_steps mở rộng) ─────────────────────────────────

export const templateStepSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowDefinitionId: z.string().uuid(),
  /** Khoá ổn định cho deps + canvas (KHÔNG đổi khi reorder). */
  nodeKey: z.string().min(1),
  stepType: stepTypeSchema,
  stepOrder: z.number().int().min(1),
  code: z.string(),
  title: z.string(),
  assigneeRoleCode: z.string().nullable(),
  reviewerRoleCode: z.string().nullable(),
  isRequired: z.boolean(),
  positionX: z.number().nullable(),
  positionY: z.number().nullable(),
  defaultChecklistId: z.string().uuid().nullable(),
});
export type TemplateStepDto = z.infer<typeof templateStepSchema>;

// ─── Dependency (workflow_step_dependencies — cạnh DAG) ───────────────────────
// Quy ước: fromStepId = bước CHẠY TRƯỚC (tiền nhiệm), toStepId = bước phụ thuộc (chạy sau).
// "B chờ A" ⇒ { fromStepId: A, toStepId: B } ⇒ cạnh A→B (source=from, target=to).

export const dependencySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowDefinitionId: z.string().uuid(),
  fromStepId: z.string().uuid(),
  toStepId: z.string().uuid(),
  dependencyType: dependencyTypeSchema,
});
export type DependencyDto = z.infer<typeof dependencySchema>;

// ─── Template detail (template + steps + deps) ────────────────────────────────

export const templateDetailSchema = z.object({
  template: templateSchema,
  steps: z.array(templateStepSchema),
  dependencies: z.array(dependencySchema),
});
export type TemplateDetailDto = z.infer<typeof templateDetailSchema>;

// ─── DAG validation (kết quả của DagValidatorService — Track B 2a) ────────────

export const dagErrorCodeSchema = z.enum([
  "CYCLE",
  "SELF_DEP",
  "CROSS_TEMPLATE_DEP",
  "ORPHAN",
  "MISSING_DEP_TARGET",
  "NO_ROOT",
  "EMPTY",
]);
export type DagErrorCode = z.infer<typeof dagErrorCodeSchema>;

export const dagErrorSchema = z.object({
  code: dagErrorCodeSchema,
  message: z.string(),
  /** node_key liên quan (nếu lỗi gắn 1 bước cụ thể). */
  nodeKey: z.string().nullable().optional(),
  fromStepId: z.string().uuid().nullable().optional(),
  toStepId: z.string().uuid().nullable().optional(),
});
export type DagErrorDto = z.infer<typeof dagErrorSchema>;

export const dagValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(dagErrorSchema),
});
export type DagValidationResultDto = z.infer<typeof dagValidationResultSchema>;

// ─── Request schemas (RHF/useState → parse trước khi gửi) ─────────────────────

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(80).optional(),
  appliesTo: templateAppliesToSchema.default("content"),
  description: z.string().max(1000).optional().nullable(),
});
export type CreateTemplateRequest = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
});
export type UpdateTemplateRequest = z.infer<typeof updateTemplateSchema>;

export const createStepSchema = z.object({
  code: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  stepType: stepTypeSchema.optional(),
  assigneeRoleCode: z.string().max(80).optional().nullable(),
  reviewerRoleCode: z.string().max(80).optional().nullable(),
  isRequired: z.boolean().optional(),
  positionX: z.number().optional().nullable(),
  positionY: z.number().optional().nullable(),
});
export type CreateStepRequest = z.infer<typeof createStepSchema>;

export const updateStepSchema = createStepSchema.partial();
export type UpdateStepRequest = z.infer<typeof updateStepSchema>;

/** Lưu vị trí node (kéo-thả canvas — 2c). */
export const updateStepPositionSchema = z.object({
  positionX: z.number(),
  positionY: z.number(),
});
export type UpdateStepPositionRequest = z.infer<typeof updateStepPositionSchema>;

export const createDependencySchema = z.object({
  fromStepId: z.string().uuid(),
  toStepId: z.string().uuid(),
  dependencyType: dependencyTypeSchema.optional(),
});
export type CreateDependencyRequest = z.infer<typeof createDependencySchema>;

// ─── Instance (3d — read-only canvas tô màu theo status) ──────────────────────

export const instanceStatusSchema = z.enum(["active", "completed", "cancelled"]);
export type InstanceStatus = z.infer<typeof instanceStatusSchema>;

export const instanceStepSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowInstanceId: z.string().uuid(),
  nodeKey: z.string().nullable(),
  stepOrder: z.number().int().min(1),
  stepCode: z.string(),
  stepName: z.string(),
  status: stepInstanceStatusSchema,
  assigneeUserId: z.string().uuid().nullable(),
  reviewerUserId: z.string().uuid().nullable(),
  positionX: z.number().nullable(),
  positionY: z.number().nullable(),
});
export type InstanceStepDto = z.infer<typeof instanceStepSchema>;

export const instanceSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowDefinitionId: z.string().uuid(),
  definitionVersion: z.number().int().min(1),
  contentItemId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  status: instanceStatusSchema,
  templateName: z.string(),
  createdAt: z.string().datetime(),
});
export type InstanceDto = z.infer<typeof instanceSchema>;

export const instanceDetailSchema = z.object({
  instance: instanceSchema,
  steps: z.array(instanceStepSchema),
  dependencies: z.array(dependencySchema),
});
export type InstanceDetailDto = z.infer<typeof instanceDetailSchema>;
