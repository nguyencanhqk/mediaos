import { z } from "zod";
import { taskSchema, commentSchema, approvalRequestSchema } from "@mediaos/contracts";
import type {
  CreateCommentRequest,
  CreateTaskRequest,
  OfficeTaskStatusDto,
  SubmitStepRequest,
  ApproveRequest,
  RequestRevisionRequest,
} from "@mediaos/contracts";
import { unwrapEnvelope } from "./api-client";

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
  return schema.parse(unwrapEnvelope(json));
}

export const tasksApi = {
  getMyTasks: () => apiFetch("/tasks", z.array(taskSchema)),

  // ─── Manual office task (G9-2 / TASK-001) ──────────────────────────────────
  // Server là nguồn sự thật: POST gated `create:task`, PATCH `update:task`, DELETE `delete:task`
  // (PermissionGuard ở controller). Client chỉ ẩn UX qua <PermissionGate> — KHÔNG tự quyết quyền.

  /** Giao việc tay — tạo office task ngoài workflow. Trả TaskDto đầy đủ (parse qua taskSchema). */
  createTask: (data: CreateTaskRequest) =>
    apiFetch("/tasks", taskSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Đổi status theo luồng rút gọn (Chưa bắt đầu → Đang làm → Hoàn thành). `status` bị thu hẹp về
   * OfficeTaskStatusDto ở compile-time — không gửi được status workflow (waiting_review/approved/
   * revision); BE còn safeParse lần nữa (SEC-2 defense-in-depth).
   */
  updateTaskStatus: (taskId: string, status: OfficeTaskStatusDto) =>
    apiFetch(`/tasks/${taskId}/status`, taskSchema, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  /** Soft-delete office task (BE trả 204; workflow-driven task bị BE từ chối). */
  deleteTask: (taskId: string) =>
    apiFetch(`/tasks/${taskId}`, z.void(), { method: "DELETE" }),

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
