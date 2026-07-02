import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  AdjustLeaveBalanceRequest,
  CreateLeavePolicyRequest,
  CreateLeaveTypeAdminRequest,
  LeaveBalanceAdminListQuery,
  LeaveBalanceAdminView,
  LeaveBalanceTransactionView,
  LeavePolicyListQuery,
  LeavePolicyView,
  LeaveTypeAdminView,
  UpdateLeavePolicyRequest,
  UpdateLeaveTypeAdminRequest,
} from "@mediaos/contracts";
import { isUniqueViolation } from "../common/db-error";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { DataScopeService } from "../permission/data-scope.service";
import { LeaveAdminRepository } from "./leave-admin.repository";
import { LEAVE_ERR, numOrNull, round2 } from "./leave-request.logic";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * S3-LEAVE-BE-4 — LEAVE ADMIN SURFACE (HR/company-admin): type/policy CRUD + balance view/adjust ledger.
 *
 * GATE: every method resolves the REAL catalog pair via DataScopeService.resolveAndAssert (all 10 pairs
 * Company-scope — mig 0455) BEFORE touching data. Controller's @RequirePermission is a belt-and-suspenders
 * coarse gate; the service call is the actual authorization decision (mirrors LeaveApprovalService /
 * LeaveCalendarService pattern).
 *
 * LEDGER (BẤT BIẾN #2): adjustBalance is the ONLY mutation path for leave_balances.total_days — it ALWAYS
 * pairs the balance UPDATE with exactly 1 leave_balance_transactions INSERT (type='ADJUSTMENT') in the SAME
 * tx. No endpoint sets total_days directly without an accompanying ledger row.
 */
@Injectable()
export class LeaveAdminService {
  private readonly logger = new Logger(LeaveAdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeaveAdminRepository,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  // ─── leave_types (view/create/update/delete:leave-type) ──────────────────────

  async createType(actor: Actor, dto: CreateLeaveTypeAdminRequest): Promise<LeaveTypeAdminView> {
    await this.dataScope.resolveAndAssert(actor.id, actor.companyId, "create", "leave-type", {
      isSensitive: true,
    });
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [row] = await this.repo.createTypeTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            name: dto.name,
            code: dto.code,
            paid: dto.paid,
            status: "active",
            description: dto.description ?? null,
            deductBalance: dto.deductBalance,
            balanceUnit: dto.balanceUnit,
            allowFullDay: dto.allowFullDay,
            allowHalfDay: dto.allowHalfDay,
            allowHourly: dto.allowHourly,
            allowMultipleDays: dto.allowMultipleDays,
            requireReason: dto.requireReason,
            requireAttachment: dto.requireAttachment,
            minNoticeDays: dto.minNoticeDays ?? null,
            maxDaysPerRequest: dto.maxDaysPerRequest != null ? String(dto.maxDaysPerRequest) : null,
            maxHoursPerRequest:
              dto.maxHoursPerRequest != null ? String(dto.maxHoursPerRequest) : null,
            allowNegativeBalance: dto.allowNegativeBalance,
            isSystemDefault: false,
            sortOrder: dto.sortOrder ?? null,
            createdBy: actor.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create leave type");
        await this.audit.record(tx, {
          action: "LeaveTypeCreated",
          objectType: "leave_type",
          objectId: row.id,
          actorUserId: actor.id,
          after: { name: row.name, code: row.code, paid: row.paid, status: row.status },
        });
        return toTypeAdminView(row);
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) {
          throw new ConflictException({
            code: LEAVE_ERR.TYPE_CODE_DUPLICATE,
            message: `Đã có loại nghỉ với mã '${dto.code}'`,
          });
        }
        return this.mapError(err, "createType", { companyId: actor.companyId });
      });
  }

  async updateType(
    actor: Actor,
    id: string,
    dto: UpdateLeaveTypeAdminRequest,
  ): Promise<LeaveTypeAdminView> {
    await this.dataScope.resolveAndAssert(actor.id, actor.companyId, "update", "leave-type", {
      isSensitive: true,
    });
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [existing] = await this.repo.findTypeByIdTx(actor.companyId, id, tx);
        if (!existing) {
          throw new NotFoundException({
            code: LEAVE_ERR.TYPE_NOT_FOUND,
            message: "Không tìm thấy loại nghỉ",
          });
        }
        const [row] = await this.repo.updateTypeTx(
          actor.companyId,
          id,
          {
            name: dto.name,
            paid: dto.paid,
            status: dto.status,
            description: dto.description,
            deductBalance: dto.deductBalance,
            balanceUnit: dto.balanceUnit,
            allowFullDay: dto.allowFullDay,
            allowHalfDay: dto.allowHalfDay,
            allowHourly: dto.allowHourly,
            allowMultipleDays: dto.allowMultipleDays,
            requireReason: dto.requireReason,
            requireAttachment: dto.requireAttachment,
            minNoticeDays: dto.minNoticeDays,
            maxDaysPerRequest:
              dto.maxDaysPerRequest === undefined
                ? undefined
                : dto.maxDaysPerRequest === null
                  ? null
                  : String(dto.maxDaysPerRequest),
            maxHoursPerRequest:
              dto.maxHoursPerRequest === undefined
                ? undefined
                : dto.maxHoursPerRequest === null
                  ? null
                  : String(dto.maxHoursPerRequest),
            allowNegativeBalance: dto.allowNegativeBalance,
            sortOrder: dto.sortOrder,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to update leave type");
        await this.audit.record(tx, {
          action: "LeaveTypeUpdated",
          objectType: "leave_type",
          objectId: id,
          actorUserId: actor.id,
          before: { name: existing.name, status: existing.status },
          after: { name: row.name, status: row.status },
        });
        return toTypeAdminView(row);
      })
      .catch((err: unknown) =>
        this.mapError(err, "updateType", { companyId: actor.companyId, id }),
      );
  }

  async deleteType(actor: Actor, id: string): Promise<void> {
    await this.dataScope.resolveAndAssert(actor.id, actor.companyId, "delete", "leave-type", {
      isSensitive: true,
    });
    await this.db
      .withTenant(actor.companyId, async (tx) => {
        const [existing] = await this.repo.findTypeByIdTx(actor.companyId, id, tx);
        if (!existing) {
          throw new NotFoundException({
            code: LEAVE_ERR.TYPE_NOT_FOUND,
            message: "Không tìm thấy loại nghỉ",
          });
        }
        const [row] = await this.repo.softDeleteTypeTx(actor.companyId, id, actor.id, tx);
        if (!row) throw new InternalServerErrorException("Failed to delete leave type");
        await this.audit.record(tx, {
          action: "LeaveTypeDeleted",
          objectType: "leave_type",
          objectId: id,
          actorUserId: actor.id,
          before: { name: existing.name, code: existing.code },
        });
      })
      .catch((err: unknown) =>
        this.mapError(err, "deleteType", { companyId: actor.companyId, id }),
      );
  }

  // ─── leave_policies (view/create/update/delete:leave-policy) ─────────────────

  async listPolicies(actor: Actor, query: LeavePolicyListQuery): Promise<LeavePolicyView[]> {
    await this.dataScope.resolveAndAssert(actor.id, actor.companyId, "view", "leave-policy", {
      isSensitive: true,
    });
    return this.db.withTenant(actor.companyId, async (tx) => {
      const rows = await this.repo.listPoliciesTx(
        actor.companyId,
        { leaveTypeId: query.leaveTypeId, policyScope: query.policyScope, status: query.status },
        tx,
      );
      return rows.map(toPolicyView);
    });
  }

  async createPolicy(actor: Actor, dto: CreateLeavePolicyRequest): Promise<LeavePolicyView> {
    await this.dataScope.resolveAndAssert(actor.id, actor.companyId, "create", "leave-policy", {
      isSensitive: true,
    });
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [type] = await this.repo.findTypeByIdTx(actor.companyId, dto.leaveTypeId, tx);
        if (!type) {
          throw new NotFoundException({
            code: LEAVE_ERR.TYPE_NOT_FOUND,
            message: "Không tìm thấy loại nghỉ",
          });
        }
        const [row] = await this.repo.createPolicyTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            leaveTypeId: dto.leaveTypeId,
            policyCode: dto.policyCode,
            name: dto.name,
            description: dto.description ?? null,
            policyScope: dto.policyScope,
            departmentId: dto.departmentId ?? null,
            employeeId: dto.employeeId ?? null,
            jobLevelId: dto.jobLevelId ?? null,
            contractTypeId: dto.contractTypeId ?? null,
            yearlyQuotaDays: dto.yearlyQuotaDays != null ? String(dto.yearlyQuotaDays) : null,
            yearlyQuotaHours: dto.yearlyQuotaHours != null ? String(dto.yearlyQuotaHours) : null,
            accrualMethod: dto.accrualMethod,
            accrualDayOfMonth: dto.accrualDayOfMonth ?? null,
            prorateOnJoinDate: dto.prorateOnJoinDate,
            includeWeekends: dto.includeWeekends,
            includePublicHolidays: dto.includePublicHolidays,
            reserveBalanceOnPending: dto.reserveBalanceOnPending,
            allowNegativeBalance: dto.allowNegativeBalance,
            maxNegativeDays: dto.maxNegativeDays != null ? String(dto.maxNegativeDays) : null,
            allowCancelAfterApproved: dto.allowCancelAfterApproved,
            cancelBeforeDays: dto.cancelBeforeDays ?? null,
            requiresManagerApproval: dto.requiresManagerApproval,
            requiresHrApproval: dto.requiresHrApproval,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo ?? null,
            priority: dto.priority,
            status: "Active",
            createdBy: actor.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create leave policy");
        await this.audit.record(tx, {
          action: "LeavePolicyCreated",
          objectType: "leave_policy",
          objectId: row.id,
          actorUserId: actor.id,
          after: {
            policyCode: row.policyCode,
            name: row.name,
            policyScope: row.policyScope,
            status: row.status,
          },
        });
        return toPolicyView({ ...row, leaveTypeCode: type.code, leaveTypeName: type.name });
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) {
          throw new ConflictException({
            code: LEAVE_ERR.POLICY_CODE_DUPLICATE,
            message: `Đã có chính sách với mã '${dto.policyCode}'`,
          });
        }
        return this.mapError(err, "createPolicy", { companyId: actor.companyId });
      });
  }

  async updatePolicy(
    actor: Actor,
    id: string,
    dto: UpdateLeavePolicyRequest,
  ): Promise<LeavePolicyView> {
    await this.dataScope.resolveAndAssert(actor.id, actor.companyId, "update", "leave-policy", {
      isSensitive: true,
    });
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [existing] = await this.repo.findPolicyByIdTx(actor.companyId, id, tx);
        if (!existing) {
          throw new NotFoundException({
            code: LEAVE_ERR.POLICY_NOT_FOUND,
            message: "Không tìm thấy chính sách nghỉ",
          });
        }
        const [type] = await this.repo.findTypeByIdTx(actor.companyId, existing.leaveTypeId, tx);
        const [row] = await this.repo.updatePolicyTx(
          actor.companyId,
          id,
          {
            name: dto.name,
            description: dto.description,
            status: dto.status,
            yearlyQuotaDays:
              dto.yearlyQuotaDays === undefined
                ? undefined
                : dto.yearlyQuotaDays === null
                  ? null
                  : String(dto.yearlyQuotaDays),
            yearlyQuotaHours:
              dto.yearlyQuotaHours === undefined
                ? undefined
                : dto.yearlyQuotaHours === null
                  ? null
                  : String(dto.yearlyQuotaHours),
            accrualMethod: dto.accrualMethod,
            accrualDayOfMonth: dto.accrualDayOfMonth,
            prorateOnJoinDate: dto.prorateOnJoinDate,
            includeWeekends: dto.includeWeekends,
            includePublicHolidays: dto.includePublicHolidays,
            reserveBalanceOnPending: dto.reserveBalanceOnPending,
            allowNegativeBalance: dto.allowNegativeBalance,
            maxNegativeDays:
              dto.maxNegativeDays === undefined
                ? undefined
                : dto.maxNegativeDays === null
                  ? null
                  : String(dto.maxNegativeDays),
            allowCancelAfterApproved: dto.allowCancelAfterApproved,
            cancelBeforeDays: dto.cancelBeforeDays,
            requiresManagerApproval: dto.requiresManagerApproval,
            requiresHrApproval: dto.requiresHrApproval,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo,
            priority: dto.priority,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to update leave policy");
        await this.audit.record(tx, {
          action: "LeavePolicyUpdated",
          objectType: "leave_policy",
          objectId: id,
          actorUserId: actor.id,
          before: { name: existing.name, status: existing.status },
          after: { name: row.name, status: row.status },
        });
        return toPolicyView({
          ...row,
          leaveTypeCode: type?.code ?? null,
          leaveTypeName: type?.name ?? null,
        });
      })
      .catch((err: unknown) =>
        this.mapError(err, "updatePolicy", { companyId: actor.companyId, id }),
      );
  }

  async deletePolicy(actor: Actor, id: string): Promise<void> {
    await this.dataScope.resolveAndAssert(actor.id, actor.companyId, "delete", "leave-policy", {
      isSensitive: true,
    });
    await this.db
      .withTenant(actor.companyId, async (tx) => {
        const [existing] = await this.repo.findPolicyByIdTx(actor.companyId, id, tx);
        if (!existing) {
          throw new NotFoundException({
            code: LEAVE_ERR.POLICY_NOT_FOUND,
            message: "Không tìm thấy chính sách nghỉ",
          });
        }
        const [row] = await this.repo.softDeletePolicyTx(actor.companyId, id, actor.id, tx);
        if (!row) throw new InternalServerErrorException("Failed to delete leave policy");
        await this.audit.record(tx, {
          action: "LeavePolicyDeleted",
          objectType: "leave_policy",
          objectId: id,
          actorUserId: actor.id,
          before: { policyCode: existing.policyCode, name: existing.name },
        });
      })
      .catch((err: unknown) =>
        this.mapError(err, "deletePolicy", { companyId: actor.companyId, id }),
      );
  }

  // ─── leave_balances (view/view-transaction/adjust:leave-balance) ─────────────

  async listBalances(
    actor: Actor,
    query: LeaveBalanceAdminListQuery,
  ): Promise<LeaveBalanceAdminView[]> {
    await this.dataScope.resolveAndAssert(actor.id, actor.companyId, "view", "leave-balance", {
      isSensitive: true,
    });
    return this.db.withTenant(actor.companyId, async (tx) => {
      const rows = await this.repo.listBalancesTx(
        actor.companyId,
        { employeeId: query.employeeId, leaveTypeId: query.leaveTypeId, year: query.year },
        tx,
      );
      return rows.map(toBalanceAdminView);
    });
  }

  async listBalanceTransactions(
    actor: Actor,
    balanceId: string,
  ): Promise<LeaveBalanceTransactionView[]> {
    await this.dataScope.resolveAndAssert(
      actor.id,
      actor.companyId,
      "view-transaction",
      "leave-balance",
      { isSensitive: true },
    );
    return this.db.withTenant(actor.companyId, async (tx) => {
      const [balance] = await this.repo.findBalanceByIdTx(actor.companyId, balanceId, tx);
      if (!balance) {
        throw new NotFoundException({
          code: LEAVE_ERR.BALANCE_NOT_FOUND,
          message: "Không tìm thấy số dư phép",
        });
      }
      const rows = await this.repo.listBalanceTransactionsTx(actor.companyId, balanceId, tx);
      return rows.map(toTransactionView);
    });
  }

  /**
   * Điều chỉnh số dư phép (crown — mọi thay đổi total_days ĐI QUA đây). amountDays âm/dương; reason bắt
   * buộc. Row-lock (FOR UPDATE) trên balance → 2 adjust song song serialize. Guard KHÔNG cho remaining
   * < 0 trừ khi leave_type.allow_negative_balance=true (chốt TRONG WHERE — race-safe, không TOCTOU).
   * balance UPDATE + 1 dòng leave_balance_transactions (ADJUSTMENT) LUÔN cùng 1 tx — không có nhánh nào
   * sửa total_days mà thiếu ledger row.
   */
  async adjustBalance(
    actor: Actor,
    balanceId: string,
    dto: AdjustLeaveBalanceRequest,
  ): Promise<LeaveBalanceAdminView> {
    await this.dataScope.resolveAndAssert(actor.id, actor.companyId, "adjust", "leave-balance", {
      isSensitive: true,
    });
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [balance] = await this.repo.findBalanceForUpdateTx(actor.companyId, balanceId, tx);
        if (!balance) {
          throw new NotFoundException({
            code: LEAVE_ERR.BALANCE_NOT_FOUND,
            message: "Không tìm thấy số dư phép",
          });
        }
        const [type] = await this.repo.findTypeAllowNegativeTx(
          actor.companyId,
          balance.leaveTypeId,
          tx,
        );
        const allowNegative = type?.allowNegativeBalance === true;

        const totalBefore = numOrNull(balance.totalDays) ?? 0;
        const usedBefore = numOrNull(balance.usedDays) ?? 0;
        const pendingBefore = numOrNull(balance.pendingDays) ?? 0;
        const remainingBefore = round2(totalBefore - usedBefore);

        const updatedRows = await this.repo.applyAdjustmentTx(
          actor.companyId,
          balanceId,
          String(dto.amountDays),
          allowNegative,
          tx,
        );
        const updated = updatedRows[0];
        if (!updated) {
          // WHERE guard fired (would go negative) — fail-closed rollback.
          throw new ConflictException({
            code: LEAVE_ERR.ADJUST_NEGATIVE_BALANCE,
            message: "Điều chỉnh làm số dư phép âm — không được phép với loại nghỉ này",
          });
        }

        if (!balance.employeeId) {
          // No employee link — ledger requires a NOT NULL employee_id (mig 0453). Fail-closed rather than
          // silently writing a ghost row with a wrong employee.
          throw new ConflictException({
            code: LEAVE_ERR.BALANCE_NOT_FOUND,
            message: "Số dư phép chưa liên kết hồ sơ nhân viên — không thể điều chỉnh",
          });
        }

        const totalAfter = round2(totalBefore + dto.amountDays);
        const remainingAfter = round2(totalAfter - usedBefore - pendingBefore);
        await this.repo.insertBalanceTransactionTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            leaveBalanceId: balanceId,
            employeeId: balance.employeeId,
            leaveTypeId: balance.leaveTypeId,
            transactionType: "ADJUSTMENT",
            transactionDate: new Date().toISOString().slice(0, 10),
            amountDays: String(dto.amountDays),
            balanceBeforeDays: String(remainingBefore),
            balanceAfterDays: String(remainingAfter),
            reason: dto.reason,
            createdByType: "User",
            createdBy: actor.id,
          },
          tx,
        );
        await this.audit.record(tx, {
          action: "LeaveBalanceAdjusted",
          objectType: "leave_balance",
          objectId: balanceId,
          actorUserId: actor.id,
          before: { totalDays: totalBefore, remainingDays: remainingBefore },
          after: { totalDays: totalAfter, amountDays: dto.amountDays, reason: dto.reason },
        });

        // Re-read WITH the type/user joins for the response view (applyAdjustmentTx's .returning() only
        // has raw leave_balances columns — no leaveTypeCode/userFullName).
        const [full] = await this.repo.listBalancesTx(actor.companyId, { id: balanceId }, tx);
        if (!full) throw new InternalServerErrorException("Failed to reload adjusted balance");
        return toBalanceAdminView(full);
      })
      .catch((err: unknown) =>
        this.mapError(err, "adjustBalance", { companyId: actor.companyId, balanceId }),
      );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private mapError(err: unknown, op: string, ctx: Record<string, unknown>): never {
    if (err instanceof HttpException) throw err;
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw new InternalServerErrorException("Lỗi hệ thống, vui lòng thử lại");
  }
}

