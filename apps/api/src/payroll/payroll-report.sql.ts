import { sql, type SQL } from "drizzle-orm";
import { getSettingDefault } from "../foundation/settings/setting-defaults";
import { PUBLISHED_PERIOD_STATUSES } from "./payroll-payslips.repository";

/**
 * S15-PAYROLL-BE-5 — mảnh SQL DÙNG CHUNG của track D (Tổng quan · Lời nhắc · 7 báo cáo · «thực hiện» ngân sách).
 *
 * MỘT định nghĩa cho ba câu hỏi mà ba màn cùng hỏi — plan BE-5 D-1/D-2/D-3/D-16:
 *  · «phiếu nào được tính» = phiếu của kỳ `status ∈ PUBLISHED_PERIOD_STATUSES` (import, KHÔNG danh sách thứ hai);
 *  · «phiếu thuộc đơn vị nào» = `employee_profiles.org_unit_id` HIỆN TẠI của chủ phiếu (hồ sơ sống, mới nhất);
 *  · «chi phí luật định phía DN» = Σ `component_values_json.components[kind='statutory_employer']` của dòng lương
 *    CÙNG (kỳ, người) — kỳ đã phát hành thì dòng đã đóng băng. Dòng v1 (không khoá `components`) ⇒ 0.
 *
 * BẤT BIẾN #1: mọi bảng bind `company_id` — bảng gốc bằng tham số, bảng join bằng `x.company_id = <gốc>.company_id`.
 * `companies` đọc với `c.id = $company` TƯỜNG MINH: RLS của nó KHÔNG thu hẹp SELECT (policy
 * `companies_all_tenant_read` `qual = true` — xem `chat-oversight.service.ts`).
 */

/** Mặc định khi hàng công ty vắng múi giờ — từ registry settings (DB-10 §11.2), không chép chuỗi lần nữa. */
export const PAYROLL_REPORT_DEFAULT_TZ = String(getSettingDefault("company.timezone")?.value ?? "");
if (!PAYROLL_REPORT_DEFAULT_TZ) {
  throw new Error("payroll-report.sql: registry settings thiếu mặc định 'company.timezone'");
}

export interface PayrollMonthRange {
  readonly fromMonth: string;
  readonly toMonth: string;
}

/** Khoảng tháng của một năm tài chính (`2026` ⇒ `2026-01..2026-12`). */
export function fiscalYearRange(fiscalYear: number): PayrollMonthRange {
  return { fromMonth: `${fiscalYear}-01`, toMonth: `${fiscalYear}-12` };
}

/** «Hôm nay» theo TZ công ty — scalar; công ty đã xoá mềm ⇒ NULL (mọi so sánh ngày ra rỗng, fail-closed). */
export function companyTodaySql(companyId: string): SQL {
  return sql`(select (now() at time zone coalesce(c.timezone, ${PAYROLL_REPORT_DEFAULT_TZ}))::date
                from companies c
               where c.id = ${companyId}::uuid and c.deleted_at is null)`;
}

/**
 * Đơn vị HIỆN TẠI của `<alias>.user_id` — LATERAL, đúng một hàng (unique partial `employee_profiles` sống).
 * `alias` là tên bảng/CTE nguồn đã có `company_id` + `user_id`.
 */
export function currentOrgUnitLateral(alias: SQL): SQL {
  return sql`left join lateral (
      select e.org_unit_id
        from employee_profiles e
       where e.company_id = ${alias}.company_id
         and e.user_id = ${alias}.user_id
         and e.deleted_at is null
       order by e.created_at desc
       limit 1
    ) ep on true`;
}

/**
 * CTE `pub` — MỘT hàng/phiếu của kỳ đã phát hành trong khoảng (và đơn vị, nếu lọc).
 * Cột: `company_id · payslip_id · user_id · payroll_period_id · period_month · period_status · org_unit_id` + tiền.
 */
export function publishedPayslipsCte(
  companyId: string,
  range: PayrollMonthRange,
  orgUnitId?: string,
): SQL {
  const byUnit = orgUnitId ? sql`and ep.org_unit_id = ${orgUnitId}::uuid` : sql``;
  return sql`pub as (
    select ps.company_id, ps.id as payslip_id, ps.user_id, ps.payroll_period_id,
           pp.period_month, pp.status as period_status, ep.org_unit_id,
           ps.gross, ps.net, ps.deduction_amount, ps.adjustment_amount
      from payslips ps
      join payroll_periods pp
        on pp.company_id = ps.company_id and pp.id = ps.payroll_period_id and pp.deleted_at is null
      ${currentOrgUnitLateral(sql.raw("ps"))}
     where ps.company_id = ${companyId}::uuid
       and pp.status = any(${sql.param([...PUBLISHED_PERIOD_STATUSES])}::text[])
       and pp.period_month between ${range.fromMonth} and ${range.toMonth}
       ${byUnit}
  )`;
}

