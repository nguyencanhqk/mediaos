import { Injectable } from "@nestjs/common";
import { and, countDistinct, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import {
  payrollDependents,
  payrollStatutoryRates,
  type PayrollStatutoryRate,
} from "../db/schema/payroll";

/** Hồ sơ lương hiệu lực của MỘT nhân sự — số là CHUỖI `numeric` từ driver (vào thẳng `new D(str)` ở engine). */
export interface EffectiveProfileV2 {
  readonly id: string;
  readonly userId: string;
  readonly salaryType: "GROSS" | "NET";
  readonly baseSalary: string;
  readonly insuranceSalary: string | null;
  readonly probationSalary: string | null;
  readonly payRatioPct: string;
  readonly pitPayer: "EMPLOYEE" | "COMPANY";
}

export interface LineParticipationRow {
  readonly socialInsurance: boolean;
  readonly union: boolean;
}

export interface UnconsumedCounts {
  readonly bonusPenalties: number;
  readonly advances: number;
}

const rowsOf = <T>(res: unknown): T[] =>
  ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];

/**
 * S15-PAYROLL-BE-3 — đầu vào v2 của máy tính lương (plan §4.3 bước 9 · 11 · 16). MỖI hàm là MỘT câu set-based cho
 * CẢ kỳ (NFR §19.1 — cấm truy vấn trong vòng lặp dòng); service ghép bằng `Map`. Chỉ ĐỌC — 0 câu ghi.
 *
 * Bất biến #1: mọi câu bind `company_id` tường minh dù RLS + `withTenant` đã đỡ; mọi câu lọc `deleted_at IS NULL`.
 */
@Injectable()
export class PayrollCalcInputsRepository {
  /**
   * `userId → hồ sơ lương` hiệu lực tại `onDate` (bản `effective_date ≤ onDate` MỚI NHẤT) — CÙNG vị từ với
   * `SalaryProfilesRepository.effectiveByUserTx` (tập nền của readiness), thêm các cột v2 engine cần.
   */
  async effectiveProfilesTx(
    tx: TenantTx,
    companyId: string,
    onDate: string,
  ): Promise<Map<string, EffectiveProfileV2>> {
    const res = await tx.execute<{
      id: string;
      user_id: string;
      salary_type: string;
      base_salary: string;
      insurance_salary: string | null;
      probation_salary: string | null;
      pay_ratio_pct: string;
      pit_payer: string;
    }>(sql`
      select distinct on (sp.user_id)
             sp.id, sp.user_id, sp.salary_type, sp.base_salary, sp.insurance_salary,
             sp.probation_salary, sp.pay_ratio_pct, sp.pit_payer
        from salary_profiles sp
       where sp.company_id = ${companyId}::uuid
         and sp.deleted_at is null
         and sp.effective_date <= ${onDate}::date
       order by sp.user_id, sp.effective_date desc, sp.id
    `);
    const out = new Map<string, EffectiveProfileV2>();
    for (const r of rowsOf<{
      id: string;
      user_id: string;
      salary_type: string;
      base_salary: string;
      insurance_salary: string | null;
      probation_salary: string | null;
      pay_ratio_pct: string;
      pit_payer: string;
    }>(res)) {
      out.set(r.user_id, {
        id: r.id,
        userId: r.user_id,
        // CHECK `salary_profiles_salary_type_check` / `_pit_payer_check` ép hai tập đóng.
        salaryType: r.salary_type as EffectiveProfileV2["salaryType"],
        baseSalary: r.base_salary,
        insuranceSalary: r.insurance_salary,
        probationSalary: r.probation_salary,
        payRatioPct: r.pay_ratio_pct,
        pitPayer: r.pit_payer as EffectiveProfileV2["pitPayer"],
      });
    }
    return out;
  }

  /**
   * `profileId → {componentCode → amount}` của item SỐNG + `is_active`. Item ngưng dùng không mang tiền ⇒ không vào
   * lương và không vào phép hiệu tập hợp mã (service); mã lạ của item ĐANG DÙNG ⇒ 422 018 ở service.
   */
  async activeItemsByProfileTx(
    tx: TenantTx,
    companyId: string,
    profileIds: readonly string[],
  ): Promise<Map<string, Record<string, string>>> {
    const out = new Map<string, Record<string, string>>();
    if (profileIds.length === 0) return out;
    const res = await tx.execute<{
      salary_profile_id: string;
      component_code: string;
      amount: string;
    }>(sql`
      select spi.salary_profile_id, spi.component_code, spi.amount
        from salary_profile_items spi
       where spi.company_id = ${companyId}::uuid
         and spi.deleted_at is null
         and spi.is_active
         and spi.salary_profile_id = any(${sql.param(profileIds as string[])}::uuid[])
    `);
    for (const r of rowsOf<{ salary_profile_id: string; component_code: string; amount: string }>(
      res,
    )) {
      const items = out.get(r.salary_profile_id) ?? {};
      items[r.component_code] = r.amount;
      out.set(r.salary_profile_id, items);
    }
    return out;
  }

