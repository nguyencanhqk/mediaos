import { z } from "zod";
import { taskSchema, commentSchema, approvalRequestSchema } from "@mediaos/contracts";
import type {
  CreateCommentRequest,
  CreateTaskRequest,
  ListTasksQueryRequest,
  OfficeTaskStatusDto,
  SubmitStepRequest,
  ApproveRequest,
  RequestRevisionRequest,
} from "@mediaos/contracts";

/** Build query-string từ page params (limit/offset). */
function pageQuery(page?: { limit?: number; offset?: number }): string {
  if (!page) return "";
  const params = new URLSearchParams();
  if (page.limit !== undefined) params.set("limit", String(page.limit));
  if (page.offset !== undefined) params.set("offset", String(page.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Build query-string từ filter board (chỉ field có giá trị). */
function boardQuery(filter?: ListTasksQueryRequest): string {
  if (!filter) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
// H-NEW-1 (gate merge-G9): dùng apiFetch CHUNG (api-client.ts) như mọi *-api.ts anh em —
// ném ApiError có status/code (403 PermissionGuard, 400 SEC-1/SEC-2 phân biệt được ở UI),
// KHÔNG tự định nghĩa apiFetch local ném Error thường (nuốt mất cấu trúc lỗi).
import { apiFetch } from "./api-client";

export const tasksApi = {
  getMyTasks: () => apiFetch("/tasks", z.array(taskSchema)),

  // ─── Task Board (G9-3) ──────────────────────────────────────────────────────
  // Server là nguồn sự thật: GET /tasks/board gated `read:task` (PermissionGuard). Client chỉ ẩn
  // UX qua <PermissionGate> — KHÔNG tự quyết quyền; row server không trả thì client không render được.
  /** Board tổng — lọc theo task_type/status/project/assignee + page. Trả mảng TaskDto. */
  getBoard: (filter?: ListTasksQueryRequest) =>
    apiFetch(`/tasks/board${boardQuery(filter)}`, z.array(taskSchema)),

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
  deleteTask: (taskId: string) => apiFetch(`/tasks/${taskId}`, z.void(), { method: "DELETE" }),

  // ─── Task Hub views (G9-4) ──────────────────────────────────────────────────
  // Server gated read:task cho cả hai. Client ẩn nav qua <PermissionGate> nhưng server là sự thật.

  /** Project Tasks — task thuộc 1 dự án. Gated read:task. */
  getProjectTasks: (projectId: string, page?: { limit?: number; offset?: number }) =>
    apiFetch(`/tasks/by-project/${projectId}${pageQuery(page)}`, z.array(taskSchema)),

  /** Team Tasks — task giao cho thành viên đang active của 1 team. Gated read:task. */
  getTeamTasks: (teamId: string, page?: { limit?: number; offset?: number }) =>
    apiFetch(`/tasks/by-team/${teamId}${pageQuery(page)}`, z.array(taskSchema)),

  getComments: (taskId: string) => apiFetch(`/tasks/${taskId}/comments`, z.array(commentSchema)),

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
