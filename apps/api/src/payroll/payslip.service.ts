import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Allowance, PayslipListQuery, RunPayrollRequest } from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import type { CanInput, PermissionDecision } from "../permission/permission.types";
import { PayslipRepository, type ActiveSalaryProfileRow } from "./payslip.repository";
import { BonusPenaltyRepository } from "./bonus-penalty.repository";

const PG_UNIQUE_VIOLATION = "23505";

type RequestUser = { id: string; companyId: string };
type PayslipAction = "run-payroll" | "view-payslip" | "read-payslip";

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? ((err as Record<string, unknown>)["code"] as string | undefined)
    : undefined;
}

function sumAllowances(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return (raw as Allowance[]).reduce((acc, a) => {
    const amount = typeof a?.amount === "number" ? a.amount : Number(a?.amount ?? 0);
    return acc + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

/**
 * PayslipService — CROWN JEWEL, SNAPSHOT APPEND-ONLY (ADR-0005, BẤT BIẾN #2).
 *  - KHÔNG có update()/remove(): sửa = ghi entry_kind adjustment/void mới (append-only tuyệt đối).
 *  - runPayroll: chỉ chạy khi period DRAFT + attendance period (nếu gắn) LOCKED (BR khoá kỳ công/KPI
 *    trước khi chạy lương). Aggregate công G11 read-only → snapshot. KPI = null (slot G8-4).
 *  - G12-3: gộp thưởng/phạt APPROVED cùng period_month, chưa consume → bonus/penalty + bind consume.
 *  - Mỗi payslip ghi audit_logs (object_type='payslip') TRONG cùng tx (atomic — audit fail ⇒ rollback).
 *  - view/read-payslip is_sensitive=TRUE → KHÔNG kế thừa wildcard; mapError no-leak.
 */
@Injectable()
export class PayslipService {
  private readonly logger = new Logger(PayslipService.name);

  constructor(
    private readonly repo: PayslipRepository,
    private readonly bonusRepo: BonusPenaltyRepository,
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  private decision(
    user: RequestUser,
    action: PayslipAction,
    targetId: string | null,
  ): Promise<PermissionDecision> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action,
      resourceType: action === "run-payroll" ? "payroll_period" : "payslip",
      resourceId: targetId,
      isSensitive: true,
    };
    return this.permissionService.can(input);
  }

  async list(user: RequestUser, filters: PayslipListQuery) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "view-payslip", null);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to view payslips");
        }
        return await this.repo.listTx(tx, user.companyId, {
          payrollPeriodId: filters.payrollPeriodId,
          userId: filters.userId,
        });
      });
    } catch (err) {
      throw this.mapError(err, "Failed to list payslips");
    }
  }

  /**
   * Xem CHI TIẾT 1 payslip — G12-4: yêu cầu RE-AUTH (step-up). ctx.reauthValidUntil đến từ
   * PayslipReauthGuard (đọc cửa sổ Valkey do PayslipReauthService.reauth mint). Thiếu/hết hạn cửa sổ
   * ⇒ deny-reauth-required → 403 (kể cả HR có view-payslip). objectGrantRequired:false: KHÔNG cần
   * object-grant per-payslip (HR/admin có quyền company-level) — chỉ ÉP step-up. KHÔNG đặt false ⇒
   * permission engine suy ra (isSensitive && requiresReauth)=true ⇒ deny-object-required (chặn nhầm HR).
   */
  async getOne(user: RequestUser, id: string, ctx?: { reauthValidUntil?: Date | null }) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.permissionService.can({
          userId: user.id,
          companyId: user.companyId,
          action: "view-payslip",
          resourceType: "payslip",
          resourceId: id,
          isSensitive: true,
          requiresReauth: true,
          objectGrantRequired: false,
          ctx: { reauthValidUntil: ctx?.reauthValidUntil ?? null },
        });
        if (!decision.allow) {
          if (decision.reason === "deny-reauth-required") {
            throw new ForbiddenException("Re-authentication required to view payslip");
          }
          throw new ForbiddenException("Insufficient permission to view payslip");
        }
        const row = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!row) throw new NotFoundException("Payslip not found");
        // G16-1b READ-PATH AUDIT: ghi 1 audit row cho mỗi lần ĐỌC payslip (lương nhạy cảm) TRONG cùng tx
        // (atomic — audit fail ⇒ rollback đọc). CHỈ who/when/scope: actor + object payslip id. TUYỆT ĐỐI
        // KHÔNG ghi giá trị lương (base/gross/net) vào audit (BẤT BIẾN #3 — audit không phải nơi lưu lương).
        await this.auditService.record(tx, {
          action: "payslip.viewed",
          objectType: "payslip",
          objectId: id,
          actorUserId: user.id,
        });
        return row;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to read payslip");
    }
  }

  /**
   * Run payroll for a period: snapshot one payslip per active salary profile.
   * BR: period must be DRAFT, and the linked attendance period (if any) must be LOCKED.
   * Idempotent per (period, user): a user that already has a payslip in this period is skipped.
   * KPI/bonus/penalty are left null — slot for lane A G8-4 (no logic here).
   */
  async runPayroll(user: RequestUser, dto: RunPayrollRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "run-payroll", dto.payrollPeriodId);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to run payroll");
        }

        const period = await this.repo.findPeriodWithAttendanceLockTx(
          tx,
          user.companyId,
          dto.payrollPeriodId,
        );
        if (!period) throw new NotFoundException("Payroll period not found");
        if (period.status !== "draft") {
          throw new ConflictException("Payroll can only run on a draft period");
        }
        // BR: khoá kỳ công/KPI trước khi chạy lương. If a source attendance period is linked,
        // it MUST be locked. A period with no linked attendance source is rejected — runPayroll
        // requires a locked attendance basis (fail-closed, not fail-open).
        if (period.attendancePeriodStatus !== "locked") {
          throw new ConflictException("Attendance period must be locked before running payroll");
        }

        const profiles = await this.repo.listActiveSalaryProfilesTx(
          tx,
          user.companyId,
          dto.userIds,
        );

        const created: string[] = [];
        // Sequential: audit + payslip + items share the tx connection (must not interleave).
        for (const profile of profiles) {
          const already = await this.repo.countForPeriodUserTx(
            tx,
            user.companyId,
            period.id,
            profile.userId,
          );
          if (already > 0) continue; // idempotent — skip users already paid this period
          const id = await this.snapshotOne(tx, user, period.id, period.periodMonth, profile);
          created.push(id);
        }
        return { payrollPeriodId: period.id, created: created.length, payslipIds: created };
      });
    } catch (err) {
      throw this.mapError(err, "Failed to run payroll");
    }
  }

  /** Build + insert ONE payslip snapshot + its line items + audit, all inside the caller's tx. */
  private async snapshotOne(
    tx: TenantTx,
    user: RequestUser,
    payrollPeriodId: string,
    periodMonth: string,
    profile: ActiveSalaryProfileRow,
  ): Promise<string> {
    const baseSalary = Number(profile.baseSalary);
    const totalAllowances = sumAllowances(profile.allowances);
    const attendance = await this.repo.aggregateAttendanceTx(
      tx,
      user.companyId,
      profile.userId,
      periodMonth,
    );

    // G12-3: gộp thưởng/phạt APPROVED cùng period_month, chưa consume (read TRƯỚC khi insert payslip).
    const bp = await this.bonusRepo.aggregateApprovedForPeriodTx(
      tx,
      user.companyId,
      profile.userId,
      periodMonth,
    );
    let bonusTotal = 0;
    let penaltyTotal = 0;
    for (const row of bp) {
      const amt = Number(row.amount);
      // FAIL-LOUD (không bỏ qua thầm lặng): amount/kind bất thường = bug bất biến (DB CHECK lẽ ra chặn).
      // Bỏ qua sẽ trừ/cộng thiếu mà vẫn itemize + consume ⇒ payslip sai. Ném để rollback + lộ đúng hàng.
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new Error(
          `bonus_penalty ${row.id} amount không hợp lệ — huỷ payslip user ${profile.userId}`,
        );
      }
      if (row.kind === "bonus") bonusTotal += amt;
      else if (row.kind === "penalty") penaltyTotal += amt;
      else throw new Error(`bonus_penalty ${row.id} kind lạ '${row.kind}' — huỷ payslip`);
    }

    // gross = base + allowances. net = gross + bonus − penalty, CLAMP ≥ 0:
    // penalty > gross KHÔNG đẩy lương âm — net sàn 0, khoản phạt đầy đủ vẫn ghi ở payslip_items (lưu vết thật).
    const gross = baseSalary + totalAllowances;
    const rawNet = gross + bonusTotal - penaltyTotal;
    const net = Math.max(0, rawNet);
    const netClamped = rawNet < 0;
    if (netClamped) {
      // Lưu vết: penalty vượt gross → net sàn 0. KHÔNG giấu — log + cờ trong audit để compliance truy được.
      this.logger.warn("Payslip net clamped to 0 (penalty > gross)", {
        userId: profile.userId,
        payrollPeriodId,
        gross,
        penaltyTotal,
        rawNet,
      });
    }

    const rows = await this.repo.insertPayslipTx(tx, user.companyId, {
      payrollPeriodId,
      userId: profile.userId,
      salaryProfileId: profile.id,
      baseSalary: baseSalary.toFixed(2),
      totalAllowances: totalAllowances.toFixed(2),
      gross: gross.toFixed(2),
      net: net.toFixed(2),
      currency: profile.currency ?? "VND",
      workDays: attendance.presentDays.toFixed(2),
      presentDays: attendance.presentDays.toFixed(2),
      lateMinutes: attendance.lateMinutes,
      bonusAmount: bonusTotal > 0 ? bonusTotal.toFixed(2) : null,
      penaltyAmount: penaltyTotal > 0 ? penaltyTotal.toFixed(2) : null,
      entryKind: "original",
      createdBy: user.id,
    });
    const payslip = rows[0];
    if (!payslip) throw new Error("Failed to create payslip");

    await this.repo.insertItemTx(tx, user.companyId, {
      payslipId: payslip.id,
      itemType: "earning",
      label: "Lương cơ bản",
      amount: baseSalary.toFixed(2),
    });
    if (totalAllowances > 0) {
      await this.repo.insertItemTx(tx, user.companyId, {
        payslipId: payslip.id,
        itemType: "allowance",
        label: "Phụ cấp",
        amount: totalAllowances.toFixed(2),
      });
    }
    // 1 dòng item / khoản thưởng-phạt (lưu vết từng khoản, kể cả khi net bị clamp).
    for (const row of bp) {
      await this.repo.insertItemTx(tx, user.companyId, {
        payslipId: payslip.id,
        itemType: row.kind === "bonus" ? "bonus" : "penalty",
        label: row.reason ?? (row.kind === "bonus" ? "Thưởng" : "Phạt"),
        amount: Number(row.amount).toFixed(2),
        meta: { bonus_penalty_id: row.id },
      });
    }
    // Consume: bind kỳ lương vào các khoản đã gộp (chống trả 2 lần KHOẢN bonus/penalty). CÙNG tx (atomic).
    // FOR UPDATE ở aggregate + kiểm số hàng consume == số hàng đã gộp: lệch (txn song song consume bớt) ⇒ NÉM 409.
    // LƯU Ý: double payslip LƯƠNG GỐC cùng (kỳ,user) chặn ở unique index payslips_period_user_original_uq (mig 0099),
    // KHÔNG ở đây — count-check chỉ phủ phần thưởng/phạt.
    if (bp.length > 0) {
      const consumed = await this.bonusRepo.markConsumedTx(
        tx,
        user.companyId,
        bp.map((r) => r.id),
        payrollPeriodId,
      );
      if (consumed.length !== bp.length) {
        throw new ConflictException(
          "Concurrent payroll run detected — some bonus/penalty already consumed; aborting",
        );
      }
    }

    await this.auditService.record(tx, {
      action: "payslip_created",
      objectType: "payslip",
      objectId: payslip.id,
      actorUserId: user.id,
      after: {
        payroll_period_id: payrollPeriodId,
        user_id: profile.userId,
        entry_kind: "original",
        ...(netClamped ? { net_clamped: true } : {}),
      },
    });
    return payslip.id;
  }

  /**
   * Domain HttpExceptions pass through. unique-violation (double-adjust replaces_uq) → 409.
   * Khác → 500 generic (log PG detail server-side ONLY — không leak schema/constraint/code).
   */
  private mapError(err: unknown, context: string): Error {
    if (err instanceof HttpException) return err;
    if (pgCode(err) === PG_UNIQUE_VIOLATION) {
      return new ConflictException("This payslip has already been superseded");
    }
    this.logger.error(context, {
      error: err instanceof Error ? err.message : String(err),
      code: pgCode(err),
    });
    return new InternalServerErrorException("Internal server error");
  }
}
