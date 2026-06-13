import { createZodDto } from "nestjs-zod";
import {
  createCommentSchema,
  createTaskSchema,
  listTasksQuerySchema,
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
