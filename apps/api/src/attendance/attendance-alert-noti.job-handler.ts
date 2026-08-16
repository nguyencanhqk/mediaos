import { Injectable, Logger } from "@nestjs/common";
import type { InternalEventIntakeDto } from "@mediaos/contracts";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { localDateOf } from "../common/tz.util";
import { NotificationEngineService } from "../notifications/notification-engine.service";
import { DEFAULT_TZ } from "./attendance.types";
import {
  AttendanceAlertNotiRepository,
  type AttAlertAbsentCandidate,
  type AttAlertRecordCandidate,
} from "./attendance-alert-noti.repository";
import {
  ATT_ABSENT_DETECTED_EVENT,
  ATT_ALERT_BATCH_CAP,
  ATT_ALERT_DETECT_JOB_CODE,
  ATT_ALERT_EMPLOYEE_SCAN_CAP,
  ATT_ALERT_LOOKBACK_DAYS,
  ATT_ALERT_RAW_FETCH_CAP,
  ATT_LATE_DETECTED_EVENT,
  ATT_MISSING_CHECKOUT_EVENT,
  buildAbsentDedupeKey,
  buildAbsentPayload,
  buildLatePayload,
  buildMissingCheckoutPayload,
  buildRecordDedupeKey,
  resolveAttAlertDetectIntervalMs,
  storedDedupeKey,
} from "./attendance-alert-noti.logic";

const SOURCE_MODULE = "ATT";
const SOURCE_ENTITY_TYPE_RECORD = "attendance_record";
const SOURCE_ENTITY_TYPE_EMPLOYEE = "employee_profile";

interface IntakeItem {
  eventCode: string;
  dedupeKeyRaw: string;
  recipientUserId: string;
  sourceEntityId: string;
  sourceEntityType: string;
  payload: Record<string, unknown>;
}

/**
 * S10-ATT-NOTIPROD-1 (đóng RELEASE-02 §KI-021) — AttendanceAlertNotiJobHandler: producer THẬT ĐẦU TIÊN
 * cho `ATT_MISSING_CHECKOUT` / `ATT_LATE_DETECTED` / `ATT_ABSENT_DETECTED`. Catalog/template/deep-link ĐÃ
 * seed (migration 0481/0497) — WO này KHÔNG migration. Kill-switch = `notification_events.is_enabled`
 * (engine `findEnabledEvent` tự bỏ qua khi disabled, notification-engine.service.ts:72-79) — clamp interval
 * bên dưới KHÔNG thay thế được kill-switch này (chốt #27).
 *
 * [CHỐT #2] materialize (mở+ĐÓNG `withTenant`) TRƯỚC KHI gọi `NotificationEngineService.intake()` —
 * `intake()` TỰ mở `withTenant` riêng (notification-engine.service.ts:70, `db.transaction()` thuần) nên
 * gọi nó TRONG callback materialize sẽ tạo tx LỒNG + giữ 2 kết nối/bản ghi qua PgBouncer (mirror
 * `TaskReminderJobHandler`, cảnh báo `job-runner.ts:69`).
 *
 * [CHỐT #16] Throttle khoá THEO `companyId` (Map, KHÔNG field cấp-instance) — `JobRunner` gọi
 * `handler.run({companyId})` TUẦN TỰ cho từng tenant (`job-runner.ts:72-75`); 1 biến chung sẽ làm tenant
 * thứ 2..N đói vĩnh viễn (ở N=1 hiện tại — CLAUDE.md §1 — sai khác này KHÔNG quan sát được nên bài học
 * dashboard-mv-refresh KHÔNG áp được nguyên xi, phải sửa).
 *
 * Recipient = CHÍNH nhân viên (mode UserIds, self) — fan-out Manager/HR HOÃN (không có bề mặt cấu hình,
 * ghi nợ RELEASE-02 §KI-021). TUYỆT ĐỐI KHÔNG truyền `actorUserId`: 3 mã seed `isSystemEvent=false`
 * (foundation/seed/notification-event-catalog.const.ts) ⇒ `NotificationRecipientResolverService.resolve`
 * lọc BỎ actor khỏi recipient khi `actorUserId` trùng userIds (notification-recipient-resolver.service.ts
 * :49-51) — gán actorUserId=chính nhân viên sẽ khiến HỌ KHÔNG nhận được gì (hỏng im lặng).
 *
 * Job CHỈ ĐỌC `attendance_records` (0 UPDATE/INSERT — không đụng `is_missing_check_out`/`attendance_status`,
 * BACKEND-06 §22.1 bước 2-3 HOÃN). Đặt trong `AttendanceModule` (KHÔNG `NotificationsModule` như tiền lệ
 * `TaskReminderJobHandler`) vì logic phụ thuộc NẶNG vào `AttendanceRepository` (resolveEffectiveShiftTx/
 * findDefaultShiftTx) — import ngược NotificationsModule→AttendanceModule mới là cycle, chiều hiện tại
 * (Attendance→Notifications, đã verify KHÔNG chu trình) an toàn hơn.
 */
