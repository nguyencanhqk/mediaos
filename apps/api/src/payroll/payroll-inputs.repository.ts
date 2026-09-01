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
  "attendance_records.status IN ('present','late','early_leave','approved_adjustment') AND deleted_at IS NULL" +
  " | ngày = LEAST(GREATEST(công_ngày, phép_có_lương_ngày), 1), phép đọc từ leave_request_days (Active)," +
  " fallback bung leave_requests 1.00/ngày khi đơn không có day-row (owner 2026-09-01, S13-PAYROLL-BE-1B)";

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
 *  4. **Số ngày nghỉ là THẬP PHÂN** (S13-PAYROLL-BE-1B): nguồn chốt là `leave_request_days.leave_days`
 *     (`numeric(8,2)` — 0.50 nửa buổi, 0.38 cho 3 giờ), KHÔNG phải `count(distinct ngày)` và KHÔNG phải
 *     `leave_requests.total_days` (`numeric(5,1)`, là con số của CẢ đơn nên đơn bắc qua biên tháng không
 *     quy kết được cho kỳ). Xem SPEC-11 §13.4 «Ngày nghỉ tính theo NỬA NGÀY».
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
      req as (
        select lr.id, lr.user_id, lr.start_date, lr.end_date, lt.paid
          from leave_requests lr
          join leave_types lt
            on lt.id = lr.leave_type_id and lt.company_id = ${companyId}
         where lr.company_id = ${companyId}
           and lr.deleted_at is null
           and lr.status = any(${sql.param(APPROVED_LEAVE_STATUSES)}::text[])
      ),
      -- Đơn CÓ day-row Active — đo trên TOÀN BỘ day-row của đơn, KHÔNG chỉ phần giao cal_work.
      -- Đo trên phần giao thì đơn có day-row nằm ngoài lịch PAYROLL (lịch LEAVE ≠ lịch PAYROLL, §13.4)
      -- bị coi là "không có day-row" ⇒ rơi vào fallback ⇒ ĐẺ RA ngày nghỉ mà chính LEAVE nói là không có.
      req_has_days as (
        select distinct d.leave_request_id
          from leave_request_days d
          join req r on r.id = d.leave_request_id
         where d.company_id = ${companyId} and d.deleted_at is null and d.status = 'Active'
      ),
      -- NGUỒN CHỐT (SPEC-11 §13.4): số ngày nghỉ THẬP PHÂN, từng ngày, từ leave_request_days.
      -- leave_days = 0.50 cho nửa buổi, 0.38 cho 3 giờ — count(distinct ngày) làm tròn LÊN thành 1.
      lv_rows as (
        select r.user_id, cw.d, r.paid, d.leave_days::numeric(8,2) as days
          from leave_request_days d
          join req r on r.id = d.leave_request_id
          join cal_work cw on cw.d = d.work_date
         where d.company_id = ${companyId} and d.deleted_at is null and d.status = 'Active'
      ),
      -- FALLBACK mức ĐƠN: đơn đã duyệt KHÔNG có day-row nào (dữ liệu di sản/nhập ngoài ứng dụng).
      -- Nguồn RỖNG ≠ bằng 0 — đọc rỗng thành 0 là mất lặng lẽ một khoản tiền (nghỉ không lương biến
      -- khỏi khấu trừ). Bung như cách cũ, 1.00/ngày.
      lv_legacy as (
        select r.user_id, cw.d, r.paid, 1.00::numeric(8,2) as days
          from req r
          join cal_work cw on cw.d >= r.start_date and cw.d <= r.end_date
         -- NOT EXISTS (không NOT IN): một NULL trong tập con của NOT IN làm CẢ vế thành rỗng ⇒ fallback
         -- im lặng không chạy cho ai. Cột NOT NULL hôm nay, nhưng cái giá của việc sai ở đây là tiền.
         where not exists (
           select 1 from req_has_days h where h.leave_request_id = r.id
         )
      ),
      lv as (
        select user_id, d, paid, days from lv_rows
        union all
        select user_id, d, paid, days from lv_legacy
      ),
      -- Gộp về (người, ngày, cờ paid): hai đơn nửa buổi cùng một ngày cộng lại thành 1.00.
      lv_day as (
        select user_id, d, paid, sum(days)::numeric(8,2) as days from lv group by user_id, d, paid
      ),
      paid_day as (
        select user_id, d, sum(days)::numeric(8,2) as days from lv_day where paid is true
         group by user_id, d
      ),
      att_day as (select distinct user_id, d from att),
      -- Một ngày đếm ĐÚNG MỘT lần: GREATEST(công, phép có lương) — KHÔNG SUM. Ngày vừa có bản ghi công
      -- vừa có phép nửa buổi có lương = 1 (không 1.5); ngày CHỈ có phép nửa buổi = 0.5. Trần LEAST(…,1)
      -- chặn hai đơn nửa buổi cùng ngày đẩy một ngày vượt 1.
      present_day as (
        select coalesce(a.user_id, p.user_id) as user_id,
               least(greatest(case when a.user_id is null then 0 else 1 end,
                              coalesce(p.days, 0)), 1)::numeric(8,2) as days
          from att_day a
          full join paid_day p on p.user_id = a.user_id and p.d = a.d
      ),
      people as (
        select user_id from att union select user_id from lv
      )
      select p.user_id,
             (select n from work_days)                                              as work_days,
             coalesce((select sum(pd.days) from present_day pd where pd.user_id = p.user_id), 0)
               ::numeric(8,2)                                                        as present_days,
             coalesce((select sum(l.days) from lv_day l
                        where l.user_id = p.user_id and l.paid is true), 0)::numeric(8,2)
                                                                                     as paid_leave_days,
             coalesce((select sum(l.days) from lv_day l
                        where l.user_id = p.user_id and l.paid is false), 0)::numeric(8,2)
                                                                                     as unpaid_leave_days,
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
