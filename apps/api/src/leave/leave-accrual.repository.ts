import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { leaveBalances } from "../db/schema/hr";
import { leaveBalanceTransactions, leavePolicies } from "../db/schema/leave";

/**
 * S6-LEAVE-ACCRUAL-1 — persistence của engine cộng dồn phép. Mọi method nhận `tx` của caller ⇒ SERVICE
 * sở hữu `withTenant` (RLS + `company_id` tường minh, BẤT BIẾN #1).
 *
 * BẤT BIẾN #2: `leave_balance_transactions` là sổ cái APPEND-ONLY (mig 0453 GRANT SELECT,INSERT) —
 * file này CHỈ có `insertLedgerTx`, KHÔNG có method UPDATE/DELETE cho nó. `leave_balances` KHÔNG bao giờ
 * bị hard-delete ở đây; accrual chỉ CỘNG vào `total_days`/`granted_days`, tuyệt đối không chạm
 * `used_days` (đường duyệt đơn) hay `remaining_days` (cột GENERATED).
 */
@Injectable()
export class LeaveAccrualRepository {
  /**
   * Chính sách áp dụng cho từng loại nghỉ tại `refDate` — CÙNG luật resolve với đường tạo đơn
   * (`LeaveRequestRepository.findActivePolicyForTypeTx`): scope `Company`, `Active`, còn hiệu lực,
   * `priority` cao nhất. Giữ nguyên một luật cho hai đường để số dư được cấp và số dư bị trừ không
   * bao giờ nói theo hai chính sách khác nhau. (Scope hẹp hơn vẫn DEFERRED ở CẢ HAI đường.)
   *
   * `DISTINCT ON (leave_type_id)` + ORDER BY priority DESC ⇒ đúng 1 chính sách/loại nghỉ.
   */
  async listActiveCompanyPoliciesTx(companyId: string, refDate: string, tx: TenantTx) {
    const rows = await tx
      .selectDistinctOn([leavePolicies.leaveTypeId], {
        policyId: leavePolicies.id,
        policyCode: leavePolicies.policyCode,
        leaveTypeId: leavePolicies.leaveTypeId,
        accrualMethod: leavePolicies.accrualMethod,
        yearlyQuotaDays: leavePolicies.yearlyQuotaDays,
        effectiveFrom: leavePolicies.effectiveFrom,
        effectiveTo: leavePolicies.effectiveTo,
      })
      .from(leavePolicies)
      .where(
        and(
          eq(leavePolicies.companyId, companyId),
          eq(leavePolicies.policyScope, "Company"),
          eq(leavePolicies.status, "Active"),
          isNull(leavePolicies.deletedAt),
          lte(leavePolicies.effectiveFrom, refDate),
          sql`(${leavePolicies.effectiveTo} IS NULL OR ${leavePolicies.effectiveTo} >= ${refDate})`,
        ),
      )
      .orderBy(leavePolicies.leaveTypeId, desc(leavePolicies.priority), leavePolicies.id);
    return rows;
  }

  /** Hồ sơ nhân sự còn sống của tenant. KHÔNG lọc `status`/`start_date` ở SQL — engine phải BÁO CÁO */
  /** từng hồ sơ bị bỏ qua kèm lý do, mà lọc ở SQL thì chúng biến mất im lặng (đúng lỗi WO đang vá). */
  async listEmployeesTx(companyId: string, tx: TenantTx) {
    return tx
      .select({
        employeeId: employeeProfiles.id,
        userId: employeeProfiles.userId,
        employeeCode: employeeProfiles.employeeCode,
        startDate: employeeProfiles.startDate,
        endDate: employeeProfiles.endDate,
        status: employeeProfiles.status,
      })
      .from(employeeProfiles)
      .where(and(eq(employeeProfiles.companyId, companyId), isNull(employeeProfiles.deletedAt)))
      .orderBy(employeeProfiles.id);
  }

