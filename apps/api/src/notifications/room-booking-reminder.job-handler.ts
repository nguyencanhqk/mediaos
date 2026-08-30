import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { formatLocalDateTime } from "../rooms/room-time";
import { NotificationEngineService } from "./notification-engine.service";
import { RoomAudienceReader } from "./room-audience.reader";

export const ROOM_BOOKING_REMINDER_JOB_CODE = "ROOM_BOOKING_REMINDER";
const EVENT_CODE = "ROOM_BOOKING_REMINDER";
/** ROOM-DEC-004: nhắc trước 15′ — quét `starts_at ∈ (now, now + 15′]`. */
export const ROOM_REMINDER_WINDOW_MINUTES = 15;
/** Trần hàng/nhịp — chống unbounded read (dedupe (booking, startsAt) ở NOTI làm phần dư được nhắc ở nhịp sau). */
export const ROOM_REMINDER_BATCH = 500;
const SOURCE_MODULE = "ROOM";
const SOURCE_ENTITY_TYPE = "room_booking";

interface ReminderRow {
  id: string;
  title: string;
  startsAt: Date;
  roomName: string;
}

interface Materialized {
  timezone: string;
  rows: ReminderRow[];
  participants: Map<string, string[]>;
}

/**
 * S11-ROOM-BE-1 — RoomBookingReminderJobHandler (SPEC-14 §13.5 · ROOM-DEC-004): mỗi nhịp scheduler (60s, lặp từng
 * company — chính là "throttle theo companyId"), quét lượt `Confirmed` có `starts_at ∈ (now, now + 15′]` TRONG
 * `withTenant(companyId)` (worker policy chỉ theo GUC + FORCE — KHÔNG scan trần, KHÔNG policy `USING(true)`), rồi phát
 * `ROOM_BOOKING_REMINDER` cho organizer ∪ attendees qua `NotificationEngineService.intake()` in-process.
 *
 * IDEMPOTENT: catalog 0555 `dedupe_strategy='DedupeKey'`; `dedupeKey = "<bookingId>:<startsAt ISO>"` ⇒ engine ghép
 * `ROOM_BOOKING_REMINDER:…` — một lượt nhắc đúng một lần; KHÔNG cột "đã nhắc" (cột ghi-rồi-bỏ là thứ để gỡ).
 * `is_system_event=true` ⇒ engine không loại ai. Lượt đặt < 15′ trước giờ họp được nhắc ở nhịp kế.
 *
 * [CHỐT] materialize (mở + ĐÓNG `withTenant`) TRƯỚC khi gọi `intake()` — `intake()` tự mở tx riêng (không lồng —
 * khuôn AttendanceAlertNoti/ASSET). 0 recipient (organizer đã xoá mềm…) ⇒ WARN, run vẫn OK — chỉ `failed` khi
 * `intake()` ném (plan-review H4). Dep đều là provider thật ⇒ không cần `@Optional()`.
 */
@Injectable()
@SystemJobHandler()
export class RoomBookingReminderJobHandler implements JobHandler {
  readonly jobCode = ROOM_BOOKING_REMINDER_JOB_CODE;
  private readonly logger = new Logger(RoomBookingReminderJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly reader: RoomAudienceReader,
    private readonly engine: NotificationEngineService,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    const m = await this.db.withTenant(companyId, (tx) => this.materialize(tx, companyId));
    let success = 0;
    let failed = 0;
    let noRecipient = 0;
    for (const row of m.rows) {
      const userIds = m.participants.get(row.id) ?? [];
      if (userIds.length === 0) {
        noRecipient += 1;
        this.logger.warn(
          `ROOM_BOOKING_REMINDER tenant=${companyId} booking=${row.id}: không có người nhận (organizer/attendees đã xoá?) — bỏ qua.`,
        );
        continue;
      }
      if (await this.fireSafe(companyId, row, userIds, m.timezone)) success += 1;
      else failed += 1;
    }
    return {
      total: m.rows.length,
      success,
      failed,
      metadata: { bookings: m.rows.length, noRecipient, batch: ROOM_REMINDER_BATCH },
    };
  }

  private async materialize(tx: TenantTx, companyId: string): Promise<Materialized> {
    const res = await tx.execute(sql`
      select b.id, b.title, b.starts_at as "startsAt", r.name as "roomName"
        from room_bookings b
        join meeting_rooms r on r.id = b.room_id and r.company_id = ${companyId}
       where b.company_id = ${companyId} and b.status = 'Confirmed'
         and b.starts_at > now()
         and b.starts_at <= now() + make_interval(mins => ${ROOM_REMINDER_WINDOW_MINUTES}::int)
       order by b.starts_at asc, b.id asc
       limit ${ROOM_REMINDER_BATCH}
    `);
    const rows = (res.rows as unknown as ReminderRow[]).map((r) => ({
      ...r,
      startsAt: new Date(r.startsAt),
    }));
    const participants =
      rows.length > 0
        ? await this.reader.participantsByBookingIds(
            tx,
            companyId,
            rows.map((r) => r.id),
          )
        : new Map<string, string[]>();
    const tzRes = await tx.execute(
      sql`select timezone from companies where id = ${companyId} limit 1`,
    );
    const timezone = (tzRes.rows as unknown as Array<{ timezone: string | null }>)[0]?.timezone;
    // Thiếu hàng companies (RLS worker/GUC hỏng/company xoá) ⇒ NÉM (gate silent-failure H2) — render giờ bằng tz mặc
    // định câm là báo xanh trên dữ liệu sai; run này thành failed và kêu ở system_job_runs.
    if (!timezone) {
      throw new Error(
        `ROOM_BOOKING_REMINDER tenant=${companyId}: không đọc được companies.timezone (0 hàng) — RLS/GUC của worker?`,
      );
    }
    return { timezone, rows, participants };
  }

  /** true = phát thành công (hoặc dedupe/skip — KHÔNG phải lỗi); false = engine ném lỗi thật (log, không nuốt câm). */
  private async fireSafe(
    companyId: string,
    row: ReminderRow,
    userIds: string[],
    timezone: string,
  ): Promise<boolean> {
    try {
      await this.engine.intake(companyId, {
        eventCode: EVENT_CODE,
        sourceModule: SOURCE_MODULE,
        sourceEntityType: SOURCE_ENTITY_TYPE,
        sourceEntityId: row.id,
        dedupeKey: `${row.id}:${row.startsAt.toISOString()}`,
        recipient: { mode: "UserIds", userIds, employeeIds: [] },
        payload: {
          title: row.title,
          room_name: row.roomName,
          starts_at_local: formatLocalDateTime(row.startsAt, timezone),
          booking_id: row.id,
        },
      });
      return true;
    } catch (err) {
      this.logger.error(
        `ROOM_BOOKING_REMINDER: intake(booking=${row.id}, recipients=${userIds.length}) THẤT BẠI: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
  }
}
