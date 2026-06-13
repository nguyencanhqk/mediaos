import { createZodDto } from "nestjs-zod";
import {
  createCommentSchema,
  createTaskSchema,
  updateTaskStatusSchema,
} from "@mediaos/contracts";

export class CreateCommentDto extends createZodDto(createCommentSchema) {}

/** Giao việc tay (G9-2): office task, không cần content/workflow. */
export class CreateTaskDto extends createZodDto(createTaskSchema) {}

/** Đổi trạng thái luồng rút gọn (G9-3) — chỉ status office. */
export class UpdateTaskStatusDto extends createZodDto(updateTaskStatusSchema) {}
