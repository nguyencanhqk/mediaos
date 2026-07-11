import { z } from "zod";
import {
  taskCoreResponseSchema,
  myTaskItemSchema,
  taskActionResponseSchema,
  commentSchema,
  type TaskCoreResponseDto,
  type MyTaskItemDto,
  type CommentDto,
  type TaskActionResponseDto,
  type ListTaskCoreQueryRequest,
  type CreateTaskCoreRequest,
  type UpdateTaskCoreRequest,
  type AssignTaskRequest,
  type ChangeTaskStatusRequest,
  type ChangeTaskPriorityRequest,
  type ChangeTaskDeadlineRequest,
  type CreateCommentRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * TASK core API client — S4-FE-TASK-2 (SPEC-06 §7/§9/§14, routes S4-TASK-BE-2/BE-3 ĐÃ merge).
 *
 * BẤT BIẾN: company_id do SERVER resolve từ AuthContext — client KHÔNG nhận/forward (mirror hr-api.ts /
 * task-project-api.ts). Response validate Zod ở ranh giới (schema @mediaos/contracts task.ts/task-actions.ts).
 * Masking là việc của SERVER — client CHỈ render field nhận được.
 *
 * `listTasks`/`getMyTasks` trả MẢNG TRẦN (KHÔNG envelope {items,meta} — xem task-core.service.ts) → validate
 * bằng z.array(schema). Phân trang listTasks ở FE làm limit/offset "load more" (KHÔNG có total từ server),
 * mirror task-project-api.ts. getMyTasks KHÔNG phân trang (gộp 3 nguồn, server tự sort quá-hạn-lên-đầu).
 *
 * 6 action mutate vòng đời (assign/change-status/change-priority/change-deadline/watchers add-remove) là
 * crown-FSM S4-TASK-BE-3 — verb canonical SPEC-06 §16.3 TK-4 (KHÔNG PUT .../status). Response chung
 * `{task, warnings}` (taskActionResponseSchema) — warnings[] KHÔNG chặn hành động, chỉ hiển thị cảnh báo.
 *
 * KHÔNG có endpoint GET liệt kê watchers (BE-3 tự nhận self-only MVP — xem task-actions.controller ghi
 * chú) ⇒ client KHÔNG thể lấy watcherId để gọi removeWatcher sau khi addWatcher thành công (response chỉ
 * trả {task, warnings}, không có watcher row). TaskAssignControl vì vậy CHỈ hỗ trợ "Theo dõi" (add, idempotent
 * qua 409 DUPLICATE), KHÔNG có nút "Bỏ theo dõi" — backend gap, ghi trong PR/backlog theo dõi riêng.
 */
export const taskCoreApi = {
  /** GET /tasks — danh sách task theo data-scope thật (read:task). Filter status/priority/assignee/project/
   * due-range/overdue + pagination. */
  listTasks: (query?: Partial<ListTaskCoreQueryRequest>): Promise<TaskCoreResponseDto[]> =>
    apiFetch(`/tasks${buildQueryString(query ?? {})}`, z.array(taskCoreResponseSchema)),

  /** GET /tasks/my — task của CHÍNH user (read:task): gộp assigned+created+watched, mỗi dòng kèm `source`. */
  getMyTasks: (): Promise<MyTaskItemDto[]> => apiFetch(`/tasks/my`, z.array(myTaskItemSchema)),

  /** GET /tasks/:id — chi tiết 1 task core (read:task, cùng data-scope với list). */
  getTask: (id: string): Promise<TaskCoreResponseDto> =>
    apiFetch(`/tasks/${id}`, taskCoreResponseSchema),

  /** POST /tasks — tạo task core (create:task). title bắt buộc, project optional (task cá nhân MVP). */
  createTask: (body: CreateTaskCoreRequest): Promise<TaskCoreResponseDto> =>
    apiFetch(`/tasks`, taskCoreResponseSchema, { method: "POST", body: JSON.stringify(body) }),

  /** PATCH /tasks/:id — cập nhật field task core (update:task). KHÔNG đổi status (action riêng). */
  updateTask: (id: string, body: UpdateTaskCoreRequest): Promise<TaskCoreResponseDto> =>
    apiFetch(`/tasks/${id}`, taskCoreResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /tasks/:id — soft-delete (delete:task, sensitive, 204). */
  deleteTask: (id: string): Promise<void> =>
    apiFetch(`/tasks/${id}`, z.void(), { method: "DELETE" }),

  /** POST /tasks/:id/assign — giao việc Main assignee (assign:task). */
  assign: (id: string, body: AssignTaskRequest): Promise<TaskActionResponseDto> =>
    apiFetch(`/tasks/${id}/assign`, taskActionResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /tasks/:id/change-status — chuyển trạng thái FSM (update-status:task). Sai bảng → 409. */
  changeStatus: (id: string, body: ChangeTaskStatusRequest): Promise<TaskActionResponseDto> =>
    apiFetch(`/tasks/${id}/change-status`, taskActionResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /tasks/:id/change-priority (update-priority:task). */
  changePriority: (id: string, body: ChangeTaskPriorityRequest): Promise<TaskActionResponseDto> =>
    apiFetch(`/tasks/${id}/change-priority`, taskActionResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /tasks/:id/change-deadline (update-deadline:task). dueAt=null → gỡ hạn. */
  changeDeadline: (id: string, body: ChangeTaskDeadlineRequest): Promise<TaskActionResponseDto> =>
    apiFetch(`/tasks/${id}/change-deadline`, taskActionResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /tasks/:id/watchers — tự theo dõi, self-only MVP (watch:task). Body rỗng. 409 nếu đã theo dõi. */
  addWatcher: (id: string): Promise<TaskActionResponseDto> =>
    apiFetch(`/tasks/${id}/watchers`, taskActionResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  /** GET /tasks/:id/comments — thread bình luận (KHÔNG gate — user xem được task thì xem được comment). */
  listComments: (id: string): Promise<CommentDto[]> =>
    apiFetch(`/tasks/${id}/comments`, z.array(commentSchema)),

  /** POST /tasks/:id/comments — thêm bình luận (comment:task). */
  addComment: (id: string, body: CreateCommentRequest): Promise<CommentDto> =>
    apiFetch(`/tasks/${id}/comments`, commentSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
