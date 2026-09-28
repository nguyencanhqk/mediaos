import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type {
  FeedEngagementRowDto,
  FeedEngagementUnitDto,
  FeedEngagementWeekDto,
} from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { getSettingDefault } from "../foundation/settings/setting-defaults";
import type { StatsScopeFilter } from "./social-stats-scope";

/**
 * S16-SOCIAL-BE-3B — SQL của thống kê tương tác `052`/`053`/widget (plan D3/D4/D6).
 *
 * BẤT BIẾN #1: mọi bảng ghim `company_id` — bảng gốc bằng THAM SỐ, bảng join bằng `x.company_id = <gốc>.company_id`.
 * `companies` đọc với `c.id = $company` TƯỜNG MINH: RLS của nó KHÔNG thu hẹp SELECT (`companies_all_tenant_read`).
 * Mọi giá trị đi vào câu là THAM SỐ bind — không nội suy chuỗi.
 *
 * ⚠️ KHÔNG import `payroll-report.sql.ts` (plan D11): mặc định TZ đọc thẳng registry foundation, LATERAL viết cục bộ.
 */

/** Mặc định khi hàng công ty vắng múi giờ — registry settings (DB-10 §11.2), không chép chuỗi lần nữa. */
const DEFAULT_TZ = String(getSettingDefault("company.timezone")?.value ?? "");
if (!DEFAULT_TZ) {
  throw new Error("social-stats.repository: registry settings thiếu mặc định 'company.timezone'");
}

export interface EngagementRange {
  readonly from: string;
  readonly to: string;
  readonly weeks: number;
}

/** `rows` của `tx.execute` — driver trả `{ rows }`, một số đường trả mảng trần; dạng khác ⇒ NÉM (không đọc nhầm thành «rỗng»). */
function rowsOf<T>(res: unknown): T[] {
  const rows = Array.isArray(res) ? res : (res as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("social-stats.repository: kết quả tx.execute không có dạng { rows } hay mảng");
  }
  return rows as T[];
}

/**
 * Múi giờ công ty — scalar; công ty đã xoá mềm ⇒ NULL ⇒ mọi biên khoảng NULL ⇒ 0 sự kiện (fail-closed).
 */
function companyTzSql(companyId: string): SQL {
  return sql`(select coalesce(c.timezone, ${DEFAULT_TZ})
                from companies c
               where c.id = ${companyId}::uuid and c.deleted_at is null)`;
}

/** Vị từ phạm vi trên `ep.org_unit_id` — dựng từ CÙNG `StatsScopeFilter` với metadata (plan D5). */
function scopePredicate(filter: StatsScopeFilter): SQL {
  switch (filter.kind) {
    case "all":
      return sql`true`;
    case "units":
      // `= ANY` trên NULL không khớp ⇒ nhóm «chưa gán đơn vị» bị loại, đúng ý D5.
      return filter.ids.length > 0
        ? sql`ep.org_unit_id = any(${sql.param([...filter.ids])}::uuid[])`
        : sql`false`;
    case "none":
      return sql`false`;
    default:
      return sql`false`;
  }
}

interface RawStatRow {
  kind: "row" | "total";
  week_start: string;
  org_unit_id: string | null;
  posts: number;
  comments: number;
  reactions: number;
  active_members: number;
}

@Injectable()
export class SocialStatsRepository {
  /**
   * Khoảng mặc định: `weeks` tuần tới HẾT tuần hiện tại, «hôm nay» theo TZ công ty (plan D1).
   * `null` ⇔ công ty không còn (xoá mềm) — caller quyết định.
   */
  async defaultRangeTx(
    tx: TenantTx,
    companyId: string,
    weeks: number,
  ): Promise<EngagementRange | null> {
    const res = await tx.execute(sql`
      with t as (
        select date_trunc('week', (now() at time zone ${companyTzSql(companyId)}))::date as monday
      )
      select to_char(t.monday - ${(weeks - 1) * 7}::int, 'YYYY-MM-DD') as "from",
             to_char(t.monday + 6, 'YYYY-MM-DD') as "to"
        from t
    `);
    const row = rowsOf<{ from: string | null; to: string | null }>(res)[0];
    if (!row?.from || !row.to) return null;
    return { from: row.from, to: row.to, weeks };
  }

  /**
   * Metadata `units` — CŨNG là tập `orgUnitId` hợp lệ DUY NHẤT (plan D6). Gồm cả đơn vị đã xoá mềm
   * (`isDeleted`): hoạt động của người thuộc đơn vị đó vẫn hiện trong `rows`, nên lọc theo nó phải được.
   */
  async unitsTx(
    tx: TenantTx,
    companyId: string,
    filter: StatsScopeFilter,
  ): Promise<FeedEngagementUnitDto[]> {
    if (filter.kind === "none") return [];
    const byIds =
      filter.kind === "units" ? sql`and o.id = any(${sql.param([...filter.ids])}::uuid[])` : sql``;
    const res = await tx.execute(sql`
      select o.id as "orgUnitId", o.name as "name", (o.deleted_at is not null) as "isDeleted"
        from org_units o
       where o.company_id = ${companyId}::uuid
         ${byIds}
       order by o.name, o.id
    `);
    return rowsOf<FeedEngagementUnitDto>(res);
  }

