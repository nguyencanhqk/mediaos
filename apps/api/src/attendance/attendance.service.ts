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
import { assertValidTimezone, localDateOf, monthDateRange, monthOfDate } from "../common/tz.util";
import { AttendanceRepository } from "./attendance.repository";
import {
  checkInTitleStatus,
  checkOutTitleStatus,
  computeMissingMinutes,
  computeWorkingMinutes,
  deriveAttendanceStatus,
  earlyLeaveMinutesFor,
  lateMinutesFor,
  type ScheduleCalc,
  type ShiftCalc,
  shiftEarlyLeaveMinutes,
  shiftLateMinutes,
} from "./attendance.logic";
import { isUniqueViolation } from "../common/db-error";

const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
/** Business-key của rule mặc định (đồng bộ AttMasterDataSeeder ATT_DEFAULT_RULE_CODE). */
const ATT_DEFAULT_RULE_CODE = "DEFAULT_OFFICE_RULE";
const NO_EMPLOYEE_MSG = "Tài khoản chưa liên kết hồ sơ nhân sự";

interface Actor {
  id: string;
  companyId: string;
}

/** Hồ sơ nhân sự đã resolve server-side (BẤT BIẾN: KHÔNG tin employee_id client). */
type ResolvedEmployee = {
  id: string;
  status: string;
  orgUnitId: string | null;
  positionId: string | null;
};

/** Ca làm hiệu lực rút gọn (từ SHIFT_FIELDS) — null = không có ca hiệu lực. */
type ShiftRow = NonNullable<Awaited<ReturnType<AttendanceRepository["findDefaultShiftTx"]>>>;

/** Rule chấm công hiệu lực đã chuẩn hoá (in-code default khi DB không có). */
interface EffectiveRule {
  id: string | null;
  ruleCode: string | null;
  requireCheckIn: boolean;
  requireCheckOut: boolean;
  blockWhenLeaveApproved: boolean;
}

const DEFAULT_RULE: EffectiveRule = {
  id: null,
  ruleCode: null,
  requireCheckIn: true,
  requireCheckOut: true,
  blockWhenLeaveApproved: true,
};

