import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import type { PayrollInputSnapshotMeta, PayrollUserInputs } from "./payroll.types";

/** Một khoản thưởng/phạt ĐÃ KHOÁ (`FOR UPDATE`) — dùng chung cho SUM và BIND (plan §4 bước 7 · B4). */
export interface PickedBonusPenalty {
  id: string;
  userId: string;
  kind: "bonus" | "penalty";
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

/**
 * S13-PAYROLL-BE-2 — `PayrollCalcRepository`: máy tính lương (`PAYROLL-API-007`) + đọc dòng (008/018)
 * + điều chỉnh tay (009) + nguồn export (017).
 *
 * ── BA LUẬT CẤP FILE, phá là mất tiền ─────────────────────────────────────────────────────────────
 *
 * **L1 — TIỀN TÍNH Ở SQL, KHÔNG Ở JS** (SPEC-11 §13.4 · `clamp-must-be-sql-not-js`). Pro-rate · làm
 * tròn · `LEAST`/`GREATEST` · `net` đều nằm trong câu lệnh. `numeric(18,2)` không có biểu diễn chính
 * xác trong `double` của JS: `22000000 * 20 / 22` ở JS ra `19999999.999999996`. Không có `Number()`
 * nào ở đường tính.
 *
 * **L2 — SET-BASED, MỘT CÂU cho cả kỳ.** Cấm vòng lặp per-người (NFR §19: 500 NV < 5s), cấm câu
 * aggregation thứ hai cho cùng đại lượng — `PayrollInputsRepository.computeInputsTx` là định nghĩa
 * DUY NHẤT của năm đại lượng đầu vào; ở đây chỉ tiêu thụ.
 *
 * **L3 — `ON CONFLICT` PHẢI kèm vế `WHERE deleted_at IS NULL`.** Unique
 * `payroll_period_lines_period_user_uq` là **PARTIAL** (`db/schema/payroll.ts:248-250`); `ON CONFLICT
 * (a,b,c)` trần không suy ra được index nào ⇒ **42P10 lúc chạy** (không phải lúc typecheck). Hệ quả
 * thứ hai của partial: hàng XOÁ MỀM **không nằm trong index** nên `DO UPDATE` KHÔNG BAO GIỜ chạm nó —
 * hồi sinh điều chỉnh tay phải làm ở nhánh INSERT bằng `LEFT JOIN LATERAL old` (§5 🩹B6), viết
 * `deleted_at = NULL` trong `DO UPDATE SET` là **code chết** đội lốt "đã lo hồi sinh".
 *
 * ── CÔNG THỨC (QUYẾT ĐỊNH OWNER 2026-09-01, plan §0b) ─────────────────────────────────────────────
 *
 *   prorate      = LEAST((present_days + unpaid_leave_days) / work_days, 1)
 *   base_amount  = round(base_salary × prorate, 2)
 *   dailyRate    = base_salary / work_days
 *   deduction    = round(penalty + unpaid_leave_days × dailyRate, 2)
 *   gross        = round(base_amount + allowance + bonus, 2)
 *   net          = GREATEST(round(gross − deduction + adjustment, 2), 0)
 *
 * **TỬ SỐ gồm `unpaid_leave_days`** (phương án B). `present_days` ĐÃ LOẠI ngày nghỉ không lương
 * (`payroll-inputs.repository.ts` — `present = att ∪ (lv WHERE paid)`), nên pro-rate theo `present`
 * rồi lại trừ `unpaid × dailyRate` là **trừ HAI LẦN**: mất `base × unpaid / work` mỗi người mỗi kỳ,
 * im lặng, không CHECK nào bắt. Cộng `unpaid` vào tử số trả lại đúng phần đó, và vế khấu trừ được giữ
 * để phiếu lương còn dòng «nghỉ không lương −N ngày» giải thích được (PAY-DEC-004).
 *
 * ⚠️ Phương án B chỉ đúng khi ba đại lượng ngày mang ngữ nghĩa **thập phân nửa ngày**
 * (`S13-PAYROLL-BE-1B`): với ngữ nghĩa nguyên-ngày, một ngày nửa-làm/nửa-nghỉ-không-lương cho
 * `present = 1` VÀ `unpaid = 1` ⇒ tử số vượt mẫu số (trần `LEAST(…,1)` che mất, số vẫn sai).
 *
 * **KHÔNG có vế khấu trừ theo phút trễ ở v1** (quyết định owner O2): SPEC-11 §13.4 viết "trễ/sớm
 * (**nếu bật rule** ATT)" nhưng `companies.payroll_config_json` (mig `0015`) chỉ có `{cutoffDay,
 * payDay}` — không tồn tại rule nào để bật. `late_minutes` vẫn ghi vào dòng + snapshot để giải thích.
 */
@Injectable()
export class PayrollCalcRepository {
  /**
   * Bước 5 — **NHẢ consume của CHÍNH kỳ này** trước khi tính lại.
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
    return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
  }

  /**
   * Bước 7 — **KHOÁ TẬP KHOẢN MỘT LẦN** (`FOR UPDATE`), trả về đúng tập id dùng cho CẢ `SUM` (bước 8)
   * LẪN `BIND` (bước 10).
   *
   * Đây là lý do tồn tại của cả khối, không phải tối ưu (plan §4 🩹B4). Thiếu nó:
   *  (a) khoản **xoá mềm** vẫn được cộng (lọc `deleted_at IS NULL` phải nằm ở ĐÂY, một chỗ);
   *  (b) khoản của nhân sự **không có hồ sơ lương** bị consume vĩnh viễn mà không ai được trả — tiền
   *      biến mất khỏi mọi kỳ, im lặng (`eligibleUserIds` chặn);
   *  (c) READ COMMITTED: một khoản được duyệt **giữa** bước 8 và bước 10 sẽ bị bind nhưng không vào
   *      `bonus_amount` ⇒ nhân viên mất tiền, không log, không lỗi.
   */
  async lockPickedBonusPenaltiesTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
    eligibleUserIds: readonly string[],
  ): Promise<PickedBonusPenalty[]> {
    if (eligibleUserIds.length === 0) return [];
    const res = await tx.execute<{ id: string; user_id: string; kind: string }>(sql`
      select bp.id, bp.user_id, bp.kind
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
    return (list as { id: string; user_id: string; kind: string }[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
      kind: r.kind as "bonus" | "penalty",
    }));
  }

  /**
   * Bước 8 — **MỘT câu `INSERT … ON CONFLICT DO UPDATE`** dựng/làm mới toàn bộ bảng lương nháp.
   *
   * `inputs` đi vào SQL qua `jsonb_to_recordset` (không phải N câu lệnh); tổng thưởng/phạt đi vào qua
   * `picked` — CHÍNH tập đã khoá ở bước 7, KHÔNG query lại `bonus_penalties`.
   *
   * Hai nhánh (INSERT / DO UPDATE) phải cho **cùng một công thức đóng**
   * `net = GREATEST(gross − deduction + adjustment, 0)`; khác nhau đúng một điểm: nhánh INSERT lấy
   * `adjustment_*` từ hàng xoá mềm cũ (hồi sinh — B6), nhánh UPDATE giữ nguyên `adjustment_*` của hàng
   * SỐNG (SPEC-11 §13.4 · nghiệm thu §20.17). Có unit test đối chiếu hai nhánh.
   */
  async upsertLinesTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    args: {
      lastDay: string;
      inputs: readonly PayrollUserInputs[];
      snapshotMeta: PayrollInputSnapshotMeta;
      picked: readonly PickedBonusPenalty[];
      actorUserId: string;
    },
  ): Promise<number> {
    const inputsJson = JSON.stringify(
      args.inputs.map((i) => ({
        user_id: i.userId,
        work_days: i.workDays,
        present_days: i.presentDays,
        paid_leave_days: i.paidLeaveDays,
        unpaid_leave_days: i.unpaidLeaveDays,
        late_minutes: i.lateMinutes,
      })),
    );
    const pickedJson = JSON.stringify(
      args.picked.map((p) => ({ id: p.id, user_id: p.userId, kind: p.kind })),
    );
    const res = await tx.execute(sql`
      with picked as (
        select p.id, p.user_id, p.kind, bp.amount
          from jsonb_to_recordset(${pickedJson}::jsonb) as p(id uuid, user_id uuid, kind text)
          join bonus_penalties bp
            on bp.id = p.id and bp.company_id = ${companyId}::uuid
      ),
      bp as (
        select user_id,
               coalesce(sum(amount) filter (where kind = 'bonus'), 0)   as bonus,
               coalesce(sum(amount) filter (where kind = 'penalty'), 0) as penalty
          from picked
         group by user_id
      )
      insert into payroll_period_lines (
        company_id, payroll_period_id, user_id, salary_profile_id,
        work_days, present_days, paid_leave_days, unpaid_leave_days, late_minutes,
        input_snapshot_json, base_amount, allowance_amount, bonus_amount, penalty_amount,
        deduction_amount, adjustment_amount, adjustment_reason, gross, net, created_by, updated_by)
      select
        ${companyId}::uuid, ${periodId}::uuid, i.user_id, sp.id,
        i.work_days, i.present_days, i.paid_leave_days, i.unpaid_leave_days, i.late_minutes,
        ${JSON.stringify(args.snapshotMeta)}::jsonb || jsonb_build_object('inputs', to_jsonb(i)),
        base.amt, allw.amt, coalesce(bp.bonus, 0), coalesce(bp.penalty, 0),
        ded.amt,
        coalesce(old.adjustment_amount, 0), old.adjustment_reason,
        round(base.amt + allw.amt + coalesce(bp.bonus, 0), 2)                                as gross,
        greatest(round(base.amt + allw.amt + coalesce(bp.bonus, 0)
                       - ded.amt + coalesce(old.adjustment_amount, 0), 2), 0)                as net,
        ${args.actorUserId}::uuid, ${args.actorUserId}::uuid
      from jsonb_to_recordset(${inputsJson}::jsonb)
        as i(user_id uuid, work_days numeric, present_days numeric,
             paid_leave_days numeric, unpaid_leave_days numeric, late_minutes int)
      -- Hồ sơ lương HIỆU LỰC tại ngày cuối kỳ (SPEC-11 §13.4 bước 5). INNER LATERAL ⇒ nhân sự không có
      -- hồ sơ hiệu lực **không sinh dòng** (họ là 'missing-salary-profile' của readiness, không phải 0đ).
      join lateral (
        select sp2.id, sp2.base_salary, sp2.allowances
          from salary_profiles sp2
         where sp2.company_id = ${companyId}::uuid
           and sp2.user_id = i.user_id
           and sp2.deleted_at is null
           and sp2.effective_date <= ${args.lastDay}::date
         order by sp2.effective_date desc, sp2.id
         limit 1
      ) sp on true
      left join bp on bp.user_id = i.user_id
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
      -- O1 — TỬ SỐ = present + unpaid (phương án B). 'NULLIF' chặn chia-0; work_days = 0 đã bị service
      -- chặn từ trước bằng 422 PAYROLL-ERR-009, vế này chỉ là phòng thủ chiều sâu.
      cross join lateral (
        select round(sp.base_salary
                     * least((i.present_days + i.unpaid_leave_days) / nullif(i.work_days, 0), 1), 2) as amt
      ) base
      -- Phụ cấp: tổng 'amount' trong 'salary_profiles.allowances' (mảng {name, amount}); NULL/rỗng ⇒ 0.
      cross join lateral (
        select coalesce((
          select sum((a ->> 'amount')::numeric)
            from jsonb_array_elements(coalesce(sp.allowances, '[]'::jsonb)) a
        ), 0) as amt
      ) allw
      -- O1 + O2: khấu trừ = phạt + nghỉ-không-lương × đơn giá ngày. KHÔNG có vế trễ ở v1.
      cross join lateral (
        select round(coalesce(bp.penalty, 0)
                     + i.unpaid_leave_days * (sp.base_salary / nullif(i.work_days, 0)), 2) as amt
      ) ded
      on conflict (company_id, payroll_period_id, user_id) where deleted_at is null
      do update set
        salary_profile_id   = excluded.salary_profile_id,
        work_days           = excluded.work_days,
        present_days        = excluded.present_days,
        paid_leave_days     = excluded.paid_leave_days,
        unpaid_leave_days   = excluded.unpaid_leave_days,
        late_minutes        = excluded.late_minutes,
        -- Nêu TƯỜNG MINH: cột NOT NULL + CHECK '<> '{}'', bỏ sót là snapshot của lượt tính TRƯỚC.
        input_snapshot_json = excluded.input_snapshot_json,
        base_amount         = excluded.base_amount,
        allowance_amount    = excluded.allowance_amount,
        bonus_amount        = excluded.bonus_amount,
        penalty_amount      = excluded.penalty_amount,
        deduction_amount    = excluded.deduction_amount,
        gross               = excluded.gross,
        -- GIỮ NGUYÊN điều chỉnh tay của hàng SỐNG — xoá trắng là mất tiền người dùng nhập.
        adjustment_amount   = payroll_period_lines.adjustment_amount,
        adjustment_reason   = payroll_period_lines.adjustment_reason,
        net                 = greatest(round(excluded.gross - excluded.deduction_amount
                                             + payroll_period_lines.adjustment_amount, 2), 0),
        updated_at          = now(),
        updated_by          = ${args.actorUserId}::uuid
    `);
    return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
  }

  /**
   * Bước 9 — **xoá MỀM** dòng của nhân sự không còn đủ điều kiện (bất biến #2: không hard-delete).
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
    return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
  }

  /** Bước 10 — BIND consume ĐÚNG tập đã khoá ở bước 7 (cả cặp, không một vế). */
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
    return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
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
