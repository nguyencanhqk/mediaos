import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { LeaveAccrualRepository } from "./leave-accrual.repository";
import { LeaveAccrualService } from "./leave-accrual.service";
import { LeaveCarryoverRepository } from "./leave-carryover.repository";
import {
  buildCarryPlan,
  buildExpirePlan,
  expiryDateFor,
  num,
  type CarryoverBalanceInput,
  type CarryoverPolicyInput,
  type CarryoverSkipReason,
} from "./leave-carryover.logic";

/**
 * S6-LEAVE-CARRYOVER-1 — engine chuyển tiếp phép chưa nghỉ sang năm sau + hết hạn theo mốc cấu hình.
 *
 * LỖ ĐANG VÁ: `leave_balances` có sẵn `carried_over_days` + `expired_days` từ mig 0453 nhưng **không một
 * dòng code nào đọc/ghi**, và `leave_policies` không có cột nào khai luật chuyển tiếp ⇒ sau engine cộng
 * dồn, phép được cấp đều đặn mà KHÔNG BAO GIỜ được dọn.
 *
 * BẤT BIẾN:
 *   #1 mọi truy vấn đi qua `withTenant(companyId)` + `company_id` tường minh trong WHERE.
 *   #2 `leave_balance_transactions` INSERT-ONLY; không sửa/xoá dòng cũ, kể cả khi ghi bù.
 *   #3 audit/metadata chỉ chứa SỐ ĐẾM — không PII, không danh sách người.
 *
 * THỨ TỰ TRONG MỘT NHỊP (plan §3.6) — không được đảo:
 *   1. HẾT HẠN cho năm hiện tại VÀ năm trước (job chết vắt qua mốc thì ngày lẽ ra đã hết hạn không được
 *      phép sống lại bằng đường chuyển tiếp).
 *   2. CHUYỂN TIẾP năm trước → năm nay (chỉ từ mốc chốt sổ 01/02).
 */

export interface CarryoverPendingLine {
  kind: "CARRY_OVER" | "EXPIRE";
  employeeId: string;
  employeeCode: string | null;
  leaveTypeId: string;
  policyCode: string;
  /** Dòng số dư bị GHI NỢ (năm nguồn khi chuyển; chính nó khi hết hạn). */
  fromBalanceId: string;
  fromYear: number;
  /** Năm nhận (chỉ có với chuyển tiếp). */
  toYear: number | null;
  amountDays: number;
  /** `2026→2027` hoặc `2027-03-31` — để đọc được lý do trong sổ cái mà không phải tra code. */
  periodKey: string;
  /** KHÔNG phơi ra DTO — chỉ dùng nội bộ khi dựng dòng số dư năm mới. */
  userId: string;
}

export interface CarryoverSkipEntry {
  employeeId: string | null;
  employeeCode: string | null;
  leaveTypeId: string;
  policyCode: string;
  year: number;
  reason: CarryoverSkipReason;
}

export interface CarryoverPreview {
  today: string;
  policies: {
    policyCode: string;
    leaveTypeId: string;
    allowCarryForward: boolean;
    maxCarryForwardDays: number | null;
    expiryDate: string;
  }[];
  sourceYear: number;
  targetYear: number;
  balancesScanned: number;
  /**
   * Dòng số dư NGOÀI cửa sổ quét (năm < `sourceYear`) mà vẫn còn ngày chưa dùng. Engine không đụng tới
   * được — nhưng con số này phải HIỆN RA, nếu không "không tồn tại" và "không có" là một, và
   * `balancesScanned` sẽ luôn trông khoẻ. > 0 = có việc cho người (điều chỉnh tay).
   */
  strandedBalances: number;
  /** Đếm chính sách để phân biệt "cấu hình sai" với "đang nghỉ đúng thiết kế" (mirror engine cộng dồn). */
  policiesTotal: number;
  policiesWithCarryForward: number;
  pending: CarryoverPendingLine[];
  carryDays: number;
  expireDays: number;
  employeesAffected: number;
  skipped: CarryoverSkipEntry[];
}

/** Trần số dòng chi tiết trả qua HTTP. Số TỔNG luôn đi kèm nên trần này không bao giờ im lặng. */
export const CARRYOVER_PREVIEW_ROW_CAP = 500;

