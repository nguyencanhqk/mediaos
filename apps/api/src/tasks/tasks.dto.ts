import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  createAttachmentIntentSchema,
  createCommentSchema,
  createLabelSchema,
  createProjectStateSchema,
  createTaskCoreSchema,
  createTaskSchema,
  listTaskCoreQuerySchema,
  listTasksQuerySchema,
  updateLabelSchema,
  updateProjectStateSchema,
  updateTaskCoreSchema,
  updateTaskFieldsSchema,
  updateTaskStatusSchema,
} from "@mediaos/contracts";

export class CreateCommentDto extends createZodDto(createCommentSchema) {}

/** Giao việc tay (G9-2): office task, không cần content/workflow. */
export class CreateTaskDto extends createZodDto(createTaskSchema) {}

/** Đổi trạng thái luồng rút gọn (G9-3) — chỉ status office. */
export class UpdateTaskStatusDto extends createZodDto(updateTaskStatusSchema) {}

/**
 * Task Board query (G9-3) — validate filter + clamp page ở biên (limit ≤ 200, offset ≥ 0).
 * Nguồn sự thật là listTasksQuerySchema ở contracts (z.coerce parse @Query string thô).
 */
export class ListTasksQueryDto extends createZodDto(listTasksQuerySchema) {}

/**
 * Pagination-only query cho by-team / by-project endpoints (G9-4).
 * Path-param đã chứa teamId/projectId; chỉ cần page{limit,offset} qua query string.
 */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export class PageQueryDto extends createZodDto(pageQuerySchema) {}

/**
 * Upload-intent body (B4) — fileName/contentType/sizeBytes. allowlist + max-size là nguồn sự thật ở
 * contracts (createAttachmentIntentSchema). Service re-validate biên (defense-in-depth).
 */
export class CreateAttachmentIntentDto extends createZodDto(createAttachmentIntentSchema) {}

// ─── PM-1 (apps/projects, mig 0420) — work item / project_states / labels ────────

/** PATCH /tasks/:id — cập nhật field work item (partial; ≥1 field). KHÔNG đổi status (qua state/legacy). */
export class UpdateTaskFieldsDto extends createZodDto(updateTaskFieldsSchema) {}

/** POST /projects/:projectId/states — tạo trạng thái tùy biến. */
export class CreateProjectStateDto extends createZodDto(createProjectStateSchema) {}

/** PATCH /states/:stateId — sửa trạng thái (rename/recolor/reorder/set-default). */
export class UpdateProjectStateDto extends createZodDto(updateProjectStateSchema) {}

/** POST /projects/:projectId/labels — tạo nhãn màu. */
export class CreateLabelDto extends createZodDto(createLabelSchema) {}

/** PATCH /labels/:labelId — sửa nhãn (rename/recolor). */
export class UpdateLabelDto extends createZodDto(updateLabelSchema) {}

// ─── S4-TASK-BE-2 — Task core (SPEC-06 task CRUD + my-tasks + filter) ────────────

/** GET /tasks — filter status/priority/assignee/project/due-range/overdue + pagination (read:task). */
export class ListTaskCoreQueryDto extends createZodDto(listTaskCoreQuerySchema) {}

/** POST /tasks — tạo task core (create:task). title bắt buộc, project optional (task cá nhân MVP). */
export class CreateTaskCoreDto extends createZodDto(createTaskCoreSchema) {}

/** PATCH /tasks/:id — cập nhật field task core (update:task, partial ≥1 field, KHÔNG đổi status). */
export class UpdateTaskCoreDto extends createZodDto(updateTaskCoreSchema) {}
