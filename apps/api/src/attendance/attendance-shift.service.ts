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
import { AuditService } from "../events/audit.service";
import type { AttendanceRule, Shift, ShiftAssignment } from "../db/schema/attendance";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";
import { AttendanceShiftRepository } from "./attendance-shift.repository";
import { toRuleDto, toShiftAssignmentDto, toShiftDto } from "./attendance-shift.mappers";
import { toEffectiveShiftRuleDto } from "./attendance.mappers";
import type { Actor } from "./attendance.types";

/**
 * Audit snapshot = config-only projection of a row (BẤT BIẾN #3): reuse the DTO mapper (which already
 * carries ONLY shift/rule/assignment config fields — the tables hold NO secret/PII columns), then strip
 * createdAt/updatedAt (not config; always-changed noise that would pollute changed_fields on every update).
 */
function shiftSnapshot(row: Shift): Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, ...cfg } = toShiftDto(row);
  return cfg;
}
function ruleSnapshot(row: AttendanceRule): Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, ...cfg } = toRuleDto(row);
  return cfg;
}
function assignmentSnapshot(row: ShiftAssignment): Record<string, unknown> {
  const { createdAt: _c, updatedAt: _u, ...cfg } = toShiftAssignmentDto(row);
  return cfg;
}

/**
 * S3-ATT-BE-3 — shift/rule/assignment CRUD (minimum scope, DB-04 §7.1/7.2/7.3) + effective resolve.
 *
 * `getEffectiveShiftRule` reuses `AttendanceService.resolveShiftAndRule` (S3-ATT-BE-1) — ONE
 * implementation of the Employee≻Department≻Company≻System priority (§10) for both the Today/
 * check-in/check-out flow AND the standalone GET /attendance/rules/effective read. CRUD is
 * intentionally minimal (create/update only, no delete/list-filter/bulk) — advanced ops are
 * carry-over CO-S4-007.
 *
 * AUDIT (SPEC-01 §16.3 / BẤT BIẾN #2): config của shift/rule/assignment đổi cách tính công TOÀN công ty
 * = 'hành động quan trọng' ⇒ create/update ghi audit IN-TX (cùng withTenant tx → cùng commit/rollback,
 * không audit nửa vời). object_type ∈ {'shift','attendance_rule','shift_assignment'} — đã nạp vào
 * AUDIT_OBJECT_TYPES + CHECK DB (migration 0457, UNION ADD-only, append-only #2 nguyên vẹn). before/after
 * = snapshot cấu hình ONLY (shiftSnapshot/ruleSnapshot/assignmentSnapshot — bảng KHÔNG có cột secret/PII;
 * AuditService cũng mask lần nữa trước insert — BẤT BIẾN #3). 404 (row không tồn tại/tenant khác) → throw
 * TRƯỚC audit ⇒ KHÔNG ghi audit giả cho mutation không xảy ra.
 */
@Injectable()
export class AttendanceShiftService {
  private readonly logger = new Logger(AttendanceShiftService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AttendanceRepository,
    private readonly shiftRepo: AttendanceShiftRepository,
    private readonly attendanceService: AttendanceService,
    private readonly audit: AuditService,
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
        await this.audit.record(tx, {
          action: "ShiftCreated",
          actionGroup: "CREATE",
          objectType: "shift",
          objectId: row.id,
          actorUserId: actor.id,
          actorType: "User",
          moduleCode: "ATT",
          entityType: "shift",
          entityId: row.id,
          after: shiftSnapshot(row),
          newValues: shiftSnapshot(row),
          sensitivityLevel: "Sensitive",
          resultStatus: "Success",
          dataScope: "Company",
          permissionCode: "ATT.SHIFT.CREATE",
        });
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
        await this.audit.record(tx, {
          action: "ShiftUpdated",
          actionGroup: "CONFIG_UPDATE",
          objectType: "shift",
          objectId: id,
          actorUserId: actor.id,
          actorType: "User",
          moduleCode: "ATT",
          entityType: "shift",
          entityId: id,
          before: shiftSnapshot(existing),
          after: shiftSnapshot(row),
          oldValues: shiftSnapshot(existing),
          newValues: shiftSnapshot(row),
          sensitivityLevel: "Sensitive",
          resultStatus: "Success",
          dataScope: "Company",
          permissionCode: "ATT.SHIFT.UPDATE",
        });
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
        await this.audit.record(tx, {
          action: "RuleCreated",
          actionGroup: "CREATE",
          objectType: "attendance_rule",
          objectId: row.id,
          actorUserId: actor.id,
          actorType: "User",
          moduleCode: "ATT",
          entityType: "attendance_rule",
          entityId: row.id,
          after: ruleSnapshot(row),
          newValues: ruleSnapshot(row),
          sensitivityLevel: "Sensitive",
          resultStatus: "Success",
          dataScope: "Company",
          permissionCode: "ATT.RULE.CONFIG",
        });
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
        await this.audit.record(tx, {
          action: "RuleUpdated",
          actionGroup: "CONFIG_UPDATE",
          objectType: "attendance_rule",
          objectId: id,
          actorUserId: actor.id,
          actorType: "User",
          moduleCode: "ATT",
          entityType: "attendance_rule",
          entityId: id,
          before: ruleSnapshot(existing),
          after: ruleSnapshot(row),
          oldValues: ruleSnapshot(existing),
          newValues: ruleSnapshot(row),
          sensitivityLevel: "Sensitive",
          resultStatus: "Success",
          dataScope: "Company",
          permissionCode: "ATT.RULE.CONFIG",
        });
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
        await this.audit.record(tx, {
          action: "ShiftAssignmentCreated",
          actionGroup: "CREATE",
          objectType: "shift_assignment",
          objectId: row.id,
          actorUserId: actor.id,
          actorType: "User",
          moduleCode: "ATT",
          entityType: "shift_assignment",
          entityId: row.id,
          after: assignmentSnapshot(row),
          newValues: assignmentSnapshot(row),
          sensitivityLevel: "Sensitive",
          resultStatus: "Success",
          dataScope: "Company",
          permissionCode: "ATT.SHIFT_ASSIGNMENT.UPDATE",
        });
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
