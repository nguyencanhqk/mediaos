import { z } from "zod";
import { boardTaskSchema, commentSchema, taskSchema } from "@mediaos/contracts";
import type {
  CreateCommentRequest,
  CreateTaskRequest,
  ListTasksQueryRequest,
  UpdateTaskFieldsRequest,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

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

/**
 * API work item kiểu Plane (PM-1) — board + CRUD + comments + label gắn task. Server là nguồn sự thật:
 * gated `read/create/update/delete:task` (PermissionGuard); client chỉ ẩn UX qua <PermissionGate>.
 *
 * GET /tasks/board trả BoardTaskDto[] (taskSchema + labels[] + priority/state/displayId…). Lọc theo
 * projectId/stateId/priority/labelId + page.
 */
export const tasksApi = {
  getBoard: (filter?: ListTasksQueryRequest) =>
    apiFetch(`/tasks/board${boardQuery(filter)}`, z.array(boardTaskSchema)),

  createTask: (data: CreateTaskRequest) =>
    apiFetch("/tasks", taskSchema, { method: "POST", body: JSON.stringify(data) }),

  /** PATCH field work item (partial — title/description/priority/stateId/assignee/due/start). */
  updateTask: (taskId: string, data: UpdateTaskFieldsRequest) =>
    apiFetch(`/tasks/${taskId}`, taskSchema, { method: "PATCH", body: JSON.stringify(data) }),

  deleteTask: (taskId: string) => apiFetch(`/tasks/${taskId}`, z.void(), { method: "DELETE" }),

  // ── Labels gắn task (POST/DELETE) — gated update:task ──────────────────────
  addLabel: (taskId: string, labelId: string) =>
    apiFetch(`/tasks/${taskId}/labels/${labelId}`, z.unknown(), { method: "POST" }),

  removeLabel: (taskId: string, labelId: string) =>
    apiFetch(`/tasks/${taskId}/labels/${labelId}`, z.void(), { method: "DELETE" }),

  // ── Comments ───────────────────────────────────────────────────────────────
  getComments: (taskId: string) => apiFetch(`/tasks/${taskId}/comments`, z.array(commentSchema)),

  addComment: (taskId: string, data: CreateCommentRequest) =>
    apiFetch(`/tasks/${taskId}/comments`, commentSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
