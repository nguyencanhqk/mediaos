import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/** Một khoản thưởng/phạt ĐÃ KHOÁ (`FOR UPDATE`) — dùng chung cho tiền của dòng VÀ BIND (plan BE-2 §4 bước 7 · B4). */
export interface PickedBonusPenalty {
  id: string;
  userId: string;
  kind: "bonus" | "penalty";
  /** `numeric` ⇒ chuỗi. S15-PAYROLL-BE-3: tổng đi vào `SYS_BONUS_AMOUNT`/`SYS_PENALTY_AMOUNT` ở TS (decimal.js). */
  amount: string;
}

/** Một khoản tạm ứng `Approved` ĐÃ KHOÁ (`FOR UPDATE`) — cùng khuôn thưởng/phạt (plan BE-3 §4.9). */
export interface PickedAdvance {
  id: string;
  userId: string;
  amount: string;
}

/** Hàng ghi của `upsertLinesTx` — tiền là CHUỖI scale 2 (ép `numeric` từ text trong SQL, không qua số thực JSON). */
export interface PayrollLineWrite {
  userId: string;
  salaryProfileId: string;
  workDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  lateMinutes: number;
  inputSnapshot: Record<string, unknown>;
  componentValues: Record<string, unknown>;
  baseAmount: string;
  allowanceAmount: string;
  bonusAmount: string;
  penaltyAmount: string;
  deductionAmount: string;
  gross: string;
  templateFingerprint: string;
  grossUpIterations: number | null;
}

/** Hàng dòng lương thô đọc từ DB (numeric về JS là CHUỖI — chuyển ở biên DTO, không tính trên nó). */
export interface PayrollLineRow {
  id: string;
  payroll_period_id: string;
  user_id: string;
  salary_profile_id: string | null;
  work_days: string;
  present_days: string;
  paid_leave_days: string;
  unpaid_leave_days: string;
  late_minutes: number;
  base_amount: string;
  allowance_amount: string;
  bonus_amount: string;
  penalty_amount: string;
  deduction_amount: string;
  adjustment_amount: string;
  adjustment_reason: string | null;
  gross: string;
  net: string;
  /** v2 (mig 0570) — `{}` cho dòng v1; dòng v2 mang khoá `components` (S15-PAYROLL-BE-3). */
  component_values_json?: Record<string, unknown> | null;
  template_fingerprint?: string | null;
  gross_up_iterations?: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  /** `tx.execute<T>` đòi T mở rộng `Record<string, unknown>` — hàng thô của pg vốn là vậy. */
  [key: string]: unknown;
}

export interface PayrollPeriodSummaryRow {
  payroll_period_id: string;
  period_month: string;
  status: string;
  headcount: number;
  total_gross: string;
  total_net: string;
  /** `tx.execute<T>` đòi T mở rộng `Record<string, unknown>` — hàng thô của pg vốn là vậy. */
  [key: string]: unknown;
}

const rowCount = (res: unknown): number => Number((res as { rowCount?: number }).rowCount ?? 0);