export interface CarryoverPreviewResponse extends Omit<CarryoverPreview, "pending" | "skipped"> {
  pending: Omit<CarryoverPendingLine, "userId">[];
  pendingTotal: number;
  pendingTruncated: boolean;
  skipped: CarryoverSkipEntry[];
  skippedTotal: number;
  skippedTruncated: boolean;
}

export interface CarryoverRunResult {
  preview: CarryoverPreview;
  carried: number;
  carriedDays: number;
  expired: number;
  expiredDays: number;
  failed: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class LeaveCarryoverService {
  private readonly logger = new Logger(LeaveCarryoverService.name);
  /** companyId → chữ ký lỗi đã in. Chặn 1440 dòng ERROR giống hệt nhau mỗi ngày cho một hồ sơ hỏng BỀN. */
  private readonly loggedFailures = new Map<string, string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeaveCarryoverRepository,
    /** Dùng lại `ensureBalanceTx` — một nguồn sự thật duy nhất cho hình dạng dòng số dư mới. */
    private readonly accrualRepo: LeaveAccrualRepository,
    private readonly accrual: LeaveAccrualService,
    private readonly audit: AuditService,
  ) {}

  /** Hôm nay theo UTC (ADR-0008) — cột `date` của Postgres là ngày thuần, phải cùng hệ quy chiếu. */
  static today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Dry-run: KHÔNG ghi gì. Dùng để đối chiếu số trước khi bật công tắc trên staging/PROD. */
  async previewCompany(
    companyId: string,
    today = LeaveCarryoverService.today(),
  ): Promise<CarryoverPreview> {
    return this.db.withTenant(companyId, (tx) => this.plan(companyId, today, tx));
  }

  /** Bản dry-run cho HTTP: cắt hai mảng chi tiết về trần và NÓI RA rằng đã cắt; số tổng luôn đầy đủ. */
  async previewCompanyForResponse(
    companyId: string,
    today = LeaveCarryoverService.today(),
  ): Promise<CarryoverPreviewResponse> {
    const preview = await this.previewCompany(companyId, today);
    return {
      ...preview,
      // `userId` KHÔNG đi ra ngoài (chỉ dùng nội bộ khi dựng dòng số dư).
      pending: preview.pending
        .slice(0, CARRYOVER_PREVIEW_ROW_CAP)
        .map(({ userId: _userId, ...row }) => row),
      pendingTotal: preview.pending.length,
      pendingTruncated: preview.pending.length > CARRYOVER_PREVIEW_ROW_CAP,
      skipped: preview.skipped.slice(0, CARRYOVER_PREVIEW_ROW_CAP),
      skippedTotal: preview.skipped.length,
      skippedTruncated: preview.skipped.length > CARRYOVER_PREVIEW_ROW_CAP,
    };
  }

