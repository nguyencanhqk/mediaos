import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import type { ParsedAdjustmentRow } from "./payroll-adjustments-import.columns";

const rowsOf = <T>(res: unknown): T[] =>
  ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];

/**
 * S15-PAYROLL-BE-4 — ba câu DB của `PAYROLL-API-076` (import thu nhập/khấu trừ khác → `bonus_penalties` `Pending`).
 *
 * · `employee_code` đọc từ `employee_profiles` (KHÔNG phải cột danh tính của `users` — ratchet chiều 6 `rawSqlIdentity`,
 *   plan R5); hồ sơ sống, `user_id NOT NULL`; unique partial `employee_profiles_company_code_active_uq` bảo đảm ≤ 1/mã.
 * · INSERT set-based `unnest` — MỘT câu cho cả tệp (toàn tệp hoặc không dòng nào — 030). `Pending` + `created_by = actor`;
 *   KHÔNG mang cặp consume ⇒ trigger (F) 0574 không bắn; CHECK four-eyes 0575 chỉ soi `Approved`.
 * BẤT BIẾN #1: mọi câu bind `company_id`.
 */
@Injectable()
export class PayrollAdjustmentImportRepository {
  /** `employee_code` (so KHÔNG phân biệt hoa/thường) → `user_id`; mã không có ⇒ vắng trong map. */
  async resolveEmployeeCodesTx(
    tx: TenantTx,
    companyId: string,
    codes: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (codes.length === 0) return out;
    const res = await tx.execute<{ employee_code: string; user_id: string }>(sql`
      select ep.employee_code, ep.user_id
        from employee_profiles ep
       where ep.company_id = ${companyId}::uuid
         and ep.deleted_at is null
         and ep.user_id is not null
         and lower(ep.employee_code) = any(${sql.param(codes.map((c) => c.toLowerCase()))}::text[])`);
    for (const r of rowsOf<{ employee_code: string; user_id: string }>(res)) {
      out.set(r.employee_code.toLowerCase(), r.user_id);
    }
    return out;
  }

  /**
   * C6 — số dòng tệp trùng `(user, kind, amount, period_month)` với một khoản `Pending` sống đã có (nạp cùng tệp hai lần) —
   * chỉ để cảnh báo `possible-duplicate:<n>`, KHÔNG chặn (còn cổng duyệt).
   */
  async countPendingDuplicatesTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
    rows: ReadonlyArray<{ userId: string; kind: string; amount: string }>,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const res = await tx.execute<{ n: number }>(sql`
      with f as (
        select * from unnest(
          ${sql.param(rows.map((r) => r.userId))}::uuid[],
          ${sql.param(rows.map((r) => r.kind))}::text[],
          ${sql.param(rows.map((r) => r.amount))}::numeric[]
        ) as t(user_id, kind, amount)
      )
      select count(*)::int as n
        from f
       where exists (
         select 1 from bonus_penalties bp
          where bp.company_id = ${companyId}::uuid
            and bp.user_id = f.user_id and bp.kind = f.kind and bp.amount = f.amount
            and bp.period_month = ${periodMonth}
            and bp.status = 'Pending' and bp.deleted_at is null)`);
    return Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0);
  }

  /** Ghi MỘT câu — mọi dòng `Pending`, `created_by = actor`; trả số dòng ghi. */
  async insertPendingTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
    rows: ReadonlyArray<ParsedAdjustmentRow & { userId: string }>,
    actorUserId: string,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const res = await tx.execute<{ id: string }>(sql`
      insert into bonus_penalties
        (company_id, user_id, kind, amount, period_month, reason, status, created_by, updated_by)
      select ${companyId}::uuid, t.user_id, t.kind, t.amount, ${periodMonth}, t.reason, 'Pending',
             ${actorUserId}::uuid, ${actorUserId}::uuid
        from unnest(
          ${sql.param(rows.map((r) => r.userId))}::uuid[],
          ${sql.param(rows.map((r) => r.kind))}::text[],
          ${sql.param(rows.map((r) => r.amount))}::numeric[],
          ${sql.param(rows.map((r) => r.reason))}::text[]
        ) as t(user_id, kind, amount, reason)
      returning id`);
    return rowsOf<{ id: string }>(res).length;
  }
}
