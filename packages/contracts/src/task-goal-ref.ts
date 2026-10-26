import { z } from "zod";

/**
 * Tham chiếu mục tiêu của bản ghi việc (S5-GOAL-BE-2 · SPEC-10 §7 · GOAL-API-010), dùng chung cho
 * `taskCoreResponseSchema` (và mọi schema spread từ nó: thẻ kanban, việc của tôi, phản hồi action).
 *
 * S20-SEC-GOALNAMEDTO-1 — `goalId`/`goalCode`/`goalName` CHỈ có giá trị khi người xem đọc được chính
 * mục tiêu đó qua đường đọc mục tiêu chuẩn (cặp `('view','goal')` + phạm vi đọc của mục tiêu); còn lại
 * server trả null cả ba. `hasGoal` = việc đang gắn một mục tiêu còn sống — cờ TRUNG TÍNH, không mang
 * id/tên/mã; FE dùng để hiện chip «có mục tiêu» thay vì «—». Che là việc của SERVER.
 *
 * Mọi trường `.optional()` additive, KHÔNG `.default()` (giữ Input=Output cho apiFetch<T>): FE mới
 * parse được phản hồi API cũ (không có cờ) và FE cũ bỏ qua khoá lạ của API mới.
 */
export const taskGoalRefShape = {
  goalId: z.string().uuid().nullable().optional(),
  goalCode: z.string().nullable().optional(),
  goalName: z.string().nullable().optional(),
  hasGoal: z.boolean().optional(),
};