  /**
   * Mọi kỳ ACCRUAL ĐÃ ghi cho các loại nghỉ đang xét — nguồn của lớp idempotency #2 (lớp #3 là partial
   * unique index mig 0536). Trả khoá thô để service dựng Set tra cứu O(1).
   */
  async listAccrualLedgerKeysTx(companyId: string, leaveTypeIds: string[], tx: TenantTx) {
    if (leaveTypeIds.length === 0) return [];
    return tx
      .select({
        employeeId: leaveBalanceTransactions.employeeId,
        leaveTypeId: leaveBalanceTransactions.leaveTypeId,
        transactionDate: leaveBalanceTransactions.transactionDate,
      })
      .from(leaveBalanceTransactions)
      .where(
        and(
          eq(leaveBalanceTransactions.companyId, companyId),
          eq(leaveBalanceTransactions.transactionType, "ACCRUAL"),
          inArray(leaveBalanceTransactions.leaveTypeId, leaveTypeIds),
        ),
      );
  }

  /** Khoá dòng số dư (FOR UPDATE) — nối tiếp hoá accrual với adjust/approve trên CÙNG dòng. */
  async findBalanceForUpdateTx(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    year: number,
    tx: TenantTx,
  ) {
    const [row] = await tx
      .select({
        id: leaveBalances.id,
        totalDays: leaveBalances.totalDays,
        grantedDays: leaveBalances.grantedDays,
      })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.userId, userId),
          eq(leaveBalances.leaveTypeId, leaveTypeId),
          eq(leaveBalances.year, year),
        ),
      )
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * Tạo dòng số dư năm nếu chưa có. `ON CONFLICT DO NOTHING` trên khoá duy nhất sẵn có
   * `(company_id, user_id, leave_type_id, year)` ⇒ hai tiến trình cùng tạo thì đúng 1 thắng, kẻ thua
   * KHÔNG ném lỗi và đọc lại dòng của kẻ thắng. Khởi tạo tại 0 — số ngày do `applyAccrualTx` cộng vào
   * (để mọi thay đổi số dư đều có DÒNG SỔ CÁI đối ứng, không có ngày phép nào "từ trên trời rơi xuống").
   */
  async ensureBalanceTx(
    companyId: string,
    data: { userId: string; employeeId: string; leaveTypeId: string; year: number },
    tx: TenantTx,
  ) {
    await tx
      .insert(leaveBalances)
      .values({
        companyId,
        userId: data.userId,
        employeeId: data.employeeId,
        leaveTypeId: data.leaveTypeId,
        year: data.year,
        balanceYear: data.year,
        periodStart: `${data.year}-01-01`,
        periodEnd: `${data.year}-12-31`,
        totalDays: "0",
        usedDays: "0",
        grantedDays: "0",
        status: "Active",
      })
      .onConflictDoNothing({
        target: [
          leaveBalances.companyId,
          leaveBalances.userId,
          leaveBalances.leaveTypeId,
          leaveBalances.year,
        ],
      });
  }

  /**
   * Cộng `amountDays` vào `total_days` + `granted_days` của một dòng số dư. KHÔNG đụng `used_days`
   * (CHECK `leave_bal_used_check: used_days <= total_days` chỉ có thể được NỚI RỘNG bởi phép cộng này,
   * không bao giờ bị vi phạm) và KHÔNG đụng `remaining_days` (GENERATED).
   *
   * `employee_id`/`balance_year` được vá luôn cho dòng cũ (S3 tạo trước khi có 2 cột DB-05 này).
   */
  async applyAccrualTx(
    companyId: string,
    balanceId: string,
    amountDays: string,
    employeeId: string,
    year: number,
    tx: TenantTx,
  ) {
    return tx
      .update(leaveBalances)
      .set({
        totalDays: sql`${leaveBalances.totalDays} + ${amountDays}::numeric`,
        grantedDays: sql`COALESCE(${leaveBalances.grantedDays}, 0) + ${amountDays}::numeric`,
        employeeId: sql`COALESCE(${leaveBalances.employeeId}, ${employeeId}::uuid)`,
        balanceYear: sql`COALESCE(${leaveBalances.balanceYear}, ${year})`,
        lastAccrualAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(leaveBalances.companyId, companyId), eq(leaveBalances.id, balanceId)))
      .returning({ id: leaveBalances.id, totalDays: leaveBalances.totalDays });
  }

  /** INSERT ONLY (BẤT BIẾN #2). Trùng kỳ ⇒ vỡ `uq_leave_balance_tx_accrual_period` (mig 0536). */
  async insertLedgerTx(
    companyId: string,
    data: typeof leaveBalanceTransactions.$inferInsert,
    tx: TenantTx,
  ) {
    return tx
      .insert(leaveBalanceTransactions)
      .values({ ...data, companyId })
      .returning({ id: leaveBalanceTransactions.id });
  }
}
