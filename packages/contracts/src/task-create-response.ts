import { z } from "zod";
import { taskCoreResponseSchema } from "./task";
import { taskActionWarningSchema } from "./task-actions";

/**
 * S20-TASK-ASSIGNNOTI-1 — phản hồi `POST /tasks` (TASK-API-202) = bản ghi việc + `warnings[]` như route
 * `/assign` (người được giao nghỉ phép trùng ngày hạn · không là thành viên dự án). Tách khỏi `./task` (đã quá
 * 800 dòng); import NGƯỢC, KHÔNG re-export tên nào của hai file kia.
 *
 * `warnings` `.optional()` additive (KHÔNG `.default()` — giữ Input=Output cho `apiFetch<T>`): FE và API
 * deploy lệch pha vẫn parse được; server mới LUÔN điền (mảng rỗng khi không có cảnh báo).
 */
export const taskCoreCreateResponseSchema = taskCoreResponseSchema.extend({
  warnings: z.array(taskActionWarningSchema).optional(),
});
export type TaskCoreCreateResponseDto = z.infer<typeof taskCoreCreateResponseSchema>;