  /** O-2 — cờ tham gia BH / công đoàn. Vắng hàng settings ⇒ service coi cả hai `false` (default cột DB). */
  async participationByUserTx(
    tx: TenantTx,
    companyId: string,
    userIds: readonly string[],
  ): Promise<Map<string, LineParticipationRow>> {
    const out = new Map<string, LineParticipationRow>();
    if (userIds.length === 0) return out;
    const res = await tx.execute<{
      user_id: string;
      joins_social_insurance: boolean;
      joins_union: boolean;
    }>(sql`
      select pes.user_id, pes.joins_social_insurance, pes.joins_union
        from payroll_employee_settings pes
       where pes.company_id = ${companyId}::uuid
         and pes.deleted_at is null
         and pes.user_id = any(${sql.param(userIds as string[])}::uuid[])
    `);
    for (const r of rowsOf<{
      user_id: string;
      joins_social_insurance: boolean;
      joins_union: boolean;
    }>(res)) {
      out.set(r.user_id, { socialInsurance: r.joins_social_insurance, union: r.joins_union });
    }
    return out;
  }

  /**
   * Số người phụ thuộc hiệu lực trong tháng — khoảng `[effective_from, effective_to]` (NULL = vô hạn) GIAO
   * `[firstDay, lastDay]` (NPT hết hạn giữa kỳ vẫn đếm). Đếm theo NGƯỜI (`count(DISTINCT full_name)`, plan §3.9):
   * `EXCLUDE` khoá `(company, user, full_name)` nên một NPT có thể có HAI hàng không chồng trong cùng tháng.
   */
  async dependentCountsTx(
    tx: TenantTx,
    companyId: string,
    userIds: readonly string[],
    firstDay: string,
    lastDay: string,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (userIds.length === 0) return out;
    // Builder, KHÔNG template `sql` thô: cột `full_name` trong chuỗi thô là vùng mù của census chiếu danh tính
    // (`identity-projection-ratchet` chiều 6). Ở đây họ tên NPT chỉ để ĐẾM, không ra response.
    const rows = await tx
      .select({ userId: payrollDependents.userId, n: countDistinct(payrollDependents.fullName) })
      .from(payrollDependents)
      .where(
        and(
          eq(payrollDependents.companyId, companyId),
          isNull(payrollDependents.deletedAt),
          inArray(payrollDependents.userId, userIds as string[]),
          lte(payrollDependents.effectiveFrom, lastDay),
          or(isNull(payrollDependents.effectiveTo), gte(payrollDependents.effectiveTo, firstDay)),
        ),
      )
      .groupBy(payrollDependents.userId);
    for (const r of rows) out.set(r.userId, Number(r.n));
    return out;
  }

  /**
   * Bản tỉ lệ luật định hiệu lực tại ngày cuối kỳ (`effective_from ≤ onDate` mới nhất) — `FOR SHARE`: 058 (khoá catalog
   * độc quyền) không sửa được nó tới hết tx. `null` ⇒ service 422 022 `statutory-rate-missing` (CẤM net = 0).
   */
  async statutoryRateAtTx(
    tx: TenantTx,
    companyId: string,
    onDate: string,
  ): Promise<PayrollStatutoryRate | null> {
    const [row] = await tx
      .select()
      .from(payrollStatutoryRates)
      .where(
        and(
          eq(payrollStatutoryRates.companyId, companyId),
          isNull(payrollStatutoryRates.deletedAt),
          lte(payrollStatutoryRates.effectiveFrom, onDate),
        ),
      )
      .orderBy(desc(payrollStatutoryRates.effectiveFrom))
      .limit(1)
      .for("share");
    return row ?? null;
  }

  /**
   * plan §0b m3 — khoản `Approved` cùng tháng CHƯA gắn kỳ nào SAU lượt tính (của người không đủ điều kiện). Chỉ SỐ ĐẾM
   * (không tiền) ⇒ `warnings` của route ghi.
   */
  async unconsumedCountsTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
  ): Promise<UnconsumedCounts> {
    const res = await tx.execute<{ bonus_penalties: number; advances: number }>(sql`
      select
        (select count(*)::int from bonus_penalties bp
          where bp.company_id = ${companyId}::uuid and bp.status = 'Approved'
            and bp.period_month = ${periodMonth} and bp.payroll_period_id is null
            and bp.deleted_at is null) as bonus_penalties,
        (select count(*)::int from payroll_advances pa
          where pa.company_id = ${companyId}::uuid and pa.status = 'Approved'
            and pa.deduct_period_month = ${periodMonth} and pa.payroll_period_id is null
            and pa.deleted_at is null) as advances
    `);
    const row = rowsOf<{ bonus_penalties: number; advances: number }>(res)[0];
    return { bonusPenalties: row?.bonus_penalties ?? 0, advances: row?.advances ?? 0 };
  }
}