// ─── row → view mappers ─────────────────────────────────────────────────────────

interface TypeRow {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  status: string;
  description: string | null;
  deductBalance: boolean | null;
  balanceUnit: string | null;
  allowFullDay: boolean | null;
  allowHalfDay: boolean | null;
  allowHourly: boolean | null;
  allowMultipleDays: boolean | null;
  requireReason: boolean | null;
  requireAttachment: boolean | null;
  minNoticeDays: number | null;
  maxDaysPerRequest: string | null;
  maxHoursPerRequest: string | null;
  allowNegativeBalance: boolean | null;
  sortOrder: number | null;
}

function toTypeAdminView(row: TypeRow): LeaveTypeAdminView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    paid: row.paid,
    status: row.status,
    description: row.description,
    deductBalance: row.deductBalance,
    balanceUnit: row.balanceUnit,
    allowFullDay: row.allowFullDay,
    allowHalfDay: row.allowHalfDay,
    allowHourly: row.allowHourly,
    allowMultipleDays: row.allowMultipleDays,
    requireReason: row.requireReason,
    requireAttachment: row.requireAttachment,
    minNoticeDays: row.minNoticeDays,
    maxDaysPerRequest: numOrNull(row.maxDaysPerRequest),
    maxHoursPerRequest: numOrNull(row.maxHoursPerRequest),
    sortOrder: row.sortOrder,
    allowNegativeBalance: row.allowNegativeBalance,
  };
}

