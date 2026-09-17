import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { PayrollReportCode } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import {
  currentOrgUnitLateral,
  employerStatutoryCte,
  incomeStructureCte,
  payslipStatutoryCte,
  publishedPayslipsCte,
  rowsOf,
} from "./payroll-report.sql";
import { PAYROLL_REPORTS, sumColumnsOf } from "./payroll-reports.registry";

/** Tham số đã kiểm (service ép bắt buộc theo registry) — khoảng tháng có thể vắng ở `salary-history`. */
export interface PayrollReportFilter {
  readonly fromMonth?: string;
  readonly toMonth?: string;
  readonly orgUnitId?: string;
  readonly userId?: string;
  readonly batchStatus?: string;
}

export type RawReportRow = Record<string, unknown>;

/** Một báo cáo = CTE + câu gom nhóm (mỗi hàng đã là hàng báo cáo) + thứ tự ổn định. */
interface ReportQuery {
  readonly ctes: SQL;
  /** SELECT trả cột camelCase đúng `key` của registry (+ khoá liên kết). */
  readonly grouped: SQL;
  /** ORDER BY trên alias `g` (và `ou` = đơn vị của `g."orgUnitId"` nếu `joinOrgUnit`). */
  readonly order: SQL;
  /** Ghép tên đơn vị (sống) theo `g."orgUnitId"` ở câu ngoài. */
  readonly joinOrgUnit: boolean;
}

type SqlReportCode = Exclude<PayrollReportCode, "budget-status">;

const ident = (key: string): SQL => sql`${sql.identifier(key)}`;

/**
 * S15-PAYROLL-BE-5 — `PAYROLL-API-081/082`: 6 báo cáo SQL set-based (`budget-status` đi qua
 * `PayrollBudgetsRepository` để ra CÙNG số với 073).
 *
 * Mỗi báo cáo dựng MỘT câu gom nhóm; ba đường đọc bọc nó:
 *  · `countTx` — số hàng SAU gom nhóm (trần 50.000 kiểm TRƯỚC khi đọc dòng — §0b C11);
 *  · `rowsTx`  — trang (hoặc toàn bộ cho XLSX);
 *  · `totalsTx` — Σ các cột `total: 'sum'` trên CẢ bộ lọc (không phải trang — plan D-7).
 *
 * ⚠️ Không cột danh tính nào ở đây (ratchet identity-projection): tên + mã NV ghép ở service qua
 * `PayrollPeopleRepository`; `employee_code` chỉ xuất hiện trong ORDER BY (vị từ sắp xếp, không phải chiếu).
 * BẤT BIẾN #1: bảng gốc bind `company_id` bằng tham số, bảng join bằng `company_id` của bảng gốc.
 */
@Injectable()
export class PayrollReportsRepository {
  async countTx(
    tx: TenantTx,
    companyId: string,
    code: SqlReportCode,
    f: PayrollReportFilter,
  ): Promise<number> {
    const q = PayrollReportsRepository.build(code, companyId, f);
    const res = await tx.execute<{ n: number }>(
      sql`with ${q.ctes} select count(*)::int as n from (${q.grouped}) g`,
    );
    const [row] = rowsOf<{ n: number }>(res);
    if (!row) throw new Error(`payroll report ${code}: count(*) trả 0 hàng`);
    return Number(row.n);
  }

  async rowsTx(
    tx: TenantTx,
    companyId: string,
    code: SqlReportCode,
    f: PayrollReportFilter,
    page: { limit: number; offset: number } | null,
  ): Promise<RawReportRow[]> {
    const q = PayrollReportsRepository.build(code, companyId, f);
    const unit = q.joinOrgUnit
      ? sql`, ou.name as "orgUnitName" from (${q.grouped}) g
            left join org_units ou
              on ou.company_id = ${companyId}::uuid and ou.id = g."orgUnitId" and ou.deleted_at is null`
      : sql` from (${q.grouped}) g`;
    const limit = page ? sql`limit ${page.limit} offset ${page.offset}` : sql``;
    const res = await tx.execute<RawReportRow>(
      sql`with ${q.ctes} select g.*${unit} order by ${q.order} ${limit}`,
    );
    return rowsOf<RawReportRow>(res);
  }

