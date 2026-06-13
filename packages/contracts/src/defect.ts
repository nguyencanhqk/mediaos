import { z } from "zod";

// ─── Defect type enum ─────────────────────────────────────────────────────────
export const defectTypeSchema = z.enum([
  "missing_content",
  "wrong_format",
  "quality_issue",
  "policy_violation",
  "other",
]);
export type DefectTypeDto = z.infer<typeof defectTypeSchema>;

// ─── Defect DTO ───────────────────────────────────────────────────────────────
export const defectSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workflowStepId: z.string().uuid(),
  responsibleUserId: z.string().uuid().nullable(),
  causedByApprovalStepId: z.string().uuid().nullable(),
  defectType: defectTypeSchema,
  description: z.string(),
  revisionTaskId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type DefectDto = z.infer<typeof defectSchema>;

// ─── Request: create defect ───────────────────────────────────────────────────
export const createDefectSchema = z.object({
  workflowStepId: z.string().uuid(),
  causedByApprovalStepId: z.string().uuid().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  defectType: defectTypeSchema,
  description: z.string().min(1).max(2000),
});
export type CreateDefectRequest = z.infer<typeof createDefectSchema>;