@Injectable()
@SystemJobHandler()
export class AttendanceAlertNotiJobHandler implements JobHandler {
  readonly jobCode = ATT_ALERT_DETECT_JOB_CODE;
  private readonly logger = new Logger(AttendanceAlertNotiJobHandler.name);
  private readonly lastRunAtMsByCompany = new Map<string, number>();

  constructor(
    private readonly db: DatabaseService,
    private readonly engine: NotificationEngineService,
    private readonly repo: AttendanceAlertNotiRepository,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    const intervalMs = resolveAttAlertDetectIntervalMs();
    const nowMs = Date.now();
    const lastRunAtMs = this.lastRunAtMsByCompany.get(companyId);
    if (lastRunAtMs !== undefined && nowMs - lastRunAtMs < intervalMs) {
      return {
        total: 0,
        success: 1,
        failed: 0,
        metadata: { skipped: true, reason: "not-due", intervalMs },
      };
    }
    this.lastRunAtMsByCompany.set(companyId, nowMs);
    this.pruneStaleThrottleEntries(nowMs, intervalMs);

    const now = new Date(nowMs);
    const todayLocalDate = localDateOf(now, DEFAULT_TZ);

    const { items, metadata } = await this.db.withTenant(companyId, (tx) =>
      this.materializeIntakeItems(companyId, { now, todayLocalDate }, tx),
    );

    let success = 0;
    let failed = 0;
    const firedByCode: Record<string, number> = {
      [ATT_MISSING_CHECKOUT_EVENT]: 0,
      [ATT_LATE_DETECTED_EVENT]: 0,
      [ATT_ABSENT_DETECTED_EVENT]: 0,
    };
    for (const item of items) {
      if (await this.fireSafe(companyId, item)) {
        success++;
        firedByCode[item.eventCode] = (firedByCode[item.eventCode] ?? 0) + 1;
      } else {
        failed++;
      }
    }

    return { total: items.length, success, failed, metadata: { ...metadata, firedByCode } };
  }

  private async materializeIntakeItems(
    companyId: string,
    args: { now: Date; todayLocalDate: string },
    tx: TenantTx,
  ): Promise<{ items: IntakeItem[]; metadata: Record<string, unknown> }> {
    const bundle = await this.repo.materializeCandidatesTx(
      companyId,
      {
        now: args.now,
        todayLocalDate: args.todayLocalDate,
        lookbackDays: ATT_ALERT_LOOKBACK_DAYS,
        rawFetchCap: ATT_ALERT_RAW_FETCH_CAP,
        employeeScanCap: ATT_ALERT_EMPLOYEE_SCAN_CAP,
      },
      tx,
    );

    const candidates: IntakeItem[] = [
      ...bundle.missingCheckout.map((r) => this.toMissingCheckoutItem(r)),
      ...bundle.late.map((r) => this.toLateItem(r)),
      ...bundle.absent.map((r) => this.toAbsentItem(r)),
    ];

    // [CHỐT #7] loại tập "đã từng phát" TRƯỚC khi áp trần (chốt #22 — trần KHÔNG được nuốt người im lặng).
    const storedKeys = candidates.map((c) => storedDedupeKey(c.eventCode, c.dedupeKeyRaw));
    const already = await this.repo.findExistingDedupeKeysTx(companyId, storedKeys, tx);
    const fresh = candidates.filter(
      (c) => !already.has(storedDedupeKey(c.eventCode, c.dedupeKeyRaw)),
    );

    const { items, truncatedByCode } = this.applyBatchCap(fresh);
    if (Object.values(truncatedByCode).some(Boolean)) {
      this.logger.warn(
        `ATT_ALERT_DETECT company=${companyId}: chạm trần ${ATT_ALERT_BATCH_CAP}/mã — ${JSON.stringify(
          truncatedByCode,
        )}. Phần còn lại phát ở lượt kế (sau throttle) — KHÔNG mất, chỉ lùi.`,
      );
    }

    return {
      items,
      metadata: {
        candidateCounts: {
          missingCheckout: bundle.missingCheckout.length,
          late: bundle.late.length,
          absent: bundle.absent.length,
        },
        alreadyNotified: candidates.length - fresh.length,
        skippedNoEmployeeMapping: bundle.skippedNoEmployeeMapping,
        skippedNoShift: bundle.skippedNoShift,
        skippedNoWorkDays: bundle.skippedNoWorkDays,
        truncatedByCode,
      },
    };
  }

