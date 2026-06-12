import { z } from "zod";
import {
  workflowTemplateSchema,
  templateStepSchema as realTemplateStepSchema,
  stepDependencySchema,
  checklistSchema as realChecklistSchema,
  checklistItemSchema as realChecklistItemSchema,
  templateDetailSchema as realTemplateDetailSchema,
  dagValidationResultSchema,
  dagValidationErrorSchema,
  dagErrorCodeSchema,
  dependencyTypeSchema as realDependencyTypeSchema,
  templateStatusSchema as realTemplateStatusSchema,
  stepStatusSchema,
  instanceStatusSchema as realInstanceStatusSchema,
  createTemplateSchema as realCreateTemplateSchema,
  updateTemplateSchema as realUpdateTemplateSchema,
  createTemplateStepSchema,
  updateTemplateStepSchema,
  createDependencySchema as realCreateDependencySchema,
  createChecklistSchema as realCreateChecklistSchema,
  createChecklistItemSchema as realCreateChecklistItemSchema,
  applyTemplateSchema as realApplyTemplateSchema,
} from "@mediaos/contracts";

/**
 * Workflow Builder contract — SEAM ĐỒNG BỘ DUY NHẤT giữa UI builder và `@mediaos/contracts`.
 *
 * Sau khi LUỒNG A freeze contract (G7-1b) + merge-forward, file này RE-EXPORT thẳng các schema
 * FROZEN dưới TÊN ỔN ĐỊNH mà UI đang dùng (vd `templateSchema`, `DependencyDto`). Đổi nguồn DTO
 * = đổi 1 file. KHÔNG còn mirror tay → không lệch contract.
 *
 * Ngoại lệ giữ FE-local: các read-view INSTANCE giàu hơn (nodeKey + position trên step, templateName,
 * dependencies) phục vụ canvas 3d — BE CHƯA ship endpoint instance tương ứng (spine chỉ trả
 * { instance, steps } phẳng). Khi A ship, thay nốt phần dưới bằng re-export.
 */

// ─── Template / step / dependency / checklist (re-export FROZEN) ──────────────

export {
  workflowTemplateSchema as templateSchema,
  stepDependencySchema as dependencySchema,
  dagValidationResultSchema,
  dagValidationErrorSchema as dagErrorSchema,
  dagErrorCodeSchema,
  createTemplateStepSchema as createStepSchema,
  updateTemplateStepSchema as updateStepSchema,
} from "@mediaos/contracts";

export const templateStepSchema = realTemplateStepSchema;
export const checklistSchema = realChecklistSchema;
export const checklistItemSchema = realChecklistItemSchema;
export const templateDetailSchema = realTemplateDetailSchema;
export const dependencyTypeSchema = realDependencyTypeSchema;
export const templateStatusSchema = realTemplateStatusSchema;
export const stepInstanceStatusSchema = stepStatusSchema;
export const instanceStatusSchema = realInstanceStatusSchema;

export const createTemplateSchema = realCreateTemplateSchema;
export const updateTemplateSchema = realUpdateTemplateSchema;
export const createDependencySchema = realCreateDependencySchema;
export const createChecklistSchema = realCreateChecklistSchema;
export const createChecklistItemSchema = realCreateChecklistItemSchema;
export const applyTemplateSchema = realApplyTemplateSchema;

export type TemplateDto = z.infer<typeof workflowTemplateSchema>;
export type TemplateStepDto = z.infer<typeof realTemplateStepSchema>;
export type DependencyDto = z.infer<typeof stepDependencySchema>;
export type ChecklistDto = z.infer<typeof realChecklistSchema>;
export type ChecklistItemDto = z.infer<typeof realChecklistItemSchema>;
export type TemplateDetailDto = z.infer<typeof realTemplateDetailSchema>;
export type DagValidationResultDto = z.infer<typeof dagValidationResultSchema>;
export type DagErrorDto = z.infer<typeof dagValidationErrorSchema>;
export type DagErrorCode = z.infer<typeof dagErrorCodeSchema>;
export type DependencyType = z.infer<typeof realDependencyTypeSchema>;
export type TemplateStatus = z.infer<typeof realTemplateStatusSchema>;
export type StepInstanceStatus = z.infer<typeof stepStatusSchema>;
export type InstanceStatus = z.infer<typeof realInstanceStatusSchema>;

export type CreateTemplateRequest = z.infer<typeof realCreateTemplateSchema>;
export type UpdateTemplateRequest = z.infer<typeof realUpdateTemplateSchema>;
export type CreateStepRequest = z.infer<typeof createTemplateStepSchema>;
export type UpdateStepRequest = z.infer<typeof updateTemplateStepSchema>;
export type CreateDependencyRequest = z.infer<typeof realCreateDependencySchema>;
export type CreateChecklistRequest = z.infer<typeof realCreateChecklistSchema>;
export type CreateChecklistItemRequest = z.infer<typeof realCreateChecklistItemSchema>;
export type ApplyTemplateRequest = z.infer<typeof realApplyTemplateSchema>;

/** Lưu vị trí node (kéo-thả canvas 2c) — BE không có endpoint /position riêng; gửi qua PATCH step. */
export interface UpdateStepPositionRequest {
  positionX: number;
  positionY: number;
}

// ─── Instance read-views (3d, FE-local — BE chưa ship endpoint instance giàu) ──

export const instanceStepSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowInstanceId: z.string().uuid(),
  nodeKey: z.string().nullable(),
  stepOrder: z.number().int().min(1),
  stepCode: z.string(),
  stepName: z.string(),
  status: stepStatusSchema,
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
  status: realInstanceStatusSchema,
  templateName: z.string(),
  createdAt: z.string().datetime(),
});
export type InstanceDto = z.infer<typeof instanceSchema>;

export const instanceDetailSchema = z.object({
  instance: instanceSchema,
  steps: z.array(instanceStepSchema),
  dependencies: z.array(stepDependencySchema),
});
export type InstanceDetailDto = z.infer<typeof instanceDetailSchema>;