/**
 * CTE `er` (phụ thuộc `pub`) — chi phí luật định phía DN theo (kỳ, người). `jsonb_typeof` chặn dòng v1
 * (`component_values_json = '{}'`) và snapshot hỏng hình thành 0 hàng thay vì lỗi `cannot extract elements`.
 */
export function employerStatutoryCte(companyId: string): SQL {
  return sql`er as (
    select pl.payroll_period_id, pl.user_id,
           sum((c.value->>'value')::numeric) as employer_statutory
      from payroll_period_lines pl
      join (select distinct payroll_period_id from pub) pk on pk.payroll_period_id = pl.payroll_period_id
     cross join lateral jsonb_array_elements(
             case when jsonb_typeof(pl.component_values_json->'components') = 'array'
                  then pl.component_values_json->'components' else '[]'::jsonb end) as c(value)
     where pl.company_id = ${companyId}::uuid
       and pl.deleted_at is null
       and c.value->>'kind' = 'statutory_employer'
     group by pl.payroll_period_id, pl.user_id
  )`;
}

/**
 * CTE `pit` (phụ thuộc `pub`) — BH người lao động + thuế TNCN KHẤU TRỪ theo phiếu, từ `payslip_items.meta.kind`
 * (khoản trừ mang dấu âm ⇒ `-sum`). Thuế do công ty chịu (`pitPayer = COMPANY`) KHÔNG có item ⇒ không có ở đây
 * (plan §0b C2). Phiếu v1 (meta NULL) ⇒ 0.
 */
export function payslipStatutoryCte(companyId: string): SQL {
  return sql`pit as (
    select pi.payslip_id,
           coalesce(-sum(pi.amount) filter (where pi.meta->>'kind' = 'statutory_employee'), 0) as insurance_employee,
           coalesce(-sum(pi.amount) filter (where pi.meta->>'kind' = 'tax'), 0) as pit_withheld
      from payslip_items pi
      join pub on pub.payslip_id = pi.payslip_id
     where pi.company_id = ${companyId}::uuid
     group by pi.payslip_id
  )`;
}

/** Tên hiển thị cố định của khoản v1/`meta` NULL theo `item_type` — KHÔNG chiếu nhãn item (lộ lý do riêng, §0b B3). */
export const PAYROLL_ITEM_TYPE_LABELS: Readonly<Record<string, string>> = {
  earning: "Lương cơ bản",
  allowance: "Phụ cấp",
  bonus: "Thưởng",
  penalty: "Phạt",
  attendance: "Nghỉ không lương",
  deduction: "Khấu trừ khác",
  adjustment: "Điều chỉnh",
};

/** `jsonb` hằng cho bảng nhãn trên — tra trong SQL để giữ gom nhóm set-based. */
export function itemTypeLabelsJson(): SQL {
  return sql`${JSON.stringify(PAYROLL_ITEM_TYPE_LABELS)}::jsonb`;
}

/**
 * CTE `struct` (phụ thuộc `pub`) — cơ cấu khoản theo khoá `(mã thành phần | item_type) × chiều (dấu)`.
 * Nhãn: v2 = `min(label)` theo mã (nhãn cột của MẪU, không riêng người); v1 = bảng hằng. Tỉ trọng tính trong chiều.
 */
export function incomeStructureCte(companyId: string): SQL {
  return sql`struct_raw as (
    select pi.meta->>'componentCode' as component_code,
           pi.item_type,
           -- khoá gom phụ: khoản v1 (không mã) gom theo loại; khoản v2 gom theo MÃ (loại đi theo mã).
           case when pi.meta->>'componentCode' is null then pi.item_type end as v1_item_type,
           case when pi.amount >= 0 then 'income' else 'deduction' end as direction,
           case when pi.meta->>'componentCode' is null then null else pi.label end as v2_label,
           abs(pi.amount) as amount
      from payslip_items pi
      join pub on pub.payslip_id = pi.payslip_id
     where pi.company_id = ${companyId}::uuid
       and pi.amount <> 0
  ),
  struct as (
    select component_code,
           coalesce(v1_item_type, min(item_type)) as item_type,
           direction,
           coalesce(min(v2_label), ${itemTypeLabelsJson()} ->> coalesce(v1_item_type, min(item_type))) as label,
           sum(amount) as total_amount
      from struct_raw
     group by component_code, v1_item_type, direction
  ),
  struct_share as (
    select s.*,
           round(s.total_amount * 100 / nullif(sum(s.total_amount) over (partition by s.direction), 0), 2)
             as share_pct
      from struct s
  )`;
}

/** `rows` của `tx.execute` — driver trả `{ rows }`, một số đường trả mảng trần. */
export function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];
}
