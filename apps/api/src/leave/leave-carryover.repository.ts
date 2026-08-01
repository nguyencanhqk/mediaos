import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { leaveBalances } from "../db/schema/hr";
import { leaveBalanceTransactions, leavePolicies } from "../db/schema/leave";

/**
 * S6-LEAVE-CARRYOVER-1 — persistence của engine chuyển tiếp/hết hạn phép. Mọi method nhận `tx` của caller
 * ⇒ SERVICE sở hữu `withTenant` (RLS + `company_id` tường minh, BẤT BIẾN #1).
 *
 * BẤT BIẾN #2: `leave_balance_transactions` là sổ cái APPEND-ONLY (mig 0453 GRANT SELECT,INSERT) — file
 * này CHỈ có `insertLedgerTx`, KHÔNG có method UPDATE/DELETE cho nó.
 *
 * ⚠️ CHỖ QUAN TRỌNG NHẤT CỦA CẢ WORK ORDER nằm trong file này: **ràng buộc SỐ NGÀY ở mệnh đề WHERE** của
 * hai lệnh ghi nợ. Số dư năm cũ KHÔNG đóng băng sau khi chuyển (từ chối đơn trả lại `pending_days`, huỷ
 * đơn trả lại `used_days`, HR điều chỉnh đổi `total_days`), nên engine phải được phép ghi BÙ ở nhịp sau —
 * và khi đã cho ghi bù thì thứ duy nhất chặn được "ghi quá số" là ràng buộc theo SỐ, ép ở tầng DB, không
 * phải một câu `if` trong TypeScript. UPDATE đổi 0 dòng ⇒ service ném lỗi ⇒ không dòng sổ cái nào được ghi.
 */
/**
 * Số ngày ghi vào số dư PHẢI có tối đa 1 chữ số thập phân — `leave_balances.total_days` là `numeric(5,1)`
 * còn `carried_over_days`/`expired_days` là `numeric(8,2)`. Đưa vào 5.25 thì `total_days` LÀM TRÒN (5.3)
 * trong khi cột phân rã giữ 5.25 ⇒ sổ và số dư lệch dần, và cận trên "không hết hạn quá phần đã nhận" tính
 * trên một con số không còn đúng. `floor1()` ở tầng logic đã bảo đảm điều này; chốt lại ở đây để một
 * đường gọi tương lai (endpoint chạy tay, script) không lặng lẽ phá bất biến đó.
 */
function assertOneDecimal(amountDays: string, label: string): void {
  const scale = amountDays.split(".")[1]?.replace(/0+$/, "").length ?? 0;
  if (scale > 1) {
    throw new Error(
      `[leave.carryover] số ngày ${label} phải tối đa 1 chữ số thập phân (numeric(5,1) của total_days), nhận "${amountDays}"`,
    );
  }
}

