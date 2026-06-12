import {
  workflowDetailSchema,
  workflowStepSchema,
  type AssignStepRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Workflow API — khởi tạo + xem + gán bước cho 1 content item.
 * Bước thực thi (start/submit) và duyệt (approve/revision) ở `tasks-api.ts` qua trang /tasks.
 */
export const workflowApi = {
  /** GET /workflow/by-content/:id — workflow của content (null nếu chưa bắt đầu). */
  getByContent: (contentItemId: string) =>
    apiFetch(`/workflow/by-content/${contentItemId}`, workflowDetailSchema.nullable()),

  /** POST /workflow/start — tạo instance + 4 bước + task bước 1. */
  start: (contentItemId: string) =>
    apiFetch("/workflow/start", workflowDetailSchema, {
      method: "POST",
      body: JSON.stringify({ contentItemId }),
    }),

  /** POST /workflow/steps/:id/assign — PM gán assignee + reviewer. */
  assignStep: (stepId: string, data: AssignStepRequest) =>
    apiFetch(`/workflow/steps/${stepId}/assign`, workflowStepSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
