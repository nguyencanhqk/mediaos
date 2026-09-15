import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PaymentBatchMethod, PaymentBatchStatus } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { payrollPaymentBatches, type PayrollPaymentBatch } from "../db/schema/payroll-disbursement";
import type { PaymentBatchRow, PaymentLineRow } from "./payroll-disbursement.mapper";
import { bankAccountLast4 } from "./payroll-disbursement.mapper";

export interface PaymentBatchListFilter {
  payrollPeriodId?: string;
  status?: PaymentBatchStatus[];
  method?: PaymentBatchMethod;
}

/** Ứng viên nạp dòng: phiếu của kỳ + cờ «đã có dòng sống ở đợt nào (toàn công ty)» + cờ «đủ cặp TK». */
export interface LineCandidate {
  payslipId: string;
  userId: string;
  /** chuỗi numeric — chỉ để phát hiện `zero-net`, KHÔNG đi vào audit/log. */
  net: string;
  hasLine: boolean;
  hasBank: boolean;
}

/** Dòng vừa ghi/gỡ — `last4` DẪN XUẤT trong bộ nhớ để audit; số đầy đủ KHÔNG rời repository. */
export interface LineTouch {
  userId: string;
  last4: string | null;
}

export interface LiveLine {
  id: string;
  userId: string;
  payslipId: string;
  paidAt: Date | string | null;
}

/** Hàng cho tệp UNC (071) — số TK ĐẦY ĐỦ, chỉ `PayrollPaymentExportService` được gọi. */
export interface ExportLine {
  user_id: string;
  net: string;
  bank_account_snapshot: string | null;
  bank_name_snapshot: string | null;
  account_holder_snapshot: string | null;
  [key: string]: unknown;
}

const rowsOf = <T>(res: unknown): T[] =>
  ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];
const rowCount = (res: unknown): number => Number((res as { rowCount?: number }).rowCount ?? 0);

/** snake_case → camelCase cho hàng đọc thô (chỉ dùng trên cột do file này SELECT tường minh). */
function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

/**
 * S15-PAYROLL-BE-4 — `payroll_payment_batches` + `payroll_payment_lines` (DB-13 §14.2 · §14.3, mig 0572).
 *
 * ── THỨ TỰ KHOÁ (DB-2 M5): kỳ `FOR UPDATE` (khi chạm kỳ) → đợt `FOR UPDATE` → RỒI MỚI ghi dòng. T2 đọc đợt
 *    `FOR SHARE` khi ghi dòng — cùng tx đang giữ `FOR UPDATE` ⇒ không tự xung đột; ghi dòng trước rồi UPDATE đợt là
 *    nâng khoá = 40P01. Service giữ thứ tự; repository chỉ cung cấp từng câu.
 * ── MỘT vị từ «phiếu của kỳ» (`payslipsOfPeriod`, plan-review C1): `payslips` append-only, KHÔNG có `deleted_at` —
 *    dùng CHUNG cho nạp dòng (067/069) LẪN luật PHỦ (072). Hai bản chép là hai luật phủ.
 * ── Số tài khoản: `insertLinesTx` chép snapshot **set-based từ `payroll_employee_settings`** (số TK KHÔNG là tham số câu
 *    SQL — không lọt `params` của DrizzleQueryError); đường đọc DTO chỉ nhận `last4`; bản đầy đủ CHỈ `linesForExportTx`.
 * BẤT BIẾN #1: mọi câu bind `company_id` tường minh. #2: gỡ dòng = `deleted_at`.
 */
@Injectable()
export class PayrollPaymentBatchesRepository {
  private static scope(companyId: string) {
    return and(
      eq(payrollPaymentBatches.companyId, companyId),
      isNull(payrollPaymentBatches.deletedAt),
    );
  }

  /** Vị từ DUY NHẤT «phiếu của kỳ» — C1. */
  private static payslipsOfPeriod(companyId: string, periodId: string): SQL {
    return sql`
      select ps.id, ps.user_id, ps.net, ps.company_id
        from payslips ps
       where ps.company_id = ${companyId}::uuid
         and ps.payroll_period_id = ${periodId}::uuid`;
  }