interface PolicyRow {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string | null;
  leaveTypeName: string | null;
  policyCode: string;
  name: string;
  description: string | null;
  policyScope: string;
  departmentId: string | null;
  employeeId: string | null;
  jobLevelId: string | null;
  contractTypeId: string | null;
  yearlyQuotaDays: string | null;
  yearlyQuotaHours: string | null;
  accrualMethod: string;
  reserveBalanceOnPending: boolean;
  allowNegativeBalance: boolean;
  maxNegativeDays: string | null;
  requiresManagerApproval: boolean;
  requiresHrApproval: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  status: string;
}

function toPolicyView(row: PolicyRow): LeavePolicyView {
  return {
    id: row.id,
    leaveTypeId: row.leaveTypeId,
    leaveTypeCode: row.leaveTypeCode,
    leaveTypeName: row.leaveTypeName,
    policyCode: row.policyCode,
    name: row.name,
    description: row.description,
    policyScope: row.policyScope as LeavePolicyView["policyScope"],
    departmentId: row.departmentId,
    employeeId: row.employeeId,
    jobLevelId: row.jobLevelId,
    contractTypeId: row.contractTypeId,
    yearlyQuotaDays: numOrNull(row.yearlyQuotaDays),
    yearlyQuotaHours: numOrNull(row.yearlyQuotaHours),
    accrualMethod: row.accrualMethod as LeavePolicyView["accrualMethod"],
    reserveBalanceOnPending: row.reserveBalanceOnPending,
    allowNegativeBalance: row.allowNegativeBalance,
    maxNegativeDays: numOrNull(row.maxNegativeDays),
    requiresManagerApproval: row.requiresManagerApproval,
    requiresHrApproval: row.requiresHrApproval,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    priority: row.priority,
    status: row.status as LeavePolicyView["status"],
  };
}

