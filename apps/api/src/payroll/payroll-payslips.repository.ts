import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/** Phiếu vừa sinh — id + chủ phiếu, đủ cho NOTI-023 (một event/phiếu) và audit. */
export interface GeneratedPayslipRef {
  id: string;
  userId: string;
}

/** Hàng `payslips` đọc thô + hai cột DẪN XUẤT ghép ở câu đọc. */
export interface PayslipRow {
  id: string;
  company_id: string;
  payroll_period_id: string;
  user_id: string;
  salary_profile_id: string | null;
  base_salary: string;
  total_allowances: string;
  bonus_amount: string;
  penalty_amount: string;
  deduction_amount: string;
  adjustment_amount: string;
  gross: string;
  net: string;
  work_days: string;
  present_days: string;
  paid_leave_days: string;
  unpaid_leave_days: string;
  late_minutes: number;
  created_by: string;
  created_at: Date | string;
  period_status: string;
  period_month: string;
  acknowledged_at: Date | string | null;
  /** `tx.execute<T>` đòi T mở rộng `Record<string, unknown>` — hàng thô của pg vốn là vậy. */
  [key: string]: unknown;
}

export interface PayslipItemRow {
  id: string;
  payslip_id: string;
  item_type: string;
  label: string;
  amount: string;
  sort_order: number;
  meta: Record<string, unknown> | null;
  created_at: Date | string;
  /** `tx.execute<T>` đòi T mở rộng `Record<string, unknown>` — hàng thô của pg vốn là vậy. */
  [key: string]: unknown;
}

/** Kỳ ĐÃ PHÁT HÀNH — chỉ hai trạng thái này mới cho nhân viên thấy phiếu của mình (SPEC-11 §13.2). */
const PUBLISHED_PERIOD_STATUSES = ["Paid", "Locked"];

/**
 * S13-PAYROLL-BE-2 — `payslips` · `payslip_items` · `payslip_acknowledgements`.
 *
 * ⚠️ **BA BẢNG APPEND-ONLY** (bất biến #2 — app role chỉ có SELECT + INSERT): không `UPDATE`, không
 * `DELETE`, không cột `deleted_at`. Sai sót sau phát hành xử lý bằng thưởng/phạt kỳ SAU, không phải
 * bằng sửa phiếu. Mọi câu ở đây vì thế chỉ có `insert` và `select`.
 *
 * ⚠️ `payslips.input_snapshot_json` **NOT NULL và KHÔNG DEFAULT** (cặp với CHECK `<> '{}'`): phải copy
 * TƯỜNG MINH từ dòng nháp. Để DEFAULT thì mọi INSERT bỏ trống cột sẽ ăn `23514` — DEFAULT thành giá
 * trị CHẾT.
 *
 * ⚠️ Trạng thái phiếu là **DẪN XUẤT**, không có cột: mọi câu đọc phải JOIN `payroll_periods` lấy
 * `status` và LEFT JOIN `payslip_acknowledgements` của CHÍNH chủ phiếu.
 */