@Injectable()
export class LeaveCarryoverRepository {
  /**
   * Chính sách áp dụng cho từng loại nghỉ tại `refDate` — CÙNG luật resolve với đường tạo đơn và với
   * engine cộng dồn (`DISTINCT ON (leave_type_id)` + `priority` cao nhất, scope `Company`). Giữ một luật
   * cho mọi đường để số dư được cấp, bị trừ, được chuyển và bị xoá không bao giờ nói theo hai chính sách
   * khác nhau.
   *
   * KHÔNG lọc `allow_carry_forward` ở SQL: nhánh HẾT HẠN vẫn phải chạy trên chính sách đã TẮT công tắc
   * (tắt sau khi đã chuyển mà cũng tắt luôn hết hạn thì số ngày đó sống mãi).
   */
  async listActiveCompanyPoliciesTx(companyId: string, refDate: string, tx: TenantTx) {
    return tx
      .selectDistinctOn([leavePolicies.leaveTypeId], {
        policyId: leavePolicies.id,
        policyCode: leavePolicies.policyCode,
        leaveTypeId: leavePolicies.leaveTypeId,
        allowCarryForward: leavePolicies.allowCarryForward,
        maxCarryForwardDays: leavePolicies.maxCarryForwardDays,
        expiryMonth: leavePolicies.carryForwardExpiryMonth,
        expiryDay: leavePolicies.carryForwardExpiryDay,
        reserveBalanceOnPending: leavePolicies.reserveBalanceOnPending,
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
  }

  /**
   * Dòng số dư của các năm đang xét, kèm hồ sơ nhân sự để biết `end_date`.
   *
   * Ghép qua `user_id` chứ KHÔNG qua `leave_balances.employee_id`: cột đó là cột MỚI (mig 0453) và còn
   * NULL trên dòng cũ.
   *
   * `DISTINCT ON (leave_balances.id)` ở đây là ĐAI AN TOÀN, không phải cơ chế chọn hồ sơ: chỉ mục
   * `employee_profiles_company_user_active_uq (company_id, user_id) WHERE deleted_at IS NULL` cộng với
   * `isNull(deletedAt)` trong điều kiện JOIN đã bảo đảm tối đa MỘT hồ sơ sống cho mỗi user ⇒ không có ca
   * "một user hai hồ sơ" đi qua được đường này. `NULLS LAST` để nếu đai an toàn có phải làm việc thì nó
   * ưu tiên hồ sơ CÓ `start_date` (cột này nullable) thay vì hồ sơ thiếu dữ liệu.
   */
  async listBalancesForYearsTx(
    companyId: string,
    years: number[],
    leaveTypeIds: string[],
    tx: TenantTx,
  ) {
    if (years.length === 0 || leaveTypeIds.length === 0) return [];
    return tx
      .selectDistinctOn([leaveBalances.id], {
        balanceId: leaveBalances.id,
        year: leaveBalances.year,
        leaveTypeId: leaveBalances.leaveTypeId,
        userId: leaveBalances.userId,
        balanceEmployeeId: leaveBalances.employeeId,
        totalDays: leaveBalances.totalDays,
        usedDays: leaveBalances.usedDays,
        pendingDays: leaveBalances.pendingDays,
        carriedOverDays: leaveBalances.carriedOverDays,
        expiredDays: leaveBalances.expiredDays,
        profileEmployeeId: employeeProfiles.id,
        employeeCode: employeeProfiles.employeeCode,
        endDate: employeeProfiles.endDate,
      })
      .from(leaveBalances)
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, leaveBalances.userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          inArray(leaveBalances.year, years),
          inArray(leaveBalances.leaveTypeId, leaveTypeIds),
          isNull(leaveBalances.deletedAt),
        ),
      )
      .orderBy(leaveBalances.id, sql`${employeeProfiles.startDate} DESC NULLS LAST`);
  }

