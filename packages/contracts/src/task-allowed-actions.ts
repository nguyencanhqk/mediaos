import { z } from "zod";

/**
 * S20-TASK-ALLOWEDACTIONS-1 — khả năng thao tác của NGƯỜI GỌI trên một việc (chỉ chi tiết việc).
 *
 * Mỗi khoá = kết quả cổng THẬT của đúng route chuyên trách (cặp quyền + phạm vi ghi + vòng đời hàng),
 * server tính. CHỈ để trình bày (khoá trường, hiện lý do) — KHÔNG phải cổng an ninh: server vẫn
 * 403/404 khi thao tác. Mọi khoá optional ⇒ client cũ/server cũ không vỡ; khoá thiếu ⇒ FE quay về
 * `useCan` cho riêng khoá đó.
 */
export const TASK_ALLOWED_ACTION_KEYS = [
  "changeStatus",
  "changeState",
  "changeDeadline",
  "changePriority",
  "assign",
  "edit",
  "delete",
] as const;
export type TaskAllowedActionKey = (typeof TASK_ALLOWED_ACTION_KEYS)[number];

export const taskAllowedActionsSchema = z.object({
  changeStatus: z.boolean().optional(),
  changeState: z.boolean().optional(),
  changeDeadline: z.boolean().optional(),
  changePriority: z.boolean().optional(),
  assign: z.boolean().optional(),
  edit: z.boolean().optional(),
  delete: z.boolean().optional(),
  /** `"watcher"` ⇒ người gọi chỉ theo dõi việc (không có khoá chính nào); còn lại null/vắng. */
  lockReason: z.enum(["watcher"]).nullable().optional(),
});
export type TaskAllowedActions = z.infer<typeof taskAllowedActionsSchema>;
