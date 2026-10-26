import { Injectable, Logger } from "@nestjs/common";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { NotificationEngineService } from "./notification-engine.service";
import { NotificationEventRepository } from "./notification-event.repository";
import { NotificationDedupeService } from "./notification-dedupe.service";
import {
  findRemindedPairs,
  queryReminderCandidates,
  recipientKeyId,
  remindedSince,
  reminderDedupeKey,
  reminderRecipients,
  TASK_DUE_SOON_EVENT,
  TASK_OVERDUE_EVENT,
  type RecipientKey,
  type ReminderCandidate,
} from "./task-reminder.job-handler.query";

export const TASK_REMINDER_JOB_CODE = "TASK_REMINDER";

const SOURCE_MODULE = "TASK";
const SOURCE_ENTITY_TYPE = "task";
/** Chiến lược dedupe mà khoá (việc, mốc hạn) được thiết kế cho (DEFAULT_DEDUPE của 2 mã này). */
const EXPECTED_STRATEGY = "DedupeKey";

interface ReminderItem {
  candidate: ReminderCandidate;
  dedupeKey: string;
  /** Người nhận CÒN LẠI sau khi bỏ người đã từng nhận cùng khoá. */
  recipients: string[];
}

interface PreparedBatch {
  eventCode: string;
  toFire: ReminderItem[];
  alreadyReminded: number;
  strategyMismatch: boolean;
}

/**
 * S4-NOTI-BE-3 → S20-TASK-DUEREMIND-1 — nhắc `TASK_DUE_SOON` (hạn trong 24h tới → người phụ trách) và
 * `TASK_OVERDUE` (quá hạn trong 7 ngày gần nhất → người phụ trách ∪ reporter/người tạo) cho việc SPEC-06,
 * qua `NotificationEngineService.intake()` in-process. Phần đọc + hàm thuần: `task-reminder.job-handler.query.ts`.
 *
 * Dedupe theo (việc, sự kiện, mốc `due_at`): `dedupeKey = <taskId>:<due_at ISO UTC>`. Tầng 1/2 của engine chỉ
 * xét hàng CÒN hiệu lực ⇒ người nhận xoá mềm thông báo thì lượt sau sẽ phát lại. Vì vậy job tự kiểm trước,
 * bằng ĐÚNG khoá engine sẽ tính (đọc catalog → `resolveStrategy` → `computeKey`, cùng `occurredAt`), các
 * cặp (người nhận, khoá) đã có hàng — kể cả hàng đã xoá — và bỏ những người đó. Chiến lược giải ra khác
 * `DedupeKey` ⇒ cảnh báo + `metadata.dedupeStrategyMismatch` (không im lặng).
 *
 * BẤT BIẾN #1: JobRunContext CHỈ `companyId` — handler TỰ mở `withTenant` cho phần đọc; mỗi `intake` tự mở tx
 * ghi riêng. Lỗi ở một (việc, sự kiện) ⇒ `failed++`, việc khác vẫn chạy; lỗi phần đọc ⇒ job ném.
 */
@Injectable()
@SystemJobHandler()
export class TaskReminderJobHandler implements JobHandler {
  readonly jobCode = TASK_REMINDER_JOB_CODE;
  private readonly logger = new Logger(TaskReminderJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly engine: NotificationEngineService,
    private readonly eventRepo: NotificationEventRepository,
    private readonly dedupe: NotificationDedupeService,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    const now = new Date();

    const { found, batches } = await this.db.withTenant(companyId, async (tx) => {
      const candidates = await queryReminderCandidates(tx, companyId, now);
      const dueSoon = await this.prepare(
        tx,
        companyId,
        TASK_DUE_SOON_EVENT,
        candidates.dueSoon,
        now,
      );
      const overdue = await this.prepare(
        tx,
        companyId,
        TASK_OVERDUE_EVENT,
        candidates.overdue,
        now,
      );
      return { found: candidates, batches: [dueSoon, overdue] };
    });

    let success = 0;
    let failed = 0;
    let alreadyReminded = 0;
    const mismatch: string[] = [];
    for (const batch of batches) {
      if (batch.strategyMismatch) mismatch.push(batch.eventCode);
      alreadyReminded += batch.alreadyReminded;
      success += batch.alreadyReminded;
      for (const item of batch.toFire) {
        if (await this.fireSafe(companyId, batch.eventCode, item, now)) success++;
        else failed++;
      }
    }

    const metadata: Record<string, unknown> = {
      dueSoonCount: found.dueSoon.length,
      overdueCount: found.overdue.length,
      overdueSkippedByLookback: found.overdueSkippedByLookback,
      alreadyRemindedCount: alreadyReminded,
    };
    if (mismatch.length > 0) metadata.dedupeStrategyMismatch = mismatch;
    return { total: found.dueSoon.length + found.overdue.length, success, failed, metadata };
  }