  /**
   * Chạy cho 1 tenant. MỘT `withTenant` duy nhất cho cả vòng (JobRunner đã đóng tx enumerate TRƯỚC khi
   * gọi handler; PgBouncer transaction-mode + tx LỒNG = treo). Cô lập lỗi từng dòng bằng SAVEPOINT.
   */
  async runCompany(
    companyId: string,
    today = LeaveCarryoverService.today(),
  ): Promise<CarryoverRunResult> {
    return this.db.withTenant(companyId, async (tx) => {
      const preview = await this.plan(companyId, today, tx);
      let carried = 0;
      let carriedDays = 0;
      let expired = 0;
      let expiredDays = 0;
      let failed = 0;

      for (const line of preview.pending) {
        try {
          // SAVEPOINT: một hồ sơ hỏng (đua với lần chạy khác ⇒ vỡ unique/guard) KHÔNG kéo đổ cả tenant.
          await tx.transaction((sp) => this.applyLine(companyId, line, today, sp));
          if (line.kind === "CARRY_OVER") {
            carried += 1;
            carriedDays = round2(carriedDays + line.amountDays);
          } else {
            expired += 1;
            expiredDays = round2(expiredDays + line.amountDays);
          }
        } catch (err) {
          failed += 1;
          // KHÔNG nuốt im lặng: log đủ để điều tra, `failed>0` đẩy run-row sang Partial/Failed.
          // Nhưng CHỐNG LẶP theo chữ ký (dòng số dư + thông điệp): một hồ sơ hỏng BỀN sẽ hỏng lại mỗi
          // nhịp 60 giây, và 1440 dòng ERROR giống hệt nhau mỗi ngày chính là thứ làm người ta lọc bỏ
          // cả kênh log (bài học S6-OPS-LOGWINDOW-1). In lần đầu và mỗi khi chữ ký ĐỔI.
          const message = err instanceof Error ? err.message : String(err);
          const signature = `${line.kind}|${line.fromBalanceId}|${message}`;
          if (this.loggedFailures.get(companyId) !== signature) {
            this.loggedFailures.set(companyId, signature);
            this.logger.error(
              `LEAVE_CARRYOVER tenant=${companyId} ${line.kind} balance=${line.fromBalanceId} loại=${line.leaveTypeId}: ${message}`,
              err instanceof Error ? err.stack : undefined,
            );
          }
        }
      }

      // Audit khi thực sự có thay đổi — HOẶC khi có dòng HỎNG. Không đổi gì là trạng thái BÌNH THƯỜNG gần
      // như mọi nhịp 60s ⇒ ghi audit ở đó = ~526k dòng rác/năm trong bảng append-only (quả bom đã phải đi
      // gỡ ở LMS sync). Nhưng `failed > 0` mà `carried = expired = 0` (mọi dòng đều hỏng) thì KHÔNG được
      // im: đó đúng là lúc cần dấu vết nhất, và nếu chỉ xét "có thay đổi" thì lần chạy hỏng TOÀN BỘ sẽ
      // không để lại gì trong sổ audit của `leave_balance`.
      if (carried > 0 || expired > 0 || failed > 0) {
        await this.audit.record(tx, {
          action: "leave_carryover_run",
          objectType: "leave_balance",
          actorType: "Job",
          actionGroup: "LEAVE",
          resultStatus: failed > 0 ? "Failure" : "Success",
          dataScope: "Company",
          sensitivityLevel: "Sensitive",
          // CHỈ SỐ ĐẾM (BẤT BIẾN #3) — không tên, không mã nhân viên, không danh sách.
          metadata: {
            today,
            sourceYear: preview.sourceYear,
            targetYear: preview.targetYear,
            carried,
            carriedDays,
            expired,
            expiredDays,
            failed,
            skipped: preview.skipped.length,
          },
        });
      }
      return { preview, carried, carriedDays, expired, expiredDays, failed };
    });
  }

  /** Ghi số dư + sổ cái cho MỘT dòng kế hoạch (chuyển tiếp = 2 chân, hết hạn = 1 chân). */
  private async applyLine(
    companyId: string,
    line: CarryoverPendingLine,
    today: string,
    tx: TenantTx,
  ): Promise<void> {
    const amount = line.amountDays.toFixed(2);

    if (line.kind === "EXPIRE") {
      const balance = await this.repo.lockBalanceTx(companyId, line.fromBalanceId, tx);
      if (!balance) throw new Error(`không khoá được dòng số dư ${line.fromBalanceId}`);
      const before = num(balance.totalDays);
      const [updated] = await this.repo.applyExpireTx(companyId, line.fromBalanceId, amount, tx);
      // Guard ở tầng DB từ chối ⇒ số của tầng app đã lỗi thời (đơn vừa được duyệt/điều chỉnh). KHÔNG ghi
      // sổ cái, để nhịp sau tính lại trên số mới — thà bỏ lỡ một nhịp còn hơn xoá nhầm ngày phép.
      if (!updated) {
        throw new Error(
          `hết hạn ${amount} ngày bị ràng buộc số dư từ chối (balance=${line.fromBalanceId})`,
        );
      }
      await this.writeLedger(
        companyId,
        line,
        {
          amountDays: `-${amount}`,
          balanceId: line.fromBalanceId,
          before,
          after: num(updated.totalDays),
          today,
          reason: `EXPIRE ${line.periodKey}`,
        },
        tx,
      );
      return;
    }

    // ── CHUYỂN TIẾP: hai chân trong CÙNG SAVEPOINT, khoá theo NĂM TĂNG DẦN (thứ tự khoá toàn cục) ──
    const source = await this.repo.lockBalanceTx(companyId, line.fromBalanceId, tx);
    if (!source) throw new Error(`không khoá được dòng số dư nguồn ${line.fromBalanceId}`);

    const targetYear = line.toYear as number;
    await this.accrualRepo.ensureBalanceTx(
      companyId,
      {
        userId: line.userId,
        employeeId: line.employeeId,
        leaveTypeId: line.leaveTypeId,
        year: targetYear,
      },
      tx,
    );
    // Dùng bản của repo NÀY (lọc `deleted_at`), không dùng bản của accrual: dòng đích đã soft-delete sẽ
    // khoá được nhưng ghi có 0 dòng ⇒ ném lỗi mỗi nhịp 60 giây mãi mãi.
    const target = await this.repo.findTargetBalanceForUpdateTx(
      companyId,
      line.userId,
      line.leaveTypeId,
      targetYear,
      tx,
    );
    if (!target) throw new Error(`không dựng được dòng số dư ${line.leaveTypeId}/${targetYear}`);

    const sourceBefore = num(source.totalDays);
    const [debited] = await this.repo.applyCarryDebitTx(companyId, line.fromBalanceId, amount, tx);
    if (!debited) {
      throw new Error(
        `chuyển ${amount} ngày bị ràng buộc số dư từ chối (balance=${line.fromBalanceId})`,
      );
    }
    const targetBefore = num(target.totalDays);
    const [credited] = await this.repo.applyCarryCreditTx(companyId, target.id, amount, tx);
    if (!credited) throw new Error(`không ghi có được vào dòng số dư ${target.id}`);

    // Hai dòng sổ cái CÙNG NGÀY, KHÁC dòng số dư ⇒ không đụng khoá `uq_..._carryover_daily`.
    await this.writeLedger(
      companyId,
      line,
      {
        amountDays: `-${amount}`,
        balanceId: line.fromBalanceId,
        before: sourceBefore,
        after: num(debited.totalDays),
        today,
        reason: `CARRY_OVER ${line.periodKey}`,
      },
      tx,
    );
    await this.writeLedger(
      companyId,
      line,
      {
        amountDays: amount,
        balanceId: target.id,
        before: targetBefore,
        after: num(credited.totalDays),
        today,
        reason: `CARRY_OVER ${line.periodKey}`,
      },
      tx,
    );
  }