  /**
   * Khối số liệu — MỘT câu (plan D3/D4).
   *
   * ┌─ BA ĐIỂM DỄ SAI, ĐỪNG «ĐƠN GIẢN HOÁ» ─────────────────────────────────────────────────────────────┐
   * │ 1. `alive_posts` CHỈ lọc «còn sống», KHÔNG mang khoảng thời gian. Khoảng áp trên `created_at` của  │
   * │    CHÍNH từng nguồn: bình luận/cảm xúc trong khoảng trên bài tạo TRƯỚC khoảng vẫn phải tính.       │
   * │ 2. Cảm xúc KHÔNG bị dọn khi xoá mềm BÀI (`softDeletePostTx` không đụng `feed_reactions`; bài còn   │
   * │    khôi phục được) ⇒ PHẢI lọc đích còn sống, nếu không số cảm xúc lệch khỏi số bài/bình luận.      │
   * │ 3. `GROUPING SETS ((week, org_unit_id), (week))`: hàng tổng tuần CŨNG có `org_unit_id = NULL` —    │
   * │    y hệt nhóm «chưa gán đơn vị». Tách bằng `grouping(org_unit_id)`, TUYỆT ĐỐI không `IS NULL`.     │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * Tuần = `date_trunc('week', created_at AT TIME ZONE tz)` — `date_trunc` trần trên `timestamptz` dùng TZ
   * PHIÊN (UTC qua PgBouncer) ⇒ lệch 7 giờ ở VN. Biên khoảng nửa mở theo giờ địa phương.
   */
  async engagementTx(
    tx: TenantTx,
    companyId: string,
    range: EngagementRange,
    filter: StatsScopeFilter,
    orgUnitId: string | undefined,
  ): Promise<{ rows: FeedEngagementRowDto[]; weekTotals: FeedEngagementWeekDto[] }> {
    const byUnit = orgUnitId === undefined ? sql`` : sql`and ep.org_unit_id = ${orgUnitId}::uuid`;
    const res = await tx.execute(sql`
      with b as (
        select tz.tz,
               (${range.from}::date)::timestamp at time zone tz.tz as lo,
               ((${range.to}::date + 1))::timestamp at time zone tz.tz as hi
          from (select ${companyTzSql(companyId)} as tz) tz
      ),
      alive_posts as (
        select p.id, p.company_id, p.author_user_id, p.created_at
          from feed_posts p
          left join feed_groups g on g.company_id = p.company_id and g.id = p.group_id
         where p.company_id = ${companyId}::uuid
           and p.deleted_at is null
           and p.status <> 'deleted'
           and (p.group_id is null or (g.id is not null and g.deleted_at is null))
      ),
      alive_comments as (
        select c.id, c.company_id, c.author_user_id, c.created_at
          from feed_comments c
          join alive_posts ap on ap.company_id = c.company_id and ap.id = c.post_id
         where c.company_id = ${companyId}::uuid
           and c.deleted_at is null
      ),
      ev as (
        select ap.company_id, ap.author_user_id as user_id, ap.created_at,
               1 as is_post, 0 as is_comment, 0 as is_reaction
          from alive_posts ap cross join b
         where ap.created_at >= b.lo and ap.created_at < b.hi
        union all
        select ac.company_id, ac.author_user_id, ac.created_at, 0, 1, 0
          from alive_comments ac cross join b
         where ac.created_at >= b.lo and ac.created_at < b.hi
        union all
        select r.company_id, r.user_id, r.created_at, 0, 0, 1
          from feed_reactions r cross join b
         where r.company_id = ${companyId}::uuid
           and r.created_at >= b.lo and r.created_at < b.hi
           and (
             (r.target_type = 'post' and exists (
                select 1 from alive_posts ap
                 where ap.company_id = r.company_id and ap.id = r.target_id))
             or (r.target_type = 'comment' and exists (
                select 1 from alive_comments ac
                 where ac.company_id = r.company_id and ac.id = r.target_id))
           )
      ),
      scoped as (
        select date_trunc('week', ev.created_at at time zone b.tz)::date as week,
               ep.org_unit_id, ev.user_id, ev.is_post, ev.is_comment, ev.is_reaction
          from ev
          cross join b
          left join lateral (
            select e.org_unit_id
              from employee_profiles e
             where e.company_id = ev.company_id
               and e.user_id = ev.user_id
               and e.deleted_at is null
             order by e.created_at desc
             limit 1
          ) ep on true
         where ${scopePredicate(filter)}
           ${byUnit}
      ),
      agg as (
        select week, org_unit_id, grouping(org_unit_id) as g,
               sum(is_post)::int as posts,
               sum(is_comment)::int as comments,
               sum(is_reaction)::int as reactions,
               count(distinct user_id)::int as active_members
          from scoped
         group by grouping sets ((week, org_unit_id), (week))
      )
      select 'row' as kind, to_char(a.week, 'YYYY-MM-DD') as week_start, a.org_unit_id,
             a.posts, a.comments, a.reactions, a.active_members
        from agg a
       where a.g = 0
      union all
      select 'total', to_char(w.week::date, 'YYYY-MM-DD'), null,
             coalesce(a.posts, 0), coalesce(a.comments, 0), coalesce(a.reactions, 0),
             coalesce(a.active_members, 0)
        from generate_series(${range.from}::timestamp, ${range.to}::timestamp, interval '1 week') as w(week)
        left join agg a on a.g = 1 and a.week = w.week::date
       order by 1, 2, 3 nulls first
    `);

    const raw = rowsOf<RawStatRow>(res);
    const counts = (r: RawStatRow) => ({
      posts: Number(r.posts),
      comments: Number(r.comments),
      reactions: Number(r.reactions),
      activeMembers: Number(r.active_members),
    });
    return {
      rows: raw
        .filter((r) => r.kind === "row")
        .map((r) => ({ weekStart: r.week_start, orgUnitId: r.org_unit_id, ...counts(r) })),
      weekTotals: raw
        .filter((r) => r.kind === "total")
        .map((r) => ({ weekStart: r.week_start, ...counts(r) })),
    };
  }
}
