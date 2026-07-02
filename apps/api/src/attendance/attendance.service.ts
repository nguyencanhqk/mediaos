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
  CreateWorkScheduleRequest,
  UpdateWorkScheduleRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { assertValidTimezone, localDateOf, monthDateRange, monthOfDate } from "../common/tz.util";
import { AttendanceRepository } from "./attendance.repository";
import {
  checkOutTitleStatus,
  computeMissingMinutes,
  computeWorkingMinutes,
  deriveAttendanceStatus,
  shiftEarlyLeaveMinutes,
  shiftLateMinutes,
} from "./attendance.logic";
import { isUniqueViolation } from "../common/db-error";
import {
  ATT_DEFAULT_RULE_CODE,
  DEFAULT_RULE,
  DEFAULT_TZ,
  NO_EMPLOYEE_MSG,
  type Actor,
  type EffectiveRule,
  type ResolvedEmployee,
  type ShiftRow,
} from "./attendance.types";
import {
  buildTodayDto,
  emptyToday,
  shiftTimezone,
  toEffectiveRule,
  toPeriodDto,
  toRecordV2Dto,
  toScheduleDto,
  toShiftCalc,
} from "./attendance.mappers";
import {
  buildAttendanceEvent,
  buildCheckInAudit,
  buildCheckInValues,
  buildCheckOutAudit,
  buildCheckOutValues,
  buildLog,
} from "./attendance.builders";

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
          after: buildCheckInAudit(workDate, now, lateMinutes, isLate, dto.method),
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.checked_in",
          payload: buildAttendanceEvent(record.id, actor, employee, workDate, values.status),
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

        const calc = {
          earlyLeaveMinutes,
          workingMinutes: worked,
          missingMinutes: missing,
          requiredWorkingMinutes: required,
          legacyStatus,
          attendanceStatus,
        };
        const [record] = await this.repo.updateRecordTx(
          actor.companyId,
          existing.id,
          buildCheckOutValues(actor, shift, tz, now, dto, calc),
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
          after: buildCheckOutAudit(workDate, now, dto.method, calc),
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.checked_out",
          payload: buildAttendanceEvent(record.id, actor, employee, workDate, legacyStatus),
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

  /**
   * Ca hiệu lực (assignment → ca mặc định) + rule hiệu lực + tz + work_date (theo tz ca).
   *
   * S3-ATT-BE-3: PUBLIC (was private) + `explicitWorkDate` optional param — AttendanceShiftService
   * (GET /attendance/rules/effective) reuses this EXACT method so the shift/rule priority order
   * (Employee≻Department≻Company≻System, DB-04 §10) has ONE implementation shared with S3-ATT-BE-1
   * (today/check-in/check-out). Existing callers (checkIn/checkOut/getToday) omit the 5th arg —
   * behavior unchanged (provisional/workDate still derived from `now`).
   */
  async resolveShiftAndRule(
    tx: TenantTx,
    companyId: string,
    employee: ResolvedEmployee,
    now: Date,
    explicitWorkDate?: string,
  ): Promise<{ shift: ShiftRow | null; rule: EffectiveRule; tz: string; workDate: string }> {
    // Provisional date (DEFAULT_TZ) chỉ để lọc khoảng hiệu lực assignment; tz cuối lấy từ ca → work_date chuẩn.
    const provisional = explicitWorkDate ?? localDateOf(now, DEFAULT_TZ);
    const shift =
      (await this.repo.resolveEffectiveShiftTx(
        companyId,
        { employeeId: employee.id, orgUnitId: employee.orgUnitId, workDate: provisional },
        tx,
      )) ?? (await this.repo.findDefaultShiftTx(companyId, tx));
    const tz = shiftTimezone(shift);
    const workDate = explicitWorkDate ?? localDateOf(now, tz);
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

  // ─── Adjustment requests (CONVERGED → AttendanceAdjustmentService, S3-ATT-BE-4) ──
  // The adjustment create/list/detail/approve/reject/direct write surface now lives in
  // AttendanceAdjustmentService (canonical TitleCase FSM + engine pairs *:adjustment / adjust-direct:
  // attendance + append-only items ledger + recalc-keeps-logs). Removed from here so there is exactly
  // one writer with one status vocabulary.

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

  private mapError(err: unknown, op: string, ctx: Record<string, unknown>): never {
    // Known HTTP exceptions (NotFound/Conflict/Forbidden/InternalServerError/…) pass through.
    if (err instanceof HttpException) throw err;
    // Unknown infra errors (PG wire, Drizzle) must NOT leak schema/constraint detail to the client:
    // log the original, surface a generic 500.
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw new InternalServerErrorException("Lỗi hệ thống, vui lòng thử lại");
  }
}
