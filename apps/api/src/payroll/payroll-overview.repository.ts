import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  PAYROLL_OVERVIEW_STRUCTURE_TOP,
  PAYROLL_REMINDER_PERIOD_LIMIT,
  PAYROLL_SALARY_BANDS,
} from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { PUBLISHED_PERIOD_STATUSES } from "./payroll-payslips.repository";
import {
  companyTodaySql,
  employerStatutoryCte,
  incomeStructureCte,
  publishedPayslipsCte,
  rowsOf,
  type PayrollMonthRange,
} from "./payroll-report.sql";
import { PayrollReportsRepository, type RawReportRow } from "./payroll-reports.repository";

export interface OverviewPeriodRef {
  id: string;
  periodMonth: string;
  status: string;
}

/**
 * S15-PAYROLL-BE-5 — `PAYROLL-API-078/079`: dữ liệu Tổng quan + Lời nhắc. Khối 2/4/5/6 dùng CHÍNH câu gom nhóm của
 * báo cáo (`PayrollReportsRepository.*Grouped`) — Tổng quan và 7 báo cáo không thể ra hai con số khác nhau.
 * Lời nhắc #2/#3 KHÔNG ở đây: service gọi `PayrollEmployeesRepository.countTx` (cùng vị từ filter 036).
 */
@Injectable()
export class PayrollOverviewRepository {
  /** Hôm nay theo TZ công ty (`YYYY-MM-DD`); công ty xoá mềm ⇒ ném (không có «hôm nay» để tính). */
  async companyTodayTx(tx: TenantTx, companyId: string): Promise<string> {
    const res = await tx.execute<{ d: string | null }>(
      sql`select to_char(${companyTodaySql(companyId)}, 'YYYY-MM-DD') as d`,
    );
    const d = rowsOf<{ d: string | null }>(res)[0]?.d;
    if (!d)
      throw new Error(`payroll overview: không đọc được ngày hiện tại của công ty ${companyId}`);
    return d;
  }

  /** Kỳ ĐÃ PHÁT HÀNH mới nhất có `period_month ≤ toMonth` (vắng ⇒ mới nhất). */
  async latestPublishedPeriodTx(
    tx: TenantTx,
    companyId: string,
    toMonth: string | undefined,
  ): Promise<OverviewPeriodRef | null> {
    const res = await tx.execute<{ id: string; period_month: string; status: string }>(sql`
      select pp.id, pp.period_month, pp.status
        from payroll_periods pp
       where pp.company_id = ${companyId}::uuid
         and pp.deleted_at is null
         and pp.status = any(${sql.param([...PUBLISHED_PERIOD_STATUSES])}::text[])
         ${toMonth ? sql`and pp.period_month <= ${toMonth}` : sql``}
       order by pp.period_month desc, pp.id
       limit 1`);
    const row = rowsOf<{ id: string; period_month: string; status: string }>(res)[0];
    return row ? { id: row.id, periodMonth: row.period_month, status: row.status } : null;
  }