/**
 * S13-PAYROLL-BE-2 — `PayrollCalcRepository`: máy tính lương (`PAYROLL-API-007`) + đọc dòng (008/018)
 * + điều chỉnh tay (009) + nguồn export (017).
 *
 * 🔁 **S15-PAYROLL-BE-3 (máy tính v2):** công thức SQL cứng của v1 ĐÃ GỠ (owner O-1 15/09 — kỳ không mẫu ⇒ 409 023).
 * Giá trị từng thành phần tính ở máy công thức TS (`formula/formula.line.ts`, decimal.js, số học CHÍNH XÁC — v1 làm
 * tròn sai 0,01 ở ca hoà nửa xu); file này chỉ GHI kết quả.
 *
 * ── BA LUẬT CẤP FILE, phá là mất tiền ─────────────────────────────────────────────────────────────
 *
 * **L1 — CLAMP `net` Ở SQL** (SPEC-11 §3.9 · `clamp-must-be-sql-not-js`). `net = GREATEST(round(gross − deduction +
 * adjustment, 2), 0)` nằm trong câu lệnh ở CẢ HAI nhánh của UPSERT và ở 009 — `adjustment` sống ở DB, TS không có nó.
 *
 * **L2 — SET-BASED, MỘT CÂU cho cả kỳ.** Cấm vòng lặp per-người ghi DB (NFR §19: 500 NV < 5s). Dòng đi vào qua
 * `jsonb_to_recordset` (không phải N câu lệnh).
 *
 * **L3 — `ON CONFLICT` PHẢI kèm vế `WHERE deleted_at IS NULL`.** Unique
 * `payroll_period_lines_period_user_uq` là **PARTIAL** (`db/schema/payroll.ts`); `ON CONFLICT
 * (a,b,c)` trần không suy ra được index nào ⇒ **42P10 lúc chạy** (không phải lúc typecheck). Hệ quả
 * thứ hai của partial: hàng XOÁ MỀM **không nằm trong index** nên `DO UPDATE` KHÔNG BAO GIỜ chạm nó —
 * hồi sinh điều chỉnh tay phải làm ở nhánh INSERT bằng `LEFT JOIN LATERAL old` (§5 🩹B6), viết
 * `deleted_at = NULL` trong `DO UPDATE SET` là **code chết** đội lốt "đã lo hồi sinh".
 *
 * ── THỨ TỰ KHOÁ (plan BE-3 R6) ────────────────────────────────────────────────────────────────────
 * khoá catalog dùng chung → kỳ FOR UPDATE → bản tỉ lệ FOR SHARE → nhả consume → thưởng/phạt + tạm ứng FOR UPDATE → ghi.
 * Trigger `bonus_penalty_freeze_guard` (0574 nhánh F) và `payroll_advance_freeze_guard` (0572) đọc kỳ FOR SHARE —
 * cùng tx đang giữ FOR UPDATE nên không tự xung đột; đảo «ghi consume trước khoá kỳ» là nguy cơ 40P01.
 */
@Injectable()
export class PayrollCalcRepository {
  /**
   * NHẢ consume thưởng/phạt của CHÍNH kỳ này trước khi tính lại.
   *
   * ⚠️ Set **CẢ CẶP** `payroll_period_id` + `consumed_at` về NULL: `bonus_penalties_consumed_pair_check`
   * ràng hai cột đi đôi, set một vế là `23514` = **500 ở vùng đỏ**. Chỉ đụng hàng của kỳ này —
   * nhánh (C) của trigger `bonus_penalty_freeze_guard` cho `x → NULL` nhưng CẤM re-bind sang kỳ khác.
   */
  async releaseConsumedTx(tx: TenantTx, companyId: string, periodId: string): Promise<number> {
    const res = await tx.execute(sql`
      update bonus_penalties
         set payroll_period_id = null, consumed_at = null
       where company_id = ${companyId}::uuid
         and payroll_period_id = ${periodId}::uuid
    `);
    return rowCount(res);
  }

  /**
   * NHẢ tạm ứng đã khấu trừ ở CHÍNH kỳ này (plan BE-3 §3.5): `Deducted → Approved` + NULL CẢ CẶP trong CÙNG câu.
   * CHECK `payroll_advances_consume_status_check` (`payroll_period_id IS NULL OR status = 'Deducted'`) và nhánh (E) của
   * trigger `payroll_advance_freeze_guard` chỉ cho ĐÚNG hình dạng này — nhả một vế là 23514.
   */
  async releaseAdvancesTx(tx: TenantTx, companyId: string, periodId: string): Promise<number> {
    const res = await tx.execute(sql`
      update payroll_advances
         set status = 'Approved', payroll_period_id = null, consumed_at = null
       where company_id = ${companyId}::uuid
         and payroll_period_id = ${periodId}::uuid
         and status = 'Deducted'
    `);
    return rowCount(res);
  }