  async totalsTx(
    tx: TenantTx,
    companyId: string,
    code: SqlReportCode,
    f: PayrollReportFilter,
  ): Promise<RawReportRow> {
    const keys = sumColumnsOf(PAYROLL_REPORTS[code]);
    if (keys.length === 0) return {};
    const q = PayrollReportsRepository.build(code, companyId, f);
    const sums = sql.join(
      keys.map((k) => sql`coalesce(sum(g.${ident(k)}), 0) as ${ident(k)}`),
      sql`, `,
    );
    const res = await tx.execute<RawReportRow>(
      sql`with ${q.ctes} select ${sums} from (${q.grouped}) g`,
    );
    const [row] = rowsOf<RawReportRow>(res);
    if (!row) throw new Error(`payroll report ${code}: totals trả 0 hàng`);
    return row;
  }

  // ── builders ──────────────────────────────────────────────────────────────────────────────────

  private static build(
    code: SqlReportCode,
    companyId: string,
    f: PayrollReportFilter,
  ): ReportQuery {
    switch (code) {
      case "employee-income":
        return PayrollReportsRepository.employeeIncome(companyId, f);
      case "salary-by-period":
        return PayrollReportsRepository.salaryByPeriod(companyId, f);
      case "income-structure":
        return PayrollReportsRepository.incomeStructure(companyId, f);
      case "cost-by-org-unit":
        return PayrollReportsRepository.costByOrgUnit(companyId, f);
      case "salary-history":
        return PayrollReportsRepository.salaryHistory(companyId, f);
      case "payment-summary":
        return PayrollReportsRepository.paymentSummary(companyId, f);
    }
  }

  private static range(f: PayrollReportFilter) {
    if (!f.fromMonth || !f.toMonth) {
      // Service kiểm `required` TRƯỚC khi gọi — tới đây là bug nối dây, không phải input người dùng.
      throw new Error("payroll report: thiếu khoảng tháng ở báo cáo bắt buộc khoảng");
    }
    return { fromMonth: f.fromMonth, toMonth: f.toMonth };
  }

  /** ORDER BY theo mã NV (vị từ sắp xếp) rồi `userId` cho thứ tự ổn định. */
  private static byEmployeeCode(companyId: string, extra: SQL = sql``): SQL {
    return sql`(select e.employee_code from employee_profiles e
                 where e.company_id = ${companyId}::uuid and e.user_id = g."userId" and e.deleted_at is null
                 order by e.created_at desc limit 1) nulls last, g."userId"${extra}`;
  }

  private static employeeIncome(companyId: string, f: PayrollReportFilter): ReportQuery {
    return {
      ctes: sql`${publishedPayslipsCte(companyId, PayrollReportsRepository.range(f), f.orgUnitId)},
                ${payslipStatutoryCte(companyId)}`,
      grouped: sql`
        select pub.user_id as "userId", pub.org_unit_id as "orgUnitId",
               count(*)::int as "payslipCount",
               sum(pub.gross) as "totalGross",
               coalesce(sum(pit.insurance_employee), 0) as "insuranceEmployee",
               coalesce(sum(pit.pit_withheld), 0) as "pitWithheld",
               sum(pub.deduction_amount) as "totalDeduction",
               sum(pub.adjustment_amount) as "totalAdjustment",
               sum(pub.net) as "totalNet"
          from pub
          left join pit on pit.payslip_id = pub.payslip_id
         group by pub.user_id, pub.org_unit_id`,
      order: PayrollReportsRepository.byEmployeeCode(companyId),
      joinOrgUnit: true,
    };
  }

