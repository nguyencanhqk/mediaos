import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { tasks } from "../db/schema";
import { SequenceService } from "../foundation/sequences/sequence.service";
import { allocateTaskCode } from "./task-code.util";

/**
 * Cầu nối Task Hub cho đơn HR (BẤT BIẾN Task Hub hợp nhất — CLAUDE.md G11 §1.3):
 * đơn bổ sung công + đơn nghỉ tạo task `task_type='hr'` trong CHUNG bảng tasks, KHÔNG bảng riêng.
 * Mọi method nhận TenantTx — tạo/đóng task PHẢI cùng transaction với đơn (cùng commit/rollback).
 *
 * Provider này stateless, được AttendanceModule/LeaveModule provide cục bộ (không cần TasksModule)
 * để tránh sửa module dùng chung trong lane song song.
 *
 * S5-TASK-HRCODE-1 — inject SequenceService + DatabaseService để cấp `task_code` cho task HR (mirror
 * TaskCoreService.createTask): caller gọi `allocateTaskCodeBeforeTx(companyId)` Ở TX RIÊNG TRƯỚC tx đơn
 * (KHÔNG giữ lock counter suốt tx dài) rồi truyền `taskCode` vào `createApprovalTaskTx` để GHI vào row.
 *
 * DI — SequenceService là BẮT BUỘC (KHÔNG `@Optional()`): mọi module provide HrTasksService PHẢI
 * `imports: [SequenceModule]`. Hiện có đúng 2: AttendanceModule (dùng thật — cấp task_code cho đơn điều
 * chỉnh công) và LeaveModule (chỉ để DI resolve; LEAVE không dùng task_code — khối gọi service này là code
 * chết, xem WO S5-LEAVE-DEADCODE-1). Bắt buộc thay vì Optional để thiếu wiring FAIL-FAST LÚC BOOT, thay vì
 * boot xanh rồi 500 ở request đầu tiên — module thứ 3 quên import sẽ lộ ngay khi khởi động.
 * Guard runtime trong `allocateTaskCodeBeforeTx` GIỮ làm defense-in-depth (bắt trường hợp khởi tạo tay/test
 * truyền thiếu) — ném TASK-ERR-CODE-SEQ-UNWIRED, tuyệt đối KHÔNG cấp mã câm/silent-null.
 * DatabaseService = @Global (luôn có).
 */
@Injectable()
export class HrTasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sequence: SequenceService,
  ) {}

  /**
   * Cấp mã task kế tiếp (`TASK-####`) Ở TX RIÊNG (FOR UPDATE 0-dup) TRƯỚC tx đơn — caller (leave/attendance
   * -adjustment) gọi TRƯỚC db.withTenant rồi truyền kết quả vào createApprovalTaskTx({ taskCode }). Ensure
   * -on-miss retry-once + map counter Inactive → 409 TASK-ERR-CODE-COUNTER-INACTIVE (util = 1 điểm map chung).
   * FAIL-LOUD nếu SequenceModule chưa được import vào module chứa provider này (KHÔNG cấp mã câm).
   */
  async allocateTaskCodeBeforeTx(companyId: string): Promise<string> {
    if (!this.sequence) {
      throw new InternalServerErrorException(
        "TASK-ERR-CODE-SEQ-UNWIRED: SequenceService chưa được cấp cho HrTasksService — module chứa provider phải import SequenceModule.",
      );
    }
    return allocateTaskCode(this.db, this.sequence, companyId);
  }

  /**
   * Tạo task duyệt đơn HR. assigneeUserId = người duyệt (quản lý trực tiếp), null = hàng chờ HR.
   * `taskCode` (tuỳ chọn) = mã đã cấp qua allocateTaskCodeBeforeTx — GHI vào cột tasks.task_code để
   * comment/mention render mã THẬT (không '{task_code}' câm). Chưa truyền ⇒ null (backward-compat).
   */
  async createApprovalTaskTx(
    tx: TenantTx,
    companyId: string,
    data: {
      title: string;
      assigneeUserId: string | null;
      dueDate?: Date | null;
      taskCode?: string | null;
    },
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
        taskCode: data.taskCode ?? null,
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