/** Insert shape cho attendance_logs (company_id do repo gắn từ ngữ cảnh). */
type AttendanceLogInsert = Parameters<AttendanceRepository["insertAttendanceLogTx"]>[1];

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
      .catch((err: unknown) =>
        this.mapError(err, "createSchedule", { companyId: actor.companyId }),
      );
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
      .catch((err: unknown) =>
        this.mapError(err, "updateSchedule", { companyId: actor.companyId, id }),
      );
  }

  // ─── Today / Check-in / Check-out (S3-ATT-BE-1, DB-04 §7) ────────────────────
  // Employee resolve server-side (KHÔNG tin client). Ca/rule hiệu lực Employee≻Dept≻Company(≻System).
  // Mọi ghi đi qua `withTenant` (RLS+FORCE) + audit/outbox/log TRONG cùng tx. attendance_logs APPEND-ONLY.

  async getToday(actor: Actor) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const employee = await this.repo.resolveEmployeeByUserIdTx(actor.companyId, actor.id, tx);
        if (!employee) {
          return emptyToday(localDateOf(new Date(), DEFAULT_TZ), NO_EMPLOYEE_MSG);
        }
        const { shift, rule, tz, workDate } = await this.resolveShiftAndRule(
          tx,
          actor.companyId,
          employee,
          new Date(),
        );
        const [record] = await this.repo.findRecordByUserDateTx(
          actor.companyId,
          actor.id,
          workDate,
          tx,
        );
        const periodLocked = await this.repo.isPeriodLockedTx(
          actor.companyId,
          monthOfDate(workDate),
          tx,
        );
        const onLeave = rule.blockWhenLeaveApproved
          ? await this.repo.findApprovedFullDayLeaveTx(
              actor.companyId,
              { userId: actor.id, employeeId: employee.id, workDate },
              tx,
            )
          : false;
        return buildTodayDto({
          workDate,
          employee,
          shift,
          rule,
          tz,
          record: record ?? null,
          periodLocked,
          onLeave,
        });
      })
      .catch((err: unknown) =>
        this.mapError(err, "getToday", { companyId: actor.companyId, userId: actor.id }),
      );
  }

  async checkIn(actor: Actor, dto: CheckInRequest) {
    const now = new Date();
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const employee = await this.requireEmployee(tx, actor);
        const { shift, rule, tz, workDate } = await this.resolveShiftAndRule(
          tx,
          actor.companyId,
          employee,
          now,
        );
        this.assertPeriodOpen(
          await this.repo.isPeriodLockedTx(actor.companyId, monthOfDate(workDate), tx),
          workDate,
        );
        await this.assertNotOnApprovedLeave(tx, actor, employee, rule, workDate);

        const [existing] = await this.repo.findRecordByUserDateTx(
          actor.companyId,
          actor.id,
          workDate,
          tx,
        );
        if (existing?.checkInAt) throw new ConflictException(`Đã check-in cho ngày ${workDate}`);

        const calc = shift ? toShiftCalc(shift, tz) : null;
        const lateMinutes = calc ? shiftLateMinutes(now, workDate, calc) : 0;
        const isLate = lateMinutes > 0;
        const values = buildCheckInValues(actor, employee, shift, rule, tz, now, dto, lateMinutes);

        const [record] = existing
          ? await this.repo.updateRecordTx(actor.companyId, existing.id, values, tx)
          : await this.repo.insertRecordTx(
              actor.companyId,
              {
                companyId: actor.companyId,
                userId: actor.id,
                workDate,
                createdBy: actor.id,
                ...values,
              },
              tx,
            );
        if (!record) throw new InternalServerErrorException("Failed to record check-in");

        const [log] = await this.repo.insertAttendanceLogTx(
          actor.companyId,
          buildLog(actor, employee, record.id, workDate, "Check-in", dto),
          tx,
        );
        await this.repo.updateRecordTx(
          actor.companyId,
          record.id,
          { firstLogId: log.id, lastLogId: log.id },
          tx,
        );

        await this.audit.record(tx, {
          action: "attendance.check_in",
          objectType: "attendance_record",
          objectId: record.id,
          actorUserId: actor.id,
          after: {
            workDate,
            checkInAt: now,
            lateMinutes,
            attendanceStatus: checkInTitleStatus(isLate),
            method: dto.method,
          },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.checked_in",
          payload: {
            recordId: record.id,
            userId: actor.id,
            employeeId: employee.id,
            workDate,
            status: values.status,
          },
        });
        return toRecordV2Dto(record);
      })
      .catch((err: unknown) => this.mapCheckInError(err, actor));
  }

  async checkOut(actor: Actor, dto: CheckOutRequest) {
    const now = new Date();
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const employee = await this.requireEmployee(tx, actor);

        // F5: resolve the in-progress (open) record by checked-in/not-checked-out, NOT by today's local
        // date — an overnight shift checks in on day D and out on D+1, so the open record's own workDate
        // is the anchor for period-lock + early-leave calc.
        const [existing] = await this.repo.findOpenRecordForUserTx(actor.companyId, actor.id, tx);
        if (!existing?.checkInAt) throw new ConflictException("Chưa check-in (hoặc đã check-out)");
        const workDate = existing.workDate;
        this.assertPeriodOpen(
          await this.repo.isPeriodLockedTx(actor.companyId, monthOfDate(workDate), tx),
          workDate,
        );

        // Calc against the shift APPLIED at check-in (stored shift_id) so the math is stable across days.
        const shift = existing.shiftId
          ? await this.repo.findShiftByIdTx(actor.companyId, existing.shiftId, tx)
          : null;
        const tz = shiftTimezone(shift);
        const rule = await this.resolveRule(tx, actor.companyId, employee, workDate);
        await this.assertNotOnApprovedLeave(tx, actor, employee, rule, workDate);

        const breakMin = existing.breakMinutes ?? shift?.breakMinutes ?? 0;
        const required = existing.requiredWorkingMinutes ?? shift?.requiredWorkingMinutes ?? null;
        const earlyLeaveMinutes = shift
          ? shiftEarlyLeaveMinutes(now, workDate, toShiftCalc(shift, tz))
          : 0;
        const worked = computeWorkingMinutes(existing.checkInAt, now, breakMin);
        const missing = computeMissingMinutes(required, worked);
        const lateMinutes = existing.lateMinutes;
        const legacyStatus = deriveAttendanceStatus(lateMinutes, earlyLeaveMinutes);
        const attendanceStatus = checkOutTitleStatus(lateMinutes, earlyLeaveMinutes, missing);

        const [record] = await this.repo.updateRecordTx(
          actor.companyId,
          existing.id,
          {
            checkOutAt: now,
            checkOutMethod: dto.method,
            earlyLeaveMinutes,
            status: legacyStatus,
            workingMinutes: worked,
            missingMinutes: missing,
            attendanceStatus,
            isEarlyLeave: earlyLeaveMinutes > 0,
            isMissingCheckOut: false,
            calculationSnapshot: {
              tz,
              shiftId: shift?.id ?? null,
              endTime: shift?.endTime ?? null,
              earlyLeaveMinutes,
              workingMinutes: worked,
              requiredWorkingMinutes: required,
              missingMinutes: missing,
              checkOutAt: now.toISOString(),
            },
            updatedBy: actor.id,
          },
          tx,
        );
        if (!record) throw new InternalServerErrorException("Failed to record check-out");

        const [log] = await this.repo.insertAttendanceLogTx(
          actor.companyId,
          buildLog(actor, employee, record.id, workDate, "Check-out", dto),
          tx,
        );
        await this.repo.updateRecordTx(actor.companyId, record.id, { lastLogId: log.id }, tx);

        await this.audit.record(tx, {
          action: "attendance.check_out",
          objectType: "attendance_record",
          objectId: record.id,
          actorUserId: actor.id,
          after: {
            workDate,
            checkOutAt: now,
            earlyLeaveMinutes,
            workingMinutes: worked,
            missingMinutes: missing,
            attendanceStatus,
            method: dto.method,
          },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.checked_out",
          payload: {
            recordId: record.id,
            userId: actor.id,
            employeeId: employee.id,
            workDate,
            status: legacyStatus,
          },
        });
        return toRecordV2Dto(record);
      })
      .catch((err: unknown) =>
        this.mapError(err, "checkOut", { companyId: actor.companyId, userId: actor.id }),
      );
  }

  // ─── S3-ATT-BE-1 helpers ─────────────────────────────────────────────────────

  /** Resolve hồ sơ nhân sự + gate trạng thái việc làm (chỉ 'active' được chấm công). */
  private async requireEmployee(tx: TenantTx, actor: Actor): Promise<ResolvedEmployee> {
    const employee = await this.repo.resolveEmployeeByUserIdTx(actor.companyId, actor.id, tx);
    if (!employee) throw new ForbiddenException(NO_EMPLOYEE_MSG);
    if (employee.status === "active") return employee;
    if (employee.status === "resigned" || employee.status === "terminated") {
      throw new ForbiddenException(
        `Hồ sơ nhân sự ở trạng thái "${employee.status}" — không thể chấm công`,
      );
    }
    throw new ConflictException(
      `Hồ sơ nhân sự đang tạm ngưng (${employee.status}) — không thể chấm công`,
    );
  }

  /** Ca hiệu lực (assignment → ca mặc định) + rule hiệu lực + tz + work_date (theo tz ca). */
  private async resolveShiftAndRule(
    tx: TenantTx,
    companyId: string,
    employee: ResolvedEmployee,
    now: Date,
  ): Promise<{ shift: ShiftRow | null; rule: EffectiveRule; tz: string; workDate: string }> {
    // Provisional date (DEFAULT_TZ) chỉ để lọc khoảng hiệu lực assignment; tz cuối lấy từ ca → work_date chuẩn.
    const provisional = localDateOf(now, DEFAULT_TZ);
    const shift =
      (await this.repo.resolveEffectiveShiftTx(
        companyId,
        { employeeId: employee.id, orgUnitId: employee.orgUnitId, workDate: provisional },
        tx,
      )) ?? (await this.repo.findDefaultShiftTx(companyId, tx));
    const tz = shiftTimezone(shift);
    const workDate = localDateOf(now, tz);
    const rule = await this.resolveRule(tx, companyId, employee, workDate);
    return { shift, rule, tz, workDate };
  }

  /** Rule hiệu lực: scope-match → DEFAULT_OFFICE_RULE → bất kỳ Company/System → in-code default. */
  private async resolveRule(
    tx: TenantTx,
    companyId: string,
    employee: ResolvedEmployee,
    workDate: string,
  ): Promise<EffectiveRule> {
    const row =
      (await this.repo.resolveEffectiveRuleTx(
        companyId,
        { employeeId: employee.id, orgUnitId: employee.orgUnitId, workDate },
        tx,
      )) ??
      (await this.repo.findRuleByCodeTx(companyId, ATT_DEFAULT_RULE_CODE, tx)) ??
      (await this.repo.findAnyActiveRuleTx(companyId, tx));
    return row ? toEffectiveRule(row) : DEFAULT_RULE;
  }

  /** Chặn check-in/check-out khi có đơn nghỉ cả ngày ĐÃ DUYỆT (gate sau rule.blockWhenLeaveApproved). */
  private async assertNotOnApprovedLeave(
    tx: TenantTx,
    actor: Actor,
    employee: ResolvedEmployee,
    rule: EffectiveRule,
    workDate: string,
  ): Promise<void> {
    if (!rule.blockWhenLeaveApproved) return;
    const onLeave = await this.repo.findApprovedFullDayLeaveTx(
      actor.companyId,
      { userId: actor.id, employeeId: employee.id, workDate },
      tx,
    );
    if (onLeave) {
      throw new ConflictException(`Đã có đơn nghỉ được duyệt cho ngày ${workDate}`);
    }
  }

  /** check-in: 23505 (đua chèn cùng ngày) → 409 backstop; còn lại → mapError chung. */
  private mapCheckInError(err: unknown, actor: Actor): never {
    if (isUniqueViolation(err)) {
      throw new ConflictException("Đã có bản ghi chấm công cho hôm nay (trùng lặp)");
    }
    return this.mapError(err, "checkIn", { companyId: actor.companyId, userId: actor.id });
  }

  // ─── Monthly list (read:attendance; others ⇒ manage) ─────────────────────────

  async listMonthly(
    actor: Actor,
    query: { month: string; userId?: string; limit: number; offset: number },
  ) {
    const { from, toExclusive } = monthDateRange(query.month);
    if (query.userId && query.userId !== actor.id) {
      await this.assertCanManage(actor, "attendance");
    }
    return this.repo.findRecordsByMonth(actor.companyId, {
      from,
      toExclusive,
      userId: query.userId ?? actor.id,
      limit: query.limit,
      offset: query.offset,
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
          throw new ConflictException(
            `Đã có đơn bổ sung công đang chờ duyệt cho ngày ${dto.workDate}`,
          );
        }
        return this.mapError(err, "createAdjustment", { companyId: actor.companyId });
      });
  }

  async listAdjustments(
    actor: Actor,
    query: { status?: string; scope: "me" | "all"; limit: number; offset: number },
  ) {
    if (query.scope === "all") {
      await this.assertCanApprove(actor, "attendance");
      return this.repo.findAdjustments(actor.companyId, {
        status: query.status,
        limit: query.limit,
        offset: query.offset,
      });
    }
    return this.repo.findAdjustments(actor.companyId, {
      userId: actor.id,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async approveAdjustment(actor: Actor, id: string, note?: string) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        // Re-read under FOR UPDATE inside the tx so two concurrent approvals serialize (F1 TOCTOU):
        // the second waits on the row lock, then sees status≠pending and is rejected below.
        const [request] = await this.repo.findAdjustmentByIdForUpdateTx(actor.companyId, id, tx);
        if (!request) throw new NotFoundException(`Adjustment request not found: ${id}`);
        if (request.status !== "pending") {
          throw new ConflictException(
            `Đơn không còn ở trạng thái chờ duyệt (status=${request.status})`,
          );
        }
        this.assertPeriodOpen(
          await this.repo.isPeriodLockedTx(actor.companyId, monthOfDate(request.workDate), tx),
          request.workDate,
        );

        // Apply the requested times to the attendance record (create it if the day had none).
        const schedule = await this.repo.resolveScheduleForUserTx(
          actor.companyId,
          request.userId,
          tx,
        );
        const calc = schedule ? toScheduleCalc(schedule) : null;
        const [existing] = await this.repo.findRecordByUserDateTx(
          actor.companyId,
          request.userId,
          request.workDate,
          tx,
        );

        const checkInAt = request.requestedCheckInAt ?? existing?.checkInAt ?? null;
        const checkOutAt = request.requestedCheckOutAt ?? existing?.checkOutAt ?? null;
        const lateMinutes =
          calc && checkInAt ? lateMinutesFor(checkInAt, request.workDate, calc) : 0;
        const earlyLeaveMinutes =
          calc && checkOutAt ? earlyLeaveMinutesFor(checkOutAt, request.workDate, calc) : 0;

        const recordValues = {
          checkInAt,
          checkOutAt,
          checkInMethod: request.requestedCheckInAt
            ? "adjustment"
            : (existing?.checkInMethod ?? null),
          checkOutMethod: request.requestedCheckOutAt
            ? "adjustment"
            : (existing?.checkOutMethod ?? null),
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

        if (request.taskId)
          await this.hrTasks.closeTaskTx(tx, actor.companyId, request.taskId, "approved");

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
          payload: {
            requestId: id,
            recordId: record.id,
            userId: request.userId,
            approvedBy: actor.id,
          },
        });
        return toAdjustmentDto(updated);
      })
      .catch((err: unknown) =>
        this.mapError(err, "approveAdjustment", { companyId: actor.companyId, id }),
      );
  }

  async rejectAdjustment(actor: Actor, id: string, note?: string) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        // Re-read under FOR UPDATE inside the tx so two concurrent decisions serialize (F1 TOCTOU).
        const [request] = await this.repo.findAdjustmentByIdForUpdateTx(actor.companyId, id, tx);
        if (!request) throw new NotFoundException(`Adjustment request not found: ${id}`);
        if (request.status !== "pending") {
          throw new ConflictException(
            `Đơn không còn ở trạng thái chờ duyệt (status=${request.status})`,
          );
        }
        const [updated] = await this.repo.updateAdjustmentTx(
          actor.companyId,
          id,
          {
            status: "rejected",
            approvedBy: actor.id,
            approvedAt: new Date(),
            reviewNote: note ?? null,
          },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to reject adjustment request");
        if (request.taskId)
          await this.hrTasks.closeTaskTx(tx, actor.companyId, request.taskId, "completed");

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
      .catch((err: unknown) =>
        this.mapError(err, "rejectAdjustment", { companyId: actor.companyId, id }),
      );
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
      .catch((err: unknown) =>
        this.mapError(err, "cancelAdjustment", { companyId: actor.companyId, id }),
      );
  }

  // ─── Period lock (lock-period:attendance) ────────────────────────────────────

  listPeriods(companyId: string, opts: { limit: number; offset: number }) {
    return this.repo.findPeriods(companyId, opts).then((rows) => rows.map(toPeriodDto));
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
      .catch((err: unknown) =>
        this.mapError(err, "lockPeriod", { companyId: actor.companyId, periodMonth }),
      );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private loadAdjustment(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) => this.repo.findAdjustmentByIdTx(companyId, id, tx));
  }

  private assertPeriodOpen(locked: boolean, workDate: string): void {
    if (locked) {
      throw new ConflictException(
        `Kỳ công ${monthOfDate(workDate)} đã khoá — không thể ghi/sửa công`,
      );
    }
  }

  private async assertCanManage(actor: Actor, resourceType: string): Promise<void> {
    const decision = await this.permission.can({
      userId: actor.id,
      companyId: actor.companyId,
      action: "manage",
      resourceType,
    });
    if (!decision.allow)
      throw new ForbiddenException("Không có quyền xem dữ liệu của nhân sự khác");
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

// ─── S3-ATT-BE-1 mappers / pure builders (Date → JSON ISO handled by the serializer) ──

/** Đọc tz từ shift.metadata.timezone (jsonb), fallback DEFAULT_TZ. */
function shiftTimezone(shift: ShiftRow | null): string {
  const meta = shift?.metadata;
  if (meta && typeof meta === "object" && "timezone" in meta) {
    const tz = (meta as { timezone?: unknown }).timezone;
    if (typeof tz === "string" && tz.length > 0) return tz;
  }
  return DEFAULT_TZ;
}

/** ShiftRow → ShiftCalc (chỉ field math cần). */
function toShiftCalc(shift: ShiftRow, tz: string): ShiftCalc {
  return {
    startTime: shift.startTime,
    endTime: shift.endTime,
    graceLateMinutes: shift.graceLateMinutes,
    graceEarlyLeaveMinutes: shift.graceEarlyLeaveMinutes,
    breakMinutes: shift.breakMinutes,
    crossDay: shift.crossDay,
    timezone: tz,
  };
}

/** Chuẩn hoá rule row → EffectiveRule (block_when_leave_approved default true khi thiếu). */
function toEffectiveRule(row: {
  id: string;
  ruleCode: string;
  requireCheckIn: boolean;
  requireCheckOut: boolean;
  ruleConfig: unknown;
}): EffectiveRule {
  const cfg = (row.ruleConfig ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    ruleCode: row.ruleCode,
    requireCheckIn: row.requireCheckIn,
    requireCheckOut: row.requireCheckOut,
    blockWhenLeaveApproved: cfg["block_when_leave_approved"] !== false,
  };
}

/** method (web/mobile) → attendance source enum (WEB/MOBILE) — CHECK chk_*_source. */
function methodToSource(method: string): "WEB" | "MOBILE" {
  return method === "mobile" ? "MOBILE" : "WEB";
}

/** Giá trị ghi attendance_records lúc check-in (cột legacy + DB-04 §7.4 additive). */
function buildCheckInValues(
  actor: Actor,
  employee: ResolvedEmployee,
  shift: ShiftRow | null,
  rule: EffectiveRule,
  tz: string,
  now: Date,
  dto: CheckInRequest,
  lateMinutes: number,
) {
  const isLate = lateMinutes > 0;
  return {
    // ── legacy (KEEP — user_id NOT NULL ⇒ live 0-dup unique attendance_records_company_user_date_uq) ──
    checkInAt: now,
    checkInMethod: dto.method,
    locationJson: dto.location ?? null,
    lateMinutes,
    earlyLeaveMinutes: 0,
    status: deriveAttendanceStatus(lateMinutes, 0),
    // ── DB-04 §7.4 additive (nullable) ──
    employeeId: employee.id,
    departmentId: employee.orgUnitId,
    positionId: employee.positionId,
    shiftId: shift?.id ?? null,
    appliedRuleId: rule.id,
    requiredWorkingMinutes: shift?.requiredWorkingMinutes ?? null,
    breakMinutes: shift?.breakMinutes ?? null,
    attendanceStatus: checkInTitleStatus(isLate),
    attendanceSource: methodToSource(dto.method),
    workMode: "Office",
    isLate,
    isEarlyLeave: false,
    isMissingCheckIn: false,
    isMissingCheckOut: true,
    calculationSnapshot: {
      tz,
      shiftId: shift?.id ?? null,
      shiftCode: shift?.shiftCode ?? null,
      startTime: shift?.startTime ?? null,
      graceLateMinutes: shift?.graceLateMinutes ?? null,
      lateMinutes,
      ruleId: rule.id,
      checkInAt: now.toISOString(),
    },
    updatedBy: actor.id,
  };
}

/** attendance_logs APPEND-ONLY row: server-time (logTime DEFAULT now()); client_time = tham chiếu. */
function buildLog(
  actor: Actor,
  employee: ResolvedEmployee,
  recordId: string,
  workDate: string,
  logType: "Check-in" | "Check-out",
  dto: CheckInRequest | CheckOutRequest,
): AttendanceLogInsert {
  return {
    attendanceRecordId: recordId,
    employeeId: employee.id,
    userId: actor.id,
    workDate,
    logType,
    clientTime: dto.clientTime ? new Date(dto.clientTime) : null,
    clientTimezone: dto.clientTimezone ?? null,
    source: methodToSource(dto.method),
    gpsLatitude: dto.location ? String(dto.location.lat) : null,
    gpsLongitude: dto.location ? String(dto.location.lng) : null,
    locationLabel: dto.location?.label ?? null,
    isValid: true,
    note: dto.note ?? null,
    createdBy: actor.id,
  };
}

/** Một attendance_records row (superset) → DTO V2 trả REST/WS. */
interface RecordRowForDto {
  id: string;
  workDate: string;
  employeeId: string | null;
  shiftId: string | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  checkInMethod: string | null;
  checkOutMethod: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workingMinutes: number | null;
  requiredWorkingMinutes: number | null;
  missingMinutes: number | null;
  breakMinutes: number | null;
  status: string;
  attendanceStatus: string | null;
  isLate: boolean | null;
  isEarlyLeave: boolean | null;
  isMissingCheckOut: boolean | null;
}

function toRecordV2Dto(row: RecordRowForDto) {
  return {
    id: row.id,
    workDate: row.workDate,
    employeeId: row.employeeId ?? null,
    shiftId: row.shiftId ?? null,
    checkInAt: row.checkInAt,
    checkOutAt: row.checkOutAt,
    checkInMethod: row.checkInMethod,
    checkOutMethod: row.checkOutMethod,
    lateMinutes: row.lateMinutes,
    earlyLeaveMinutes: row.earlyLeaveMinutes,
    workingMinutes: row.workingMinutes ?? null,
    requiredWorkingMinutes: row.requiredWorkingMinutes ?? null,
    missingMinutes: row.missingMinutes ?? null,
    breakMinutes: row.breakMinutes ?? null,
    status: row.status,
    attendanceStatus: row.attendanceStatus ?? null,
    isLate: row.isLate ?? null,
    isEarlyLeave: row.isEarlyLeave ?? null,
    isMissingCheckOut: row.isMissingCheckOut ?? null,
  };
}

function toShiftSummary(shift: ShiftRow, tz: string) {
  return {
    id: shift.id,
    shiftCode: shift.shiftCode,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakMinutes: shift.breakMinutes,
    requiredWorkingMinutes: shift.requiredWorkingMinutes,
    graceLateMinutes: shift.graceLateMinutes,
    graceEarlyLeaveMinutes: shift.graceEarlyLeaveMinutes,
    crossDay: shift.crossDay,
    isDefault: shift.isDefault,
    timezone: tz,
  };
}

function toRuleSummary(rule: EffectiveRule) {
  return {
    id: rule.id,
    ruleCode: rule.ruleCode,
    requireCheckIn: rule.requireCheckIn,
    requireCheckOut: rule.requireCheckOut,
    blockWhenLeaveApproved: rule.blockWhenLeaveApproved,
  };
}

/** Today khi không có employee mapping (KHÔNG throw — màn hình hiển thị lý do). */
function emptyToday(workDate: string, reason: string) {
  return {
    workDate,
    employee: null,
    shift: null,
    rule: null,
    record: null,
    allowedActions: { canCheckIn: false, canCheckOut: false },
    disabledReason: reason,
    periodLocked: false,
  };
}

function todayDisabledReason(args: {
  active: boolean;
  onLeave: boolean;
  periodLocked: boolean;
  checkedOut: boolean;
  workDate: string;
}): string | null {
  if (!args.active) return "Hồ sơ nhân sự không ở trạng thái làm việc — không thể chấm công";
  if (args.onLeave) return `Đã có đơn nghỉ được duyệt cho ngày ${args.workDate}`;
  if (args.periodLocked) return `Kỳ công ${monthOfDate(args.workDate)} đã khoá`;
  if (args.checkedOut) return "Đã hoàn tất chấm công hôm nay";
  return null;
}

function buildTodayDto(args: {
  workDate: string;
  employee: ResolvedEmployee;
  shift: ShiftRow | null;
  rule: EffectiveRule;
  tz: string;
  record: RecordRowForDto | null;
  periodLocked: boolean;
  onLeave: boolean;
}) {
  const { workDate, employee, shift, rule, tz, record, periodLocked, onLeave } = args;
  const active = employee.status === "active";
  const checkedIn = Boolean(record?.checkInAt);
  const checkedOut = Boolean(record?.checkOutAt);
  return {
    workDate,
    employee: { id: employee.id, status: employee.status },
    shift: shift ? toShiftSummary(shift, tz) : null,
    rule: toRuleSummary(rule),
    record: record ? toRecordV2Dto(record) : null,
    allowedActions: {
      canCheckIn: active && !periodLocked && !onLeave && !checkedIn,
      canCheckOut: active && !periodLocked && !onLeave && checkedIn && !checkedOut,
    },
    disabledReason: todayDisabledReason({ active, onLeave, periodLocked, checkedOut, workDate }),
    periodLocked,
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
  return row;
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
