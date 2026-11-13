import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// S20-TASK-MYTASKSLOAD-1 — query của GET /tasks/my («Việc của tôi» tải nhẹ).
// ═══════════════════════════════════════════════════════════════════════════════

/** Trần số việc ĐÃ ĐÓNG (Done/Cancelled) trả về khi `includeClosed=true`. */
export const MY_TASKS_CLOSED_LIMIT = 100;

/**
 * Boolean query-param CHẶT, idempotent dưới ZodValidationPipe KÉP: nhận "true"/"false" lẫn boolean;
 * `undefined` ⇒ undefined; MỌI giá trị khác đi nguyên ⇒ `z.boolean()` từ chối ⇒ 400 (khác
 * `taskCoreOptionalBooleanParam` nuốt rác thành undefined).
 */
export const taskCoreStrictBooleanParam = () =>
  z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean().optional());

export const myTasksQuerySchema = z.object({
  includeClosed: taskCoreStrictBooleanParam(),
});
export type MyTasksQueryRequest = z.infer<typeof myTasksQuerySchema>;
