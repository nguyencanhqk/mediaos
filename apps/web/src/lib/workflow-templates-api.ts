import { z } from "zod";
import { apiFetch } from "./api-client";
import {
  dependencySchema,
  templateDetailSchema,
  templateSchema,
  templateStepSchema,
  type ApplyTemplateRequest,
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
import { validateDag } from "./workflow-builder/dag";
import { mockTemplatesStore } from "./workflow-builder/mock-store";

/**
 * Client cho Workflow Builder templates — nối endpoint THẬT `/workflow-templates` (G7-1c/2b đã ship).
 *
 * Mặc định dùng API THẬT. Đặt `VITE_WORKFLOW_MOCK=true` để bật mock in-memory (fallback DEV khi
 * không chạy được api+db). Hai nhánh implement cùng `WorkflowTemplatesApi` → đổi nguồn không đụng UI.
 *
 * Lưu ý hợp đồng BE:
 *   - KHÔNG có endpoint validate riêng → `validate()` chạy validateDag client-side trên detail
 *     (đủ cho phản hồi tức thì; publish 422 là nguồn chuẩn cuối).
 *   - KHÔNG có endpoint position riêng → `updateStepPosition()` gửi qua PATCH step (positionX/Y).
 *   - publish lỗi DAG → 422 (ApiError.status 422); double-publish/đã xuất bản → 409. UI bắt theo status.
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
  apply(templateId: string, req: ApplyTemplateRequest): Promise<{ instanceId: string }>;
}

const BASE = "/workflow-templates";

// DELETE trả { id, deleted: true } (không phải 204) — parse tolerant, UI bỏ body.
const deleteResultSchema = z.unknown();
// apply trả { instance, steps } (spine) — chỉ cần id instance vừa tạo.
const applyResultSchema = z
  .object({ instance: z.object({ id: z.string().uuid() }).passthrough() })
  .passthrough();

const realTemplatesApi: WorkflowTemplatesApi = {
  list: () => apiFetch(BASE, z.array(templateSchema)),
  get: (id) => apiFetch(`${BASE}/${id}`, templateDetailSchema),
  create: (req) => apiFetch(BASE, templateSchema, { method: "POST", body: JSON.stringify(req) }),
  update: (id, req) =>
    apiFetch(`${BASE}/${id}`, templateSchema, { method: "PATCH", body: JSON.stringify(req) }),
  remove: async (id) => {
    await apiFetch(`${BASE}/${id}`, deleteResultSchema, { method: "DELETE" });
  },
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
  // BE không có /position → gửi qua PATCH step (positionX/Y là field của updateTemplateStepSchema).
  updateStepPosition: (templateId, stepId, req) =>
    apiFetch(`${BASE}/${templateId}/steps/${stepId}`, templateStepSchema, {
      method: "PATCH",
      body: JSON.stringify({ positionX: req.positionX, positionY: req.positionY }),
    }),
  removeStep: async (templateId, stepId) => {
    await apiFetch(`${BASE}/${templateId}/steps/${stepId}`, deleteResultSchema, { method: "DELETE" });
  },
  addDependency: (templateId, req) =>
    apiFetch(`${BASE}/${templateId}/dependencies`, dependencySchema, {
      method: "POST",
      body: JSON.stringify(req),
    }),
  removeDependency: async (templateId, depId) => {
    await apiFetch(`${BASE}/${templateId}/dependencies/${depId}`, deleteResultSchema, {
      method: "DELETE",
    });
  },
  // Không có endpoint validate → dựng kết quả từ detail bằng validator client-side (mirror LUỒNG B).
  validate: async (templateId) => {
    const detail = await apiFetch(`${BASE}/${templateId}`, templateDetailSchema);
    return validateDag(detail.steps, detail.dependencies);
  },
  publish: (templateId) =>
    apiFetch(`${BASE}/${templateId}/publish`, templateSchema, { method: "POST" }),
  clone: (templateId) =>
    apiFetch(`${BASE}/${templateId}/clone`, templateSchema, { method: "POST" }),
  apply: async (templateId, req) => {
    const result = await apiFetch(`${BASE}/${templateId}/apply`, applyResultSchema, {
      method: "POST",
      body: JSON.stringify(req),
    });
    return { instanceId: result.instance.id };
  },
};

const USE_MOCK = import.meta.env.VITE_WORKFLOW_MOCK === "true";

export const workflowTemplatesApi: WorkflowTemplatesApi = USE_MOCK
  ? mockTemplatesStore
  : realTemplatesApi;
