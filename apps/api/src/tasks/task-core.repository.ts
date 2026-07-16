import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S4-TASK-BE-2 — persistence Task core (SPEC-06 §7/§9, DB-06 §7.4 cột TitleCase MỚI mig 0478).
 *
 * TRÁNH FILE-SCOPE CONFLICT (risk #2 plan): Drizzle typed `tasks` (schema/workflow.ts) CHỈ có cột legacy;
 * ~20 cột 0478 (task_status/task_priority/main_assignee_employee_id/creator_user_id/reporter_employee_id/
 * due_at/start_at/department_id/...) CHƯA sync. Lane BỊ CẤM chạm schema/** (RÀNG BUỘC CỨNG) ⇒ dùng raw
 * `sql`` tham chiếu tên cột thô qua tx.execute (fallback tường minh của plan). company_id BIND tường minh
 * mọi câu (defense-in-depth trên RLS+FORCE 0478). task_watchers/employee_profiles cũng truy vấn raw.
 *
 * BẤT BIẾN #1: MỌI method chạy TRONG tx của withTenant (RLS+FORCE) + WHERE luôn AND company_id.
 * BẤT BIẾN #2: KHÔNG hard-delete — softDeleteTx set deleted_at/deleted_by.
 */

export interface TaskCoreListFilter {
  status?: string;
  priority?: string;
  assigneeEmployeeId?: string;
  projectId?: string;
  dueFrom?: string;
  dueTo?: string;
  overdue?: boolean;
  limit: number;
  offset: number;
}

export interface TaskCoreRow {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  taskType: string;
  // S5-NOTI-FIX-2 (lane noti-fix2-comment): additive — cột `tasks.task_code` cho placeholder {task_code}
  // (seed 0481 TASK_COMMENT_CREATED/TASK_MENTIONED). Optional (KHÔNG bắt buộc) để KHÔNG phá literal
  // TaskCoreRow hiện có (vd task-core.mapper.spec.ts baseRow) chưa set field này — additive, không rewrite.
  taskCode?: string | null;
  taskStatus: string | null;
  taskPriority: string | null;
  projectId: string | null;
  projectName: string | null;
  mainAssigneeEmployeeId: string | null;
  assigneeName: string | null;
  creatorUserId: string | null;
  creatorName: string | null;
  reporterEmployeeId: string | null;
  departmentId: string | null;
  // Raw tx.execute KHÔNG type-parse (drizzle không biết OID) ⇒ timestamptz về dạng string, boolean về
  // 't'/'f'|'true'|'false'. Service normalize (toIso/toBool) — KHÔNG giả định Date/boolean sẵn.
  dueAt: string | Date | null;
  startAt: string | Date | null;
  completedAt: string | Date | null;
  isOverdue: boolean | string;
  createdBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface MyTaskRow extends TaskCoreRow {
  source: "assigned" | "created" | "watched";
}

/** Hàng THÔ tối thiểu cho guard workflow + tenant-check (không cần projection tên). */
export interface TaskRawRow {
  id: string;
  taskType: string;
  workflowStepId: string | null;
  projectId: string | null;
  mainAssigneeEmployeeId: string | null;
  taskStatus: string | null;
}

export interface EmployeeForScope {
  id: string;
  userId: string | null;
  status: string;
  deletedAt: Date | null;
  orgUnitId: string | null;
  directManagerUserId: string | null;
}

export interface TaskCoreInsertValues {
  title: string;
  description: string | null;
  projectId: string | null;
  departmentId: string | null;
  mainAssigneeEmployeeId: string | null;
  assigneeUserId: string | null;
  reporterEmployeeId: string | null;
  taskPriority: string | null;
  dueAt: string | null;
  startAt: string | null;
  creatorUserId: string;
  createdBy: string;
}

export interface TaskCorePatchValues {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  departmentId?: string | null;
  mainAssigneeEmployeeId?: string | null;
  assigneeUserId?: string | null;
  taskPriority?: string | null;
  dueAt?: string | null;
  startAt?: string | null;
}

// Projection dùng chung cho list/detail/my — cột thô + join tên. `is_overdue` tính tại DB (now() UTC).
const TASK_CORE_SELECT = sql`
  tk.id                        AS id,
  tk.company_id                AS "companyId",
  tk.title                     AS title,
  tk.description               AS description,
  tk.task_type                 AS "taskType",
  tk.task_code                 AS "taskCode",
  tk.task_status               AS "taskStatus",
  tk.task_priority             AS "taskPriority",
  tk.project_id                AS "projectId",
  pr.name                      AS "projectName",
  tk.main_assignee_employee_id AS "mainAssigneeEmployeeId",
  au.full_name                 AS "assigneeName",
  tk.creator_user_id           AS "creatorUserId",
  cu.full_name                 AS "creatorName",
  tk.reporter_employee_id      AS "reporterEmployeeId",
  tk.department_id             AS "departmentId",
  tk.due_at                    AS "dueAt",
  tk.start_at                  AS "startAt",
  tk.completed_at              AS "completedAt",
  (tk.due_at IS NOT NULL AND tk.due_at < now()
     AND (tk.task_status IS NULL OR tk.task_status NOT IN ('Done','Cancelled'))) AS "isOverdue",
  tk.created_by                AS "createdBy",
  tk.created_at                AS "createdAt",
  tk.updated_at                AS "updatedAt"`;

const TASK_CORE_JOINS = sql`
  from tasks tk
  left join projects pr          on pr.id = tk.project_id
  left join employee_profiles ae on ae.id = tk.main_assignee_employee_id
  left join users au             on au.id = ae.user_id
  left join users cu             on cu.id = tk.creator_user_id`;

@Injectable()
export class TaskCoreRepository {
  // ── Data-scope EXISTS (filter AT THE DB, defense-in-depth trên RLS) ──────────────

  /**
   * Predicate scope ĐỌC cho Own/Team/Department: task giữ khi (A) main_assignee_employee_id trỏ 1
   * employee_profiles thoả `scopeCond` (DataScopeService.buildEmployeeScopeCondition — predicate over
   * employee_profiles) HOẶC (B) actor là ACTIVE member của project chứa task (membership OR-scope,
   * done_when #2). Correlate `tk` (outer alias). Company/System KHÔNG gọi (service bỏ qua ⇒ thấy toàn tenant).
   *
   * Idiom đã chứng minh (ProjectsRepository.buildScopeExists): subquery FROM `employee_profiles` KHÔNG alias
   * ⇒ scopeCond render `"employee_profiles"."…"` bind đúng phạm vi con; `${companyId}` = bind-param.
   */
  buildReadScopeExists(
    companyId: string,
    scopeCond: SQL,
    actorEmployeeId: string | null,
    actorUserId: string,
  ): SQL {
    const assigneeExists = sql`exists (
      select 1 from employee_profiles
       where employee_profiles.id = tk.main_assignee_employee_id
         and employee_profiles.deleted_at is null
         and ${scopeCond}
    )`;

    const memberPredicate = actorEmployeeId
      ? sql`(pm.employee_id = ${actorEmployeeId} or pm.user_id = ${actorUserId})`
      : sql`pm.user_id = ${actorUserId}`;
    const projectMemberExists = sql`exists (
      select 1 from project_members pm
       where pm.company_id = ${companyId}
         and pm.project_id = tk.project_id
         and pm.member_status = 'Active'
         and pm.deleted_at is null
         and ${memberPredicate}
    )`;

    return sql`(${assigneeExists} or ${projectMemberExists})`;
  }

  // ── Reads ──────────────────────────────────────────────────────────────────────

  async listTx(
    tx: TenantTx,
    companyId: string,
    filter: TaskCoreListFilter,
    scopeExists?: SQL,
  ): Promise<TaskCoreRow[]> {
    const conds: SQL[] = [sql`tk.company_id = ${companyId}`, sql`tk.deleted_at is null`];
    if (filter.status) conds.push(sql`tk.task_status = ${filter.status}`);
    if (filter.priority) conds.push(sql`tk.task_priority = ${filter.priority}`);
    if (filter.assigneeEmployeeId) {
      conds.push(sql`tk.main_assignee_employee_id = ${filter.assigneeEmployeeId}`);
    }
    if (filter.projectId) conds.push(sql`tk.project_id = ${filter.projectId}`);
    if (filter.dueFrom) conds.push(sql`tk.due_at >= ${filter.dueFrom}`);
    if (filter.dueTo) conds.push(sql`tk.due_at <= ${filter.dueTo}`);
    if (filter.overdue === true) {
      conds.push(
        sql`tk.due_at is not null and tk.due_at < now() and (tk.task_status is null or tk.task_status not in ('Done','Cancelled'))`,
      );
    }
    if (scopeExists) conds.push(scopeExists);

    const where = sql.join(conds, sql` and `);
    const res = await tx.execute(sql`
      select ${TASK_CORE_SELECT}
      ${TASK_CORE_JOINS}
      where ${where}
      order by tk.created_at desc
      limit ${filter.limit} offset ${filter.offset}
    `);
    return res.rows as unknown as TaskCoreRow[];
  }

  async findScopedByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    scopeExists?: SQL,
  ): Promise<TaskCoreRow | undefined> {
    const conds: SQL[] = [
      sql`tk.id = ${id}`,
      sql`tk.company_id = ${companyId}`,
      sql`tk.deleted_at is null`,
    ];
    if (scopeExists) conds.push(scopeExists);
    const where = sql.join(conds, sql` and `);
    const res = await tx.execute(sql`
      select ${TASK_CORE_SELECT}
      ${TASK_CORE_JOINS}
      where ${where}
      limit 1
    `);
    return (res.rows as unknown as TaskCoreRow[])[0];
  }

  /** Hàng THÔ cho guard workflow/tenant. Soft-deleted ⇒ undefined (404). */
  async findRawByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<TaskRawRow | undefined> {
    const res = await tx.execute(sql`
      select id, task_type as "taskType", workflow_step_id as "workflowStepId",
             project_id as "projectId", main_assignee_employee_id as "mainAssigneeEmployeeId",
             task_status as "taskStatus"
        from tasks
       where id = ${id} and company_id = ${companyId} and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as TaskRawRow[])[0];
  }

  /**
   * GET /tasks/my (TASK-API-210) — 3 nguồn hợp nhất, DEDUPE theo task.id (join 1:1 ⇒ không nhân dòng):
   *   assigned = main_assignee_employee_id=actorEmployeeId OR assignee_user_id=actorUserId (back-compat);
   *   created  = creator_user_id=actorUserId;
   *   watched  = EXISTS task_watchers (employee_id=actorEmployeeId, status∈Active/Muted, chưa xoá).
   * source ưu tiên assigned > created > watched. Sort: quá hạn lên đầu → due_at ASC NULLS LAST → mới nhất.
   */
  async findMyTasksTx(
    tx: TenantTx,
    companyId: string,
    actorUserId: string,
    actorEmployeeId: string | null,
  ): Promise<MyTaskRow[]> {
    const assignedPredicate = actorEmployeeId
      ? sql`(tk.main_assignee_employee_id = ${actorEmployeeId} or tk.assignee_user_id = ${actorUserId})`
      : sql`tk.assignee_user_id = ${actorUserId}`;
    const createdPredicate = sql`tk.creator_user_id = ${actorUserId}`;
    const watchedExists = actorEmployeeId
      ? sql`exists (
          select 1 from task_watchers tw
           where tw.company_id = ${companyId}
             and tw.task_id = tk.id
             and tw.employee_id = ${actorEmployeeId}
             and tw.status in ('Active','Muted')
             and tw.deleted_at is null
        )`
      : sql`false`;

    const sourceExpr = sql`case
        when ${assignedPredicate} then 'assigned'
        when ${createdPredicate}  then 'created'
        else 'watched'
      end`;

    const res = await tx.execute(sql`
      select ${TASK_CORE_SELECT}, ${sourceExpr} as source
      ${TASK_CORE_JOINS}
      where tk.company_id = ${companyId}
        and tk.deleted_at is null
        and (${assignedPredicate} or ${createdPredicate} or ${watchedExists})
      order by
        (tk.due_at is not null and tk.due_at < now()
           and (tk.task_status is null or tk.task_status not in ('Done','Cancelled'))) desc,
        tk.due_at asc nulls last,
        tk.created_at desc
    `);
    return res.rows as unknown as MyTaskRow[];
  }

  // ── Actor / employee lookup ──────────────────────────────────────────────────

  /** employee_profiles ACTIVE của actor (userId) trong tenant → {id} | undefined. */
  async findActiveEmployeeByUserTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      select id from employee_profiles
       where company_id = ${companyId} and user_id = ${userId}
         and status = 'active' and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  /** org_units cùng tenant? (guard departmentId trước insert/update — FK là PK toàn cục nên phải app-check). */
  async orgUnitExistsTx(tx: TenantTx, companyId: string, orgUnitId: string): Promise<boolean> {
    const res = await tx.execute(sql`
      select 1 from org_units where company_id = ${companyId} and id = ${orgUnitId} limit 1
    `);
    return res.rows.length > 0;
  }

  /** Resolve employee đích cho assignee — trả kèm signal scope (org_unit/manager) cho isEmployeeInScope. */
  async findEmployeeForScopeTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeForScope | undefined> {
    const res = await tx.execute(sql`
      select id, user_id as "userId", status, deleted_at as "deletedAt",
             org_unit_id as "orgUnitId", direct_manager_id as "directManagerUserId"
        from employee_profiles
       where company_id = ${companyId} and id = ${employeeId}
       limit 1
    `);
    return (res.rows as unknown as EmployeeForScope[])[0];
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  /**
   * Insert task core (task_type='office' cố định, task_status='Todo'). Ghi CẢ creator_user_id (domain, nguồn
   * 'created' cho /my) LẪN created_by (audit generic) = actor để tránh lệch. assignee_user_id (legacy) ghi
   * ĐỒNG THỜI với main_assignee_employee_id để board cũ vẫn thấy. Cột legacy status/priority giữ DEFAULT DB.
   */
  async insertTaskCoreTx(
    tx: TenantTx,
    companyId: string,
    v: TaskCoreInsertValues,
  ): Promise<{ id: string }> {
    const res = await tx.execute(sql`
      insert into tasks (
        company_id, task_type, title, description, task_status, task_priority,
        project_id, department_id, main_assignee_employee_id, assignee_user_id,
        creator_user_id, reporter_employee_id, due_at, start_at, created_by, updated_by
      ) values (
        ${companyId}, 'office', ${v.title}, ${v.description}, 'Todo', ${v.taskPriority},
        ${v.projectId}, ${v.departmentId}, ${v.mainAssigneeEmployeeId}, ${v.assigneeUserId},
        ${v.creatorUserId}, ${v.reporterEmployeeId}, ${v.dueAt}, ${v.startAt}, ${v.createdBy}, ${v.createdBy}
      )
      returning id
    `);
    const row = (res.rows as unknown as { id: string }[])[0];
    if (!row) throw new Error("insertTaskCoreTx: insert returned no row");
    return row;
  }

  async updateTaskCoreTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: TaskCorePatchValues,
    updatedBy: string,
  ): Promise<{ id: string } | undefined> {
    const sets: SQL[] = [sql`updated_at = now()`, sql`updated_by = ${updatedBy}`];
    const map: [keyof TaskCorePatchValues, string][] = [
      ["title", "title"],
      ["description", "description"],
      ["projectId", "project_id"],
      ["departmentId", "department_id"],
      ["mainAssigneeEmployeeId", "main_assignee_employee_id"],
      ["assigneeUserId", "assignee_user_id"],
      ["taskPriority", "task_priority"],
      ["dueAt", "due_at"],
      ["startAt", "start_at"],
    ];
    for (const [key, col] of map) {
      if (patch[key] !== undefined) {
        sets.push(sql`${sql.raw(col)} = ${patch[key] as string | null}`);
      }
    }
    const setClause = sql.join(sets, sql`, `);
    const res = await tx.execute(sql`
      update tasks set ${setClause}
       where id = ${id} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  /** Soft-delete (BẤT BIẾN #2). Trả {id} (undefined nếu đã xoá/không thuộc tenant). */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    deletedBy: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update tasks
         set deleted_at = now(), deleted_by = ${deletedBy}, updated_at = now(), updated_by = ${deletedBy}
       where id = ${id} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }
}
