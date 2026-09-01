import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import type { PayrollInputSnapshotMeta, PayrollUserInputs } from "./payroll.types";

/**
 * Luật đếm ngày công — **QUYẾT ĐỊNH OWNER 2026-09-01** (plan §0b O1). SPEC-11 §13.4 chốt 5 đại lượng
 * nhưng để ngỏ "bản ghi công HỢP LỆ" là những `status` nào; con số này là **tử số pro-rate** nên nó
 * quyết thẳng vào tiền lương ⇒ không phải chi tiết thi công, phải là quyết định owner.
 *
 * Đi trễ / về sớm **vẫn tính đủ ngày công** vì đã bị trừ riêng qua `late_minutes` — trừ hai lần là sai.
 * `pending_adjustment` chưa duyệt ⇒ chưa tính; `approved_adjustment` đã duyệt ⇒ tính.
 *
 * Ghi nguyên văn vào `input_snapshot_json.presentDaysRule` để nhiều tháng sau còn đối chiếu được.
 */
export const PRESENT_DAYS_RULE =
  "attendance_records.status IN ('present','late','early_leave','approved_adjustment') AND deleted_at IS NULL (owner 2026-09-01)";

const VALID_ATTENDANCE_STATUSES = ["present", "late", "early_leave", "approved_adjustment"];

/** CHECK `leave_req_status_check` (mig `0453`) là **UNION hoa/thường** — lọc một dạng là mất một nửa. */
const APPROVED_LEAVE_STATUSES = ["approved", "Approved"];

export interface PayrollPeriodInputs {
  /** Hằng CHUNG cả kỳ — mẫu số pro-rate. */
  workDays: number;
  /** Một hàng cho mỗi nhân sự CÓ dữ liệu công/phép trong kỳ. */
  rows: PayrollUserInputs[];
  meta: PayrollInputSnapshotMeta;
}

/**
 * S13-PAYROLL-BE-1 — `PayrollInputsRepository`: **năm đại lượng đầu vào** của SPEC-11 §13.4, tính
 * hoàn toàn ở SQL, một câu set-based cho cả kỳ (KHÔNG vòng lặp per-người ở JS — NFR §19: 500 NV < 5s).
 *
 * ⚠️ **CHỈ ĐỌC — 0 câu ghi.** `readiness` (006, BE-1) và `calculate` (007, BE-2) dùng CHUNG hàm này:
 * hai bản aggregation = hai định nghĩa tiền.
 *
 * Ba bẫy đã đóng, đừng "tối giản" mất:
 *  1. `companies.working_days_json` có hình dạng `{"days":[…]}` (mig `0015`) — **khác**
 *     `work_schedules.working_days_json` vốn là mảng TRẦN (mig `0061`). Quên khoá `'days'` ⇒
 *     `work_days = 0` ⇒ CẢ CÔNG TY rơi 422 PAYROLL-ERR-009.
 *  2. `public_holidays.company_id` **NULLABLE** — hàng lễ quốc gia có `company_id IS NULL` (mig `0434`);
 *     lọc `= $companyId` là **mất toàn bộ lễ quốc gia**.
 *  3. `leave_requests.status` là **UNION hoa/thường** (mig `0453`).
 */
