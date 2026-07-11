import { createZodDto } from "nestjs-zod";
import {
  addMemberSchema,
  closeTaskProjectSchema,
  createTaskProjectSchema,
  listTaskProjectsQuerySchema,
  updateMemberRoleSchema,
  updateTaskProjectSchema,
} from "@mediaos/contracts";

/**
 * S4-TASK-BE-1 — DTO boundary cho Project domain (SPEC-06). Nguồn sự thật = Zod ở @mediaos/contracts
 * (task.ts, prefix `taskProject*`). createZodDto → validate qua ZodValidationPipe ở controller. Giữ file
 * riêng (KHÔNG nhồi vào tasks.dto.ts) theo quy tắc nhiều-file-nhỏ.
 */

/** POST /projects (create:project). name bắt buộc; owner-member set server-side (KHÔNG qua DTO). */
export class CreateTaskProjectDto extends createZodDto(createTaskProjectSchema) {}

/** PATCH /projects/:id (update:project) — partial; KHÔNG đổi status ở đây (đi qua verb close). */
export class UpdateTaskProjectDto extends createZodDto(updateTaskProjectSchema) {}

/** POST /projects/:id/close (close:project) — note tuỳ chọn ghi vào activity log. */
export class CloseTaskProjectDto extends createZodDto(closeTaskProjectSchema) {}

/** GET /projects (read:project) — status/ownerEmployeeId/search + limit/offset (coerce idempotent). */
export class ListTaskProjectsQueryDto extends createZodDto(listTaskProjectsQuerySchema) {}

/** POST /projects/:id/members (manage-member:project) — employeeId là nguồn sự thật (KHÔNG nhận user_id). */
export class AddMemberDto extends createZodDto(addMemberSchema) {}

/** PATCH /projects/:id/members/:memberId (manage-member:project) — chỉ đổi project_role. */
export class UpdateMemberRoleDto extends createZodDto(updateMemberRoleSchema) {}
