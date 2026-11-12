import type { Pagination } from "@mediaos/contracts";
import { MY_TASKS_CLOSED_LIMIT } from "@mediaos/contracts";
import { sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { TASK_CORE_JOINS, TASK_CORE_SELECT, type MyTaskRow } from "./task-core.repository";

/**
 * S20-TASK-MYTASKSLOAD-1 — truy vấn «Việc của tôi» (GET /tasks/my, TASK-API-210), hàm thuần nhận `tx`.
 *
 * 3 nguồn hợp nhất (DEDUPE theo task.id — join 1:1 ⇒ không nhân dòng):
 *   assigned = main_assignee_employee_id = actorEmployeeId OR assignee_user_id = actorUserId (back-compat);
 *   created  = creator_user_id = actorUserId;
 *   watched  = EXISTS task_watchers (employee_id = actorEmployeeId, status ∈ Active/Muted, chưa xoá).
 * `source` ưu tiên assigned > created > watched.
 *
 * MỌI chế độ (all/open/closed) và phép đếm dùng CHUNG `myTasksBaseWhere`: `company_id` + `deleted_at IS NULL`
 * + OR của 3 nguồn — không có đường nào bỏ điều kiện tenant/xoá mềm.
 */

export type MyTasksMode = "all" | "open" | "closed";

const CLOSED_STATUSES = sql`('Done','Cancelled')`;
const CLOSED_PREDICATE = sql`(tk.task_status is not null and tk.task_status in ${CLOSED_STATUSES})`;
const OPEN_PREDICATE = sql`(tk.task_status is null or tk.task_status not in ${CLOSED_STATUSES})`;

interface MyTasksPredicates {
  assigned: SQL;
  created: SQL;
  where: SQL;
}

function myTasksPredicates(
  companyId: string,
  userId: string,
  empId: string | null,
): MyTasksPredicates {
  const assigned = empId
    ? sql`(tk.main_assignee_employee_id = ${empId} or tk.assignee_user_id = ${userId})`
    : sql`tk.assignee_user_id = ${userId}`;
  const created = sql`tk.creator_user_id = ${userId}`;
  const watched = empId
    ? sql`exists (
          select 1 from task_watchers tw
           where tw.company_id = ${companyId}
             and tw.task_id = tk.id
             and tw.employee_id = ${empId}
             and tw.status in ('Active','Muted')
             and tw.deleted_at is null
        )`
    : sql`false`;
  const where = sql`tk.company_id = ${companyId}
        and tk.deleted_at is null
        and (${assigned} or ${created} or ${watched})`;
  return { assigned, created, where };
}

/** `myTasksBaseWhere` — điều kiện gốc dùng chung (xuất để spec đo SQL có tenant + xoá mềm). */
export function myTasksBaseWhere(companyId: string, userId: string, empId: string | null): SQL {
  return myTasksPredicates(companyId, userId, empId).where;
}

const MODE_FILTER: Record<MyTasksMode, SQL> = {
  all: sql`true`,
  open: OPEN_PREDICATE,
  closed: CLOSED_PREDICATE,
};

// Mở/tất cả: quá hạn lên đầu → hạn gần trước → mới tạo trước (giữ thứ tự cũ của findMyTasksTx).
const ORDER_OPEN = sql`
        (tk.due_at is not null and tk.due_at < now()
           and (tk.task_status is null or tk.task_status not in ('Done','Cancelled'))) desc,
        tk.due_at asc nulls last,
        tk.created_at desc`;
// Đóng: mới đóng gần nhất trước (huỷ theo `cancelled_at`, không bị sửa-sau-huỷ đẩy lên).
const ORDER_CLOSED = sql`coalesce(tk.completed_at, tk.cancelled_at, tk.updated_at) desc, tk.id desc`;

export async function selectMyTasksTx(
  tx: TenantTx,
  companyId: string,
  userId: string,
  empId: string | null,
  mode: MyTasksMode,
  limit?: number,
): Promise<MyTaskRow[]> {
  const p = myTasksPredicates(companyId, userId, empId);
  const sourceExpr = sql`case
        when ${p.assigned} then 'assigned'
        when ${p.created}  then 'created'
        else 'watched'
      end`;
  const limitSql = limit === undefined ? sql`` : sql`limit ${limit}`;
  const res = await tx.execute(sql`
      select ${TASK_CORE_SELECT}, ${sourceExpr} as source
      ${TASK_CORE_JOINS}
      where ${p.where}
        and ${MODE_FILTER[mode]}
      order by ${mode === "closed" ? ORDER_CLOSED : ORDER_OPEN}
      ${limitSql}
    `);
  return res.rows as unknown as MyTaskRow[];
}

export async function countMyClosedTx(
  tx: TenantTx,
  companyId: string,
  userId: string,
  empId: string | null,
): Promise<number> {
  const p = myTasksPredicates(companyId, userId, empId);
  const res = await tx.execute(sql`
      select count(*)::int as n from tasks tk
      where ${p.where}
        and ${CLOSED_PREDICATE}
    `);
  return Number((res.rows as unknown as { n: number }[])[0]?.n ?? 0);
}

export interface MyTasksListResult {
  items: MyTaskRow[];
  truncated: boolean;
  total: number;
}

/** Danh sách cho FE: việc MỞ (không trần — giữ hành vi) + (tuỳ chọn) tối đa N việc đóng gần nhất. */
export async function loadMyTasksForListTx(
  tx: TenantTx,
  companyId: string,
  userId: string,
  empId: string | null,
  includeClosed: boolean,
  closedLimit: number = MY_TASKS_CLOSED_LIMIT,
): Promise<MyTasksListResult> {
  const open = await selectMyTasksTx(tx, companyId, userId, empId, "open");
  if (!includeClosed) return { items: open, truncated: false, total: open.length };
  const closed = await selectMyTasksTx(tx, companyId, userId, empId, "closed", closedLimit + 1);
  const truncated = closed.length > closedLimit;
  const closedTotal = truncated
    ? await countMyClosedTx(tx, companyId, userId, empId)
    : closed.length;
  return {
    items: [...open, ...closed.slice(0, closedLimit)],
    truncated,
    total: open.length + closedTotal,
  };
}

/**
 * Khối `pagination` làm TÍN HIỆU CẮT (`has_next` = còn việc đóng chưa trả); `data` vẫn là mảng trần.
 * Chỉ `has_next`/`total` mang nghĩa; `total_pages` = ceil(total / per_page) cho nhất quán API-01 §16.1.
 */
export function buildMyTasksPagination(
  returned: number,
  total: number,
  truncated: boolean,
): Pagination {
  const perPage = Math.max(returned, 1);
  return {
    page: 1,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
    has_next: truncated,
    has_prev: false,
  };
}
