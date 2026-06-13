import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  CheckInRequest,
  CheckOutRequest,
  CreateAdjustmentRequest,
  CreateWorkScheduleRequest,
  UpdateWorkScheduleRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { assertValidTimezone, localDateOf, monthOfDate } from "../common/tz.util";
import { AttendanceRepository } from "./attendance.repository";
import {
  deriveAttendanceStatus,
  earlyLeaveMinutesFor,
  lateMinutesFor,
  type ScheduleCalc,
} from "./attendance.logic";

const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
const PG_UNIQUE_VIOLATION = "23505";

interface Actor {
  id: string;
  companyId: string;
}

type ScheduleRow = Awaited<ReturnType<AttendanceRepository["findSchedules"]>>[number];

function toScheduleCalc(row: ScheduleRow): ScheduleCalc {
  return {
    startTime: row.startTime,
    endTime: row.endTime,
    graceMinutes: row.graceMinutes,
    timezone: row.timezone,
    workingDays: row.workingDaysJson,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === PG_UNIQUE_VIOLATION
  );
}

/**
 * G11-1 — Attendance application service.
 *
 * BẤT BIẾN: số liệu công chỉ đổi qua check-in/out hoặc đơn bổ sung công ĐÃ DUYỆT — không endpoint
 * sửa thẳng. Mọi thay đổi đi qua `withTenant` (RLS) + audit trong CÙNG tx. Đơn duyệt qua Task Hub
 * (task_type='hr'); khoá kỳ công (attendance_periods) chặn mọi ghi vào tháng đã chốt (feed payroll G12).
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AttendanceRepository,
    private readonly permission: PermissionService,
    private readonly hrTasks: HrTasksService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── Work schedules (manage:attendance) ──────────────────────────────────────

  listSchedules(companyId: string) {
    return this.repo.findSchedules(companyId).then((rows) => rows.map(toScheduleDto));
  }

  async createSchedule(actor: Actor, dto: CreateWorkScheduleRequest) {
    assertValidTimezone(dto.timezone);
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [row] = await this.repo.createScheduleTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            name: dto.name,
            workType: dto.workType,
            startTime: dto.startTime,
            endTime: dto.endTime,
            workingDaysJson: dto.workingDays,
            timezone: dto.timezone,
            graceMinutes: dto.graceMinutes,
            isDefault: dto.isDefault,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create work schedule");
        await this.audit.record(tx, {
          action: "WorkScheduleCreated",
          objectType: "work_schedule",
          objectId: row.id,
          actorUserId: actor.id,
          after: { name: row.name, isDefault: row.isDefault, timezone: row.timezone },
        });
        return toScheduleDto(row);
      })
      .catch((err: unknown) => this.mapError(err, "createSchedule", { companyId: actor.companyId }));
  }

  async updateSchedule(actor: Actor, id: string, dto: UpdateWorkScheduleRequest) {
    if (dto.timezone) assertValidTimezone(dto.timezone);
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [existing] = await this.repo.findScheduleByIdTx(actor.companyId, id, tx);
        if (!existing) throw new NotFoundException(`Work schedule not found: ${id}`);
        const [row] = await this.repo.updateScheduleTx(
          actor.companyId,
          id,
          {
            name: dto.name,
            workType: dto.workType,
            startTime: dto.startTime,
            endTime: dto.endTime,
            workingDaysJson: dto.workingDays,
            timezone: dto.timezone,
            graceMinutes: dto.graceMinutes,
            isDefault: dto.isDefault,
            status: dto.status,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to update work schedule");
        await this.audit.record(tx, {
          action: "WorkScheduleUpdated",
          objectType: "work_schedule",
          objectId: id,
          actorUserId: actor.id,
          before: { name: existing.name, isDefault: existing.isDefault },
          after: { name: row.name, isDefault: row.isDefault, status: row.status },
        });
        return toScheduleDto(row);
      })
      .catch((err: unknown) => this.mapError(err, "updateSchedule", { companyId: actor.companyId, id }));
  }

  // ─── Check-in / Check-out (check-in:attendance) ──────────────────────────────

  async getToday(actor: Actor) {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const schedule = await this.repo.resolveScheduleForUserTx(actor.companyId, actor.id, tx);
      const tz = schedule?.timezone ?? DEFAULT_TZ;
      const workDate = localDateOf(new Date(), tz);
      const [record] = await this.repo.findRecordByUserDateTx(actor.companyId, actor.id, workDate, tx);
      const periodLocked = await this.repo.isPeriodLockedTx(actor.companyId, monthOfDate(workDate), tx);
      return {
        workDate,
        record: record ? toRecordDto(record) : null,
        schedule: schedule ? toScheduleDto(schedule) : null,
        periodLocked,
      };
    });
  }

  async checkIn(actor: Actor, dto: CheckInRequest) {
    const now = new Date();
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const schedule = await this.repo.resolveScheduleForUserTx(actor.companyId, actor.id, tx);
        const tz = schedule?.timezone ?? DEFAULT_TZ;
        const workDate = localDateOf(now, tz);
        this.assertPeriodOpen(await this.repo.isPeriodLockedTx(actor.companyId, monthOfDate(workDate), tx), workDate);

        const [existing] = await this.repo.findRecordByUserDateTx(actor.companyId, actor.id, workDate, tx);
        if (existing?.checkInAt) throw new ConflictException(`Đã check-in cho ngày ${workDate}`);

        const calc = schedule ? toScheduleCalc(schedule) : null;
        const lateMinutes = calc ? lateMinutesFor(now, workDate, calc) : 0;
        const status = deriveAttendanceStatus(lateMinutes, 0);

        const [record] = existing
          ? await this.repo.updateRecordTx(
              actor.companyId,
              existing.id,
              {
                checkInAt: now,
                checkInMethod: dto.method,
                locationJson: dto.location ?? null,
                lateMinutes,
                status,
                workScheduleId: schedule?.id ?? null,
              },
              tx,
            )
          : await this.repo.insertRecordTx(
              actor.companyId,
              {
                companyId: actor.companyId,
                userId: actor.id,
                workDate,
                workScheduleId: schedule?.id ?? null,
                checkInAt: now,
                checkInMethod: dto.method,
                locationJson: dto.location ?? null,
                lateMinutes,
                status,
              },
              tx,
            );
        if (!record) throw new InternalServerErrorException("Failed to record check-in");

        await this.audit.record(tx, {
          action: "AttendanceCheckIn",
          objectType: "attendance_record",
          objectId: record.id,
          actorUserId: actor.id,
          after: { workDate, checkInAt: now, status, lateMinutes, method: dto.method },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.checked_in",
          payload: { recordId: record.id, userId: actor.id, workDate, status },
        });
        return toRecordDto(record);
      })
      .catch((err: unknown) => this.mapError(err, "checkIn", { companyId: actor.companyId, userId: actor.id }));
  }

  async checkOut(actor: Actor, dto: CheckOutRequest) {
    const now = new Date();
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const schedule = await this.repo.resolveScheduleForUserTx(actor.companyId, actor.id, tx);

        // F5: resolve the in-progress (open) record by checked-in/not-checked-out, NOT by today's
        // local date — an overnight shift checks in on day D and out on D+1, so the open record's
        // own workDate is the anchor for period-lock + early-leave calc.
        const [existing] = await this.repo.findOpenRecordForUserTx(actor.companyId, actor.id, tx);
        if (!existing?.checkInAt) throw new ConflictException("Chưa check-in (hoặc đã check-out)");
        const workDate = existing.workDate;
        this.assertPeriodOpen(await this.repo.isPeriodLockedTx(actor.companyId, monthOfDate(workDate), tx), workDate);

        const calc = schedule ? toScheduleCalc(schedule) : null;
        const earlyLeaveMinutes = calc ? earlyLeaveMinutesFor(now, workDate, calc) : 0;
        const status = deriveAttendanceStatus(existing.lateMinutes, earlyLeaveMinutes);

        const [record] = await this.repo.updateRecordTx(
          actor.companyId,
          existing.id,
          { checkOutAt: now, checkOutMethod: dto.method, earlyLeaveMinutes, status },
          tx,
        );
        if (!record) throw new InternalServerErrorException("Failed to record check-out");

        await this.audit.record(tx, {
          action: "AttendanceCheckOut",
          objectType: "attendance_record",
          objectId: record.id,
          actorUserId: actor.id,
          after: { workDate, checkOutAt: now, status, earlyLeaveMinutes, method: dto.method },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.checked_out",
          payload: { recordId: record.id, userId: actor.id, workDate, status },
        });
        return toRecordDto(record);
      })
      .catch((err: unknown) => this.mapError(err, "checkOut", { companyId: actor.companyId, userId: actor.id }));
  }

  // ─── Monthly list (read:attendance; others ⇒ manage) ─────────────────────────

  async listMonthly(actor: Actor, query: { month: string; userId?: string }) {
    const { from, toExclusive } = monthRange(query.month);
    if (query.userId && query.userId !== actor.id) {
      await this.assertCanManage(actor, "attendance");
    }
    return this.repo.findRecordsByMonth(actor.companyId, {
      from,
      toExclusive,
      userId: query.userId ?? actor.id,
    });
  }

  // ─── Adjustment requests (adjust / approve:attendance) ───────────────────────

  async createAdjustment(actor: Actor, dto: CreateAdjustmentRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        this.assertPeriodOpen(
          await this.repo.isPeriodLockedTx(actor.companyId, monthOfDate(dto.workDate), tx),
          dto.workDate,
        );

        const task = await this.hrTasks.createApprovalTaskTx(tx, actor.companyId, {
          title: `Duyệt bổ sung công ${dto.workDate}`,
          assigneeUserId: null,
        });
        const [row] = await this.repo.insertAdjustmentTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            userId: actor.id,
            workDate: dto.workDate,
            requestedCheckInAt: dto.requestedCheckInAt ? new Date(dto.requestedCheckInAt) : null,
            requestedCheckOutAt: dto.requestedCheckOutAt ? new Date(dto.requestedCheckOutAt) : null,
            reason: dto.reason,
            status: "pending",
            taskId: task.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create adjustment request");

        await this.audit.record(tx, {
          action: "AttendanceAdjustmentRequested",
          objectType: "attendance_adjustment_request",
          objectId: row.id,
          actorUserId: actor.id,
          after: { workDate: dto.workDate, taskId: task.id },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.adjustment_requested",
          payload: { requestId: row.id, userId: actor.id, workDate: dto.workDate, taskId: task.id },
        });
        return toAdjustmentDto(row);
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) {
          throw new ConflictException(`Đã có đơn bổ sung công đang chờ duyệt cho ngày ${dto.workDate}`);
        }
        return this.mapError(err, "createAdjustment", { companyId: actor.companyId });
      });
  }

  async listAdjustments(actor: Actor, query: { status?: string; scope: "me" | "all" }) {
    if (query.scope === "all") {
      await this.assertCanApprove(actor, "attendance");
      return this.repo.findAdjustments(actor.companyId, { status: query.status });
    }
    return this.repo.findAdjustments(actor.companyId, { userId: actor.id, status: query.status });
  }

  async approveAdjustment(actor: Actor, id: string, note?: string) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        // Re-read under FOR UPDATE inside the tx so two concurrent approvals serialize (F1 TOCTOU):
        // the second waits on the row lock, then sees status≠pending and is rejected below.
        const [request] = await this.repo.findAdjustmentByIdForUpdateTx(actor.companyId, id, tx);
        if (!request) throw new NotFoundException(`Adjustment request not found: ${id}`);
        if (request.status !== "pending") {
          throw new ConflictException(`Đơn không còn ở trạng thái chờ duyệt (status=${request.status})`);
        }
        this.assertPeriodOpen(
          await this.repo.isPeriodLockedTx(actor.companyId, monthOfDate(request.workDate), tx),
          request.workDate,
        );

        // Apply the requested times to the attendance record (create it if the day had none).
        const schedule = await this.repo.resolveScheduleForUserTx(actor.companyId, request.userId, tx);
        const calc = schedule ? toScheduleCalc(schedule) : null;
        const [existing] = await this.repo.findRecordByUserDateTx(
          actor.companyId,
          request.userId,
          request.workDate,
          tx,
        );

        const checkInAt = request.requestedCheckInAt ?? existing?.checkInAt ?? null;
        const checkOutAt = request.requestedCheckOutAt ?? existing?.checkOutAt ?? null;
        const lateMinutes = calc && checkInAt ? lateMinutesFor(checkInAt, request.workDate, calc) : 0;
        const earlyLeaveMinutes =
          calc && checkOutAt ? earlyLeaveMinutesFor(checkOutAt, request.workDate, calc) : 0;

        const recordValues = {
          checkInAt,
          checkOutAt,
          checkInMethod: request.requestedCheckInAt ? "adjustment" : existing?.checkInMethod ?? null,
          checkOutMethod: request.requestedCheckOutAt ? "adjustment" : existing?.checkOutMethod ?? null,
          lateMinutes,
          earlyLeaveMinutes,
          status: "approved_adjustment" as const,
          workScheduleId: schedule?.id ?? existing?.workScheduleId ?? null,
        };

        const [record] = existing
          ? await this.repo.updateRecordTx(actor.companyId, existing.id, recordValues, tx)
          : await this.repo.insertRecordTx(
              actor.companyId,
              {
                companyId: actor.companyId,
                userId: request.userId,
                workDate: request.workDate,
                ...recordValues,
              },
              tx,
            );
        if (!record) throw new InternalServerErrorException("Failed to apply adjustment to record");

        const [updated] = await this.repo.updateAdjustmentTx(
          actor.companyId,
          id,
          {
            status: "approved",
            attendanceRecordId: record.id,
            approvedBy: actor.id,
            approvedAt: new Date(),
            reviewNote: note ?? null,
          },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to close adjustment request");

        if (request.taskId) await this.hrTasks.closeTaskTx(tx, actor.companyId, request.taskId, "approved");

        await this.audit.record(tx, {
          action: "AttendanceAdjustmentApproved",
          objectType: "attendance_adjustment_request",
          objectId: id,
          actorUserId: actor.id,
          after: { recordId: record.id, lateMinutes, earlyLeaveMinutes },
        });
        await this.audit.record(tx, {
          action: "AttendanceRecordAdjusted",
          objectType: "attendance_record",
          objectId: record.id,
          actorUserId: actor.id,
          after: { workDate: request.workDate, checkInAt, checkOutAt, fromRequestId: id },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.adjustment_approved",
          payload: { requestId: id, recordId: record.id, userId: request.userId, approvedBy: actor.id },
        });
        return toAdjustmentDto(updated);
      })
      .catch((err: unknown) => this.mapError(err, "approveAdjustment", { companyId: actor.companyId, id }));
  }

  async rejectAdjustment(actor: Actor, id: string, note?: string) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        // Re-read under FOR UPDATE inside the tx so two concurrent decisions serialize (F1 TOCTOU).
        const [request] = await this.repo.findAdjustmentByIdForUpdateTx(actor.companyId, id, tx);
        if (!request) throw new NotFoundException(`Adjustment request not found: ${id}`);
        if (request.status !== "pending") {
          throw new ConflictException(`Đơn không còn ở trạng thái chờ duyệt (status=${request.status})`);
        }
        const [updated] = await this.repo.updateAdjustmentTx(
          actor.companyId,
          id,
          { status: "rejected", approvedBy: actor.id, approvedAt: new Date(), reviewNote: note ?? null },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to reject adjustment request");
        if (request.taskId) await this.hrTasks.closeTaskTx(tx, actor.companyId, request.taskId, "completed");

        await this.audit.record(tx, {
          action: "AttendanceAdjustmentRejected",
          objectType: "attendance_adjustment_request",
          objectId: id,
          actorUserId: actor.id,
          after: { reviewNote: note ?? null },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.adjustment_rejected",
          payload: { requestId: id, userId: request.userId, rejectedBy: actor.id },
        });
        return toAdjustmentDto(updated);
      })
      .catch((err: unknown) => this.mapError(err, "rejectAdjustment", { companyId: actor.companyId, id }));
  }

  async cancelAdjustment(actor: Actor, id: string) {
    const [request] = await this.loadAdjustment(actor.companyId, id);
    if (!request) throw new NotFoundException(`Adjustment request not found: ${id}`);
    if (request.userId !== actor.id) {
      throw new ForbiddenException("Chỉ người gửi đơn mới được huỷ đơn");
    }
    if (request.status !== "pending") {
      throw new ConflictException(`Chỉ huỷ được đơn đang chờ duyệt (status=${request.status})`);
    }

    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [updated] = await this.repo.updateAdjustmentTx(
          actor.companyId,
          id,
          { status: "cancelled" },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to cancel adjustment request");
        if (request.taskId) await this.hrTasks.cancelTaskTx(tx, actor.companyId, request.taskId);

        await this.audit.record(tx, {
          action: "AttendanceAdjustmentCancelled",
          objectType: "attendance_adjustment_request",
          objectId: id,
          actorUserId: actor.id,
        });
        return toAdjustmentDto(updated);
      })
      .catch((err: unknown) => this.mapError(err, "cancelAdjustment", { companyId: actor.companyId, id }));
  }

  // ─── Period lock (lock-period:attendance) ────────────────────────────────────

  listPeriods(companyId: string) {
    return this.repo.findPeriods(companyId).then((rows) => rows.map(toPeriodDto));
  }

  async lockPeriod(actor: Actor, periodMonth: string) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [existing] = await this.repo.findPeriodTx(actor.companyId, periodMonth, tx);
        if (existing?.status === "locked") {
          throw new ConflictException(`Kỳ công ${periodMonth} đã được khoá`);
        }
        const [row] = await this.repo.lockPeriodTx(
          actor.companyId,
          { periodMonth, lockedBy: actor.id },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to lock attendance period");

        await this.audit.record(tx, {
          action: "AttendancePeriodLocked",
          objectType: "attendance_period",
          objectId: row.id,
          actorUserId: actor.id,
          after: { periodMonth, lockedBy: actor.id },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.period_locked",
          payload: { periodMonth, lockedBy: actor.id },
        });
        return toPeriodDto(row);
      })
      .catch((err: unknown) => this.mapError(err, "lockPeriod", { companyId: actor.companyId, periodMonth }));
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private loadAdjustment(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) => this.repo.findAdjustmentByIdTx(companyId, id, tx));
  }

  private assertPeriodOpen(locked: boolean, workDate: string): void {
    if (locked) {
      throw new ConflictException(`Kỳ công ${monthOfDate(workDate)} đã khoá — không thể ghi/sửa công`);
    }
  }

  private async assertCanManage(actor: Actor, resourceType: string): Promise<void> {
    const decision = await this.permission.can({
      userId: actor.id,
      companyId: actor.companyId,
      action: "manage",
      resourceType,
    });
    if (!decision.allow) throw new ForbiddenException("Không có quyền xem dữ liệu của nhân sự khác");
  }

  private async assertCanApprove(actor: Actor, resourceType: string): Promise<void> {
    const decision = await this.permission.can({
      userId: actor.id,
      companyId: actor.companyId,
      action: "approve",
      resourceType,
    });
    if (!decision.allow) throw new ForbiddenException("Không có quyền duyệt đơn");
  }

  private mapError(err: unknown, op: string, ctx: Record<string, unknown>): never {
    // Known HTTP exceptions (NotFound/Conflict/Forbidden/InternalServerError/…) pass through.
    if (err instanceof HttpException) throw err;
    // Unknown infra errors (PG wire, Drizzle) must NOT leak schema/constraint detail to the client:
    // log the original, surface a generic 500.
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw new InternalServerErrorException("Lỗi hệ thống, vui lòng thử lại");
  }
}

// ─── DTO mappers (Date → JSON ISO handled by the serializer) ───────────────────

function toScheduleDto(row: ScheduleRow) {
  return {
    id: row.id,
    name: row.name,
    workType: row.workType,
    startTime: row.startTime,
    endTime: row.endTime,
    workingDays: row.workingDaysJson,
    timezone: row.timezone,
    graceMinutes: row.graceMinutes,
    isDefault: row.isDefault,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRecordDto(row: {
  id: string;
  userId: string;
  workDate: string;
  workScheduleId: string | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  checkInMethod: string | null;
  checkOutMethod: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  status: string;
  note: string | null;
}) {
  return {
    id: row.id,
    userId: row.userId,
    workDate: row.workDate,
    workScheduleId: row.workScheduleId,
    checkInAt: row.checkInAt,
    checkOutAt: row.checkOutAt,
    checkInMethod: row.checkInMethod,
    checkOutMethod: row.checkOutMethod,
    lateMinutes: row.lateMinutes,
    earlyLeaveMinutes: row.earlyLeaveMinutes,
    status: row.status,
    note: row.note,
  };
}

function toAdjustmentDto(row: {
  id: string;
  userId: string;
  attendanceRecordId: string | null;
  workDate: string;
  requestedCheckInAt: Date | null;
  requestedCheckOutAt: Date | null;
  reason: string;
  status: string;
  taskId: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
}) {
  return { ...row };
}

function toPeriodDto(row: {
  id: string;
  periodMonth: string;
  status: string;
  lockedBy: string | null;
  lockedAt: Date | null;
}) {
  return {
    id: row.id,
    periodMonth: row.periodMonth,
    status: row.status,
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt,
  };
}

/** [from, toExclusive) for a 'YYYY-MM' period — used by listMonthly. */
function monthRange(periodMonth: string): { from: string; toExclusive: string } {
  const [y, m] = periodMonth.split("-").map(Number);
  const from = `${periodMonth}-01`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from, toExclusive: `${next}-01` };
}