  // ── Đợt ───────────────────────────────────────────────────────────────────────────────────────

  async findTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<PayrollPaymentBatch | null> {
    const q = tx
      .select()
      .from(payrollPaymentBatches)
      .where(
        and(PayrollPaymentBatchesRepository.scope(companyId), eq(payrollPaymentBatches.id, id)),
      )
      .limit(1);
    const [row] = opts.forUpdate ? await q.for("update") : await q;
    return row ?? null;
  }

  /** 072 bước 0 — kỳ của đợt bằng SELECT thường TRƯỚC khi khoá kỳ (kỳ của đợt BẤT BIẾN nhờ T1 ⇒ đọc trước không đua). */
  async periodIdOfTx(tx: TenantTx, companyId: string, batchId: string): Promise<string | null> {
    const [row] = await tx
      .select({ periodId: payrollPaymentBatches.payrollPeriodId })
      .from(payrollPaymentBatches)
      .where(
        and(
          PayrollPaymentBatchesRepository.scope(companyId),
          eq(payrollPaymentBatches.id, batchId),
        ),
      )
      .limit(1);
    return row?.periodId ?? null;
  }

  private static statsSelect(companyId: string, where: SQL): SQL {
    return sql`
      select b.id, b.company_id, b.payroll_period_id, b.code, b.method, b.status, b.pay_date,
             b.completed_by, b.completed_at, b.note, b.created_at, b.created_by, b.updated_at, b.updated_by,
             b.deleted_at, b.deleted_by,
             pp.period_month,
             (select count(*)::int from payroll_payment_lines l
               where l.company_id = b.company_id and l.batch_id = b.id and l.deleted_at is null) as line_count,
             (select count(*)::int from payroll_payment_lines l
               where l.company_id = b.company_id and l.batch_id = b.id and l.deleted_at is null
                 and l.paid_at is not null) as paid_line_count,
             (select sum(ps.net) from payroll_payment_lines l
               join payslips ps on ps.company_id = l.company_id and ps.id = l.payslip_id
              where l.company_id = b.company_id and l.batch_id = b.id and l.deleted_at is null) as total_net
        from payroll_payment_batches b
        join payroll_periods pp on pp.company_id = b.company_id and pp.id = b.payroll_period_id
       where b.company_id = ${companyId}::uuid
         and b.deleted_at is null
         and ${where}`;
  }

  async findWithStatsTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<PaymentBatchRow | null> {
    const res = await tx.execute(
      PayrollPaymentBatchesRepository.statsSelect(companyId, sql`b.id = ${id}::uuid`),
    );
    const [row] = rowsOf<Record<string, unknown>>(res);
    return row ? camel<PaymentBatchRow>(row) : null;
  }

  private static filterSql(f: PaymentBatchListFilter): SQL {
    const conds: SQL[] = [sql`true`];
    if (f.payrollPeriodId) conds.push(sql`b.payroll_period_id = ${f.payrollPeriodId}::uuid`);
    if (f.status?.length) conds.push(sql`b.status = any(${sql.param(f.status)}::text[])`);
    if (f.method) conds.push(sql`b.method = ${f.method}`);
    return sql.join(conds, sql` and `);
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    f: PaymentBatchListFilter,
    limit: number,
    offset: number,
  ): Promise<PaymentBatchRow[]> {
    const res = await tx.execute(sql`${PayrollPaymentBatchesRepository.statsSelect(
      companyId,
      PayrollPaymentBatchesRepository.filterSql(f),
    )}
       order by pp.period_month desc, b.created_at desc, b.id desc
       limit ${limit} offset ${offset}`);
    return rowsOf<Record<string, unknown>>(res).map((r) => camel<PaymentBatchRow>(r));
  }

