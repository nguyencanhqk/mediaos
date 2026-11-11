import { Injectable } from "@nestjs/common";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { users } from "../db/schema/users";
import { taskOpenPredicate, taskOverduePredicate } from "./task-workload.predicates";

/** Một dòng gộp theo người phụ trách; `employeeId = null` = nhóm «Chưa giao». */
export interface WorkloadAggregateRow {
  employeeId: string | null;
  activeCount: number;
  overdueCount: number;
  dueSoon7dCount: number;
  inReviewCount: number;
  maxOverdueDays: number | null;
}

export interface WorkloadAggregateInput {
  companyId: string;
  projectId?: string;
  departmentId?: string;
  /** `exists` read-scope của GET /tasks (undefined ở Company/System). */
  scopeExists?: SQL;
  /** Vị từ «người xuất hiện» (D2). */
  personPredicate?: SQL;
  tz: string;
  now: Date;
  windowEnd: Date;
}

/** Trần số dòng truy vấn gộp: 1 nhóm NULL + 101 người (101 để biết có bị cắt). */
export const WORKLOAD_AGGREGATE_LIMIT = 102;

const num = (v: unknown): number => Number(v ?? 0);

/**
 * S20-TASK-WORKLOAD-1 — persistence «Đội của tôi». BẤT BIẾN #1: chạy TRONG tx của withTenant, WHERE luôn
 * AND company_id. Truy vấn gộp là `sql` thô NHƯNG KHÔNG chứa `full_name`/`email` (ratchet chiếu danh tính,
 * D10): tên tra riêng ở `assigneeNamesTx` (drizzle).
 */
@Injectable()
export class TaskWorkloadRepository {
  async aggregateTx(tx: TenantTx, input: WorkloadAggregateInput): Promise<WorkloadAggregateRow[]> {
    const nowExpr = sql`${input.now.toISOString()}::timestamptz`;
    const overdue = taskOverduePredicate("tk", nowExpr);
    const conds: SQL[] = [
      sql`tk.company_id = ${input.companyId}`,
      sql`tk.deleted_at is null`,
      taskOpenPredicate("tk"),
    ];
    if (input.projectId) conds.push(sql`tk.project_id = ${input.projectId}`);
    if (input.departmentId) conds.push(sql`tk.department_id = ${input.departmentId}`);
    if (input.scopeExists) conds.push(input.scopeExists);
    if (input.personPredicate) conds.push(input.personPredicate);
    const where = sql.join(conds, sql` and `);
    const windowEnd = sql`${input.windowEnd.toISOString()}::timestamptz`;

    const res = await tx.execute(sql`
      select tk.main_assignee_employee_id as "employeeId",
             count(*)::int as "activeCount",
             (count(*) filter (where ${overdue}))::int as "overdueCount",
             (count(*) filter (where tk.due_at is not null and not ${overdue}
                                 and tk.due_at < ${windowEnd}))::int as "dueSoon7dCount",
             (count(*) filter (where tk.task_status = 'In Review'))::int as "inReviewCount",
             max((${nowExpr} at time zone ${input.tz})::date - (tk.due_at at time zone ${input.tz})::date)
               filter (where ${overdue}) as "maxOverdueDays"
        from tasks tk
       where ${where}
       group by tk.main_assignee_employee_id
       order by (tk.main_assignee_employee_id is null) desc,
                count(*) filter (where ${overdue}) desc,
                max((${nowExpr} at time zone ${input.tz})::date - (tk.due_at at time zone ${input.tz})::date)
                  filter (where ${overdue}) desc nulls last,
                count(*) desc,
                tk.main_assignee_employee_id asc
       limit ${WORKLOAD_AGGREGATE_LIMIT}
    `);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      employeeId: (r["employeeId"] as string | null) ?? null,
      activeCount: num(r["activeCount"]),
      overdueCount: num(r["overdueCount"]),
      dueSoon7dCount: num(r["dueSoon7dCount"]),
      inReviewCount: num(r["inReviewCount"]),
      maxOverdueDays: r["maxOverdueDays"] == null ? null : num(r["maxOverdueDays"]),
    }));
  }

  /**
   * TÊN HIỂN THỊ theo lô (D10) — khuôn `goals.repository.ts#ownerNamesTx`. CHỈ `users.full_name`: KHÔNG
   * email/SĐT/mã NV. Id tra là `main_assignee_employee_id` của CHÍNH các hàng `aggregateTx` vừa trả (đã qua
   * read-scope + vị từ người) ⇒ không mở tập tên nào ngoài `assigneeName` mà GET /tasks đã trả cho người
   * xem. Hồ sơ hoặc tài khoản xoá mềm ⇒ null. `company_id` ở CẢ hai bảng.
   */
  async assigneeNamesTx(
    tx: TenantTx,
    companyId: string,
    employeeIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (employeeIds.length === 0) return out;
    const rows = await tx
      .select({
        employeeId: employeeProfiles.id,
        fullName: users.fullName,
        userDeletedAt: users.deletedAt,
        deletedAt: employeeProfiles.deletedAt,
      })
      .from(employeeProfiles)
      .leftJoin(
        users,
        and(eq(users.id, employeeProfiles.userId), eq(users.companyId, employeeProfiles.companyId)),
      )
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          inArray(employeeProfiles.id, [...employeeIds]),
        ),
      );
    for (const r of rows) {
      const name = r.fullName?.trim();
      out.set(r.employeeId, r.deletedAt || r.userDeletedAt || !name ? null : name);
    }
    return out;
  }
}
