import { z } from "zod";
import {
  taskCommentResponseSchema,
  taskChecklistResponseSchema,
  taskChecklistItemResponseSchema,
  taskActivityLogResponseSchema,
  taskKanbanBoardSchema,
  taskActionResponseSchema,
  type TaskCommentResponseDto,
  type CreateTaskCommentRequest,
  type UpdateTaskCommentRequest,
  type TaskChecklistResponseDto,
  type TaskChecklistItemResponseDto,
  type CreateTaskChecklistRequest,
  type UpdateTaskChecklistRequest,
  type CreateTaskChecklistItemRequest,
  type UpdateTaskChecklistItemRequest,
  type TaskActivityLogResponseDto,
  type ListTaskActivityQueryRequest,
  type TaskKanbanBoardDto,
  type TaskActionResponseDto,
  type ChangeTaskStatusRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * TASK collaboration API client — S4-FE-TASK-3 (SPEC-06 §13.8/§14.13/§14.14/§14.16/§14.19,
 * S4-TASK-BE-4 routes ĐÃ merge: Kanban board+move · comment/mention · checklist/items · activity feed).
 *
 * BẤT BIẾN: company_id do SERVER resolve từ AuthContext — client KHÔNG nhận/forward. Response validate
 * Zod ở ranh giới (schema @mediaos/contracts task-collab.ts). Masking là việc của SERVER — client CHỈ
 * render field nhận được.
 *
 * Comment: TÁCH khỏi taskCoreApi CŨ (task-core-api.ts) — route `/tasks/:id/comments` server-side đã ĐỔI
 * sang TaskCommentsService (content/mentionEmployeeIds) từ S4-TASK-BE-4; client cũ dùng schema cũ
 * (`body`, KHÔNG mention) sẽ FAIL Zod validate ở response THẬT. `taskCoreApi.listComments/addComment` đã
 * gỡ — dùng CHÍNH client này (xem task-core-api.ts ghi chú).
 *
 * Mention "trong scope": FE KHÔNG có endpoint search-nhân-viên-theo-scope riêng — autocomplete dùng
 * CHÍNH danh sách `hrApi.listEmployees` (đã gate read:employee ở nơi gọi, server lọc theo data-scope của
 * actor) rồi lọc client-side theo chuỗi gõ. Validate THẬT (nhân viên có xem được task không) luôn ở SERVER
 * khi submit (403 MENTION-OUT-OF-SCOPE nếu sai) — client chỉ gợi ý, không tự quyết.
 *
 * Move (Kanban drag/drop) tái dùng CHÍNH `ChangeTaskStatusRequest`/`taskActionResponseSchema` — "move" là
 * route sugar cho `TaskActionsService.changeStatus` ở BE (KHÔNG service/schema riêng).
 */
export const taskCollabApi = {
  // ── Kanban board (GET /projects/:id/kanban, TASK-API-212, view-kanban:task) ──

  /** GET /projects/:id/kanban — board task theo cột task_status (5 cột cố định FSM). */
  getKanbanBoard: (projectId: string): Promise<TaskKanbanBoardDto> =>
    apiFetch(`/projects/${projectId}/kanban`, taskKanbanBoardSchema),

  /** POST /tasks/:id/move — kéo-thả đổi cột (update-status:task). Sai bảng FSM → 409 (mirror changeStatus). */
  moveTask: (taskId: string, body: ChangeTaskStatusRequest): Promise<TaskActionResponseDto> =>
    apiFetch(`/tasks/${taskId}/move`, taskActionResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Comments (GET/POST/PATCH/DELETE /tasks/:id/comments, TASK-API-301..304) ──

  /** GET /tasks/:id/comments — thread bình luận (read:task, chỉ khi task trong scope đọc). */
  listComments: (taskId: string): Promise<TaskCommentResponseDto[]> =>
    apiFetch(`/tasks/${taskId}/comments`, z.array(taskCommentResponseSchema)),

  /** POST /tasks/:id/comments — thêm bình luận + mention (comment:task). */
  addComment: (taskId: string, body: CreateTaskCommentRequest): Promise<TaskCommentResponseDto> =>
    apiFetch(`/tasks/${taskId}/comments`, taskCommentResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /tasks/:id/comments/:commentId — sửa bình luận, self-only MVP (comment:task). */
  updateComment: (
    taskId: string,
    commentId: string,
    body: UpdateTaskCommentRequest,
  ): Promise<TaskCommentResponseDto> =>
    apiFetch(`/tasks/${taskId}/comments/${commentId}`, taskCommentResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /tasks/:id/comments/:commentId — soft-delete (comment:task, 204). */
  deleteComment: (taskId: string, commentId: string): Promise<void> =>
    apiFetch(`/tasks/${taskId}/comments/${commentId}`, z.void(), { method: "DELETE" }),

  // ── Checklists + items (GET/POST/PATCH/DELETE /tasks/:id/checklists[...], update:task) ──

  /** GET /tasks/:id/checklists — nhóm checklist + item (read:task). */
  listChecklists: (taskId: string): Promise<TaskChecklistResponseDto[]> =>
    apiFetch(`/tasks/${taskId}/checklists`, z.array(taskChecklistResponseSchema)),

  /** POST /tasks/:id/checklists — tạo nhóm checklist + item khởi tạo (update:task). */
  createChecklist: (
    taskId: string,
    body: CreateTaskChecklistRequest,
  ): Promise<TaskChecklistResponseDto> =>
    apiFetch(`/tasks/${taskId}/checklists`, taskChecklistResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /tasks/:id/checklists/:checklistId — sửa tên/cờ bắt buộc/thứ tự (update:task). */
  updateChecklist: (
    taskId: string,
    checklistId: string,
    body: UpdateTaskChecklistRequest,
  ): Promise<TaskChecklistResponseDto> =>
    apiFetch(`/tasks/${taskId}/checklists/${checklistId}`, taskChecklistResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /tasks/:id/checklists/:checklistId — soft cascade xuống item (update:task, 204). */
  deleteChecklist: (taskId: string, checklistId: string): Promise<void> =>
    apiFetch(`/tasks/${taskId}/checklists/${checklistId}`, z.void(), { method: "DELETE" }),

  /** POST /tasks/:id/checklists/:checklistId/items — thêm hạng mục (update:task). */
  addChecklistItem: (
    taskId: string,
    checklistId: string,
    body: CreateTaskChecklistItemRequest,
  ): Promise<TaskChecklistItemResponseDto> =>
    apiFetch(`/tasks/${taskId}/checklists/${checklistId}/items`, taskChecklistItemResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH .../items/:itemId — tick is_done (update:task); backend tự ghi doneBy/doneAt. */
  updateChecklistItem: (
    taskId: string,
    checklistId: string,
    itemId: string,
    body: UpdateTaskChecklistItemRequest,
  ): Promise<TaskChecklistItemResponseDto> =>
    apiFetch(
      `/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`,
      taskChecklistItemResponseSchema,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  /** DELETE .../items/:itemId — soft-delete hạng mục (update:task, 204). */
  deleteChecklistItem: (taskId: string, checklistId: string, itemId: string): Promise<void> =>
    apiFetch(`/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`, z.void(), {
      method: "DELETE",
    }),

  // ── Activity feed (GET /tasks/:id/activity, TASK-API-602, view:task-audit-log SENSITIVE) ──

  /** GET /tasks/:id/activity — nhật ký hoạt động (view:task-audit-log, CHỈ hr/company-admin). */
  listActivity: (
    taskId: string,
    query?: Partial<ListTaskActivityQueryRequest>,
  ): Promise<TaskActivityLogResponseDto[]> =>
    apiFetch(
      `/tasks/${taskId}/activity${buildQueryString(query ?? {})}`,
      z.array(taskActivityLogResponseSchema),
    ),
};