  async countTx(tx: TenantTx, companyId: string, f: PaymentBatchListFilter): Promise<number> {
    const res = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
        from payroll_payment_batches b
       where b.company_id = ${companyId}::uuid and b.deleted_at is null
         and ${PayrollPaymentBatchesRepository.filterSql(f)}`);
    return Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0);
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    input: {
      payrollPeriodId: string;
      code: string;
      method: PaymentBatchMethod;
      payDate: string | null;
      note: string | null;
    },
    actorUserId: string,
  ): Promise<PayrollPaymentBatch> {
    const [row] = await tx
      .insert(payrollPaymentBatches)
      .values({
        companyId,
        payrollPeriodId: input.payrollPeriodId,
        code: input.code,
        method: input.method,
        status: "Draft",
        payDate: input.payDate,
        note: input.note,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();
    return row;
  }

  /** 069 — `status` chỉ `Draft`/`Ready` (Zod riêng — B4) · `payDate` · `note`. Đợt `Completed` ⇒ T1 `frozen` (map 027). */
  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: { status?: "Draft" | "Ready"; payDate?: string | null; note?: string | null },
    actorUserId: string,
  ): Promise<PayrollPaymentBatch | null> {
    const [row] = await tx
      .update(payrollPaymentBatches)
      .set({ ...patch, updatedBy: actorUserId, updatedAt: new Date() })
      .where(
        and(PayrollPaymentBatchesRepository.scope(companyId), eq(payrollPaymentBatches.id, id)),
      )
      .returning();
    return row ?? null;
  }

  /** 072 — `Completed` + `completed_by/at` trong MỘT câu (CHECK `completed_pair`). */
  async completeTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    payDate: string | undefined,
    actorUserId: string,
  ): Promise<PayrollPaymentBatch | null> {
    const [row] = await tx
      .update(payrollPaymentBatches)
      .set({
        status: "Completed",
        completedBy: actorUserId,
        completedAt: new Date(),
        ...(payDate !== undefined ? { payDate } : {}),
        updatedBy: actorUserId,
        updatedAt: new Date(),
      })
      .where(
        and(PayrollPaymentBatchesRepository.scope(companyId), eq(payrollPaymentBatches.id, id)),
      )
      .returning();
    return row ?? null;
  }

  // ── Dòng ───────────────────────────────────────────────────────────────────────────────────────

  /**
   * Ứng viên nạp dòng = phiếu của kỳ (vị từ C1) ⋈ dòng sống TOÀN công ty (`payslip_uq` partial ⇒ ≤ 1) ⋈ settings.
   * `userIds` null ⇒ mọi phiếu của kỳ; có ⇒ chỉ những người đó (người không có phiếu ở kỳ sẽ VẮNG — service ⇒ 404).
   */
  async candidatesTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    userIds: readonly string[] | null,
  ): Promise<LineCandidate[]> {
    const res = await tx.execute<Record<string, unknown>>(sql`
      with p as (${PayrollPaymentBatchesRepository.payslipsOfPeriod(companyId, periodId)})
      select p.id as payslip_id, p.user_id, p.net,
             (l.id is not null) as has_line,
             (s.bank_account_number is not null and s.bank_name is not null and s.account_holder is not null) as has_bank
        from p
        left join payroll_payment_lines l
               on l.company_id = p.company_id and l.payslip_id = p.id and l.deleted_at is null
        left join payroll_employee_settings s
               on s.company_id = p.company_id and s.user_id = p.user_id and s.deleted_at is null
       where ${userIds ? sql`p.user_id = any(${sql.param(userIds as string[])}::uuid[])` : sql`true`}
       order by p.user_id`);
    return rowsOf<Record<string, unknown>>(res).map((r) => ({
      payslipId: String(r["payslip_id"]),
      userId: String(r["user_id"]),
      net: String(r["net"]),
      hasLine: Boolean(r["has_line"]),
      hasBank: Boolean(r["has_bank"]),
    }));
  }

  /**
   * INSERT … SELECT set-based: snapshot TK chép TỪ settings NGAY trong câu (số TK KHÔNG là tham số). `cash` ⇒ ba snapshot
   * NULL. `payslip_uq`/`batch_user_uq` (23505) và tag T2 map ở service qua `mappedLineWrite`.
   */
  async insertLinesTx(
    tx: TenantTx,
    companyId: string,
    batch: { id: string; method: string },
    payslipIds: readonly string[],
    actorUserId: string,
  ): Promise<LineTouch[]> {
    if (payslipIds.length === 0) return [];
    const isBank = batch.method === "bank";
    const res = await tx.execute<Record<string, unknown>>(sql`
      insert into payroll_payment_lines
        (company_id, batch_id, user_id, payslip_id,
         bank_account_snapshot, bank_name_snapshot, account_holder_snapshot, created_by, updated_by)
      select ps.company_id, ${batch.id}::uuid, ps.user_id, ps.id,
             case when ${isBank} then s.bank_account_number end,
             case when ${isBank} then s.bank_name end,
             case when ${isBank} then s.account_holder end,
             ${actorUserId}::uuid, ${actorUserId}::uuid
        from payslips ps
        left join payroll_employee_settings s
               on s.company_id = ps.company_id and s.user_id = ps.user_id and s.deleted_at is null
       where ps.company_id = ${companyId}::uuid
         and ps.id = any(${sql.param(payslipIds as string[])}::uuid[])
       order by ps.user_id
      returning user_id, bank_account_snapshot`);
    return rowsOf<Record<string, unknown>>(res).map((r) => ({
      userId: String(r["user_id"]),
      last4: bankAccountLast4((r["bank_account_snapshot"] as string | null) ?? null),
    }));
  }

  async liveLinesTx(tx: TenantTx, companyId: string, batchId: string): Promise<LiveLine[]> {
    const res = await tx.execute<Record<string, unknown>>(sql`
      select l.id, l.user_id, l.payslip_id, l.paid_at
        from payroll_payment_lines l
       where l.company_id = ${companyId}::uuid and l.batch_id = ${batchId}::uuid and l.deleted_at is null
       order by l.user_id`);
    return rowsOf<Record<string, unknown>>(res).map((r) => ({
      id: String(r["id"]),
      userId: String(r["user_id"]),
      payslipId: String(r["payslip_id"]),
      paidAt: (r["paid_at"] as Date | string | null) ?? null,
    }));
  }

  /** Xoá MỀM dòng sống CHƯA chi của những người trong tập (service đã chặn dòng `paid_at NOT NULL` — B1). */
  async softDeleteLinesTx(
    tx: TenantTx,
    companyId: string,
    batchId: string,
    userIds: readonly string[],
    actorUserId: string,
  ): Promise<LineTouch[]> {
    if (userIds.length === 0) return [];
    const res = await tx.execute<Record<string, unknown>>(sql`
      update payroll_payment_lines l
         set deleted_at = now(), deleted_by = ${actorUserId}::uuid, updated_by = ${actorUserId}::uuid, updated_at = now()
       where l.company_id = ${companyId}::uuid and l.batch_id = ${batchId}::uuid and l.deleted_at is null
         and l.paid_at is null
         and l.user_id = any(${sql.param(userIds as string[])}::uuid[])
      returning l.user_id, l.bank_account_snapshot`);
    return rowsOf<Record<string, unknown>>(res).map((r) => ({
      userId: String(r["user_id"]),
      last4: bankAccountLast4((r["bank_account_snapshot"] as string | null) ?? null),
    }));
  }

  /** `paid_at = now()` cho dòng sống CHƯA chi; `userIds` null ⇒ MỌI dòng (072 `confirmAllPaid`). Trả user đã lật. */
  async markPaidTx(
    tx: TenantTx,
    companyId: string,
    batchId: string,
    userIds: readonly string[] | null,
    actorUserId: string,
  ): Promise<string[]> {
    const res = await tx.execute<Record<string, unknown>>(sql`
      update payroll_payment_lines l
         set paid_at = now(), updated_by = ${actorUserId}::uuid, updated_at = now()
       where l.company_id = ${companyId}::uuid and l.batch_id = ${batchId}::uuid and l.deleted_at is null
         and l.paid_at is null
         and ${userIds ? sql`l.user_id = any(${sql.param(userIds as string[])}::uuid[])` : sql`true`}
      returning l.user_id`);
    return rowsOf<Record<string, unknown>>(res).map((r) => String(r["user_id"]));
  }

  async lineCountsTx(
    tx: TenantTx,
    companyId: string,
    batchId: string,
  ): Promise<{ live: number; unpaid: number }> {
    const res = await tx.execute<{ live: number; unpaid: number }>(sql`
      select count(*)::int as live, count(*) filter (where paid_at is null)::int as unpaid
        from payroll_payment_lines l
       where l.company_id = ${companyId}::uuid and l.batch_id = ${batchId}::uuid and l.deleted_at is null`);
    const row = rowsOf<{ live: number; unpaid: number }>(res)[0];
    return { live: Number(row?.live ?? 0), unpaid: Number(row?.unpaid ?? 0) };
  }

  /**
   * LUẬT PHỦ (SPEC-11 §13.1): số phiếu của kỳ CHƯA có dòng sống thuộc đợt `Completed` sống cùng kỳ. Đếm DƯỚI khoá kỳ
   * (service). Cùng vị từ C1 với `candidatesTx`. `NOT EXISTS` đi qua `payroll_payment_lines_payslip_uq` (company, payslip).
   */
  async uncoveredPayeesTx(tx: TenantTx, companyId: string, periodId: string): Promise<number> {
    const res = await tx.execute<{ n: number }>(sql`
      with p as (${PayrollPaymentBatchesRepository.payslipsOfPeriod(companyId, periodId)})
      select count(*)::int as n
        from p
       where not exists (
         select 1
           from payroll_payment_lines l
           join payroll_payment_batches b
             on b.company_id = l.company_id and b.id = l.batch_id
            and b.deleted_at is null and b.status = 'Completed'
            and b.payroll_period_id = ${periodId}::uuid
          where l.company_id = p.company_id and l.payslip_id = p.id and l.deleted_at is null)`);
    return Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0);
  }

  /** 070 — dòng sống ⋈ `payslips.net`, phân trang; mapper chỉ phát `last4`. */
  async linesPageTx(
    tx: TenantTx,
    companyId: string,
    batchId: string,
    limit: number,
    offset: number,
  ): Promise<PaymentLineRow[]> {
    const res = await tx.execute<Record<string, unknown>>(sql`
      select l.id, l.company_id, l.batch_id, l.user_id, l.payslip_id,
             l.bank_account_snapshot, l.bank_name_snapshot, l.account_holder_snapshot, l.paid_at,
             l.created_at, l.created_by, l.updated_at, l.updated_by, l.deleted_at, l.deleted_by,
             ps.net
        from payroll_payment_lines l
        join payslips ps on ps.company_id = l.company_id and ps.id = l.payslip_id
       where l.company_id = ${companyId}::uuid and l.batch_id = ${batchId}::uuid and l.deleted_at is null
       order by l.user_id
       limit ${limit} offset ${offset}`);
    return rowsOf<Record<string, unknown>>(res).map((r) => camel<PaymentLineRow>(r));
  }

  async countLinesTx(tx: TenantTx, companyId: string, batchId: string): Promise<number> {
    return (await this.lineCountsTx(tx, companyId, batchId)).live;
  }

  /** 071 — TOÀN BỘ dòng sống kèm số TK ĐẦY ĐỦ. CHỈ `PayrollPaymentExportService` (ba cặp + audit) được gọi. */
  async linesForExportTx(tx: TenantTx, companyId: string, batchId: string): Promise<ExportLine[]> {
    const res = await tx.execute<ExportLine>(sql`
      select l.user_id, ps.net, l.bank_account_snapshot, l.bank_name_snapshot, l.account_holder_snapshot
        from payroll_payment_lines l
        join payslips ps on ps.company_id = l.company_id and ps.id = l.payslip_id
       where l.company_id = ${companyId}::uuid and l.batch_id = ${batchId}::uuid and l.deleted_at is null
       order by l.user_id`);
    return rowsOf<ExportLine>(res);
  }

  /** Số dòng bị một câu ghi chạm — tiện ích cho ca race/đột biến. */
  static affected(res: unknown): number {
    return rowCount(res);
  }
}
