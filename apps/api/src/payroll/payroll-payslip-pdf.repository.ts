import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { PayrollAccessService } from "./payroll-access.service";
import type { PayslipItemRow, PayslipRow } from "./payroll-payslips.repository";
import { rowsOf } from "./payroll-report.sql";
import type { PayrollActor } from "./payroll.types";

/**
 * S15-PAYROLL-BE-5B — đọc cho PDF phiếu lương (083–085). Mọi câu có `company_id` TƯỜNG MINH trên TỪNG bảng
 * (kể cả `companies` — RLS của nó đọc chéo tenant, memory BE-5 B5). Chỉ đọc snapshot, không tính lại.
 */

export interface PdfPeriodRow {
  id: string;
  period_month: string;
  [key: string]: unknown;
}

/** Vân tay tập phiếu của kỳ — `payslips` append-only, chỉ có `created_at` (plan §0b B1). */
export interface PayslipSetFingerprint {
  count: number;
  fingerprint: string;
}

/**
 * Tương đương `actor.peopleVisibleCond` nhưng viết trên `ps.user_id` TƯỜNG MINH — câu có nhiều bảng, còn cột của
 * drizzle nhúng vào `sql` thô có thể render không kèm tên bảng (memory `drizzle-sql-template-renders-columns-unqualified`).
 */
function visibleOwner(actor: PayrollActor): SQL {
  return PayrollAccessService.isCompany(actor.routeScope)
    ? sql`true`
    : sql`ps.user_id = ${actor.actorUserId}::uuid`;
}

@Injectable()
export class PayrollPayslipPdfRepository {
  async companyNameTx(tx: TenantTx, companyId: string): Promise<string> {
    const res = await tx.execute<{ name: string }>(sql`
      select c.name from companies c
       where c.id = ${companyId}::uuid and c.deleted_at is null
       limit 1
    `);
    const row = rowsOf<{ name: string }>(res)[0];
    // Công ty của chính caller luôn tồn tại (RLS + auth) — vắng là dữ liệu hỏng, KHÔNG in phiếu vô danh.
    if (!row) throw new Error(`payslip-pdf: không đọc được công ty ${companyId}`);
    return row.name;
  }

  async periodTx(tx: TenantTx, companyId: string, periodId: string): Promise<PdfPeriodRow | null> {
    const res = await tx.execute<PdfPeriodRow>(sql`
      select pp.id, pp.period_month
        from payroll_periods pp
       where pp.company_id = ${companyId}::uuid
         and pp.id = ${periodId}::uuid
         and pp.deleted_at is null
       limit 1
    `);
    return rowsOf<PdfPeriodRow>(res)[0] ?? null;
  }

  /**
   * Số phiếu + vân tay của kỳ, CHỈ trên người mà actor thấy (sàn Company ⇒ mọi phiếu; AND tường minh để lô
   * không bao giờ rộng hơn phạm vi của actor — plan §0b).
   */
  async payslipSetFingerprintTx(
    tx: TenantTx,
    actor: PayrollActor,
    periodId: string,
  ): Promise<PayslipSetFingerprint> {
    const res = await tx.execute<{ count: string | number; fp: string | null }>(sql`
      select count(*) as count,
             md5(coalesce(max(ps.created_at)::text, '') || ':' ||
                 coalesce(string_agg(ps.id::text, ',' order by ps.id), '')) as fp
        from payslips ps
       where ps.company_id = ${actor.companyId}::uuid
         and ps.payroll_period_id = ${periodId}::uuid
         and (${visibleOwner(actor)})
    `);
    const row = rowsOf<{ count: string | number; fp: string | null }>(res)[0];
    if (!row) throw new Error("payslip-pdf: câu đếm phiếu không trả hàng");
    return { count: Number(row.count), fingerprint: row.fp ?? "" };
  }

  /** Mọi phiếu của kỳ (cùng lọc với vân tay) — thứ tự ổn định theo id. */
  async batchPayslipsTx(
    tx: TenantTx,
    actor: PayrollActor,
    periodId: string,
  ): Promise<PayslipRow[]> {
    const res = await tx.execute<PayslipRow>(sql`
      select ps.*, pp.status as period_status, pp.period_month, null::timestamptz as acknowledged_at
        from payslips ps
        join payroll_periods pp
          on pp.id = ps.payroll_period_id and pp.company_id = ps.company_id and pp.deleted_at is null
       where ps.company_id = ${actor.companyId}::uuid
         and ps.payroll_period_id = ${periodId}::uuid
         and (${visibleOwner(actor)})
       order by ps.id
    `);
    return rowsOf<PayslipRow>(res);
  }

  /** Khoản của nhiều phiếu trong MỘT câu, xếp `payslip_id, sort_order, id`. */
  async itemsByPayslipIdsTx(
    tx: TenantTx,
    companyId: string,
    payslipIds: readonly string[],
  ): Promise<PayslipItemRow[]> {
    if (payslipIds.length === 0) return [];
    const res = await tx.execute<PayslipItemRow>(sql`
      select * from payslip_items
       where company_id = ${companyId}::uuid
         and payslip_id = any(${sql.param([...payslipIds])}::uuid[])
       order by payslip_id, sort_order, id
    `);
    return rowsOf<PayslipItemRow>(res);
  }

  /** Tuần tự hoá lấy-hoặc-tạo của MỘT người trên MỘT kỳ (nhả khi tx kết thúc — an toàn với PgBouncer tx-mode). */
  async lockBatchTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    userId: string,
  ): Promise<void> {
    const key = `payroll-pdf-batch:${companyId}:${periodId}:${userId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  }
}
