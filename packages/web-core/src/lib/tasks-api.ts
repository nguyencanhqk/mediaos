import { z } from "zod";
import {
  taskSchema,
  boardTaskSchema,
  commentSchema,
  type TaskDto,
  type BoardTaskDto,
  type CommentDto,
  type CreateTaskRequest,
  type CreateCommentRequest,
  type ListTasksQueryRequest,
  type OfficeTaskStatusDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * TASK API client — S4-FE-REGISTRY-1 (skeleton typed, page thật = S4-FE-TASK-1).
 *
 * BẤT BIẾN: company_id do SERVER resolve từ AuthContext — client KHÔNG nhận/forward (mirror
 * attendance-api.ts / my-notification-api.ts). Response validate Zod ở ranh giới (schema @mediaos/contracts
 * task.ts). KHÔNG import token-storage (apiFetch tự gắn Bearer + refresh-on-401 + envelope unwrap).
 *
 * Gate là việc của SERVER: GET /tasks (My Tasks) read mở (việc của chính mình); GET /tasks/board +
 * by-project/by-team gated read:task (đọc chéo tenant, non-sensitive → grant công ty đủ); mutation gated
 * create/update/delete:task. Client chỉ chọn endpoint + render field server trả.
 *
 * List endpoint trả MẢNG TRẦN (TaskDto[] / BoardTaskDto[] / CommentDto[]) theo service (KHÔNG envelope
 * {items}) → validate bằng z.array(schema). Nếu BE đổi shape, validator ném ở ranh giới (fail-closed).
 */
export const tasksApi = {
  /** GET /tasks — việc được giao cho tôi (read mở, không gate). */
  getMyTasks: (): Promise<TaskDto[]> => apiFetch("/tasks", z.array(taskSchema)),

  /**
   * GET /tasks/board — Task Board tổng (đọc chéo tenant). Permission: read:task.
   * Filter/pagination qua ListTasksQueryRequest (clamp ở biên contract).
   */
  getBoard: (query?: Partial<ListTasksQueryRequest>): Promise<BoardTaskDto[]> =>
    apiFetch(`/tasks/board${buildQueryString(query ?? {})}`, z.array(boardTaskSchema)),

  /** GET /tasks/by-project/:projectId — task theo dự án. Permission: read:task. */
  getProjectTasks: (
    projectId: string,
    query?: { limit?: number; offset?: number },
  ): Promise<BoardTaskDto[]> =>
    apiFetch(
      `/tasks/by-project/${projectId}${buildQueryString(query ?? {})}`,
      z.array(boardTaskSchema),
    ),

  /** POST /tasks — giao việc tay (office task ngoài workflow). Permission: create:task. */
  createTask: (body: CreateTaskRequest): Promise<TaskDto> =>
    apiFetch("/tasks", taskSchema, { method: "POST", body: JSON.stringify(body) }),

  /** PATCH /tasks/:taskId/status — luồng rút gọn office (not_started/in_progress/completed). Permission: update:task. */
  updateStatus: (taskId: string, status: OfficeTaskStatusDto): Promise<TaskDto> =>
    apiFetch(`/tasks/${taskId}/status`, taskSchema, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  /** GET /tasks/:taskId/comments — thread bình luận. */
  getComments: (taskId: string): Promise<CommentDto[]> =>
    apiFetch(`/tasks/${taskId}/comments`, z.array(commentSchema)),

  /** POST /tasks/:taskId/comments — thêm bình luận. Permission: comment:comment. */
  addComment: (taskId: string, body: CreateCommentRequest): Promise<CommentDto> =>
    apiFetch(`/tasks/${taskId}/comments`, commentSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