  /**
   * **KHOÁ TẬP KHOẢN MỘT LẦN** (`FOR UPDATE`), trả về đúng tập id dùng cho CẢ tiền của dòng LẪN `BIND`.
   *
   * Đây là lý do tồn tại của cả khối, không phải tối ưu (plan BE-2 §4 🩹B4). Thiếu nó:
   *  (a) khoản **xoá mềm** vẫn được cộng (lọc `deleted_at IS NULL` phải nằm ở ĐÂY, một chỗ);
   *  (b) khoản của nhân sự **không có hồ sơ lương** bị consume vĩnh viễn mà không ai được trả — tiền
   *      biến mất khỏi mọi kỳ, im lặng (`eligibleUserIds` chặn);
   *  (c) READ COMMITTED: một khoản được duyệt **giữa** lúc cộng và lúc bind sẽ bị bind nhưng không vào
   *      tiền ⇒ nhân viên mất tiền, không log, không lỗi.
   */
  async lockPickedBonusPenaltiesTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
    eligibleUserIds: readonly string[],
  ): Promise<PickedBonusPenalty[]> {
    if (eligibleUserIds.length === 0) return [];
    const res = await tx.execute<{ id: string; user_id: string; kind: string; amount: string }>(sql`
      select bp.id, bp.user_id, bp.kind, bp.amount
        from bonus_penalties bp
       where bp.company_id = ${companyId}::uuid
         and bp.status = 'Approved'
         and bp.period_month = ${periodMonth}
         and bp.payroll_period_id is null
         and bp.deleted_at is null
         and bp.user_id = any(${sql.param(eligibleUserIds as string[])}::uuid[])
       order by bp.id
         for update
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return (list as { id: string; user_id: string; kind: string; amount: string }[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
      kind: r.kind as "bonus" | "penalty",
      amount: r.amount,
    }));
  }

  /** Khuôn `lockPickedBonusPenaltiesTx` cho tạm ứng: `Approved` · đúng tháng khấu trừ · chưa gắn · sống · người đủ điều kiện. */
  async lockPickedAdvancesTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
    eligibleUserIds: readonly string[],
  ): Promise<PickedAdvance[]> {
    if (eligibleUserIds.length === 0) return [];
    const res = await tx.execute<{ id: string; user_id: string; amount: string }>(sql`
      select pa.id, pa.user_id, pa.amount
        from payroll_advances pa
       where pa.company_id = ${companyId}::uuid
         and pa.status = 'Approved'
         and pa.deduct_period_month = ${periodMonth}
         and pa.payroll_period_id is null
         and pa.deleted_at is null
         and pa.user_id = any(${sql.param(eligibleUserIds as string[])}::uuid[])
       order by pa.id
         for update
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return (list as { id: string; user_id: string; amount: string }[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
      amount: r.amount,
    }));
  }

  /**
   * **MỘT câu `INSERT … ON CONFLICT DO UPDATE`** dựng/làm mới toàn bộ bảng lương nháp từ kết quả máy công thức.
   *
   * Hai nhánh (INSERT / DO UPDATE) cho **cùng một công thức đóng** `net = GREATEST(gross − deduction + adjustment, 0)`;
   * khác nhau đúng một điểm: nhánh INSERT lấy `adjustment_*` từ hàng xoá mềm cũ (hồi sinh — B6), nhánh UPDATE giữ
   * nguyên `adjustment_*` của hàng SỐNG (SPEC-11 §13.4 · nghiệm thu §20.17).
   */
  async upsertLinesTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    lines: readonly PayrollLineWrite[],
    actorUserId: string,
  ): Promise<number> {
    if (lines.length === 0) return 0;
    const linesJson = JSON.stringify(
      lines.map((l) => ({
        user_id: l.userId,
        salary_profile_id: l.salaryProfileId,
        // Ngày công cũng đi dạng CHUỖI scale 2 như tiền (database-review BE-3 MEDIUM): số JSON là double — nguồn hôm nay
        // là `numeric(8,2)` đọc thẳng nên chưa lệch, nhưng một phép tính ngày ở TS về sau sẽ đưa đuôi float vào `numeric`.
        work_days: l.workDays.toFixed(2),
        present_days: l.presentDays.toFixed(2),
        paid_leave_days: l.paidLeaveDays.toFixed(2),
        unpaid_leave_days: l.unpaidLeaveDays.toFixed(2),
        late_minutes: l.lateMinutes,
        input_snapshot_json: l.inputSnapshot,
        component_values_json: l.componentValues,
        base_amount: l.baseAmount,
        allowance_amount: l.allowanceAmount,
        bonus_amount: l.bonusAmount,
        penalty_amount: l.penaltyAmount,
        deduction_amount: l.deductionAmount,
        gross: l.gross,
        template_fingerprint: l.templateFingerprint,
        gross_up_iterations: l.grossUpIterations,
      })),
    );
    const res = await tx.execute(sql`
      insert into payroll_period_lines (
        company_id, payroll_period_id, user_id, salary_profile_id,
        work_days, present_days, paid_leave_days, unpaid_leave_days, late_minutes,
        input_snapshot_json, component_values_json, template_fingerprint, gross_up_iterations,
        base_amount, allowance_amount, bonus_amount, penalty_amount, deduction_amount,
        adjustment_amount, adjustment_reason, gross, net, created_by, updated_by)
      select
        ${companyId}::uuid, ${periodId}::uuid, i.user_id, i.salary_profile_id,
        i.work_days, i.present_days, i.paid_leave_days, i.unpaid_leave_days, i.late_minutes,
        i.input_snapshot_json, i.component_values_json, i.template_fingerprint, i.gross_up_iterations,
        i.base_amount, i.allowance_amount, i.bonus_amount, i.penalty_amount, i.deduction_amount,
        coalesce(old.adjustment_amount, 0), old.adjustment_reason,
        i.gross,
        greatest(round(i.gross - i.deduction_amount + coalesce(old.adjustment_amount, 0), 2), 0),
        ${actorUserId}::uuid, ${actorUserId}::uuid
      from jsonb_to_recordset(${linesJson}::jsonb)
        as i(user_id uuid, salary_profile_id uuid,
             work_days numeric, present_days numeric, paid_leave_days numeric,
             unpaid_leave_days numeric, late_minutes int,
             input_snapshot_json jsonb, component_values_json jsonb,
             base_amount numeric, allowance_amount numeric, bonus_amount numeric,
             penalty_amount numeric, deduction_amount numeric, gross numeric,
             template_fingerprint text, gross_up_iterations int)
      -- 🩹B6 Hàng ĐÃ XOÁ MỀM của cùng (kỳ, người): partial unique loại nó khỏi 'ON CONFLICT', nên phải
      --      mang 'adjustment_*' sang nhánh INSERT bằng tay — kẻo nhân sự quay lại đủ điều kiện là
      --      MẤT khoản điều chỉnh đã nhập, im lặng.
      left join lateral (
        select pl.adjustment_amount, pl.adjustment_reason
          from payroll_period_lines pl
         where pl.company_id = ${companyId}::uuid
           and pl.payroll_period_id = ${periodId}::uuid
           and pl.user_id = i.user_id
           and pl.deleted_at is not null
         order by pl.deleted_at desc
         limit 1
      ) old on true
      on conflict (company_id, payroll_period_id, user_id) where deleted_at is null
      do update set
        salary_profile_id     = excluded.salary_profile_id,
        work_days             = excluded.work_days,
        present_days          = excluded.present_days,
        paid_leave_days       = excluded.paid_leave_days,
        unpaid_leave_days     = excluded.unpaid_leave_days,
        late_minutes          = excluded.late_minutes,
        -- Nêu TƯỜNG MINH: cột NOT NULL + CHECK, bỏ sót là snapshot của lượt tính TRƯỚC.
        input_snapshot_json   = excluded.input_snapshot_json,
        component_values_json = excluded.component_values_json,
        template_fingerprint  = excluded.template_fingerprint,
        gross_up_iterations   = excluded.gross_up_iterations,
        base_amount           = excluded.base_amount,
        allowance_amount      = excluded.allowance_amount,
        bonus_amount          = excluded.bonus_amount,
        penalty_amount        = excluded.penalty_amount,
        deduction_amount      = excluded.deduction_amount,
        gross                 = excluded.gross,
        -- GIỮ NGUYÊN điều chỉnh tay của hàng SỐNG — xoá trắng là mất tiền người dùng nhập.
        adjustment_amount     = payroll_period_lines.adjustment_amount,
        adjustment_reason     = payroll_period_lines.adjustment_reason,
        net                   = greatest(round(excluded.gross - excluded.deduction_amount
                                               + payroll_period_lines.adjustment_amount, 2), 0),
        updated_at            = now(),
        updated_by            = ${actorUserId}::uuid
    `);
    return rowCount(res);
  }

  /**
   * **xoá MỀM** dòng của nhân sự không còn đủ điều kiện (bất biến #2: không hard-delete).
   * `keepUserIds` rỗng ⇒ xoá mềm toàn bộ dòng sống của kỳ (`= any('{}')` không khớp ai).
   */
  async softDeleteStaleLinesTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    keepUserIds: readonly string[],
    actorUserId: string,
  ): Promise<number> {
    const res = await tx.execute(sql`
      update payroll_period_lines
         set deleted_at = now(), deleted_by = ${actorUserId}::uuid
       where company_id = ${companyId}::uuid
         and payroll_period_id = ${periodId}::uuid
         and deleted_at is null
         and not (user_id = any(${sql.param(keepUserIds as string[])}::uuid[]))
    `);
    return rowCount(res);
  }

  /** BIND consume thưởng/phạt ĐÚNG tập đã khoá (cả cặp, không một vế). */
  async bindConsumedTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    pickedIds: readonly string[],
  ): Promise<number> {
    if (pickedIds.length === 0) return 0;
    const res = await tx.execute(sql`
      update bonus_penalties
         set payroll_period_id = ${periodId}::uuid, consumed_at = now()
       where company_id = ${companyId}::uuid
         and id = any(${sql.param(pickedIds as string[])}::uuid[])
    `);
    return rowCount(res);
  }

  /**
   * BIND tạm ứng ĐÚNG tập đã khoá: `status = 'Deducted'` + cặp gắn kỳ trong CÙNG câu (plan BE-3 §3.5). Giữ `Approved`
   * mà gắn kỳ = 23514 `payroll_advances_consume_status_check`.
   */
  async bindAdvancesTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    pickedIds: readonly string[],
  ): Promise<number> {
    if (pickedIds.length === 0) return 0;
    const res = await tx.execute(sql`
      update payroll_advances
         set status = 'Deducted', payroll_period_id = ${periodId}::uuid, consumed_at = now()
       where company_id = ${companyId}::uuid
         and id = any(${sql.param(pickedIds as string[])}::uuid[])
    `);
    return rowCount(res);
  }

  /** 009 — điều chỉnh tay MỘT dòng; `net` TÍNH LẠI Ở SQL (plan §4b bước 5 · B5). 0 hàng ⇒ caller 404. */
  async adjustLineTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    lineId: string,
    patch: { amount: number; reason: string | null },
    actorUserId: string,
  ): Promise<PayrollLineRow | null> {
    const res = await tx.execute<PayrollLineRow>(sql`
      update payroll_period_lines
         set adjustment_amount = ${patch.amount.toFixed(2)}::numeric,
             adjustment_reason = ${patch.reason},
             -- Thiếu vế này ⇒ 'generate-payslips' copy 'net' CŨ ⇒ phiếu lương sai tiền và đẳng thức
             -- SUM(items) = gross − deduction + adjustment vỡ.
             net = greatest(round(gross - deduction_amount + ${patch.amount.toFixed(2)}::numeric, 2), 0),
             updated_by = ${actorUserId}::uuid,
             updated_at = now()
       where company_id = ${companyId}::uuid
         and payroll_period_id = ${periodId}::uuid
         and id = ${lineId}::uuid
         and deleted_at is null
      returning *
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return ((list as PayrollLineRow[])[0] ?? null) as PayrollLineRow | null;
  }

  /** 008 — dòng bảng lương của kỳ (chỉ hàng SỐNG). Thứ tự ổn định theo `user_id`. */
  async listLinesTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    filter: { userId?: string },
    limit: number,
    offset: number,
  ): Promise<PayrollLineRow[]> {
    const byUser = filter.userId ? sql`and pl.user_id = ${filter.userId}::uuid` : sql``;
    const res = await tx.execute<PayrollLineRow>(sql`
      select pl.*
        from payroll_period_lines pl
       where pl.company_id = ${companyId}::uuid
         and pl.payroll_period_id = ${periodId}::uuid
         and pl.deleted_at is null
         ${byUser}
       order by pl.user_id
       limit ${limit} offset ${offset}
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return list as PayrollLineRow[];
  }

  async countLinesTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    filter: { userId?: string },
  ): Promise<number> {
    const byUser = filter.userId ? sql`and pl.user_id = ${filter.userId}::uuid` : sql``;
    const res = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
        from payroll_period_lines pl
       where pl.company_id = ${companyId}::uuid
         and pl.payroll_period_id = ${periodId}::uuid
         and pl.deleted_at is null
         ${byUser}
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return Number((list as { n: number }[])[0]?.n ?? 0);
  }

  /**
   * 018 — tổng chi phí của kỳ **MỚI NHẤT** (`period_month` lớn nhất, chưa xoá mềm).
   *
   * Công ty **chưa có kỳ nào** ⇒ trả `null` ⇒ service trả **200 + `data: null`** (KHÔNG 404): widget
   * DASH phải phân biệt được «chưa có kỳ» với «không có quyền».
   */
  async latestSummaryTx(tx: TenantTx, companyId: string): Promise<PayrollPeriodSummaryRow | null> {
    const res = await tx.execute<PayrollPeriodSummaryRow>(sql`
      with p as (
        select id, period_month, status
          from payroll_periods
         where company_id = ${companyId}::uuid and deleted_at is null
         order by period_month desc, id
         limit 1
      )
      select p.id                                    as payroll_period_id,
             p.period_month,
             p.status,
             coalesce(count(pl.id), 0)::int          as headcount,
             coalesce(sum(pl.gross), 0)::numeric(18,2) as total_gross,
             coalesce(sum(pl.net), 0)::numeric(18,2)   as total_net
        from p
        left join payroll_period_lines pl
          on pl.company_id = ${companyId}::uuid
         and pl.payroll_period_id = p.id
         and pl.deleted_at is null
       group by p.id, p.period_month, p.status
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return ((list as PayrollPeriodSummaryRow[])[0] ?? null) as PayrollPeriodSummaryRow | null;
  }

  /** 017 — TOÀN BỘ dòng sống của kỳ (không phân trang). Trần kiểm ở service ⇒ 422 `016`. */
  async allLinesForExportTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
  ): Promise<PayrollLineRow[]> {
    const res = await tx.execute<PayrollLineRow>(sql`
      select pl.*
        from payroll_period_lines pl
       where pl.company_id = ${companyId}::uuid
         and pl.payroll_period_id = ${periodId}::uuid
         and pl.deleted_at is null
       order by pl.user_id
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return list as PayrollLineRow[];
  }
}
