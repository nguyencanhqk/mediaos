import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  LeaveBalanceView,
  LeaveCalculateRequest,
  LeaveCalculateResponse,
  LeaveMyBalanceTransactionsQuery,
  LeaveMyBalanceTransactionsResponse,
  LeaveTypeView,
} from "@mediaos/contracts";
import { addDaysToLocalDate } from "../common/tz.util";
import { DatabaseService } from "../db/db.service";
import { leaveTypes } from "../db/schema/hr";
import { HolidaysService, type HolidayView } from "../foundation/holidays/holidays.service";
import { LeaveRepository } from "./leave.repository";
import { LeaveReadRepository } from "./leave-read.repository";
import { calculateLeave } from "./leave-calc.logic";

interface Actor {
  id: string;
  companyId: string;
}

type LeaveTypeRow = typeof leaveTypes.$inferSelect;

/** Calendar year of an ISO 'YYYY-MM-DD' date — the quota year a request is checked against. */
function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

function numOrNull(v: string | null): number | null {
  return v != null ? Number(v) : null;
}

/**
 * S3-LEAVE-BE-1 — read/preview surface for LEAVE (types catalog · own balances · calculate preview).
 *
 * BẤT BIẾN #1: every read runs in db.withTenant(actor.companyId) (RLS + explicit company_id) — cross-tenant
 * reads return 0 rows / 404. NO WRITES anywhere here: calculate is preview-only (no leave_balances /
 * leave_balance_transactions / leave_requests mutation). Holiday batch via HolidaysService.getHolidaysInRange
 * (1 query for the whole range), keyed on affectsLeaveCalculation (NOT affectsAttendance).
 */
@Injectable()
export class LeaveReadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeaveRepository,
    private readonly readRepo: LeaveReadRepository,
    private readonly holidays: HolidaysService,
  ) {}

  // ─── GET /leave/types (view:leave-type) ──────────────────────────────────────

  async listTypes(companyId: string): Promise<LeaveTypeView[]> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await this.readRepo.findActiveTypesTx(companyId, tx);
      return rows.map(toLeaveTypeView);
    });
  }

  // ─── GET /leave/me/balances (view-own:leave-balance) ─────────────────────────

  /** OWN balances only (filtered by user_id). Empty (no rows) → [] (never 500). */
  async listMyBalances(actor: Actor): Promise<LeaveBalanceView[]> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const rows = await this.readRepo.findOwnBalancesTx(actor.companyId, actor.id, tx);
      return rows.map(toLeaveBalanceView);
    });
  }

  // ─── GET /leave/me/balance-transactions (view-own:leave-balance, API-05 §13.2) ───────────────

  /**
   * S3-LEAVE-BE-6 — OWN balance transactions (ledger). Self-locked by user_id (leaveRead.findOwn
   * BalanceTransactionsTx joins leave_balances.user_id — NEVER a scope query). Empty → {items:[],...}
   * (never 500).
   */
  async listMyBalanceTransactions(
    actor: Actor,
    query: LeaveMyBalanceTransactionsQuery,
  ): Promise<LeaveMyBalanceTransactionsResponse> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const filters = { periodYear: query.periodYear, leaveTypeId: query.leaveTypeId };
      const [rows, total] = await Promise.all([
        this.readRepo.findOwnBalanceTransactionsTx(
          actor.companyId,
          actor.id,
          filters,
          query.page,
          query.pageSize,
          tx,
        ),
        this.readRepo.countOwnBalanceTransactionsTx(actor.companyId, actor.id, filters, tx),
      ]);
      const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0;
      return {
        items: rows.map(toBalanceTransactionView),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages,
          hasNext: query.page < totalPages,
          hasPrev: query.page > 1,
        },
      };
    });
  }

  // ─── POST /leave/requests/calculate (create:leave) — PREVIEW ONLY ────────────

  async calculate(actor: Actor, dto: LeaveCalculateRequest): Promise<LeaveCalculateResponse> {
    // Holiday batch (BATCH, 1 query) — its own tenant tx; harmless to fetch before the type check.
    const holidayRows = await this.holidays.getHolidaysInRange(
      actor.companyId,
      dto.startDate,
      addDaysToLocalDate(dto.endDate, 1),
    );
    const holidayDates = buildLeaveHolidayDates(holidayRows);

    return this.db.withTenant(actor.companyId, async (tx) => {
      // Type must exist (cross-tenant → RLS 0 rows → 404) and be active.
      const [type] = await this.repo.findTypeByIdTx(actor.companyId, dto.leaveTypeId, tx);
      if (!type) throw new NotFoundException(`Không tìm thấy loại nghỉ: ${dto.leaveTypeId}`);
      if (type.status !== "active") {
        throw new ConflictException(`Loại nghỉ '${type.name}' đang không hoạt động`);
      }

      // Server-authoritative actor resolution (ignore any client employee_id, §6.2). Not required for
      // the day math — balances key on user_id — but anchors that we never trust client identity.
      await this.repo.resolveEmployeeByUserIdTx(actor.companyId, actor.id, tx);

      const workingDays = await this.repo.resolveWorkingDaysForUserTx(
        actor.companyId,
        actor.id,
        tx,
      );
      const calc = calculateLeave(
        {
          startDate: dto.startDate,
          endDate: dto.endDate,
          durationType: dto.durationType,
          halfDaySession: dto.halfDaySession,
          startTime: dto.startTime,
          endTime: dto.endTime,
        },
        workingDays,
        holidayDates,
      );

      const isBalanceRequired = type.deductBalance === true;
      const warnings = [...calc.warnings];
      let balance: LeaveCalculateResponse["balance"] = null;

      if (isBalanceRequired) {
        const year = yearOf(dto.startDate);
        const [bal] = await this.repo.findBalanceTx(
          actor.companyId,
          actor.id,
          dto.leaveTypeId,
          year,
          tx,
        );
        // Empty balance (no row for the year) is VALID → remaining 0, is_enough false (no 500).
        const remaining = bal?.remainingDays != null ? Number(bal.remainingDays) : 0;
        const after = round2(remaining - calc.calculatedDays);
        const isEnough = after >= 0;
        balance = {
          remaining_days: remaining,
          requested_days: calc.calculatedDays,
          after_remaining_days: after,
          is_enough: isEnough,
        };
        if (!isEnough) warnings.push("Số dư phép còn lại không đủ cho yêu cầu này.");
      }

      return {
        calculated_days: calc.calculatedDays,
        calculated_hours: calc.calculatedHours,
        is_balance_required: isBalanceRequired,
        balance,
        days: calc.days,
        warnings,
      };
    });
  }
}