  /**
   * Đếm dòng số dư NẰM NGOÀI cửa sổ quét mà vẫn còn ngày chưa dùng.
   *
   * Engine chỉ xử lý `[năm(today)−1, năm(today)]`. Dòng của năm cũ hơn (job chết cả năm, tenant import dữ
   * liệu lịch sử, owner bật công tắc muộn) sẽ KHÔNG bao giờ được chuyển, KHÔNG bao giờ hết hạn, và —
   * nếu không đếm ở đây — cũng KHÔNG bao giờ xuất hiện ở bất kỳ con số nào: `balancesScanned` chỉ đếm hai
   * năm trong cửa sổ, nên nó luôn trông "khoẻ". Đúng loại lỗi im lặng mà Work Order này sinh ra để diệt.
   * Một `COUNT(*)` là đủ để biến "không tồn tại" thành "có N dòng, đi mà xem".
   */
  async countStrandedBalancesTx(
    companyId: string,
    beforeYear: number,
    leaveTypeIds: string[],
    tx: TenantTx,
  ): Promise<number> {
    if (leaveTypeIds.length === 0) return 0;
    const [row] = await tx
      .select({ n: sql<string>`COUNT(*)` })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          lt(leaveBalances.year, beforeYear),
          inArray(leaveBalances.leaveTypeId, leaveTypeIds),
          isNull(leaveBalances.deletedAt),
          sql`(${leaveBalances.totalDays} - COALESCE(${leaveBalances.usedDays}, 0)) > 0`,
        ),
      );
    return Number(row?.n ?? 0);
  }

  /**
   * MỌI dòng ghi CÓ của CARRY_OVER trên từng dòng số dư (ngày + số ngày).
   *
   * Trả cả danh sách chứ KHÔNG rút gọn thành `MAX(ngày)`: mốc hết hạn chỉ áp dụng cho phần chuyển vào
   * TRƯỚC mốc, nên rút gọn sẽ khiến MỘT dòng ghi có sau mốc miễn nhiễm cho TOÀN BỘ dòng số dư, vĩnh viễn.
   */
  async listCarryCreditsTx(companyId: string, balanceIds: string[], tx: TenantTx) {
    if (balanceIds.length === 0) return [];
    return tx
      .select({
        balanceId: leaveBalanceTransactions.leaveBalanceId,
        transactionDate: leaveBalanceTransactions.transactionDate,
        amountDays: leaveBalanceTransactions.amountDays,
      })
      .from(leaveBalanceTransactions)
      .where(
        and(
          eq(leaveBalanceTransactions.companyId, companyId),
          eq(leaveBalanceTransactions.transactionType, "CARRY_OVER"),
          inArray(leaveBalanceTransactions.leaveBalanceId, balanceIds),
          sql`${leaveBalanceTransactions.amountDays} > 0`,
        ),
      )
      .orderBy(leaveBalanceTransactions.transactionDate);
  }

  /**
   * Dòng số dư theo khoá (user, loại nghỉ, năm) + FOR UPDATE. Bản của accrual KHÔNG lọc `deleted_at`, mà
   * `applyCarryCreditTx` thì có ⇒ một dòng đích đã soft-delete sẽ "khoá được" rồi "ghi có 0 dòng" ⇒ ném
   * lỗi mỗi nhịp 60 giây mãi mãi. Lọc ngay ở đây để nó thành một lần bỏ qua có lý do.
   */
  async findTargetBalanceForUpdateTx(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    year: number,
    tx: TenantTx,
  ) {
    const [row] = await tx
      .select({ id: leaveBalances.id, totalDays: leaveBalances.totalDays })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.userId, userId),
          eq(leaveBalances.leaveTypeId, leaveTypeId),
          eq(leaveBalances.year, year),
          isNull(leaveBalances.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * Tổng hợp sổ cái theo từng (dòng số dư, loại giao dịch) cho hai loại engine này ghi:
   *   · `debitDays`      — đã ghi nợ bao nhiêu (trừ vào trần, chống dòng bù cấp lại trọn trần)
   *   · `lastCreditDate` — ngày nhận chuyển tiếp gần nhất (luật "chuyển vào sau mốc thì mốc không áp dụng")
   *   · `lastTxDate`     — ngày ghi GẦN NHẤT bất kể dấu. Đây là thứ chặn "đã ghi hôm nay rồi còn ghi nữa":
   *                        `uq_..._daily` chỉ cho MỘT dòng/ngày/dòng-số-dư, nên nếu số khả dụng tăng lại
   *                        NGAY TRONG NGÀY (HR từ chối đơn / điều chỉnh sau khi engine đã chạy sáng nay),
   *                        engine mà cứ lên kế hoạch sẽ đâm unique MỖI 60 GIÂY tới nửa đêm UTC: mỗi nhịp
   *                        một `system_job_runs` trạng thái Failed + một dòng ERROR, trong khi KHÔNG mất
   *                        ngày phép nào (SAVEPOINT rollback). Tức là hỏng phần PHÁT HIỆN chứ không hỏng
   *                        số liệu — nhưng đúng loại nhiễu đã phải đi dọn ở S6-OPS-LOGWINDOW-1. Hoãn sang
   *                        hôm sau là đủ và không mất gì.
   */
  async summarizeLedgerTx(companyId: string, balanceIds: string[], tx: TenantTx) {
    if (balanceIds.length === 0) return [];
    return tx
      .select({
        balanceId: leaveBalanceTransactions.leaveBalanceId,
        transactionType: leaveBalanceTransactions.transactionType,
        debitDays: sql<string>`COALESCE(SUM(CASE WHEN ${leaveBalanceTransactions.amountDays} < 0 THEN -${leaveBalanceTransactions.amountDays} ELSE 0 END), 0)`,
        lastCreditDate: sql<
          string | null
        >`MAX(CASE WHEN ${leaveBalanceTransactions.amountDays} > 0 THEN ${leaveBalanceTransactions.transactionDate} END)`,
        lastTxDate: sql<string | null>`MAX(${leaveBalanceTransactions.transactionDate})`,
      })
      .from(leaveBalanceTransactions)
      .where(
        and(
          eq(leaveBalanceTransactions.companyId, companyId),
          inArray(leaveBalanceTransactions.transactionType, ["CARRY_OVER", "EXPIRE"]),
          inArray(leaveBalanceTransactions.leaveBalanceId, balanceIds),
        ),
      )
      .groupBy(leaveBalanceTransactions.leaveBalanceId, leaveBalanceTransactions.transactionType);
  }

  /** Khoá dòng số dư (FOR UPDATE) — nối tiếp hoá với accrual/adjust/approve đang chạy trên cùng dòng. */
  async lockBalanceTx(companyId: string, balanceId: string, tx: TenantTx) {
    const [row] = await tx
      .select({
        id: leaveBalances.id,
        year: leaveBalances.year,
        totalDays: leaveBalances.totalDays,
        usedDays: leaveBalances.usedDays,
        pendingDays: leaveBalances.pendingDays,
        carriedOverDays: leaveBalances.carriedOverDays,
        expiredDays: leaveBalances.expiredDays,
      })
      .from(leaveBalances)
      .where(and(eq(leaveBalances.companyId, companyId), eq(leaveBalances.id, balanceId)))
      .limit(1)
      .for("update");
    return row;
  }

  /**
   * GHI NỢ năm cũ khi chuyển tiếp. Guard trong WHERE là chốt an toàn CHÍNH (xem đầu file):
   * không bao giờ chuyển quá phần còn khả dụng, kể cả khi tầng app tính sai.
   *
   * KHÔNG đụng `used_days` (đường duyệt đơn) và `remaining_days` (cột GENERATED).
   */
  async applyCarryDebitTx(companyId: string, balanceId: string, amountDays: string, tx: TenantTx) {
    assertOneDecimal(amountDays, "chuyển tiếp");
    return tx
      .update(leaveBalances)
      .set({
        totalDays: sql`${leaveBalances.totalDays} - ${amountDays}::numeric`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.id, balanceId),
          isNull(leaveBalances.deletedAt),
          sql`(${leaveBalances.totalDays} - COALESCE(${leaveBalances.usedDays}, 0) - COALESCE(${leaveBalances.pendingDays}, 0)) >= ${amountDays}::numeric`,
        ),
      )
      .returning({ id: leaveBalances.id, totalDays: leaveBalances.totalDays });
  }

  /**
   * GHI CÓ năm mới. `carried_over_days` là cột PHÂN RÃ (breakdown) — nguồn khả dụng thật là `total_days`
   * vì `remaining_days` GENERATED = `total_days − used_days` (plan §1.1 F1). Ghi thiếu `total_days` thì
   * số ngày chuyển sang hiện ra trên báo cáo mà KHÔNG ai dùng được.
   */
  async applyCarryCreditTx(companyId: string, balanceId: string, amountDays: string, tx: TenantTx) {
    assertOneDecimal(amountDays, "chuyển tiếp");
    return tx
      .update(leaveBalances)
      .set({
        totalDays: sql`${leaveBalances.totalDays} + ${amountDays}::numeric`,
        carriedOverDays: sql`COALESCE(${leaveBalances.carriedOverDays}, 0) + ${amountDays}::numeric`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.id, balanceId),
          isNull(leaveBalances.deletedAt),
        ),
      )
      .returning({ id: leaveBalances.id, totalDays: leaveBalances.totalDays });
  }

  /**
   * GHI NỢ khi HẾT HẠN. HAI guard trong WHERE, cả hai đều cần:
   *   1. không đẩy `total_days` xuống dưới `used + pending` (giữ CHECK `leave_bal_used_check`);
   *   2. không cho `expired_days` vượt `carried_over_days` — không thể xoá nhiều hơn số đã nhận về.
   */
  async applyExpireTx(companyId: string, balanceId: string, amountDays: string, tx: TenantTx) {
    assertOneDecimal(amountDays, "hết hạn");
    return tx
      .update(leaveBalances)
      .set({
        totalDays: sql`${leaveBalances.totalDays} - ${amountDays}::numeric`,
        expiredDays: sql`COALESCE(${leaveBalances.expiredDays}, 0) + ${amountDays}::numeric`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.id, balanceId),
          isNull(leaveBalances.deletedAt),
          sql`(${leaveBalances.totalDays} - COALESCE(${leaveBalances.usedDays}, 0) - COALESCE(${leaveBalances.pendingDays}, 0)) >= ${amountDays}::numeric`,
          sql`(COALESCE(${leaveBalances.carriedOverDays}, 0) - COALESCE(${leaveBalances.expiredDays}, 0)) >= ${amountDays}::numeric`,
        ),
      )
      .returning({ id: leaveBalances.id, totalDays: leaveBalances.totalDays });
  }

  /** INSERT ONLY (BẤT BIẾN #2). Trùng trong NGÀY ⇒ vỡ `uq_leave_balance_tx_{carryover,expire}_daily`. */
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