  private async writeLedger(
    companyId: string,
    line: CarryoverPendingLine,
    row: {
      amountDays: string;
      balanceId: string;
      before: number;
      after: number;
      today: string;
      reason: string;
    },
    tx: TenantTx,
  ): Promise<void> {
    await this.repo.insertLedgerTx(
      companyId,
      {
        companyId,
        leaveBalanceId: row.balanceId,
        employeeId: line.employeeId,
        leaveTypeId: line.leaveTypeId,
        transactionType: line.kind,
        // Ngày ghi sổ = NGÀY PHÁT HIỆN (cùng quy ước với ADJUSTMENT). Kỳ nằm ở `reason`/`metadata` —
        // ghi theo kỳ sẽ khoá cứng một dòng/kỳ và làm engine không ghi bù được (plan §3.2).
        transactionDate: row.today,
        amountDays: row.amountDays,
        balanceBeforeDays: row.before.toFixed(2),
        balanceAfterDays: row.after.toFixed(2),
        reason: row.reason,
        referenceType: "leave_policy",
        createdByType: "Job",
        metadata: { policyCode: line.policyCode, periodKey: line.periodKey },
      },
      tx,
    );
  }

  /** Tính (không ghi) toàn bộ bức tranh chuyển tiếp/hết hạn của tenant tại `today`. */
  private async plan(companyId: string, today: string, tx: TenantTx): Promise<CarryoverPreview> {
    const targetYear = Number(today.slice(0, 4));
    const sourceYear = targetYear - 1;
    const policyRows = await this.repo.listActiveCompanyPoliciesTx(companyId, today, tx);
    const policies = new Map<string, CarryoverPolicyInput>();
    for (const row of policyRows) {
      policies.set(row.leaveTypeId, {
        policyId: row.policyId,
        policyCode: row.policyCode,
        leaveTypeId: row.leaveTypeId,
        allowCarryForward: row.allowCarryForward,
        maxCarryForwardDays: row.maxCarryForwardDays,
        expiryMonth: row.expiryMonth,
        expiryDay: row.expiryDay,
        reserveBalanceOnPending: row.reserveBalanceOnPending,
      });
    }

    const pending: CarryoverPendingLine[] = [];
    const skipped: CarryoverSkipEntry[] = [];
    const affected = new Set<string>();
    let carryDays = 0;
    let expireDays = 0;
    /**
     * Số ngày SẼ hết hạn của từng dòng, để bước chuyển tiếp trừ đi. Cả hai bước tính trên CÙNG một ảnh
     * chụp số dư (đọc một lần), nên nếu không trừ, một dòng vừa quá mốc hết hạn vừa đủ điều kiện chuyển
     * sẽ được lên kế hoạch hai lần trên cùng số ngày — ràng buộc ở DB chặn được (không mất tiền), nhưng
     * mỗi nhịp sẽ đếm một `failed` và ghi một dòng log hoảng loạn cho việc hoàn toàn bình thường.
     */
    const expirePlannedByBalance = new Map<string, number>();

    const leaveTypeIds = [...policies.keys()];
    const balances = await this.repo.listBalancesForYearsTx(
      companyId,
      [sourceYear, targetYear],
      leaveTypeIds,
      tx,
    );
    const balanceIds = balances.map((b) => b.balanceId);
    const ledger = await this.repo.summarizeLedgerTx(companyId, balanceIds, tx);
    const carryLedger = new Map(
      ledger.filter((r) => r.transactionType === "CARRY_OVER").map((r) => [r.balanceId, r]),
    );
    const expireLedger = new Map(
      ledger.filter((r) => r.transactionType === "EXPIRE").map((r) => [r.balanceId, r]),
    );
    const credits = await this.repo.listCarryCreditsTx(companyId, balanceIds, tx);
    const creditsByBalance = new Map<string, { transactionDate: string; amountDays: number }[]>();
    for (const c of credits) {
      const bucket = creditsByBalance.get(c.balanceId) ?? [];
      bucket.push({ transactionDate: c.transactionDate, amountDays: num(c.amountDays) });
      creditsByBalance.set(c.balanceId, bucket);
    }
    // Dòng số dư NGOÀI cửa sổ quét mà còn ngày chưa dùng — engine không đụng tới được, nên phải ĐẾM ra.
    const strandedBalances = await this.repo.countStrandedBalancesTx(
      companyId,
      sourceYear,
      leaveTypeIds,
      tx,
    );

    // ── 1. HẾT HẠN (cả hai năm) — phải chạy TRƯỚC chuyển tiếp ────────────────────────────────
    for (const row of balances) {
      const policy = policies.get(row.leaveTypeId);
      if (!policy) continue;
      const plan = buildExpirePlan({
        policy,
        balance: toBalanceInput(row),
        today,
        carryCredits: creditsByBalance.get(row.balanceId) ?? [],
        lastExpireTxDate: expireLedger.get(row.balanceId)?.lastTxDate ?? null,
      });
      if (plan.skipReason !== null) {
        skipped.push(skipEntry(row, policy, plan.skipReason));
        continue;
      }
      if (plan.amountDays <= 0) continue;
      const employeeId = row.balanceEmployeeId ?? row.profileEmployeeId;
      if (employeeId === null || row.userId === null) {
        skipped.push(skipEntry(row, policy, "MISSING_EMPLOYEE"));
        continue;
      }
      pending.push({
        kind: "EXPIRE",
        employeeId,
        employeeCode: row.employeeCode,
        leaveTypeId: row.leaveTypeId,
        policyCode: policy.policyCode,
        fromBalanceId: row.balanceId,
        fromYear: row.year,
        toYear: null,
        amountDays: plan.amountDays,
        periodKey: expiryDateFor(row.year, policy.expiryMonth, policy.expiryDay),
        userId: row.userId,
      });
      expireDays = round2(expireDays + plan.amountDays);
      expirePlannedByBalance.set(row.balanceId, plan.amountDays);
      affected.add(employeeId);
    }

    // ── 2. CHUYỂN TIẾP (chỉ dòng năm nguồn) ──────────────────────────────────────────────────
    const sourceRows = balances.filter((b) => b.year === sourceYear);
    const carryCandidates = sourceRows.filter((row) => {
      const policy = policies.get(row.leaveTypeId);
      const afterExpire = availableOf(row) - (expirePlannedByBalance.get(row.balanceId) ?? 0);
      return policy?.allowCarryForward === true && afterExpire > 0;
    });
    // Chỉ hỏi engine cộng dồn khi CÓ ứng viên — nhịp thường sẽ không tốn truy vấn nào.
    // Gọi qua `planWithTx` (KHÔNG phải `previewCompany`): tx LỒNG trên PgBouncer transaction-mode = treo.
    const accrualPendingYears =
      carryCandidates.length > 0
        ? new Set((await this.accrual.planWithTx(companyId, today, tx)).pending.map((p) => p.year))
        : new Set<number>();

    for (const row of sourceRows) {
      const policy = policies.get(row.leaveTypeId);
      if (!policy) continue;
      const employeeId = row.balanceEmployeeId ?? row.profileEmployeeId;
      const summary = carryLedger.get(row.balanceId);
      const plan = buildCarryPlan({
        policy,
        // Trừ phần SẼ hết hạn ngay trong nhịp này: hai bước tính trên cùng ảnh chụp số dư (xem
        // `expirePlannedByBalance`), không trừ thì cùng một ngày phép được lên kế hoạch hai lần.
        balance: withoutExpiring(row, expirePlannedByBalance.get(row.balanceId) ?? 0),
        employee: {
          employeeId: employeeId ?? "",
          userId: row.userId,
          employeeCode: row.employeeCode,
          endDate: row.endDate,
        },
        today,
        alreadyCarriedDays: num(summary?.debitDays ?? null),
        lastCarryTxDate: summary?.lastTxDate ?? null,
      });
      if (plan.skipReason !== null) {
        skipped.push(skipEntry(row, policy, plan.skipReason));
        continue;
      }
      if (plan.amountDays <= 0) continue;
      if (employeeId === null || row.userId === null) {
        skipped.push(skipEntry(row, policy, "MISSING_EMPLOYEE"));
        continue;
      }
      // Engine cộng dồn còn nợ kỳ của năm nguồn ⇒ HOÃN cả dòng này, nhịp sau tự chạy. Chuyển bây giờ sẽ
      // ra số thiếu (ngày tháng 12 chưa được cấp), và dòng bù tuy vá được nhưng đẻ thêm giao dịch vô ích.
      if (accrualPendingYears.has(sourceYear)) {
        skipped.push(skipEntry(row, policy, "ACCRUAL_PENDING"));
        continue;
      }
      pending.push({
        kind: "CARRY_OVER",
        employeeId,
        employeeCode: row.employeeCode,
        leaveTypeId: row.leaveTypeId,
        policyCode: policy.policyCode,
        fromBalanceId: row.balanceId,
        fromYear: row.year,
        toYear: row.year + 1,
        amountDays: plan.amountDays,
        periodKey: `${row.year}→${row.year + 1}`,
        userId: row.userId,
      });
      carryDays = round2(carryDays + plan.amountDays);
      affected.add(employeeId);
    }

    return {
      today,
      policies: policyRows.map((p) => ({
        policyCode: p.policyCode,
        leaveTypeId: p.leaveTypeId,
        allowCarryForward: p.allowCarryForward,
        maxCarryForwardDays: p.maxCarryForwardDays === null ? null : Number(p.maxCarryForwardDays),
        expiryDate: expiryDateFor(targetYear, p.expiryMonth, p.expiryDay),
      })),
      sourceYear,
      targetYear,
      balancesScanned: balances.length,
      strandedBalances,
      policiesTotal: policyRows.length,
      policiesWithCarryForward: policyRows.filter((p) => p.allowCarryForward).length,
      pending,
      carryDays,
      expireDays,
      employeesAffected: affected.size,
      skipped,
    };
  }
}