@Injectable()
export class PayrollInputsRepository {
  /**
   * @param periodMonth `YYYY-MM`. Biên kỳ cắt Ở BE theo **tháng công ty** (UTC-at-rest — FE không có
   *   `companies.timezone`): `[月-01, 月-01 + 1 month)`.
   */
  async computeInputsTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
  ): Promise<PayrollPeriodInputs> {
    const firstDay = `${periodMonth}-01`;

    /**
     * `cal_work` = tập ngày LÀM VIỆC của kỳ (lịch công ty − ngày lễ). Dùng cho CẢ mẫu số `work_days`
     * LẪN việc bung ngày nghỉ, để tử số và mẫu số cùng một cơ sở.
     *
     * Ngày nghỉ phép **giao** với `cal_work` (đơn nghỉ bắc qua cuối tuần không đẻ ra ngày phép ma);
     * ngày CÔNG thì **không** giao — bản ghi công là bằng chứng làm việc thật, kể cả ngày nghỉ
     * (làm thêm thứ Bảy). Vì thế `present_days` CÓ THỂ vượt `work_days`, và đó đúng là lý do SPEC-11
     * §13.4 bắt clamp `LEAST(present_days / NULLIF(work_days,0), 1)` **ở SQL** khi tính (BE-2).
     */
    const rows = await tx.execute<{
      user_id: string;
      work_days: number;
      present_days: number;
      paid_leave_days: number;
      unpaid_leave_days: number;
      late_minutes: number;
    }>(sql`
      with bounds as (
        select ${firstDay}::date as d0, (${firstDay}::date + interval '1 month')::date as d1
      ),
      cal as (
        select gs::date as d
          from bounds, generate_series(bounds.d0, bounds.d1 - interval '1 day', interval '1 day') gs
      ),
      company_dow as (
        -- ⚠️ khoá 'days' — KHÔNG phải work_schedules (mảng trần).
        select (jsonb_array_elements_text(c.working_days_json -> 'days'))::int as dow
          from companies c
         where c.id = ${companyId} and c.working_days_json is not null
      ),
      hol as (
        select distinct h.holiday_date as d
          from public_holidays h, bounds
         where (h.company_id = ${companyId} or h.company_id is null)   -- lễ quốc gia: company_id NULL
           and h.status = 'Active'
           and h.deleted_at is null
           and h.holiday_type <> 'WorkingDayOverride'                  -- ngày LÀM BÙ: trừ nó là trừ ngược
           and h.is_paid_holiday = true
           and h.holiday_date >= bounds.d0 and h.holiday_date < bounds.d1
      ),
      cal_work as (
        select cal.d
          from cal
         where extract(isodow from cal.d)::int in (select dow from company_dow)
           and cal.d not in (select d from hol)
      ),
      work_days as (select count(*)::int as n from cal_work),
      att as (
        select ar.user_id,
               ar.work_date as d,
               (ar.late_minutes + ar.early_leave_minutes)::int as mins
          from attendance_records ar, bounds
         where ar.company_id = ${companyId}
           and ar.deleted_at is null
           and ar.work_date >= bounds.d0 and ar.work_date < bounds.d1
           and ar.status = any(${sql.param(VALID_ATTENDANCE_STATUSES)}::text[])
      ),
      lv as (
        select lr.user_id, cw.d, lt.paid
          from leave_requests lr
          join leave_types lt
            on lt.id = lr.leave_type_id and lt.company_id = ${companyId}
          join cal_work cw
            on cw.d >= lr.start_date and cw.d <= lr.end_date
         where lr.company_id = ${companyId}
           and lr.deleted_at is null
           and lr.status = any(${sql.param(APPROVED_LEAVE_STATUSES)}::text[])
      ),
      -- Tập ngày "có mặt" = ngày công ∪ ngày nghỉ CÓ LƯƠNG. UNION (không ALL) ⇒ một ngày vừa có bản
      -- ghi công vừa có phép nửa buổi có lương chỉ đếm **MỘT** lần. Cộng hai COUNT rời là +2/ngày.
      present as (
        select user_id, d from att
        union
        select user_id, d from lv where paid = true
      ),
      people as (
        select user_id from att union select user_id from lv
      )
      select p.user_id,
             (select n from work_days)                                              as work_days,
             coalesce((select count(*) from present pr where pr.user_id = p.user_id), 0)::int
                                                                                     as present_days,
             coalesce((select count(distinct l.d) from lv l
                        where l.user_id = p.user_id and l.paid = true), 0)::int      as paid_leave_days,
             coalesce((select count(distinct l.d) from lv l
                        where l.user_id = p.user_id and l.paid = false), 0)::int     as unpaid_leave_days,
             coalesce((select sum(a.mins) from att a where a.user_id = p.user_id), 0)::int
                                                                                     as late_minutes
        from people p
    `);

    const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
    const parsed = (list as PayrollInputsRow[]).map((r) => ({
      userId: r.user_id,
      workDays: Number(r.work_days ?? 0),
      presentDays: Number(r.present_days ?? 0),
      paidLeaveDays: Number(r.paid_leave_days ?? 0),
      unpaidLeaveDays: Number(r.unpaid_leave_days ?? 0),
      lateMinutes: Number(r.late_minutes ?? 0),
    }));

    const meta = await this.snapshotMetaTx(tx, companyId, periodMonth);
    return { workDays: meta.workDays, rows: parsed, meta };
  }

  /**
   * Nguồn của các con số — nhét vào `input_snapshot_json` (SPEC-11 §13.4: "cả năm đại lượng PHẢI có
   * mặt kèm nguồn"). Chạy riêng vì `computeInputsTx` trả **0 hàng** khi không ai có dữ liệu, mà
   * `work_days` vẫn phải biết (mẫu số là hằng của kỳ, không phải của người).
   */
  async snapshotMetaTx(
    tx: TenantTx,
    companyId: string,
    periodMonth: string,
  ): Promise<PayrollInputSnapshotMeta> {
    const firstDay = `${periodMonth}-01`;
    const res = await tx.execute<{
      working_days: number[] | null;
      holidays: string[] | null;
      work_days: number;
    }>(sql`
      with bounds as (
        select ${firstDay}::date as d0, (${firstDay}::date + interval '1 month')::date as d1
      ),
      cal as (
        select gs::date as d
          from bounds, generate_series(bounds.d0, bounds.d1 - interval '1 day', interval '1 day') gs
      ),
      company_dow as (
        select (jsonb_array_elements_text(c.working_days_json -> 'days'))::int as dow
          from companies c
         where c.id = ${companyId} and c.working_days_json is not null
      ),
      hol as (
        select distinct h.holiday_date as d
          from public_holidays h, bounds
         where (h.company_id = ${companyId} or h.company_id is null)
           and h.status = 'Active'
           and h.deleted_at is null
           and h.holiday_type <> 'WorkingDayOverride'
           and h.is_paid_holiday = true
           and h.holiday_date >= bounds.d0 and h.holiday_date < bounds.d1
      ),
      cal_work as (
        select cal.d from cal
         where extract(isodow from cal.d)::int in (select dow from company_dow)
           and cal.d not in (select d from hol)
      )
      select (select coalesce(array_agg(dow order by dow), '{}') from company_dow)          as working_days,
             (select coalesce(array_agg(to_char(d, 'YYYY-MM-DD') order by d), '{}') from hol) as holidays,
             (select count(*)::int from cal_work)                                            as work_days
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    const row = (list as MetaRow[])[0];
    return {
      workingDays: (row?.working_days ?? []).map(Number),
      holidaysExcluded: row?.holidays ?? [],
      presentDaysRule: PRESENT_DAYS_RULE,
      periodMonth,
      workDays: Number(row?.work_days ?? 0),
    };
  }
}

interface PayrollInputsRow {
  user_id: string;
  work_days: number | string | null;
  present_days: number | string | null;
  paid_leave_days: number | string | null;
  unpaid_leave_days: number | string | null;
  late_minutes: number | string | null;
}

interface MetaRow {
  working_days: number[] | null;
  holidays: string[] | null;
  work_days: number | string | null;
}
