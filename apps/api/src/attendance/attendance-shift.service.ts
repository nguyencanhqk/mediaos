import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateRuleRequest,
  CreateShiftAssignmentRequest,
  CreateShiftRequest,
  UpdateRuleRequest,
  UpdateShiftRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { isUniqueViolation } from "../common/db-error";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";
import { AttendanceShiftRepository } from "./attendance-shift.repository";
import { toRuleDto, toShiftAssignmentDto, toShiftDto } from "./attendance-shift.mappers";
import { toEffectiveShiftRuleDto } from "./attendance.mappers";
import type { Actor } from "./attendance.types";

/**
 * S3-ATT-BE-3 — shift/rule/assignment CRUD (minimum scope, DB-04 §7.1/7.2/7.3) + effective resolve.
 *
 * `getEffectiveShiftRule` reuses `AttendanceService.resolveShiftAndRule` (S3-ATT-BE-1) — ONE
 * implementation of the Employee≻Department≻Company≻System priority (§10) for both the Today/
 * check-in/check-out flow AND the standalone GET /attendance/rules/effective read. CRUD is
 * intentionally minimal (create/update only, no delete/list-filter/bulk) — advanced ops are
 * carry-over CO-S4-007.
 *
 * KNOWN GAP (carry-over, NOT silently dropped): create/update here do NOT call AuditService yet.
 * `audit_logs.object_type` is a DB CHECK constraint (append-only #2) whose current allowed set
 * (migration history up to 0456) does NOT include 'shift' / 'attendance_rule' / 'shift_assignment' —
 * writing those values today would either (a) violate the CHECK on real Postgres (rolls back the
 * whole tx, breaking the create/update itself) or (b) require mislabeling under an unrelated existing
 * object_type, which corrupts the audit trail's accuracy. Neither is acceptable. This lane's declared
 * scope is `apps/api/src/attendance/**` + `packages/contracts/src/**` — extending the CHECK requires a
 * migration, which is explicitly OUT of scope here (CLAUDE.md rule #8: schema changes → lane
 * db-migration). CARRY-OVER: db-migration lane adds `shift`/`attendance_rule`/`shift_assignment` to the
 * audit_logs object_type CHECK (UNION ADD-only, clone migration 0456's DO-block pattern) + the same
 * values to `AUDIT_OBJECT_TYPES` (db/schema/audit.ts) in the SAME commit; this service then wires
 * `AuditService.record()` at the 5 marked TODO call sites below.
 */
@Injectable()
export class AttendanceShiftService {
  private readonly logger = new Logger(AttendanceShiftService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AttendanceRepository,
    private readonly shiftRepo: AttendanceShiftRepository,
    private readonly attendanceService: AttendanceService,
  ) {}

  // ─── shifts ──────────────────────────────────────────────────────────────────

  listShifts(companyId: string) {
    return this.shiftRepo.findShifts(companyId).then((rows) => rows.map(toShiftDto));
  }