  /** Khối 1 — số phiếu của kỳ neo theo 7 dải cố định (dải trống = 0, luôn đủ 7 hàng). */
  async salaryDistributionTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
  ): Promise<Array<{ idx: number; lo: string; hi: string | null; headcount: number }>> {
    const bands = sql.join(
      PAYROLL_SALARY_BANDS.map((lo, i) => {
        const hi = PAYROLL_SALARY_BANDS[i + 1];
        return sql`(${i}::int, ${lo}::numeric, ${hi === undefined ? null : hi}::numeric)`;
      }),
      sql`, `,
    );
    const res = await tx.execute<{ idx: number; lo: string; hi: string | null; headcount: number }>(
      sql`
      with ${publishedPayslipsCte(companyId, { fromMonth: periodMonth, toMonth: periodMonth })},
      bands(idx, lo, hi) as (values ${bands})
      select b.idx, b.lo, b.hi, count(pub.payslip_id)::int as headcount
        from bands b
        left join pub on pub.gross >= b.lo and (b.hi is null or pub.gross < b.hi)
       group by b.idx, b.lo, b.hi
       order by b.idx`,
    );
    return rowsOf(res);
  }

  /** Khối 2 — khoản THU của kỳ neo: `TOP` khoản đầu + một hàng `other` gộp phần còn lại (nếu có). */
  async incomeStructureTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
  ): Promise<RawReportRow[]> {
    const top = PAYROLL_OVERVIEW_STRUCTURE_TOP;
    const res = await tx.execute<RawReportRow>(sql`
      with ${publishedPayslipsCte(companyId, { fromMonth: periodMonth, toMonth: periodMonth })},
      ${incomeStructureCte(companyId)},
      ranked as (
        select g.*, row_number() over (
                 order by g."totalAmount" desc, g."componentCode" nulls last, g."itemType") as rn,
               sum(g."totalAmount") over () as income_total
          from (${PayrollReportsRepository.incomeStructureGrouped()}) g
         where g.direction = 'income'
      )
      select "componentCode", "itemType", label, "totalAmount" as amount, "sharePct", rn
        from ranked where rn <= ${top}
      union all
      select null, 'other', 'Khác', sum("totalAmount"), round(sum("totalAmount") * 100 / max(income_total), 2),
             ${top + 1}
        from ranked where rn > ${top}
      having count(*) > 0
      order by rn`);
    return rowsOf<RawReportRow>(res);
  }

  /** Khối 4+5 — CÙNG câu với báo cáo `salary-by-period`. */
  async byPeriodTx(
    tx: TenantTx,
    companyId: string,
    range: PayrollMonthRange,
  ): Promise<RawReportRow[]> {
    const res = await tx.execute<RawReportRow>(sql`
      with ${publishedPayslipsCte(companyId, range)}, ${employerStatutoryCte(companyId)}
      select g.* from (${PayrollReportsRepository.salaryByPeriodGrouped()}) g
       order by g."periodMonth", g."periodId"`);
    return rowsOf<RawReportRow>(res);
  }

  /** Khối 6 — CÙNG câu với báo cáo `cost-by-org-unit`, ở kỳ neo. */
  async byOrgUnitTx(tx: TenantTx, companyId: string, periodMonth: string): Promise<RawReportRow[]> {
    const res = await tx.execute<RawReportRow>(sql`
      with ${publishedPayslipsCte(companyId, { fromMonth: periodMonth, toMonth: periodMonth })},
      ${employerStatutoryCte(companyId)}
      select g.*, ou.name as "orgUnitName"
        from (${PayrollReportsRepository.costByOrgUnitGrouped()}) g
        left join org_units ou
          on ou.company_id = ${companyId}::uuid and ou.id = g."orgUnitId" and ou.deleted_at is null
       order by (g."orgUnitId" is null), ou.name nulls last, g."orgUnitId"`);
    return rowsOf<RawReportRow>(res);
  }

  /** Lời nhắc #1 — kỳ `Approved` ĐÃ sinh phiếu (chưa phát hành), cũ nhất trước. */
  async unpublishedPayslipsTx(
    tx: TenantTx,
    companyId: string,
  ): Promise<{
    periodCount: number;
    payslipCount: number;
    periods: Array<{ id: string; periodMonth: string; payslipCount: number }>;
  }> {
    const res = await tx.execute<Record<string, unknown>>(sql`
      with p as (
        select pp.id, pp.period_month, count(ps.id)::int as payslip_count
          from payroll_periods pp
          join payslips ps on ps.company_id = pp.company_id and ps.payroll_period_id = pp.id
         where pp.company_id = ${companyId}::uuid
           and pp.deleted_at is null
           and pp.status = 'Approved'
         group by pp.id, pp.period_month
      )
      select (select count(*)::int from p) as period_count,
             (select coalesce(sum(payslip_count), 0)::int from p) as payslip_count,
             coalesce((select jsonb_agg(jsonb_build_object(
                         'id', x.id, 'periodMonth', x.period_month, 'payslipCount', x.payslip_count)
                         order by x.period_month, x.id)
                         from (select * from p order by period_month, id
                               limit ${PAYROLL_REMINDER_PERIOD_LIMIT}) x), '[]'::jsonb) as periods`);
    const row = rowsOf<Record<string, unknown>>(res)[0];
    if (!row) throw new Error("payroll overview: lời nhắc #1 trả 0 hàng");
    return {
      periodCount: Number(row["period_count"]),
      payslipCount: Number(row["payslip_count"]),
      periods: row["periods"] as Array<{ id: string; periodMonth: string; payslipCount: number }>,
    };
  }

  /** `true` khi công ty CHƯA có bản tỉ lệ nào hiệu lực hôm nay (lời nhắc #3 không xét được). */
  async statutoryRateMissingTx(tx: TenantTx, companyId: string): Promise<boolean> {
    const res = await tx.execute<{ missing: boolean }>(sql`
      select not exists (
        select 1 from payroll_statutory_rates r
         where r.company_id = ${companyId}::uuid
           and r.deleted_at is null
           and r.effective_from <= ${companyTodaySql(companyId)}
      ) as missing`);
    const row = rowsOf<{ missing: boolean }>(res)[0];
    if (!row) throw new Error("payroll overview: kiểm bản tỉ lệ trả 0 hàng");
    return row.missing;
  }
}
