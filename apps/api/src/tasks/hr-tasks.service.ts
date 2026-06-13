import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { tasks } from "../db/schema";

/**
 * Cầu nối Task Hub cho đơn HR (BẤT BIẾN Task Hub hợp nhất — CLAUDE.md G11 §1.3):
 * đơn bổ sung công + đơn nghỉ tạo task `task_type='hr'` trong CHUNG bảng tasks, KHÔNG bảng riêng.
 * Mọi method nhận TenantTx — tạo/đóng task PHẢI cùng transaction với đơn (cùng commit/rollback).
 *
 * Provider này stateless, được AttendanceModule/LeaveModule provide cục bộ (không cần TasksModule)
 * để tránh sửa module dùng chung trong lane song song.
 */
@Injectable()
export class HrTasksService {
  /** Tạo task duyệt đơn HR. assigneeUserId = người duyệt (quản lý trực tiếp), null = hàng chờ HR. */
  async createApprovalTaskTx(
    tx: TenantTx,
    companyId: string,
    data: { title: string; assigneeUserId: string | null; dueDate?: Date | null },
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(tasks)
      .values({
        companyId,
        taskType: "hr",
        title: data.title,
        assigneeUserId: data.assigneeUserId,
        status: "not_started",
        origin: "initial",
        dueDate: data.dueDate ?? null,
      })
      .returning({ id: tasks.id });
    if (!row) throw new InternalServerErrorException("Failed to create HR approval task");
    return row;
  }

  /**
   * Đóng task khi đơn được duyệt/từ chối. Task Hub chỉ phản chiếu — quyết định nằm ở đơn
   * (status + approved_by + audit). 'approved' khi duyệt, 'completed' khi từ chối.
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

  /** Người gửi huỷ đơn pending → soft-delete task (không hard-delete, BẤT BIẾN #2). */
  async cancelTaskTx(tx: TenantTx, companyId: string, taskId: string): Promise<void> {
    await tx
      .update(tasks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId), isNull(tasks.deletedAt)));
  }
}
