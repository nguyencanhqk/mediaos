import { z } from "zod";
import { apiFetch } from "./api-client";
import {
  dagValidationResultSchema,
  dependencySchema,
  templateDetailSchema,
  templateSchema,
  templateStepSchema,
  type CreateDependencyRequest,
  type CreateStepRequest,
  type CreateTemplateRequest,
  type DagValidationResultDto,
  type DependencyDto,
  type TemplateDetailDto,
  type TemplateDto,
  type TemplateStepDto,
  type UpdateStepPositionRequest,
  type UpdateStepRequest,
  type UpdateTemplateRequest,
} from "./workflow-builder/contract";
import { mockTemplatesStore } from "./workflow-builder/mock-store";

/**
 * Client cho Workflow Builder templates.
 * MOCK mặc định BẬT tới khi LUỒNG A ship endpoint — đặt `VITE_WORKFLOW_MOCK=false` để dùng API thật.
 * Hai nhánh (mock/real) cùng implement `WorkflowTemplatesApi` → đổi nguồn không đụng UI.
 */
export interface WorkflowTemplatesApi {
  list(): Promise<TemplateDto[]>;
  get(id: string): Promise<TemplateDetailDto>;
  create(req: CreateTemplateRequest): Promise<TemplateDto>;
  update(id: string, req: UpdateTemplateRequest): Promise<TemplateDto>;
  remove(id: string): Promise<void>;
  addStep(templateId: string, req: CreateStepRequest): Promise<TemplateStepDto>;
  updateStep(templateId: string, stepId: string, req: UpdateStepRequest): Promise<TemplateStepDto>;
  updateStepPosition(
    templateId: string,
    stepId: string,
    req: UpdateStepPositionRequest,
  ): Promise<TemplateStepDto>;
  removeStep(templateId: string, stepId: string): Promise<void>;
  addDependency(templateId: string, req: CreateDependencyRequest): Promise<DependencyDto>;
  removeDependency(templateId: string, depId: string): Promise<void>;
  validate(templateId: string): Promise<DagValidationResultDto>;
  publish(templateId: string): Promise<TemplateDto>;
  clone(templateId: string): Promise<TemplateDto>;
}

const BASE = "/workflow/templates";

const realTemplatesApi: WorkflowTemplatesApi = {
  list: () => apiFetch(BASE, z.array(templateSchema)),
  get: (id) => apiFetch(`${BASE}/${id}`, templateDetailSchema),
  create: (req) =>
    apiFetch(BASE, templateSchema, { method: "POST", body: JSON.stringify(req) }),
  update: (id, req) =>
    apiFetch(`${BASE}/${id}`, templateSchema, { method: "PATCH", body: JSON.stringify(req) }),
  remove: (id) => apiFetch(`${BASE}/${id}`, z.void(), { method: "DELETE" }),
  addStep: (templateId, req) =>
    apiFetch(`${BASE}/${templateId}/steps`, templateStepSchema, {
      method: "POST",
      body: JSON.stringify(req),
    }),
  updateStep: (templateId, stepId, req) =>
    apiFetch(`${BASE}/${templateId}/steps/${stepId}`, templateStepSchema, {
      method: "PATCH",
      body: JSON.stringify(req),
    }),
  updateStepPosition: (templateId, stepId, req) =>
    apiFetch(`${BASE}/${templateId}/steps/${stepId}/position`, templateStepSchema, {
      method: "PATCH",
      body: JSON.stringify(req),
    }),
  removeStep: (templateId, stepId) =>
    apiFetch(`${BASE}/${templateId}/steps/${stepId}`, z.void(), { method: "DELETE" }),
  addDependency: (templateId, req) =>
    apiFetch(`${BASE}/${templateId}/dependencies`, dependencySchema, {
      method: "POST",
      body: JSON.stringify(req),
    }),
  removeDependency: (templateId, depId) =>
    apiFetch(`${BASE}/${templateId}/dependencies/${depId}`, z.void(), { method: "DELETE" }),
  validate: (templateId) =>
    apiFetch(`${BASE}/${templateId}/validate`, dagValidationResultSchema, { method: "POST" }),
  publish: (templateId) =>
    apiFetch(`${BASE}/${templateId}/publish`, templateSchema, { method: "POST" }),
  clone: (templateId) =>
    apiFetch(`${BASE}/${templateId}/clone`, templateSchema, { method: "POST" }),
};

const USE_MOCK = import.meta.env.VITE_WORKFLOW_MOCK !== "false";

export const workflowTemplatesApi: WorkflowTemplatesApi = USE_MOCK
  ? mockTemplatesStore
  : realTemplatesApi;
