import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { tasks } from "../db/schema";

/**
 * G13-4 — Cầu nối Task Hub cho đề xuất chi (BẤT BIẾN #4 — Task Hub hợp nhất):
 * expense request tạo task `task_type='finance'` trong CHUNG bảng `tasks`, KHÔNG bảng/luồng duyệt riêng.
 * Mirror hr-tasks.service.ts. Mọi method nhận TenantTx — tạo/đóng task PHẢI cùng transaction với
 * expense (cùng commit/rollback) để không để task mồ côi / cost không có approval.
 *
 * Provider stateless, FinanceModule provide CỤC BỘ (KHÔNG import TasksModule) → không đụng module dùng
 * chung trong lane song song.
 */
@Injectable()
export class FinanceTasksService {
  /**
   * Tạo task duyệt đề xuất chi. assigneeUserId = người duyệt (approver), null = hàng chờ finance.
   * dueDate = neededAt của đề xuất (nếu có).
   */
  async createApprovalTaskTx(
    tx: TenantTx,
    companyId: string,
    data: { title: string; assigneeUserId: string | null; dueDate?: Date | null },
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(tasks)
      .values({
        companyId,
        taskType: "finance",
        title: data.title,
        assigneeUserId: data.assigneeUserId,
        status: "not_started",
        origin: "initial",
        dueDate: data.dueDate ?? null,
      })
      .returning({ id: tasks.id });
    if (!row) throw new InternalServerErrorException("Failed to create finance approval task");
    return row;
  }

  /**
   * Đóng task khi đề xuất được duyệt/từ chối. Task Hub chỉ phản chiếu — quyết định nằm ở expense
   * (status + expense_approvals + audit). 'approved' khi duyệt, 'completed' khi từ chối.
   */
  async closeTaskTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    outcome: "approved" | "completed",
  ): Promise<void> {
    await tx
      .update(tasks)
      .set({ status: outcome, updatedAt: new Date() })
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId), isNull(tasks.deletedAt)));
  }
}