@Injectable()
export class PayrollPayslipsRepository {
  /**
   * 013 bước 1 — copy ĐÓNG BĂNG từ dòng nháp sống sang `payslips`.
   *
   * **Đổi tên cột khi copy** (🩹B2): `base_amount → base_salary` · `allowance_amount →
   * total_allowances`; các cột còn lại giữ tên. Nhầm cặp này là phiếu lương sai tiền mà không CHECK
   * nào bắt (cả hai đều `numeric(18,2) >= 0`).
   *
   * Sinh phiếu lần hai ⇒ `23505` trên `payslips_period_user_uq` ⇒ caller map **409 `006`** và
   * rollback TOÀN BỘ transaction (không có phiếu nửa vời).
   */
  async generateFromLinesTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
    actorUserId: string,
  ): Promise<GeneratedPayslipRef[]> {
    const res = await tx.execute<{ id: string; user_id: string }>(sql`
      insert into payslips (
        company_id, payroll_period_id, user_id, salary_profile_id,
        base_salary, total_allowances, bonus_amount, penalty_amount, deduction_amount,
        adjustment_amount, gross, net,
        work_days, present_days, paid_leave_days, unpaid_leave_days, late_minutes,
        input_snapshot_json, created_by)
      select pl.company_id, pl.payroll_period_id, pl.user_id, pl.salary_profile_id,
             pl.base_amount, pl.allowance_amount, pl.bonus_amount, pl.penalty_amount,
             pl.deduction_amount, pl.adjustment_amount, pl.gross, pl.net,
             pl.work_days, pl.present_days, pl.paid_leave_days, pl.unpaid_leave_days, pl.late_minutes,
             pl.input_snapshot_json, ${actorUserId}::uuid
        from payroll_period_lines pl
       where pl.company_id = ${companyId}::uuid
         and pl.payroll_period_id = ${periodId}::uuid
         and pl.deleted_at is null
       order by pl.user_id
      returning id, user_id
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return (list as { id: string; user_id: string }[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
    }));
  }

  /**
   * 013 bước 2 — breakdown 7 loại, **`amount` CÓ DẤU**, chỉ sinh dòng ≠ 0 (§5b).
   *
   * | sort | item_type | nguồn | dấu |
   * | --- | --- | --- | --- |
   * | 10 | `earning`    | `base_salary` (đã pro-rate) | + |
   * | 20 | `allowance`  | `total_allowances`          | + |
   * | 30 | `bonus`      | `bonus_amount`              | + |
   * | 40 | `penalty`    | `penalty_amount`            | − |
   * | 50 | `attendance` | phần khấu trừ còn lại KHI có ngày nghỉ không lương | − |
   * | 60 | `deduction`  | phần khấu trừ còn lại KHI không có ngày nghỉ không lương | − |
   * | 70 | `adjustment` | `adjustment_amount`         | theo dấu người nhập |
   *
   * ⚠️ `rest = deduction_amount − penalty_amount`. `penalty` là **thành phần con** của
   * `deduction_amount` (xem công thức ở `PayrollCalcRepository`): sinh cả dòng 40 **lẫn** một dòng
   * `deduction` bằng CẢ `deduction_amount` là **đếm hai lần** ⇒ vỡ bất biến
   * `SUM(amount) = gross − deduction_amount + adjustment_amount`.
   *
   * ⚠️ 50 và 60 **loại trừ nhau** trên cùng một `rest` — không cộng dồn. Ở v1 (quyết định O2: không
   * trừ tiền theo phút trễ) `rest` chỉ có một nguồn là nghỉ không lương, nên 60 hầu như không xuất
   * hiện; hàng 60 vẫn giữ để đảo O2 về sau không phải sửa bản đồ này.
   */
  async insertItemsForPeriodTx(tx: TenantTx, companyId: string, periodId: string): Promise<number> {
    const res = await tx.execute(sql`
      with src as (
        select ps.id as payslip_id,
               ps.base_salary, ps.total_allowances, ps.bonus_amount, ps.penalty_amount,
               ps.deduction_amount, ps.adjustment_amount, ps.unpaid_leave_days,
               (ps.deduction_amount - ps.penalty_amount) as rest,
               pl.adjustment_reason
          from payslips ps
          join payroll_period_lines pl
            on pl.company_id = ps.company_id
           and pl.payroll_period_id = ps.payroll_period_id
           and pl.user_id = ps.user_id
           and pl.deleted_at is null
         where ps.company_id = ${companyId}::uuid
           and ps.payroll_period_id = ${periodId}::uuid
      ),
      items as (
        select payslip_id, 'earning'::text as item_type, 'Lương cơ bản (theo ngày công)'::text as label,
               base_salary as amount, 10 as sort_order from src where base_salary <> 0
        union all
        select payslip_id, 'allowance', 'Phụ cấp',
               total_allowances, 20 from src where total_allowances <> 0
        union all
        select payslip_id, 'bonus', 'Thưởng',
               bonus_amount, 30 from src where bonus_amount <> 0
        union all
        select payslip_id, 'penalty', 'Phạt',
               -penalty_amount, 40 from src where penalty_amount <> 0
        union all
        select payslip_id, 'attendance',
               'Nghỉ không lương (' || trim(to_char(unpaid_leave_days, 'FM9999990.00')) || ' ngày)',
               -rest, 50 from src where rest <> 0 and unpaid_leave_days > 0
        union all
        select payslip_id, 'deduction', 'Khấu trừ khác',
               -rest, 60 from src where rest <> 0 and unpaid_leave_days = 0
        union all
        select payslip_id, 'adjustment',
               'Điều chỉnh: ' || coalesce(adjustment_reason, 'không ghi lý do'),
               adjustment_amount, 70 from src where adjustment_amount <> 0
      )
      insert into payslip_items (company_id, payslip_id, item_type, label, amount, sort_order)
      select ${companyId}::uuid, payslip_id, item_type, label, amount, sort_order from items
    `);
    return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
  }

  /**
   * Bất biến `SUM(items) = gross − deduction_amount + adjustment_amount` cho MỌI phiếu của kỳ.
   * Trả về danh sách phiếu LỆCH (rỗng = đạt) — service ném khi khác rỗng, trong CÙNG transaction nên
   * cả lượt sinh phiếu bị rollback thay vì phát hành một breakdown không cộng ra `net`.
   */
  async findItemSumMismatchesTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
  ): Promise<Array<{ payslipId: string; expected: string; actual: string }>> {
    const res = await tx.execute<{ payslip_id: string; expected: string; actual: string }>(sql`
      select ps.id as payslip_id,
             (ps.gross - ps.deduction_amount + ps.adjustment_amount)::text as expected,
             coalesce(sum(pi.amount), 0)::text                             as actual
        from payslips ps
        left join payslip_items pi on pi.payslip_id = ps.id and pi.company_id = ps.company_id
       where ps.company_id = ${companyId}::uuid
         and ps.payroll_period_id = ${periodId}::uuid
       group by ps.id, ps.gross, ps.deduction_amount, ps.adjustment_amount
      having coalesce(sum(pi.amount), 0) <> (ps.gross - ps.deduction_amount + ps.adjustment_amount)
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return (list as { payslip_id: string; expected: string; actual: string }[]).map((r) => ({
      payslipId: r.payslip_id,
      expected: r.expected,
      actual: r.actual,
    }));
  }

  /** Có phiếu nào của kỳ chưa — cổng 409 `007` của `publish` (kỳ chưa sinh phiếu thì không phát hành). */
  async countByPeriodTx(tx: TenantTx, companyId: string, periodId: string): Promise<number> {
    const res = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from payslips
       where company_id = ${companyId}::uuid and payroll_period_id = ${periodId}::uuid
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return Number((list as { n: number }[])[0]?.n ?? 0);
  }

  /** Phiếu + chủ phiếu của cả kỳ — nguồn người nhận NOTI-023 (một event/phiếu, chèn theo lô). */
  async listRefsByPeriodTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
  ): Promise<GeneratedPayslipRef[]> {
    const res = await tx.execute<{ id: string; user_id: string }>(sql`
      select id, user_id from payslips
       where company_id = ${companyId}::uuid and payroll_period_id = ${periodId}::uuid
       order by user_id
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return (list as { id: string; user_id: string }[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
    }));
  }

  // ── Đọc (029 · 030 · 031 · 032) ─────────────────────────────────────────────────────────────

  /**
   * Câu đọc DÙNG CHUNG. `ownerUserId` khác `null` ⇒ **Own scope** (`/me/payslips*`): lọc theo chủ
   * phiếu **và** chỉ kỳ ĐÃ PHÁT HÀNH (`Paid`/`Locked`) — phiếu `Generated` chưa phát hành thì nhân
   * viên KHÔNG thấy (SPEC-11 §13.2). Cùng vị từ dùng cho list, detail và ack ⇒ không có đường nào
   * nhìn thấy phiếu qua một cửa mà cửa kia chặn.
   */
  private static selectPayslips(
    companyId: string,
    opts: {
      ownerUserId?: string | null;
      payslipId?: string;
      payrollPeriodId?: string;
      userId?: string;
    },
  ) {
    const own = opts.ownerUserId
      ? sql`and ps.user_id = ${opts.ownerUserId}::uuid
            and pp.status = any(${sql.param(PUBLISHED_PERIOD_STATUSES)}::text[])`
      : sql``;
    const byId = opts.payslipId ? sql`and ps.id = ${opts.payslipId}::uuid` : sql``;
    const byPeriod = opts.payrollPeriodId
      ? sql`and ps.payroll_period_id = ${opts.payrollPeriodId}::uuid`
      : sql``;
    const byUser = opts.userId ? sql`and ps.user_id = ${opts.userId}::uuid` : sql``;
    return sql`
      from payslips ps
      join payroll_periods pp
        on pp.id = ps.payroll_period_id and pp.company_id = ps.company_id and pp.deleted_at is null
      left join payslip_acknowledgements ack
        on ack.payslip_id = ps.id and ack.company_id = ps.company_id and ack.user_id = ps.user_id
     where ps.company_id = ${companyId}::uuid
       ${own} ${byId} ${byPeriod} ${byUser}
    `;
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    opts: { ownerUserId?: string | null; payrollPeriodId?: string; userId?: string },
    limit: number,
    offset: number,
  ): Promise<PayslipRow[]> {
    const res = await tx.execute<PayslipRow>(sql`
      select ps.*, pp.status as period_status, pp.period_month, ack.created_at as acknowledged_at
      ${PayrollPayslipsRepository.selectPayslips(companyId, opts)}
      -- Thứ tự ổn định: 'created_at' có ties thật (now() per-statement cho cả lô sinh phiếu).
      order by pp.period_month desc, ps.user_id, ps.id
      limit ${limit} offset ${offset}
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return list as PayslipRow[];
  }

  async countTx(
    tx: TenantTx,
    companyId: string,
    opts: { ownerUserId?: string | null; payrollPeriodId?: string; userId?: string },
  ): Promise<number> {
    const res = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
      ${PayrollPayslipsRepository.selectPayslips(companyId, opts)}
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return Number((list as { n: number }[])[0]?.n ?? 0);
  }

  /**
   * 030 · 032 — chi tiết. Phiếu của người khác trong Own scope ⇒ 0 hàng ⇒ caller trả **404 sentinel**
   * (KHÔNG 403): 403 nói cho người hỏi biết phiếu đó tồn tại.
   */
  async findTx(
    tx: TenantTx,
    companyId: string,
    payslipId: string,
    ownerUserId: string | null,
  ): Promise<PayslipRow | null> {
    const res = await tx.execute<PayslipRow>(sql`
      select ps.*, pp.status as period_status, pp.period_month, ack.created_at as acknowledged_at
      ${PayrollPayslipsRepository.selectPayslips(companyId, { payslipId, ownerUserId })}
      limit 1
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return ((list as PayslipRow[])[0] ?? null) as PayslipRow | null;
  }

  /**
   * 033 bước 1 — tra phiếu của CHÍNH chủ **KHÔNG lọc kỳ đã phát hành**.
   *
   * ⚠️ Cố ý khác `findTx`: nếu ack cũng lọc `Paid`/`Locked` thì phiếu chưa phát hành trả 0 hàng ⇒ 404,
   * và nhánh **`PAYROLL-ERR-015` «phiếu chưa phát hành»** trở thành mã CHẾT (SPEC-11 §12 khai đủ HAI
   * nhánh cho 015). Vế "của chính mình" VẪN ép ở đây — phiếu người khác vẫn 0 hàng ⇒ 404 sentinel.
   */
  async findOwnedForAckTx(
    tx: TenantTx,
    companyId: string,
    payslipId: string,
    ownerUserId: string,
  ): Promise<{ id: string; periodStatus: string } | null> {
    const res = await tx.execute<{ id: string; period_status: string }>(sql`
      select ps.id, pp.status as period_status
        from payslips ps
        join payroll_periods pp
          on pp.id = ps.payroll_period_id and pp.company_id = ps.company_id and pp.deleted_at is null
       where ps.company_id = ${companyId}::uuid
         and ps.id = ${payslipId}::uuid
         and ps.user_id = ${ownerUserId}::uuid
       limit 1
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    const row = (list as { id: string; period_status: string }[])[0];
    return row ? { id: row.id, periodStatus: row.period_status } : null;
  }

  /** Kỳ ĐÃ PHÁT HÀNH — dùng chung giữa cổng đọc Own và cổng ack (một định nghĩa, không hai). */
  static isPublishedPeriodStatus(status: string): boolean {
    return PUBLISHED_PERIOD_STATUSES.includes(status);
  }

  async itemsByPayslipIdTx(
    tx: TenantTx,
    companyId: string,
    payslipId: string,
  ): Promise<PayslipItemRow[]> {
    const res = await tx.execute<PayslipItemRow>(sql`
      select * from payslip_items
       where company_id = ${companyId}::uuid and payslip_id = ${payslipId}::uuid
       order by sort_order, id
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return list as PayslipItemRow[];
  }

  /**
   * 033 — xác nhận đã nhận phiếu. Sổ **CHỈ-INSERT**: hàng tồn tại = đã xác nhận (bảng không có cột
   * trạng thái). Xác nhận lần hai ⇒ `23505` trên `payslip_acknowledgements_payslip_user_uq` ⇒ caller
   * map **409 `015`**. Không `ON CONFLICT DO NOTHING`: nuốt lần hai thành 200 là nói dối người dùng.
   */
  async acknowledgeTx(
    tx: TenantTx,
    companyId: string,
    payslipId: string,
    userId: string,
  ): Promise<{ id: string; createdAt: Date | string }> {
    const res = await tx.execute<{ id: string; created_at: Date | string }>(sql`
      insert into payslip_acknowledgements (company_id, payslip_id, user_id)
      values (${companyId}::uuid, ${payslipId}::uuid, ${userId}::uuid)
      returning id, created_at
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    const row = (list as { id: string; created_at: Date | string }[])[0];
    return { id: row.id, createdAt: row.created_at };
  }
}