  /** Dùng CHUNG với khối 4+5 của Tổng quan (078) — một công thức bình quân/chi phí. */
  static salaryByPeriodGrouped(): SQL {
    return sql`
      select pub.payroll_period_id as "periodId", pub.period_month as "periodMonth",
             min(pub.period_status) as "periodStatus",
             count(distinct pub.user_id)::int as "headcount",
             sum(pub.gross) as "totalGross",
             sum(pub.deduction_amount) as "totalDeduction",
             sum(pub.net) as "totalNet",
             round(avg(pub.gross), 2) as "avgGross",
             round(avg(pub.net), 2) as "avgNet",
             coalesce(sum(er.employer_statutory), 0) as "employerStatutory",
             sum(pub.gross) + coalesce(sum(er.employer_statutory), 0) as "totalCost"
        from pub
        left join er on er.payroll_period_id = pub.payroll_period_id and er.user_id = pub.user_id
       group by pub.payroll_period_id, pub.period_month`;
  }

  private static salaryByPeriod(companyId: string, f: PayrollReportFilter): ReportQuery {
    return {
      ctes: sql`${publishedPayslipsCte(companyId, PayrollReportsRepository.range(f), f.orgUnitId)},
                ${employerStatutoryCte(companyId)}`,
      grouped: PayrollReportsRepository.salaryByPeriodGrouped(),
      order: sql`g."periodMonth", g."periodId"`,
      joinOrgUnit: false,
    };
  }

  /** Dùng CHUNG với khối 2 của Tổng quan (078). */
  static incomeStructureGrouped(): SQL {
    return sql`
      select component_code as "componentCode", item_type as "itemType", label, direction,
             total_amount as "totalAmount", share_pct as "sharePct"
        from struct_share`;
  }

  private static incomeStructure(companyId: string, f: PayrollReportFilter): ReportQuery {
    return {
      ctes: sql`${publishedPayslipsCte(companyId, PayrollReportsRepository.range(f), f.orgUnitId)},
                ${incomeStructureCte(companyId)}`,
      grouped: PayrollReportsRepository.incomeStructureGrouped(),
      order: sql`(g.direction = 'income') desc, g."totalAmount" desc, g."componentCode" nulls last, g."itemType"`,
      joinOrgUnit: false,
    };
  }

  /** Dùng CHUNG với khối 6 của Tổng quan (078). */
  static costByOrgUnitGrouped(): SQL {
    return sql`
      select pub.org_unit_id as "orgUnitId",
             count(distinct pub.user_id)::int as "headcount",
             sum(pub.gross) as "totalGross",
             coalesce(sum(er.employer_statutory), 0) as "employerStatutory",
             sum(pub.gross) + coalesce(sum(er.employer_statutory), 0) as "totalCost",
             sum(pub.net) as "totalNet",
             round(avg(pub.gross), 2) as "avgGross",
             min(pub.gross) as "minGross",
             max(pub.gross) as "maxGross"
        from pub
        left join er on er.payroll_period_id = pub.payroll_period_id and er.user_id = pub.user_id
       group by pub.org_unit_id`;
  }

  private static costByOrgUnit(companyId: string, f: PayrollReportFilter): ReportQuery {
    return {
      ctes: sql`${publishedPayslipsCte(companyId, PayrollReportsRepository.range(f), f.orgUnitId)},
                ${employerStatutoryCte(companyId)}`,
      grouped: PayrollReportsRepository.costByOrgUnitGrouped(),
      order: sql`(g."orgUnitId" is null), ou.name nulls last, g."orgUnitId"`,
      joinOrgUnit: true,
    };
  }