interface BalanceRow {
  id: string;
  employeeId: string | null;
  userId: string;
  userFullName: string | null;
  leaveTypeId: string;
  leaveTypeCode: string | null;
  leaveTypeName: string | null;
  year: number;
  totalDays: string;
  usedDays: string;
  pendingDays: string | null;
  adjustedDays: string | null;
  remainingDays: string | null;
  allowNegativeBalance: boolean | null;
}

function toBalanceAdminView(row: BalanceRow): LeaveBalanceAdminView {
  const total = Number(row.totalDays);
  const used = Number(row.usedDays);
  const pending = numOrNull(row.pendingDays) ?? 0;
  const remaining = row.remainingDays != null ? Number(row.remainingDays) : total - used;
  return {
    id: row.id,
    employeeId: row.employeeId,
    userId: row.userId,
    userFullName: row.userFullName,
    leaveTypeId: row.leaveTypeId,
    leaveTypeCode: row.leaveTypeCode,
    leaveTypeName: row.leaveTypeName,
    year: row.year,
    totalDays: total,
    usedDays: used,
    pendingDays: pending,
    adjustedDays: numOrNull(row.adjustedDays) ?? 0,
    remainingDays: remaining,
    allowNegativeBalance: row.allowNegativeBalance,
  };
}

interface TransactionRow {
  id: string;
  transactionType: string;
  transactionDate: string;
  amountDays: string;
  balanceBeforeDays: string | null;
  balanceAfterDays: string | null;
  reason: string | null;
  createdByType: string;
  createdBy: string | null;
  createdAt: Date;
}

function toTransactionView(row: TransactionRow): LeaveBalanceTransactionView {
  return {
    id: row.id,
    transactionType: row.transactionType,
    transactionDate: row.transactionDate,
    amountDays: Number(row.amountDays),
    balanceBeforeDays: numOrNull(row.balanceBeforeDays),
    balanceAfterDays: numOrNull(row.balanceAfterDays),
    reason: row.reason,
    createdByType: row.createdByType,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