  /** [CHỐT #22] Trần áp MỖI MÃ riêng (1 mã ồn ào không nuốt mã khác) — thứ tự đã ổn định từ repo (workDate,id). */
  private applyBatchCap(items: IntakeItem[]): {
    items: IntakeItem[];
    truncatedByCode: Record<string, boolean>;
  } {
    const byCode = new Map<string, IntakeItem[]>();
    for (const item of items) {
      const arr = byCode.get(item.eventCode) ?? [];
      arr.push(item);
      byCode.set(item.eventCode, arr);
    }
    const out: IntakeItem[] = [];
    const truncatedByCode: Record<string, boolean> = {};
    for (const [code, arr] of byCode) {
      truncatedByCode[code] = arr.length > ATT_ALERT_BATCH_CAP;
      out.push(...arr.slice(0, ATT_ALERT_BATCH_CAP));
    }
    return { items: out, truncatedByCode };
  }

  private toMissingCheckoutItem(row: AttAlertRecordCandidate): IntakeItem {
    return {
      eventCode: ATT_MISSING_CHECKOUT_EVENT,
      dedupeKeyRaw: buildRecordDedupeKey(row.id, row.workDate),
      recipientUserId: row.userId,
      sourceEntityId: row.id,
      sourceEntityType: SOURCE_ENTITY_TYPE_RECORD,
      payload: buildMissingCheckoutPayload(row.workDate, row.fullName ?? ""),
    };
  }

  private toLateItem(row: AttAlertRecordCandidate): IntakeItem {
    return {
      eventCode: ATT_LATE_DETECTED_EVENT,
      dedupeKeyRaw: buildRecordDedupeKey(row.id, row.workDate),
      recipientUserId: row.userId,
      sourceEntityId: row.id,
      sourceEntityType: SOURCE_ENTITY_TYPE_RECORD,
      payload: buildLatePayload(row.workDate),
    };
  }

  private toAbsentItem(row: AttAlertAbsentCandidate): IntakeItem {
    return {
      eventCode: ATT_ABSENT_DETECTED_EVENT,
      dedupeKeyRaw: buildAbsentDedupeKey(row.employeeId, row.workDate),
      recipientUserId: row.userId,
      sourceEntityId: row.employeeId,
      sourceEntityType: SOURCE_ENTITY_TYPE_EMPLOYEE,
      payload: buildAbsentPayload(row.workDate, row.fullName ?? ""),
    };
  }

  /**
   * true = phát thành công (hoặc engine tự skip/dedupe qua summary — KHÔNG ném); false = engine NÉM lỗi
   * thật (fire-and-forget per-item, mirror `TaskReminderJobHandler.fireSafe` — 1 bản ghi lỗi KHÔNG chặn
   * bản ghi kế, GHI LOG ERROR chứ không nuốt câm).
   */
  private async fireSafe(companyId: string, item: IntakeItem): Promise<boolean> {
    try {
      const dto: InternalEventIntakeDto = {
        eventCode: item.eventCode,
        sourceModule: SOURCE_MODULE,
        sourceEntityType: item.sourceEntityType,
        sourceEntityId: item.sourceEntityId,
        dedupeKey: item.dedupeKeyRaw,
        recipient: { mode: "UserIds", userIds: [item.recipientUserId], employeeIds: [] },
        payload: item.payload,
      };
      await this.engine.intake(companyId, dto);
      return true;
    } catch (err) {
      this.logger.error(
        `ATT_ALERT_DETECT: intake('${item.eventCode}', entity=${item.sourceEntityId}) THẤT BẠI: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
  }

  /** Dọn khoá throttle KHÔNG chạy > 7×interval (chốt #16 "dọn khoá cũ" — chống Map phình nếu tenant park). */
  private pruneStaleThrottleEntries(nowMs: number, intervalMs: number): void {
    const staleBeforeMs = nowMs - intervalMs * 7;
    for (const [companyId, lastRunAtMs] of this.lastRunAtMsByCompany) {
      if (lastRunAtMs < staleBeforeMs) this.lastRunAtMsByCompany.delete(companyId);
    }
  }
}
