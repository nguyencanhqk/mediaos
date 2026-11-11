import { z } from "zod";
import { idSchema } from "./common/id";

/**
 * S20-TASK-WORKLOAD-1 — màn «Đội của tôi» (GET /tasks/workload, SPEC-06 §14.17 · US-TASK-QL-04).
 * Tệp RIÊNG vì `task.ts` đã vượt 800 dòng.
 *
 * Schema xuất ra KHÔNG `.strict()` (zod mặc định bỏ khoá lạ): FE parse bằng chính nó ⇒ WO sau thêm trường
 * thì FE cũ không vỡ. Lớp cứng hoá DTO ở SERVER: service dựng từng dòng bằng gán tường minh + unit
 * `strict().parse` đúng tập khoá (không avatar/email/chức danh/userId).
 */

/** Trần số dòng người trả về (không tính dòng «Chưa giao»). */
export const TASK_WORKLOAD_MAX_ROWS = 100;

export const taskWorkloadQuerySchema = z.object({
  projectId: idSchema.optional(),
  departmentId: idSchema.optional(),
});
export type TaskWorkloadQuery = z.infer<typeof taskWorkloadQuerySchema>;

export const taskWorkloadCountsSchema = z.object({
  /** Việc MỞ (không Done/Cancelled). */
  activeCount: z.number().int().min(0),
  overdueCount: z.number().int().min(0),
  /** Mở, chưa quá hạn, hạn trước hết ngày thứ 7 tính từ hôm nay (giờ công ty). */
  dueSoon7dCount: z.number().int().min(0),
  inReviewCount: z.number().int().min(0),
  /** Số NGÀY (lịch công ty) trễ lâu nhất trong các việc quá hạn; null khi không có việc quá hạn. */
  maxOverdueDays: z.number().int().min(0).nullable(),
});
export type TaskWorkloadCounts = z.infer<typeof taskWorkloadCountsSchema>;

export const taskWorkloadRowSchema = taskWorkloadCountsSchema.extend({
  employeeId: idSchema,
  /** Tên hiển thị; null khi hồ sơ/tài khoản đã xoá mềm. */
  displayName: z.string().nullable(),
});
export type TaskWorkloadRow = z.infer<typeof taskWorkloadRowSchema>;

export const taskWorkloadResponseSchema = z.object({
  items: z.array(taskWorkloadRowSchema).max(TASK_WORKLOAD_MAX_ROWS),
  /** Dòng «Chưa giao»; null khi không có việc mở chưa giao trong phạm vi (luôn null ở phạm vi Own). */
  unassigned: taskWorkloadCountsSchema.nullable(),
  /** true khi còn người bị cắt do trần — nhắc người dùng lọc theo dự án/phòng ban. */
  truncated: z.boolean(),
});
export type TaskWorkloadResponse = z.infer<typeof taskWorkloadResponseSchema>;
