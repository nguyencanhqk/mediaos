import { Injectable, Logger } from "@nestjs/common";
import { and, eq, gte, isNotNull, isNull, lt, lte, ne } from "drizzle-orm";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { tasks } from "../db/schema/workflow";
import { NotificationEngineService } from "./notification-engine.service";

export const TASK_REMINDER_JOB_CODE = "TASK_REMINDER";

const TASK_DUE_SOON_EVENT = "TASK_DUE_SOON";
const TASK_OVERDUE_EVENT = "TASK_OVERDUE";
/** Chỉ task_type='office' (SPEC-06 TASK module) — KHÔNG đụng task workflow-step/production/… (media-era,
 * out-of-scope, lifecycle do FSM sở hữu — mirror WORKFLOW_TASK_TYPES ở tasks.service.ts). */
const TASK_MODULE_TYPE = "office";
/** Trạng thái TERMINAL của office task (OfficeTaskStatusDto, packages/contracts/src/task.ts) — completed
 * = xong việc, KHÔNG nhắc nữa (dù due_date đã qua/sắp tới). */
const TERMINAL_STATUS = "completed";
/** Cửa sổ "sắp đến hạn" — mức scheduled cơ bản (IMPLEMENTATION-07 §8.4, không có window cụ thể trong spec). */
const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;
const SOURCE_MODULE = "TASK";
const SOURCE_ENTITY_TYPE = "task";

interface DueTaskRow {
  id: string;
  title: string;
  assigneeUserId: string | null;
  dueDate: Date | null;
}

/**
 * S4-NOTI-BE-3 (jobs) — TaskReminderJobHandler: quét `tasks` (task_type='office', chưa xoá, chưa
 * 'completed', có assignee + due_date) mỗi tenant → phát `TASK_DUE_SOON` (due_date trong 24h tới) /
 * `TASK_OVERDUE` (due_date đã qua) qua `NotificationEngineService.intake()` in-process (mirror comment
 * NotificationsModule "Export engine cho S4-INT-1 outbox consumer gọi intake() in-process" — job này là
 * caller THỨ HAI, không qua HTTP nội bộ).
 *
 * IDEMPOTENT (done_when "không gửi trùng trong ngày"): `dedupeKey = "<taskId>:<YYYY-MM-DD UTC>"` truyền qua
 * `InternalEventIntakeDto.dedupeKey` — NotificationDedupeService resolve strategy 'DedupeKey' cho 2 mã này
 * (APPEND vào DEFAULT_DEDUPE, notification-dedupe.const.ts — catalog mig 0481 để `dedupe_strategy='None'`).
 * Chạy job 2 lần cùng ngày cùng task/recipient → intake() tự dedupe (tầng 1 app + tầng 2 partial-unique DB),
 * KHÔNG tạo notification thứ 2 — engine trả `dedupedCount++`, KHÔNG throw (fire-and-forget).
 *
 * BẤT BIẾN #1: JobRunContext CHỈ `companyId` — handler TỰ mở `withTenant` (KHÔNG nhận `tx` từ JobRunner,
 * KHÔNG chạy nested-context, mirror RetentionCleanupJobHandler).
 *
 * Recipient = assignee (mode UserIds). Manager-on-overdue ("nếu cấu hình" — API-07 §16.4 TASK_OVERDUE):
 * KHÔNG có config surface nào tồn tại cho việc này (không bảng/route quản lý) ⇒ HOÃN, ghi rõ ở PR — KHÔNG
 * tự bịa quy tắc suy ra manager (tránh phantom notify không kiểm chứng được bằng test).
 */
@Injectable()
@SystemJobHandler()
export class TaskReminderJobHandler implements JobHandler {
  readonly jobCode = TASK_REMINDER_JOB_CODE;
  private readonly logger = new Logger(TaskReminderJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly engine: NotificationEngineService,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    const now = new Date();
    const dueSoonUntil = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
    // Bucket "ngày" ổn định UTC-at-rest (ADR-0008) — KHÔNG theo company TZ (mức scheduled cơ bản).
    const dayKey = now.toISOString().slice(0, 10);

    const [dueSoonTasks, overdueTasks] = await this.db.withTenant(companyId, async (tx) => {
      const dueSoon = await this.queryDue(tx, companyId, {
        from: now,
        to: dueSoonUntil,
      });
      const overdue = await this.queryDue(tx, companyId, { before: now });
      return [dueSoon, overdue] as const;
    });

    let success = 0;
    let failed = 0;
    const total = dueSoonTasks.length + overdueTasks.length;

    for (const task of dueSoonTasks) {
      if (await this.fireSafe(companyId, TASK_DUE_SOON_EVENT, task, dayKey)) success++;
      else failed++;
    }
    for (const task of overdueTasks) {
      if (await this.fireSafe(companyId, TASK_OVERDUE_EVENT, task, dayKey)) success++;
      else failed++;
    }

    return {
      total,
      success,
      failed,
      metadata: { dueSoonCount: dueSoonTasks.length, overdueCount: overdueTasks.length },
    };
  }

  private async queryDue(
    tx: TenantTx,
    companyId: string,
    window: { from: Date; to: Date } | { before: Date },
  ): Promise<DueTaskRow[]> {
    const windowCond =
      "before" in window
        ? lt(tasks.dueDate, window.before)
        : and(gte(tasks.dueDate, window.from), lte(tasks.dueDate, window.to));

    return tx
      .select({
        id: tasks.id,
        title: tasks.title,
        assigneeUserId: tasks.assigneeUserId,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.companyId, companyId),
          eq(tasks.taskType, TASK_MODULE_TYPE),
          isNull(tasks.deletedAt),
          isNotNull(tasks.assigneeUserId),
          isNotNull(tasks.dueDate),
          ne(tasks.status, TERMINAL_STATUS),
          windowCond,
        ),
      );
  }

  /** true = phát thành công (hoặc fire-and-forget skip/dedupe, KHÔNG phải lỗi); false = engine ném lỗi thật. */
  private async fireSafe(
    companyId: string,
    eventCode: string,
    task: DueTaskRow,
    dayKey: string,
  ): Promise<boolean> {
    if (!task.assigneeUserId) return true; // đã lọc ở query, phòng thủ kép — KHÔNG đếm là lỗi.
    try {
      await this.engine.intake(companyId, {
        eventCode,
        sourceModule: SOURCE_MODULE,
        sourceEntityType: SOURCE_ENTITY_TYPE,
        sourceEntityId: task.id,
        dedupeKey: `${task.id}:${dayKey}`,
        recipient: { mode: "UserIds", userIds: [task.assigneeUserId], employeeIds: [] },
        payload: {
          task_title: task.title,
          due_at: task.dueDate ? task.dueDate.toISOString() : null,
        },
      });
      return true;
    } catch (err) {
      this.logger.error(
        `TASK_REMINDER: intake('${eventCode}', task=${task.id}) THẤT BẠI: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
  }
}
