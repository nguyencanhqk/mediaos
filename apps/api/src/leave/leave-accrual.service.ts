import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { LeaveAccrualRepository } from "./leave-accrual.repository";
import {
  buildAccrualPlan,
  isEngineAccrualMethod,
  type AccrualEmployeeInput,
  type AccrualPolicyInput,
  type AccrualSkipReason,
} from "./leave-accrual.logic";

/**
 * S6-LEAVE-ACCRUAL-1 — engine cộng dồn phép theo `leave_policies.accrual_method`.
 *
 * LỖI GỐC ĐANG VÁ: màn Chính sách cho HR chọn `accrual_method ∈ None|Monthly|Yearly|Manual|Prorated`
 * và ghi xuống DB, nhưng TRƯỚC WO này KHÔNG một dòng code nào ĐỌC cột đó để cấp phép ⇒ HR cấu hình
 * xong tưởng đã chạy, thực tế 0 ngày được cấp và KHÔNG có lỗi nào báo. Vì vậy nguyên tắc xuyên suốt
 * file này: **không bao giờ bỏ qua trong im lặng** — mọi hồ sơ/chính sách không cấp được đều đi ra
 * `skipped[]` kèm lý do, hiện cả ở dry-run lẫn metadata của lần chạy job.
 *
 * BẤT BIẾN:
 *   #1 mọi truy vấn đi qua `withTenant(companyId)` + `company_id` tường minh trong WHERE.
 *   #2 `leave_balance_transactions` INSERT-ONLY; `leave_balances` chỉ CỘNG `total_days`/`granted_days`.
 *   #3 audit/metadata chỉ chứa SỐ ĐẾM + mã kỳ — không PII, không danh sách người.
 *
 * IDEMPOTENT (hợp đồng `JobHandler`: chạy mỗi nhịp 60s): kỳ đã có dòng ACCRUAL thì không tính lại; chốt
 * cuối là partial unique index `uq_leave_balance_tx_accrual_period` (mig 0536).
 */

export interface AccrualPendingLine {
  employeeId: string;
  employeeCode: string | null;
  /** Khoá của `leave_balances` (user_id NOT NULL). KHÔNG phơi ra DTO — chỉ dùng nội bộ khi ghi. */
  userId: string;
  leaveTypeId: string;
  policyCode: string;
  periodKey: string;
  year: number;
  transactionDate: string;
  amountDays: number;
}

export interface AccrualSkipEntry {
  employeeId: string;
  employeeCode: string | null;
  leaveTypeId: string;
  policyCode: string;
  reason: AccrualSkipReason;
}

export interface AccrualPreview {
  /** Ngày mốc dùng để tính (ISO, UTC) — hiện ra để người đọc đối chiếu được kết quả. */
  today: string;
  /** Chính sách engine THỰC SỰ chạy (đã lọc `None`/`Manual`). */
  policies: {
    policyCode: string;
    leaveTypeId: string;
    accrualMethod: string;
    quotaDays: number | null;
  }[];
  employeesScanned: number;
  /** Kỳ SẼ cấp (dry-run) hoặc kỳ VỪA cấp (sau khi chạy). */
  pending: AccrualPendingLine[];
  totalDays: number;
  employeesAffected: number;
  /** Kỳ đã có trong sổ cái từ trước ⇒ không cấp lại (bằng chứng idempotency nhìn thấy được). */
  alreadyGranted: number;
  skipped: AccrualSkipEntry[];
}

/** Trần số dòng chi tiết trả qua HTTP. Số TỔNG luôn đi kèm nên trần này không bao giờ im lặng. */
export const PREVIEW_ROW_CAP = 500;

/** Bản dry-run đi ra ngoài HTTP — bỏ `userId`, cắt chi tiết theo trần, kèm cờ + tổng thật. */
export interface AccrualPreviewResponse extends Omit<AccrualPreview, "pending" | "skipped"> {
  pending: Omit<AccrualPendingLine, "userId">[];
  pendingTotal: number;
  pendingTruncated: boolean;
  skipped: AccrualSkipEntry[];
  skippedTotal: number;
  skippedTruncated: boolean;
}