  /**
   * Lịch sử lương: `LAG` chạy trên MỌI phiên bản sống của từng người TRƯỚC khi lọc khoảng (§0b C4) — phiên bản đầu
   * trong khoảng vẫn so được với bản trước khoảng. Đổi GROSS↔NET ⇒ `changePct` NULL (hai con số không cùng nghĩa).
   */
  private static salaryHistory(companyId: string, f: PayrollReportFilter): ReportQuery {
    const conds: SQL[] = [sql`true`];
    if (f.fromMonth) conds.push(sql`h.effective_date >= (${f.fromMonth} || '-01')::date`);
    if (f.toMonth) {
      conds.push(sql`h.effective_date < ((${f.toMonth} || '-01')::date + interval '1 month')`);
    }
    if (f.userId) conds.push(sql`h.user_id = ${f.userId}::uuid`);
    if (f.orgUnitId) conds.push(sql`ep.org_unit_id = ${f.orgUnitId}::uuid`);
    return {
      ctes: sql`hist as (
        select sp.id, sp.company_id, sp.user_id, sp.effective_date, sp.salary_type, sp.base_salary,
               sp.insurance_salary, sp.probation_salary, sp.pay_ratio_pct,
               lag(sp.base_salary) over w as prev_base,
               lag(sp.salary_type) over w as prev_type
          from salary_profiles sp
         where sp.company_id = ${companyId}::uuid and sp.deleted_at is null
        window w as (partition by sp.user_id order by sp.effective_date, sp.id)
      )`,
      grouped: sql`
        select h.id as "salaryProfileId", h.user_id as "userId", ep.org_unit_id as "orgUnitId",
               h.effective_date as effective_date_sort,
               to_char(h.effective_date, 'YYYY-MM-DD') as "effectiveDate",
               h.salary_type as "salaryType",
               h.base_salary as "baseSalary",
               h.insurance_salary as "insuranceSalary",
               h.probation_salary as "probationSalary",
               h.pay_ratio_pct as "payRatioPct",
               (select coalesce(sum(i.amount), 0) from salary_profile_items i
                 where i.company_id = h.company_id and i.salary_profile_id = h.id
                   and i.is_active and i.deleted_at is null) as "itemsTotal",
               case
                 when h.prev_base is null or h.prev_base = 0 or h.prev_type is distinct from h.salary_type
                   then null
                 else round((h.base_salary - h.prev_base) * 100 / h.prev_base, 2)
               end as "changePct"
          from hist h
          ${currentOrgUnitLateral(sql.raw("h"))}
         where ${sql.join(conds, sql` and `)}`,
      order: PayrollReportsRepository.byEmployeeCode(
        companyId,
        sql`, g.effective_date_sort desc, g."salaryProfileId"`,
      ),
      joinOrgUnit: true,
    };
  }

  /** Σ net qua `payslips` của dòng sống — CÙNG biểu thức 066 (`PayrollPaymentBatchesRepository.statsSelect`). */
  private static paymentSummary(companyId: string, f: PayrollReportFilter): ReportQuery {
    const r = PayrollReportsRepository.range(f);
    const byUnit = f.orgUnitId ? sql`and ep.org_unit_id = ${f.orgUnitId}::uuid` : sql``;
    const byStatus = f.batchStatus ? sql`and b.status = ${f.batchStatus}` : sql``;
    const having = f.orgUnitId ? sql`having count(ln.id) > 0` : sql``;
    return {
      ctes: sql`ln as (
        select l.id, l.batch_id, l.paid_at, ps.net
          from payroll_payment_lines l
          join payslips ps on ps.company_id = l.company_id and ps.id = l.payslip_id
          ${currentOrgUnitLateral(sql.raw("l"))}
         where l.company_id = ${companyId}::uuid and l.deleted_at is null
           ${byUnit}
      )`,
      grouped: sql`
        select b.id as "batchId", b.code as "batchCode", pp.period_month as "periodMonth",
               b.method, b.status,
               to_char(b.pay_date, 'YYYY-MM-DD') as "payDate",
               count(ln.id)::int as "lineCount",
               (count(ln.id) filter (where ln.paid_at is not null))::int as "paidLineCount",
               coalesce(sum(ln.net), 0) as "totalNet",
               to_char(b.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "completedAt",
               b.created_at as created_sort
          from payroll_payment_batches b
          join payroll_periods pp
            on pp.company_id = b.company_id and pp.id = b.payroll_period_id and pp.deleted_at is null
          left join ln on ln.batch_id = b.id
         where b.company_id = ${companyId}::uuid
           and b.deleted_at is null
           and pp.period_month between ${r.fromMonth} and ${r.toMonth}
           ${byStatus}
         group by b.id, pp.period_month
         ${having}`,
      order: sql`g."periodMonth", g.created_sort, g."batchId"`,
      joinOrgUnit: false,
    };
  }
}
