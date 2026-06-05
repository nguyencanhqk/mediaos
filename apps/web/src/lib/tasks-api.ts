import { z } from "zod";
import { taskSchema, commentSchema, approvalRequestSchema } from "@mediaos/contracts";
import type {
  CreateCommentRequest,
  SubmitStepRequest,
  ApproveRequest,
  RequestRevisionRequest,
} from "@mediaos/contracts";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3100/api/v1";

async function apiFetch<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return schema.parse(json);
}

export const tasksApi = {
  getMyTasks: () => apiFetch("/tasks", z.array(taskSchema)),

  getComments: (taskId: string) =>
    apiFetch(`/tasks/${taskId}/comments`, z.array(commentSchema)),

  addComment: (taskId: string, data: CreateCommentRequest) =>
    apiFetch(`/tasks/${taskId}/comments`, commentSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  submitStep: (stepId: string, data: SubmitStepRequest) =>
    apiFetch(`/workflow/steps/${stepId}/submit`, z.unknown(), {
      method: "POST",
      body: JSON.stringify(data),
    }),

  startStep: (stepId: string) =>
    apiFetch(`/workflow/steps/${stepId}/start`, z.unknown(), { method: "POST" }),

  // ─── Approval ─────────────────────────────────────────────────────────────

  listApprovalRequests: () =>
    apiFetch("/workflow/approval-requests", z.array(approvalRequestSchema)),

  approve: (requestId: string, data: ApproveRequest) =>
    apiFetch(`/workflow/approval-requests/${requestId}/approve`, z.unknown(), {
      method: "POST",
      body: JSON.stringify(data),
    }),

  requestRevision: (requestId: string, data: RequestRevisionRequest) =>
    apiFetch(`/workflow/approval-requests/${requestId}/request-revision`, z.unknown(), {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