/** Round to 2 decimals (mirror leave-calc.logic round2) for balance after-math. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Leave-specific holiday predicate: a date is a leave holiday when an Active holiday on that date has
 * affectsLeaveCalculation=true. KHÔNG dùng computeIsWorkingDay (keys on affectsAttendance) — leave and
 * attendance can differ (e.g. a special day that affects attendance but not the leave quota).
 */
function buildLeaveHolidayDates(rows: readonly HolidayView[]): Set<string> {
  const set = new Set<string>();
  for (const h of rows) {
    if (h.status === "Active" && h.affectsLeaveCalculation === true) set.add(h.holidayDate);
  }
  return set;
}

function toLeaveTypeView(row: LeaveTypeRow): LeaveTypeView {
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
  };
}

interface OwnBalanceTransactionRow {
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

/** Mirrors leave-admin.service.ts toTransactionView (SAME view schema, admin vs self-service source). */
function toBalanceTransactionView(row: OwnBalanceTransactionRow) {
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

interface OwnBalanceRow {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  balanceUnit: string | null;
  year: number;
  openingDays: string | null;
  usedDays: string;
  pendingDays: string | null;
  adjustedDays: string | null;
  remainingDays: string | null;
  totalDays: string;
}

function toLeaveBalanceView(row: OwnBalanceRow): LeaveBalanceView {
  const used = Number(row.usedDays);
  const remaining =
    row.remainingDays != null ? Number(row.remainingDays) : Number(row.totalDays) - used;
  return {
    id: row.id,
    leaveType: { id: row.leaveTypeId, code: row.leaveTypeCode, name: row.leaveTypeName },
    periodYear: row.year,
    openingBalance: numOrNull(row.openingDays) ?? 0,
    usedDays: used,
    reservedDays: numOrNull(row.pendingDays) ?? 0,
    adjustedDays: numOrNull(row.adjustedDays) ?? 0,
    remainingDays: remaining,
    unit: row.balanceUnit ?? "Day",
  };
}