type BalanceRow = Awaited<ReturnType<LeaveCarryoverRepository["listBalancesForYearsTx"]>>[number];

function toBalanceInput(row: BalanceRow): CarryoverBalanceInput {
  return {
    balanceId: row.balanceId,
    year: row.year,
    totalDays: row.totalDays,
    usedDays: row.usedDays,
    pendingDays: row.pendingDays,
    carriedOverDays: row.carriedOverDays,
    expiredDays: row.expiredDays,
  };
}

function availableOf(row: BalanceRow): number {
  return num(row.totalDays) - num(row.usedDays) - num(row.pendingDays);
}

/** Ảnh chụp số dư SAU khi trừ phần sẽ hết hạn trong cùng nhịp (bước hết hạn luôn chạy trước). */
function withoutExpiring(row: BalanceRow, expiringDays: number): CarryoverBalanceInput {
  const base = toBalanceInput(row);
  if (expiringDays <= 0) return base;
  return { ...base, totalDays: String(num(base.totalDays) - expiringDays) };
}

function skipEntry(
  row: BalanceRow,
  policy: CarryoverPolicyInput,
  reason: CarryoverSkipReason,
): CarryoverSkipEntry {
  return {
    employeeId: row.balanceEmployeeId ?? row.profileEmployeeId,
    employeeCode: row.employeeCode,
    leaveTypeId: row.leaveTypeId,
    policyCode: policy.policyCode,
    year: row.year,
    reason,
  };
}