  async createShift(actor: Actor, dto: CreateShiftRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [row] = await this.shiftRepo.insertShiftTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            shiftCode: dto.shiftCode,
            name: dto.name,
            description: dto.description ?? null,
            shiftType: dto.shiftType,
            startTime: dto.startTime ?? null,
            endTime: dto.endTime ?? null,
            breakStartTime: dto.breakStartTime ?? null,
            breakEndTime: dto.breakEndTime ?? null,
            breakMinutes: dto.breakMinutes,
            requiredWorkingMinutes: dto.requiredWorkingMinutes,
            flexibleCheckInFrom: dto.flexibleCheckInFrom ?? null,
            flexibleCheckInTo: dto.flexibleCheckInTo ?? null,
            graceLateMinutes: dto.graceLateMinutes,
            graceEarlyLeaveMinutes: dto.graceEarlyLeaveMinutes,
            allowEarlyCheckIn: dto.allowEarlyCheckIn,
            allowLateCheckOut: dto.allowLateCheckOut,
            crossDay: dto.crossDay,
            workDays: dto.workDays ?? null,
            isDefault: dto.isDefault,
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create shift");
        // TODO(carry-over db-migration): AuditService.record(tx, { action: "ShiftCreated",
        // objectType: "shift", objectId: row.id, actorUserId: actor.id, after: {...} }) — see class doc.
        return toShiftDto(row);
      })
      .catch((err: unknown) => this.mapCreateError(err, "createShift", "shiftCode", actor));
  }

  async updateShift(actor: Actor, id: string, dto: UpdateShiftRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [existing] = await this.shiftRepo.findShiftByIdTx(actor.companyId, id, tx);
        if (!existing) throw new NotFoundException(`Shift not found: ${id}`);
        const [row] = await this.shiftRepo.updateShiftTx(
          actor.companyId,
          id,
          { ...dto, updatedBy: actor.id },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to update shift");
        // TODO(carry-over db-migration): AuditService.record(tx, { action: "ShiftUpdated",
        // objectType: "shift", objectId: id, actorUserId: actor.id, before: {...}, after: {...} }).
        return toShiftDto(row);
      })
      .catch((err: unknown) =>
        this.mapError(err, "updateShift", { companyId: actor.companyId, id }),
      );
  }

  // ─── attendance_rules ────────────────────────────────────────────────────────

  listRules(companyId: string) {
    return this.shiftRepo.findRules(companyId).then((rows) => rows.map(toRuleDto));
  }

  async createRule(actor: Actor, dto: CreateRuleRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [row] = await this.shiftRepo.insertRuleTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            ruleCode: dto.ruleCode,
            name: dto.name,
            description: dto.description ?? null,
            ruleScope: dto.ruleScope,
            departmentId: dto.departmentId ?? null,
            employeeId: dto.employeeId ?? null,
            priority: dto.priority,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo ?? null,
            requireCheckIn: dto.requireCheckIn,
            requireCheckOut: dto.requireCheckOut,
            allowWebCheckIn: dto.allowWebCheckIn,
            allowMobileCheckIn: dto.allowMobileCheckIn,
            allowRemoteCheckIn: dto.allowRemoteCheckIn,
            allowAdjustmentRequest: dto.allowAdjustmentRequest,
            requireGps: dto.requireGps,
            requireNote: dto.requireNote,
            requirePhoto: dto.requirePhoto,
            allowHolidayAttendance: dto.allowHolidayAttendance,
            allowWeekendAttendance: dto.allowWeekendAttendance,
            autoAttendanceEnabled: dto.autoAttendanceEnabled,
            autoCheckOutEnabled: dto.autoCheckOutEnabled,
            autoAttendanceWorkingMinutes: dto.autoAttendanceWorkingMinutes ?? null,
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create rule");
        // TODO(carry-over db-migration): AuditService.record(tx, { action: "RuleCreated",
        // objectType: "attendance_rule", objectId: row.id, actorUserId: actor.id, after: {...} }).
        return toRuleDto(row);
      })
      .catch((err: unknown) => this.mapCreateError(err, "createRule", "ruleCode", actor));
  }

  async updateRule(actor: Actor, id: string, dto: UpdateRuleRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [existing] = await this.shiftRepo.findRuleByIdTx(actor.companyId, id, tx);
        if (!existing) throw new NotFoundException(`Attendance rule not found: ${id}`);
        const [row] = await this.shiftRepo.updateRuleTx(
          actor.companyId,
          id,
          { ...dto, updatedBy: actor.id },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to update rule");
        // TODO(carry-over db-migration): AuditService.record(tx, { action: "RuleUpdated",
        // objectType: "attendance_rule", objectId: id, actorUserId: actor.id, before: {...}, after: {...} }).
        return toRuleDto(row);
      })
      .catch((err: unknown) =>
        this.mapError(err, "updateRule", { companyId: actor.companyId, id }),
      );
  }

  // ─── shift_assignments ───────────────────────────────────────────────────────

  listShiftAssignments(companyId: string) {
    return this.shiftRepo
      .findShiftAssignments(companyId)
      .then((rows) => rows.map(toShiftAssignmentDto));
  }

  async createShiftAssignment(actor: Actor, dto: CreateShiftAssignmentRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [row] = await this.shiftRepo.insertShiftAssignmentTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            shiftId: dto.shiftId,
            assignmentScope: dto.assignmentScope,
            departmentId: dto.departmentId ?? null,
            employeeId: dto.employeeId ?? null,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo ?? null,
            priority: dto.priority,
            note: dto.note ?? null,
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create shift assignment");
        // TODO(carry-over db-migration): AuditService.record(tx, { action: "ShiftAssignmentCreated",
        // objectType: "shift_assignment", objectId: row.id, actorUserId: actor.id, after: {...} }).
        return toShiftAssignmentDto(row);
      })
      .catch((err: unknown) =>
        this.mapError(err, "createShiftAssignment", { companyId: actor.companyId }),
      );
  }

  // ─── GET /attendance/rules/effective — dùng chung resolve-effective của S3-ATT-BE-1 ──────────────

  /**
   * employeeId tuỳ chọn (mặc định = hồ sơ của caller). workDate tuỳ chọn (mặc định = hôm nay theo tz
   * ca). 404 khi employeeId không tồn tại HOẶC thuộc company khác (KHÔNG lộ tồn tại xuyên tenant).
   */
  async getEffectiveShiftRule(actor: Actor, opts: { employeeId?: string; workDate?: string }) {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const employee = opts.employeeId
        ? await this.repo.resolveEmployeeByIdTx(actor.companyId, opts.employeeId, tx)
        : await this.repo.resolveEmployeeByUserIdTx(actor.companyId, actor.id, tx);
      if (!employee) throw new NotFoundException("Không tìm thấy hồ sơ nhân sự");

      const { shift, rule, tz, workDate } = await this.attendanceService.resolveShiftAndRule(
        tx,
        actor.companyId,
        employee,
        new Date(),
        opts.workDate,
      );
      return toEffectiveShiftRuleDto({ workDate, employeeId: employee.id, shift, rule, tz });
    });
  }

  // ─── error mapping ───────────────────────────────────────────────────────────

  /** Duplicate business-key (shiftCode/ruleCode) → 409, not a generic 500. */
  private mapCreateError(err: unknown, op: string, field: string, actor: Actor): never {
    if (isUniqueViolation(err)) {
      throw new ConflictException(`Mã (${field}) đã tồn tại trong công ty`);
    }
    return this.mapError(err, op, { companyId: actor.companyId });
  }

  private mapError(err: unknown, op: string, ctx: Record<string, unknown>): never {
    if (err instanceof HttpException) throw err;
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw new InternalServerErrorException("Lỗi hệ thống, vui lòng thử lại");
  }
}
