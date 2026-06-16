import { z } from "zod";

/**
 * G16-3 SaaS prep — TEMPLATE clone DTOs.
 *
 * `templateBlueprintSchema` = NGUỒN SỰ THẬT cấu trúc blueprint (roles + workflows + dashboards).
 * TemplateCloneService validate blueprint qua schema này TRƯỚC khi ghi per-company rows (fail-loud nếu
 * blueprint hỏng). Done-criterion: "clone template được cho công ty khác."
 */

// ─── Blueprint (lưu trong workspace_templates.blueprint_json) ───────────────────

const permissionRefSchema = z.object({
  action: z.string().min(1).max(100),
  resourceType: z.string().min(1).max(100),
});

export const templateRoleSchema = z.object({
  code: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  requiresTwoFactor: z.boolean().default(false),
  permissions: z.array(permissionRefSchema),
});
export type TemplateRole = z.infer<typeof templateRoleSchema>;

export const workspaceTemplateStepSchema = z.object({
  stepOrder: z.number().int().positive(),
  code: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  assigneeRoleCode: z.string().max(120).nullable().optional(),
  reviewerRoleCode: z.string().max(120).nullable().optional(),
  defaultTaskTitle: z.string().min(1).max(300),
  nodeKey: z.string().min(1).max(120),
  stepType: z.string().min(1).max(40).default("task"),
  isRequired: z.boolean().default(true),
});
export type WorkspaceTemplateStep = z.infer<typeof workspaceTemplateStepSchema>;

export const templateTransitionSchema = z.object({
  fromState: z.string().min(1).max(60),
  event: z.string().min(1).max(60),
  toState: z.string().min(1).max(60),
  appliesToStepCode: z.string().max(120).nullable().optional(),
});
export type TemplateTransition = z.infer<typeof templateTransitionSchema>;

export const templateWorkflowSchema = z.object({
  code: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  appliesTo: z.string().min(1).max(60).default("content_item"),
  maxApprovalLevel: z.number().int().positive().default(1),
  allowParallelSteps: z.boolean().default(false),
  steps: z.array(workspaceTemplateStepSchema).min(1),
  transitions: z.array(templateTransitionSchema),
});
export type TemplateWorkflow = z.infer<typeof templateWorkflowSchema>;

export const templateDashboardSchema = z.object({
  roleCode: z.string().min(1).max(120),
  layout: z.record(z.unknown()),
});
export type TemplateDashboard = z.infer<typeof templateDashboardSchema>;

export const templateBlueprintSchema = z.object({
  version: z.number().int().positive().default(1),
  roles: z.array(templateRoleSchema),
  workflows: z.array(templateWorkflowSchema),
  dashboards: z.array(templateDashboardSchema),
});
export type TemplateBlueprint = z.infer<typeof templateBlueprintSchema>;

// ─── API DTOs ───────────────────────────────────────────────────────────────────

/** DTO tóm tắt 1 template (catalog). blueprint KHÔNG trả ở list (giữ payload gọn). */
export const templateSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
});
export type TemplateSummaryDto = z.infer<typeof templateSummarySchema>;

/** POST /admin/platform/companies/:id/apply-template — chọn template theo code (default 'starter'). */
export const applyWorkspaceTemplateSchema = z.object({
  templateCode: z.string().min(1).max(64),
});
export type ApplyWorkspaceTemplateRequest = z.infer<typeof applyWorkspaceTemplateSchema>;

/** Kết quả provision: số lượng row tạo cho từng nhóm (đã idempotent-skip nếu trùng). */
export const provisionResultSchema = z.object({
  companyId: z.string().uuid(),
  templateCode: z.string(),
  rolesCreated: z.number().int().nonnegative(),
  workflowsCreated: z.number().int().nonnegative(),
  dashboardsCreated: z.number().int().nonnegative(),
  alreadyProvisioned: z.boolean(),
});
export type ProvisionResultDto = z.infer<typeof provisionResultSchema>;