export interface AccrualRunResult {
  preview: AccrualPreview;
  granted: number;
  grantedDays: number;
  failed: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class LeaveAccrualService {
  private readonly logger = new Logger(LeaveAccrualService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeaveAccrualRepository,
    private readonly audit: AuditService,
  ) {}

  /** Hôm nay theo UTC (ADR-0008 UTC-at-rest) — cột `date` của Postgres là ngày thuần, phải cùng hệ quy chiếu. */
  static today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Dry-run: KHÔNG ghi gì. Dùng để đối chiếu số trước khi bật engine trên staging/PROD.
   * Trả ĐẦY ĐỦ — đây là đầu vào của `runCompany`, cắt bớt ở đây = cấp thiếu. Việc cắt cho HTTP nằm ở
   * `capForResponse` (biên serialize), KHÔNG nằm ở đường ghi.
   */
  async previewCompany(
    companyId: string,
    today = LeaveAccrualService.today(),
  ): Promise<AccrualPreview> {
    return this.db.withTenant(companyId, (tx) => this.planWithTx(companyId, today, tx));
  }

  /**
   * S6-LEAVE-CARRYOVER-1 — CÙNG phép tính với `previewCompany` nhưng chạy TRONG tx của caller.
   *
   * Vì sao phải có: engine chuyển tiếp cần biết "accrual đã cấp xong năm cũ chưa" TRONG KHI nó đang giữ
   * `FOR UPDATE` trên dòng số dư. Gọi `previewCompany()` ở đó sẽ mở `withTenant` thứ hai = transaction thứ
   * hai trên connection thứ hai ⇒ đúng cái "tx LỒNG = treo" mà PgBouncer transaction-mode cấm.
   *
   * Thân hàm KHÔNG đổi — chỉ mở rộng khả năng gọi. `plan()` cũ giữ nguyên vai trò private bên trong.
   */
  async planWithTx(companyId: string, today: string, tx: TenantTx): Promise<AccrualPreview> {
    return this.plan(companyId, today, tx);
  }

  /**
   * Bản dry-run cho HTTP: cắt hai mảng chi tiết về trần và NÓI RA rằng đã cắt. Số tổng
   * (`totalDays`/`employeesAffected`/`alreadyGranted`/`skippedTotal`) LUÔN đầy đủ — người đọc không bao
   * giờ bị một danh sách cụt làm hiểu nhầm là "chỉ có bấy nhiêu". Không có trần thì một công ty vài
   * nghìn người sẽ trả về hàng chục nghìn dòng trong một response.
   */
  async previewCompanyForResponse(
    companyId: string,
    today = LeaveAccrualService.today(),
  ): Promise<AccrualPreviewResponse> {
    const preview = await this.previewCompany(companyId, today);
    return {
      today: preview.today,
      policies: preview.policies,
      employeesScanned: preview.employeesScanned,
      // `userId` KHÔNG đi ra ngoài (chỉ dùng nội bộ khi ghi số dư).
      pending: preview.pending.slice(0, PREVIEW_ROW_CAP).map(({ userId: _userId, ...row }) => row),
      pendingTotal: preview.pending.length,
      pendingTruncated: preview.pending.length > PREVIEW_ROW_CAP,
      totalDays: preview.totalDays,
      employeesAffected: preview.employeesAffected,
      alreadyGranted: preview.alreadyGranted,
      skipped: preview.skipped.slice(0, PREVIEW_ROW_CAP),
      skippedTotal: preview.skipped.length,
      skippedTruncated: preview.skipped.length > PREVIEW_ROW_CAP,
    };
  }

  /**
   * Cấp phép cho 1 tenant. MỘT `withTenant` duy nhất cho cả vòng (JobRunner đã đóng tx enumerate TRƯỚC
   * khi gọi handler; PgBouncer transaction-mode + tx LỒNG = treo). Cô lập lỗi từng nhân viên bằng
   * SAVEPOINT (`tx.transaction`) — không mở kết nối mới, nên không phạm điều trên.
   */
  async runCompany(
    companyId: string,
    today = LeaveAccrualService.today(),
  ): Promise<AccrualRunResult> {
    return this.db.withTenant(companyId, async (tx) => {
      const preview = await this.plan(companyId, today, tx);
      if (preview.pending.length === 0) {
        return { preview, granted: 0, grantedDays: 0, failed: 0 };
      }

      const byEmployee = new Map<string, AccrualPendingLine[]>();
      for (const line of preview.pending) {
        const key = `${line.employeeId}|${line.leaveTypeId}|${line.year}`;
        const bucket = byEmployee.get(key);
        if (bucket) bucket.push(line);
        else byEmployee.set(key, [line]);
      }

      let granted = 0;
      let grantedDays = 0;
      let failed = 0;
      for (const lines of byEmployee.values()) {
        try {
          // SAVEPOINT: một hồ sơ hỏng (vd đua với lần chạy khác ⇒ vỡ unique) KHÔNG kéo đổ cả tenant.
          const applied = await tx.transaction((sp) => this.applyLines(companyId, lines, sp));
          granted += applied.count;
          grantedDays = round2(grantedDays + applied.days);
        } catch (err) {
          failed += 1;
          // KHÔNG nuốt im lặng: log đủ để điều tra, và `failed>0` sẽ đẩy run-row sang Partial/Failed.
          this.logger.error(
            `LEAVE_ACCRUAL tenant=${companyId} employee=${lines[0]?.employeeId} loại=${lines[0]?.leaveTypeId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      }

      // Audit CHỈ khi thực sự cấp. `granted=0` là trạng thái BÌNH THƯỜNG gần như mọi nhịp 60s — ghi
      // audit ở đó = ~526k dòng rác/năm trong bảng append-only (đúng quả bom đã phải đi gỡ ở LMS sync).
      if (granted > 0) {
        await this.audit.record(tx, {
          action: "leave_accrual_run",
          objectType: "leave_balance",
          actorType: "Job",
          actionGroup: "LEAVE",
          resultStatus: failed > 0 ? "Failure" : "Success",
          dataScope: "Company",
          sensitivityLevel: "Sensitive",
          // CHỈ SỐ ĐẾM (BẤT BIẾN #3) — không tên, không mã nhân viên, không danh sách.
          metadata: {
            today,
            granted,
            grantedDays,
            failed,
            skipped: preview.skipped.length,
            alreadyGranted: preview.alreadyGranted,
            policies: preview.policies.length,
          },
        });
      }
      return { preview, granted, grantedDays, failed };
    });
  }

  /** Ghi số dư + sổ cái cho mọi kỳ của MỘT (nhân viên, loại nghỉ, năm). */
  private async applyLines(
    companyId: string,
    lines: AccrualPendingLine[],
    tx: TenantTx,
  ): Promise<{ count: number; days: number }> {
    const first = lines[0];
    await this.repo.ensureBalanceTx(
      companyId,
      {
        userId: first.userId,
        employeeId: first.employeeId,
        leaveTypeId: first.leaveTypeId,
        year: first.year,
      },
      tx,
    );

    let count = 0;
    let days = 0;
    for (const line of lines) {
      // FOR UPDATE mỗi kỳ: nối tiếp hoá với adjust/approve đang chạy trên cùng dòng số dư.
      const balance = await this.repo.findBalanceForUpdateTx(
        companyId,
        line.userId,
        line.leaveTypeId,
        line.year,
        tx,
      );
      if (!balance) throw new Error(`không dựng được dòng số dư ${line.leaveTypeId}/${line.year}`);

      const before = Number(balance.totalDays);
      const amount = line.amountDays.toFixed(2);
      const [updated] = await this.repo.applyAccrualTx(
        companyId,
        balance.id,
        amount,
        line.employeeId,
        line.year,
        tx,
      );
      if (!updated) throw new Error(`cập nhật số dư ${balance.id} không đổi dòng nào`);

      await this.repo.insertLedgerTx(
        companyId,
        {
          companyId,
          leaveBalanceId: balance.id,
          employeeId: line.employeeId,
          leaveTypeId: line.leaveTypeId,
          transactionType: "ACCRUAL",
          transactionDate: line.transactionDate,
          amountDays: amount,
          balanceBeforeDays: before.toFixed(2),
          balanceAfterDays: Number(updated.totalDays).toFixed(2),
          reason: `ACCRUAL ${line.periodKey}`,
          referenceType: "leave_policy",
          createdByType: "Job",
          metadata: { policyCode: line.policyCode, periodKey: line.periodKey },
        },
        tx,
      );
      count += 1;
      days = round2(days + line.amountDays);
    }
    return { count, days };
  }

  /** Tính (không ghi) toàn bộ bức tranh cộng dồn của tenant tại `today`. */
  private async plan(companyId: string, today: string, tx: TenantTx): Promise<AccrualPreview> {
    const allPolicies = await this.repo.listActiveCompanyPoliciesTx(companyId, today, tx);
    const employees = await this.repo.listEmployeesTx(companyId, tx);

    const pending: AccrualPendingLine[] = [];
    const skipped: AccrualSkipEntry[] = [];
    const affected = new Set<string>();
    let totalDays = 0;

    // Chỉ giữ chính sách engine THỰC SỰ chạy — `None`/`Manual` không phải "lỗi", là lựa chọn của HR
    // (D-A4), nên KHÔNG đẩy vào skipped (sẽ thành 45 dòng nhiễu mỗi lần chạy, che mất lý do thật).
    const enginePolicies = allPolicies.filter((p) => isEngineAccrualMethod(p.accrualMethod));
    const leaveTypeIds = enginePolicies.map((p) => p.leaveTypeId);
    const ledger = await this.repo.listAccrualLedgerKeysTx(companyId, leaveTypeIds, tx);
    const done = new Set(
      ledger.map((r) => `${r.employeeId}|${r.leaveTypeId}|${r.transactionDate}`),
    );
    let alreadyGranted = 0;

    for (const policyRow of enginePolicies) {
      const policy = toPolicyInput(policyRow);
      for (const row of employees) {
        const employee: AccrualEmployeeInput = {
          employeeId: row.employeeId,
          userId: row.userId,
          employeeCode: row.employeeCode,
          startDate: row.startDate,
          endDate: row.endDate,
          status: row.status,
        };
        const { periods, skipReason } = buildAccrualPlan({ policy, employee, today });
        if (skipReason !== null) {
          skipped.push({
            employeeId: employee.employeeId,
            employeeCode: employee.employeeCode,
            leaveTypeId: policy.leaveTypeId,
            policyCode: policy.policyCode,
            reason: skipReason,
          });
          continue;
        }
        for (const period of periods) {
          if (done.has(`${employee.employeeId}|${policy.leaveTypeId}|${period.transactionDate}`)) {
            alreadyGranted += 1;
            continue;
          }
          pending.push({
            // `userId` non-null được bảo đảm bởi nhánh MISSING_USER phía trên (skipReason ≠ null ⇒ continue).
            userId: employee.userId as string,
            employeeId: employee.employeeId,
            employeeCode: employee.employeeCode,
            leaveTypeId: policy.leaveTypeId,
            policyCode: policy.policyCode,
            periodKey: period.periodKey,
            year: period.year,
            transactionDate: period.transactionDate,
            amountDays: period.amountDays,
          });
          totalDays = round2(totalDays + period.amountDays);
          affected.add(employee.employeeId);
        }
      }
    }

    return {
      today,
      policies: enginePolicies.map((p) => ({
        policyCode: p.policyCode,
        leaveTypeId: p.leaveTypeId,
        accrualMethod: p.accrualMethod,
        quotaDays: p.yearlyQuotaDays === null ? null : Number(p.yearlyQuotaDays),
      })),
      employeesScanned: employees.length,
      pending,
      totalDays,
      employeesAffected: affected.size,
      alreadyGranted,
      skipped,
    };
  }
}

type PolicyRow = Awaited<ReturnType<LeaveAccrualRepository["listActiveCompanyPoliciesTx"]>>[number];

function toPolicyInput(row: PolicyRow): AccrualPolicyInput {
  return {
    policyId: row.policyId,
    policyCode: row.policyCode,
    leaveTypeId: row.leaveTypeId,
    accrualMethod: row.accrualMethod,
    yearlyQuotaDays: row.yearlyQuotaDays,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}