  /** Gắn khoá + người nhận cho từng việc, bỏ người đã từng nhận cùng khoá (kể cả đã xoá mềm). */
  private async prepare(
    tx: TenantTx,
    companyId: string,
    eventCode: string,
    candidates: ReminderCandidate[],
    now: Date,
  ): Promise<PreparedBatch> {
    const items: ReminderItem[] = candidates.map((c) => ({
      candidate: c,
      dedupeKey: reminderDedupeKey(c.id, c.dueAt),
      recipients: reminderRecipients(eventCode, c),
    }));
    const unchecked = { eventCode, toFire: items, alreadyReminded: 0, strategyMismatch: false };
    if (items.length === 0) return unchecked;

    // Sự kiện tắt/không có trong catalog ⇒ không kiểm trước được; engine tự quyết (skip/404) như cũ.
    const ev = await this.eventRepo.findEnabledEvent(tx, companyId, eventCode);
    if (!ev) return unchecked;
    const cfg = this.dedupe.resolveStrategy(ev);
    const strategyMismatch = cfg.strategy !== EXPECTED_STRATEGY;
    if (strategyMismatch) {
      this.logger.warn(
        `TASK_REMINDER: chiến lược dedupe của ${eventCode} là '${cfg.strategy}' (kỳ vọng ` +
          `'${EXPECTED_STRATEGY}') — khoá (việc, mốc hạn) có thể không chặn nhắc lặp.`,
      );
    }

    // Khoá ĐÚNG như engine tính cho từng người nhận (null ⇒ chiến lược không dedupe ⇒ không kiểm trước).
    const keyed = items.map((item) => ({
      item,
      keys: item.recipients.map((recipientUserId) => ({
        recipientUserId,
        key: this.dedupe.computeKey({
          strategy: cfg.strategy,
          windowSeconds: cfg.windowSeconds,
          eventCode: ev.eventCode,
          recipientUserId,
          sourceEntityId: item.candidate.id,
          dedupeKey: item.dedupeKey,
          occurredAtMs: now.getTime(),
        }),
      })),
    }));
    const pairs = keyed
      .flatMap((k) => k.keys)
      .filter((p): p is RecipientKey => typeof p.key === "string");
    const reminded = await findRemindedPairs(
      tx,
      companyId,
      ev.eventCode,
      pairs,
      remindedSince(candidates),
    );

    const remainingOf = keyed.map(({ item, keys }) => ({
      ...item,
      recipients: keys
        .filter((p) => p.key === null || !reminded.has(recipientKeyId(p.recipientUserId, p.key)))
        .map((p) => p.recipientUserId),
    }));
    const toFire = remainingOf.filter((item) => item.recipients.length > 0);
    return {
      eventCode,
      toFire,
      alreadyReminded: remainingOf.length - toFire.length,
      strategyMismatch,
    };
  }

  /** true = phát xong (kể cả engine skip/dedupe — fire-and-forget); false = engine ném lỗi thật. */
  private async fireSafe(
    companyId: string,
    eventCode: string,
    item: ReminderItem,
    now: Date,
  ): Promise<boolean> {
    const task = item.candidate;
    try {
      await this.engine.intake(companyId, {
        eventCode,
        sourceModule: SOURCE_MODULE,
        sourceEntityType: SOURCE_ENTITY_TYPE,
        sourceEntityId: task.id,
        dedupeKey: item.dedupeKey,
        occurredAt: now.toISOString(),
        recipient: { mode: "UserIds", userIds: item.recipients, employeeIds: [] },
        payload: { task_title: task.title, due_at: task.dueAt },
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
