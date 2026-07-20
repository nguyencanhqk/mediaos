import { z } from "zod";
import {
  taskCoreResponseSchema,
  myTaskItemSchema,
  taskActionResponseSchema,
  taskWatcherResponseSchema,
  subtaskListItemSchema,
  type TaskCoreResponseDto,
  type MyTaskItemDto,
  type TaskActionResponseDto,
  type TaskWatcherResponseDto,
  type SubtaskListItemDto,
  type ListTaskCoreQueryRequest,
  type CreateTaskCoreRequest,
  type UpdateTaskCoreRequest,
  type AssignTaskRequest,
  type ChangeTaskStatusRequest,
  type ChangeTaskPriorityRequest,
  type ChangeTaskDeadlineRequest,
  type ReorderSubtasksRequest,
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
 * Watchers (S5-TASK-DETAIL-1 GAP 4): GET /tasks/:id/watchers trả danh sách Active/Muted kèm tên +
 * userId ⇒ client nhận diện "watcher của mình" để lấy watcherId gọi removeWatcher (DELETE vẫn
 * self-only server-side — gỡ watcher người khác → 404). Cả 3 route gate watch:task.
 *
 * `listComments`/`addComment` ĐÃ GỠ khỏi client này (S4-FE-TASK-3) — route `/tasks/:id/comments` server-side
 * đổi sang TaskCommentsService (content/mentionEmployeeIds, S4-TASK-BE-4) nên schema `commentSchema` cũ
 * (`body`, không mention) FAIL Zod validate ở response thật. Dùng `taskCollabApi.listComments/addComment/
 * updateComment/deleteComment` (task-collab-api.ts) — cùng URL, đúng schema mới.
 *
 * Việc con (S5-TASK-SUBTASK-1, DECISIONS-05): `listSubtasks`/`reorderSubtasks` nối TASK-API-701/702.
 * `listSubtasks` trả MẢNG TRẦN theo `subtaskListItemSchema` (DTO HẸP D-39 — KHÔNG phải
 * taskCoreResponseSchema, KHÔNG khai envelope {data,meta} — bẫy apifetch-drops-pagination-bare-array).
 * Tạo/sửa/xoá 1 việc con dùng LẠI createTask/updateTask/deleteTask ở trên (KHÔNG endpoint riêng) —
 * tạo con truyền `parentTaskId`, KHÔNG gửi kèm `projectId`/`stateId` (BE suy từ cha, gửi lệch → 400).
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

  /** GET /tasks/:id/watchers (S5-TASK-DETAIL-1) — danh sách người theo dõi Active/Muted (watch:task). */
  listWatchers: (id: string): Promise<TaskWatcherResponseDto[]> =>
    apiFetch(`/tasks/${id}/watchers`, z.array(taskWatcherResponseSchema)),

  /** DELETE /tasks/:id/watchers/:watcherId — bỏ theo dõi self-only (watch:task, 204; của người khác → 404). */
  removeWatcher: (id: string, watcherId: string): Promise<void> =>
    apiFetch(`/tasks/${id}/watchers/${watcherId}`, z.void(), { method: "DELETE" }),

  /** GET /tasks/:taskId/subtasks (TASK-API-701, read:task, scope trên CHA — D-39 đọc thừa hưởng).
   * Task không có con ⇒ mảng rỗng (KHÔNG 404). */
  listSubtasks: (taskId: string): Promise<SubtaskListItemDto[]> =>
    apiFetch(`/tasks/${taskId}/subtasks`, z.array(subtaskListItemSchema)),

  /** PATCH /tasks/:taskId/subtasks/reorder (TASK-API-702, update:task + scope GHI trên CHA). Tập
   * `subtaskIds` phải KHỚP CHÍNH XÁC tập con hiện có (thiếu/thừa/lạ → 400). Trả MẢNG TRẦN đã sắp lại
   * (server-side, cùng schema với listSubtasks) — KHÔNG ghi activity/audit (thay đổi trình bày, không
   * phải vòng đời — DECISIONS-05). */
  reorderSubtasks: (taskId: string, body: ReorderSubtasksRequest): Promise<SubtaskListItemDto[]> =>
    apiFetch(`/tasks/${taskId}/subtasks/reorder`, z.array(subtaskListItemSchema), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
