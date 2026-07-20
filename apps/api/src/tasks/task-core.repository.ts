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
  /**
   * S5-TASK-PIPELINE-1 (lane be-read, plan mục 0) — board CHỈ hiện task cha (owner chốt 18/07:
   * việc con ẩn khỏi board, hiện trong task cha). Cột parent_task_id có từ 0478, CRUD subtask thuộc
   * S5-TASK-SUBTASK-1 — bộ lọc chốt TRƯỚC để ngày subtask lên board không phình + không sửa lại
   * truy vấn đã qua review. CHỈ truy vấn board bật; list/my giữ nguyên.
   */
  parentOnly?: boolean;
  /**
   * S5-TASK-SUBTASK-1 (TASK-API-701) — CHỈ việc con của đúng một cha. Loại trừ nhau với `parentOnly`
   * (một bên đòi parent IS NULL, bên kia đòi parent = $id). Khi set, kết quả sắp theo
   * `sort_order NULLS LAST, created_at` thay vì `created_at desc` mặc định của list.
   */
  parentId?: string;
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
  // S5-TASK-DETAIL-1 (GAP 3): tên người giao việc (JOIN rep/ru). Optional additive (mirror taskCode)
  // — KHÔNG phá literal TaskCoreRow hiện có trong unit spec.
  reporterName?: string | null;
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
  // S5-TASK-PIPELINE-1 (lane be-read): cột pipeline resolved (LEFT JOIN project_states ràng
  // company+project+active — state hỏng/cross-project ⇒ NULL). Optional additive (mirror taskCode)
  // để KHÔNG phá literal TaskCoreRow hiện có trong unit spec.
  stateId?: string | null;
  stateName?: string | null;
  stateColor?: string | null;
  stateGroup?: string | null;
  // S5-TASK-SUBTASK-1 (D-31): cây việc con. Optional additive (mirror taskCode/stateId) để KHÔNG phá
  // literal TaskCoreRow trong unit spec hiện có. NULL = task GỐC.
  parentTaskId?: string | null;
  sortOrder?: number | null;
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
  // S5-TASK-PIPELINE-1 (lane be-write) — cột pipeline hiện tại (stateName NULL khi state soft-deleted
  // hoặc trỏ project khác — dữ liệu hỏng, coi như chưa có cột, mirror findStateSyncRowTx).
  stateId: string | null;
  stateName: string | null;
  // S5-TASK-SUBTASK-1 (D-36) — NULL = task GỐC. Nguồn cho chốt "việc con không có cột" ở
  // applyStateChangeTx (phủ CẢ move-state LẪN PATCH {stateId}) và cho luật D-36a của updateTask.
  parentTaskId: string | null;
}

/** Cột pipeline đích cho đường ghi state_id (move-state / PATCH / POST — plan 3b/3c). */
export interface StateForWriteRow {
  id: string;
  projectId: string;
  name: string;
  stateGroup: string;
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
  // S5-NOTI-FIX-2 (lane notifix2-taskcode-codegen) — mã hiển thị công khai (TASK-0001…) đã cấp qua
  // SequenceService.nextCode Ở TX RIÊNG TRƯỚC insert (0 dup, gaps OK). REQUIRED: createTask luôn cấp trước
  // (KHÔNG để NULL — cột 0478 + counter 'task' 0498) ⇒ commentPayload()/mention emit mã THẬT, KHÔNG '{task_code}'.
  taskCode: string;
  // S5-TASK-PIPELINE-1 (lane be-write) — cột pipeline + status khởi tạo (SERVICE quyết định: có stateId
  // tường minh ⇒ status suy từ nhóm, chống desync-lúc-sinh 3c; không ⇒ is_default + 'Todo').
  stateId: string | null;
  taskStatus: string;
  // S5-TASK-SUBTASK-1 (D-31) — NULL = task gốc. Bất biến cây đã được TaskCoreService kiểm+khoá TRƯỚC
  // khi tới đây (assertParentAssignable); repository chỉ ghi.
  parentTaskId: string | null;
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
  ru.full_name                 AS "reporterName",
  tk.department_id             AS "departmentId",
  tk.due_at                    AS "dueAt",
  tk.start_at                  AS "startAt",
  tk.completed_at              AS "completedAt",
  (tk.due_at IS NOT NULL AND tk.due_at < now()
     AND (tk.task_status IS NULL OR tk.task_status NOT IN ('Done','Cancelled'))) AS "isOverdue",
  tk.created_by                AS "createdBy",
  tk.created_at                AS "createdAt",
  tk.updated_at                AS "updatedAt",
  tk.state_id                  AS "stateId",
  tk.parent_task_id            AS "parentTaskId",
  tk.sort_order                AS "sortOrder",
  ps.name                      AS "stateName",
  ps.color                     AS "stateColor",
  ps.state_group               AS "stateGroup"`;

const TASK_CORE_JOINS = sql`
  from tasks tk
  left join projects pr          on pr.id = tk.project_id
  left join employee_profiles ae on ae.id = tk.main_assignee_employee_id
  left join users au             on au.id = ae.user_id
  left join users cu             on cu.id = tk.creator_user_id
  left join employee_profiles rep on rep.id = tk.reporter_employee_id
  left join users ru             on ru.id = rep.user_id
  left join project_states ps    on ps.id = tk.state_id and ps.company_id = tk.company_id
                                and ps.project_id = tk.project_id and ps.deleted_at is null`;

/**
 * S5-TASK-PROJROLE-1 (DECISIONS-04 D-24) — mode của predicate scope, thread PER-OPERATION từ caller:
 *   'read'   — mọi Active member (list/detail/board/xem comment-checklist-file/watch);
 *   'collab' — viết comment · tick/sửa checklist · upload/xoá file: role ≥ Member (chặn Viewer);
 *   'write'  — sửa/move/assign/priority/deadline/delete task NGƯỜI KHÁC: Owner/Manager.
 * Nhánh assignee KHÔNG cap ở mọi mode. Helper dùng chung cho cả đọc lẫn ghi PHẢI nhận mode từ caller,
 * KHÔNG gán cứng (BLOCKING #1 + residual của plan-reviewer — docs/plans/S5-TASK-PROJROLE-1.md §Sửa sai).
 */
export type TaskScopeMode = "read" | "collab" | "write";

/**
 * S5-TASK-SUBTASK-1 (DECISIONS-05 D-32) — HAI vị từ "con", KHÁC NHAU CÓ CHỦ ĐÍCH. Đây là nguồn nhầm lẫn
 * số 1 của cây việc con; mọi nơi dùng PHẢI gọi đúng hàm và giữ comment trỏ D-32. ĐỪNG "hợp nhất cho gọn".
 *
 *   activeChildExists    (CẤU TRÚC) — con còn sống, MỌI trạng thái KỂ CẢ Cancelled.
 *     Dùng cho: xoá lan (D-38) · luật độ sâu (d) của D-33 · câu hỏi "task này có phải là cha không".
 *     Nếu dùng COUNTABLE ở đây: con Cancelled thành MỒ CÔI khi xoá cha, và cây lên được 3 tầng.
 *
 *   countableChildExists (ĐẾM)     — con còn sống VÀ task_status <> 'Cancelled'.
 *     Dùng cho: định nghĩa "lá" (D-34) · mẫu số tiến độ · rail avatar (D-40).
 *     Nếu dùng ACTIVE ở đây: một task cha đang Todo & QUÁ HẠN mà có ĐÚNG 1 con đã Cancelled sẽ rớt khỏi
 *     countsByStatus/overdueCount/assigneeWorkload ⇒ dự án hiện "0 việc phải làm, 0 quá hạn" trong khi
 *     cha vẫn sống và trễ hạn. Việc đã huỷ KHÔNG được che khuất việc còn sống.
 *
 * Nhận `alias` vì 3 câu của ProjectsRepository dùng alias khác nhau — một hằng SQL cứng sẽ không tái dùng
 * được và implementer sẽ copy 3 bản (3 đường trôi). company_id nằm TRONG subquery: BẤT BIẾN #1,
 * defense-in-depth trên RLS.
 *
 * ⚠️ NEO CHÉO: vị từ lá còn tồn tại một bản SQL viết tay trong migration
 * `0503_s5_subtask1_leaf_counting.sql` (định nghĩa mv_dashboard_task_status). KHÔNG có ràng buộc cơ học
 * nào giữ hai bản khớp nhau — sửa một bên PHẢI sửa bên kia; int-spec "ba nguồn số khớp nhau" là lưới an toàn.
 */
export const activeChildExists = (alias: string): SQL => sql`exists (
  select 1 from tasks c
   where c.parent_task_id = ${sql.raw(alias)}.id
     and c.company_id     = ${sql.raw(alias)}.company_id
     and c.deleted_at is null
)`;

export const countableChildExists = (alias: string): SQL => sql`exists (
  select 1 from tasks c
   where c.parent_task_id = ${sql.raw(alias)}.id
     and c.company_id     = ${sql.raw(alias)}.company_id
     and c.deleted_at is null
     and c.task_status is distinct from 'Cancelled'
)`;

/** "Lá" của D-34: task không có COUNTABLE_CHILD. Task không con ⇒ chính nó là lá. */
export const isLeaf = (alias: string): SQL => sql`not ${countableChildExists(alias)}`;

@Injectable()
export class TaskCoreRepository {
  // ── Data-scope EXISTS (filter AT THE DB, defense-in-depth trên RLS) ──────────────

  /**
   * Predicate scope cho Own/Team/Department: task giữ khi (A) main_assignee_employee_id trỏ 1
   * employee_profiles thoả `scopeCond` (DataScopeService.buildEmployeeScopeCondition — predicate over
   * employee_profiles) HOẶC (B) actor là ACTIVE member của project chứa task (membership OR-scope) với
   * project_role đủ bậc theo `mode` (D-24 — xem TaskScopeMode). Correlate `tk` (outer alias).
   * Company/System KHÔNG gọi (service bỏ qua ⇒ thấy toàn tenant).
   *
   * Idiom đã chứng minh (ProjectsRepository.buildScopeExists): subquery FROM `employee_profiles` KHÔNG alias
   * ⇒ scopeCond render `"employee_profiles"."…"` bind đúng phạm vi con; `${companyId}` = bind-param.
   */
  buildReadScopeExists(
    companyId: string,
    scopeCond: SQL,
    actorEmployeeId: string | null,
    actorUserId: string,
    mode: TaskScopeMode = "read",
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
    // S5-TASK-PROJROLE-1 (D-24): nhánh membership bị CAP theo project_role tuỳ mode — nhánh assignee
    // KHÔNG cap ở mọi mode (task giao cho chính mình = đường Own truyền thống). NULL = Member (member
    // legacy user_id-only trước 0478) ⇒ được read/collab, KHÔNG write-rộng.
    //   read   — mọi Active member (giữ nguyên hành vi cũ);
    //   collab — viết comment/tick checklist/upload file: role ≥ Member (chặn Viewer);
    //   write  — sửa/move/assign/priority/deadline/delete task người khác: Owner/Manager.
    const roleCond =
      mode === "write"
        ? sql` and pm.project_role in ('Owner','Manager')`
        : mode === "collab"
          ? sql` and (pm.project_role in ('Owner','Manager','Member') or pm.project_role is null)`
          : sql``;
    const projectMemberExists = sql`exists (
      select 1 from project_members pm
       where pm.company_id = ${companyId}
         and pm.project_id = tk.project_id
         and pm.member_status = 'Active'
         and pm.deleted_at is null
         and ${memberPredicate}${roleCond}
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
      // S5-TASK-SUBTASK-1 (DECISIONS-05 D-40) — RAIL AVATAR CÓ TÍNH CON: trên BOARD (parentOnly), lọc
      // theo người X giữ thẻ CHA khi assignee của chính cha là X HOẶC có COUNTABLE_CHILD giao X. Board
      // vẫn chỉ hiện cha (D-36) — con KHÔNG thành thẻ riêng. Ngoài board (list/my) giữ NGUYÊN hành vi cũ:
      // ở đó con là dòng riêng nên nới cha sẽ nhân đôi việc trước mắt người dùng.
      conds.push(
        filter.parentOnly
          ? sql`(tk.main_assignee_employee_id = ${filter.assigneeEmployeeId} or exists (
                   select 1 from tasks c
                    where c.parent_task_id = tk.id
                      and c.company_id     = tk.company_id
                      and c.deleted_at is null
                      and c.task_status is distinct from 'Cancelled'
                      and c.main_assignee_employee_id = ${filter.assigneeEmployeeId}
                 ))`
          : sql`tk.main_assignee_employee_id = ${filter.assigneeEmployeeId}`,
      );
    }
    if (filter.projectId) conds.push(sql`tk.project_id = ${filter.projectId}`);
    if (filter.dueFrom) conds.push(sql`tk.due_at >= ${filter.dueFrom}`);
    if (filter.dueTo) conds.push(sql`tk.due_at <= ${filter.dueTo}`);
    if (filter.overdue === true) {
      conds.push(
        sql`tk.due_at is not null and tk.due_at < now() and (tk.task_status is null or tk.task_status not in ('Done','Cancelled'))`,
      );
    }
    if (filter.parentOnly) conds.push(sql`tk.parent_task_id is null`);
    if (filter.parentId) conds.push(sql`tk.parent_task_id = ${filter.parentId}`);
    if (scopeExists) conds.push(scopeExists);

    const where = sql.join(conds, sql` and `);
    // Danh sách việc con có thứ tự NGƯỜI DÙNG sắp (TASK-API-702) ⇒ sort_order trước, NULLS LAST để con
    // chưa từng reorder rơi xuống cuối theo created_at. Mọi truy vấn khác giữ nguyên created_at desc.
    const orderBy = filter.parentId
      ? sql`tk.sort_order asc nulls last, tk.created_at asc`
      : sql`tk.created_at desc`;
    const res = await tx.execute(sql`
      select ${TASK_CORE_SELECT}
      ${TASK_CORE_JOINS}
      where ${where}
      order by ${orderBy}
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
      select t.id, t.task_type as "taskType", t.workflow_step_id as "workflowStepId",
             t.project_id as "projectId", t.main_assignee_employee_id as "mainAssigneeEmployeeId",
             t.task_status as "taskStatus", t.state_id as "stateId", ps.name as "stateName",
             -- S5-TASK-SUBTASK-1 (D-36): mọi chốt "không ghi state_id lên việc con" đọc từ ĐÂY. Thêm ở
             -- projection dùng chung để applyStateChangeTx (move-state + PATCH stateId) có sẵn thông tin
             -- cây mà KHÔNG phải truy vấn thêm. Đi CÙNG LƯỢT với findStateSyncRowTx — thiếu một trong hai
             -- thì chốt tương ứng im lặng không chạy.
             t.parent_task_id as "parentTaskId"
        from tasks t
        left join project_states ps
          on ps.id = t.state_id and ps.company_id = t.company_id
         and ps.project_id = t.project_id and ps.deleted_at is null
       where t.id = ${id} and t.company_id = ${companyId} and t.deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as TaskRawRow[])[0];
  }

  // ── S5-TASK-PIPELINE-1 (lane be-write) — đường ghi state_id DUY NHẤT qua TaskCoreService ─────

  /** Cột đích theo id (active, cùng tenant — cross-tenant bị RLS + company_id chặn ⇒ undefined = 404). */
  async findStateForWriteTx(
    tx: TenantTx,
    companyId: string,
    stateId: string,
  ): Promise<StateForWriteRow | undefined> {
    const res = await tx.execute(sql`
      select id, project_id as "projectId", name, state_group as "stateGroup"
        from project_states
       where id = ${stateId} and company_id = ${companyId} and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as StateForWriteRow[])[0];
  }

  /**
   * Cột pipeline active của project cho BOARD (lane be-read) — đủ field dựng cột state-mode, sort
   * XÁC ĐỊNH (sort_order, created_at, id). Nhận tx của caller — KHÔNG tự mở withTenant (bẫy 5b:
   * listStatesByProject legacy tự mở connection riêng, gọi trong tx là lồng pool).
   */
  async listBoardStatesTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
  ): Promise<
    {
      id: string;
      name: string;
      color: string;
      stateGroup: string;
      isDefault: boolean;
      sortOrder: number;
    }[]
  > {
    const res = await tx.execute(sql`
      select id, name, color, state_group as "stateGroup", is_default as "isDefault",
             sort_order as "sortOrder"
        from project_states
       where company_id = ${companyId} and project_id = ${projectId} and deleted_at is null
       order by sort_order, created_at, id
    `);
    return res.rows as unknown as {
      id: string;
      name: string;
      color: string;
      stateGroup: string;
      isDefault: boolean;
      sortOrder: number;
    }[];
  }

  /**
   * Cột mặc định cho task MỚI của project (plan mục 1): is_default → sort_order nhỏ nhất; tie-break
   * XÁC ĐỊNH (sort_order, created_at, id — is_default không unique tầng DB). Project 0 state ⇒ undefined.
   */
  async findDefaultStateTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
  ): Promise<StateForWriteRow | undefined> {
    const res = await tx.execute(sql`
      select id, project_id as "projectId", name, state_group as "stateGroup"
        from project_states
       where company_id = ${companyId} and project_id = ${projectId} and deleted_at is null
       order by is_default desc, sort_order, created_at, id
       limit 1
    `);
    return (res.rows as unknown as StateForWriteRow[])[0];
  }

  /**
   * Ghi state_id (đường move-state/PATCH — plan 3b). CHỈ được gọi từ TaskCoreService.applyStateChangeTx
   * (đã qua cổng resolveAndAssert update-state:task) — KHÔNG nối route mới vào writer này (R9).
   */
  async setTaskStateTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    stateId: string,
    actorUserId: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update tasks set state_id = ${stateId}, updated_at = now(), updated_by = ${actorUserId}
       where id = ${taskId} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
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
   *
   * S5-NOTI-FIX-2 (lane notifix2-taskcode-codegen): ghi `task_code` = mã đã cấp qua SequenceService.nextCode
   * (tx RIÊNG TRƯỚC insert — service layer). uq_tasks_company_task_code_active (0478) chặn trùng còn-sống;
   * counter FOR UPDATE (0498) đã serialize ⇒ không trùng ở đường bình thường (gaps OK khi tx này rollback).
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
        creator_user_id, reporter_employee_id, due_at, start_at, created_by, updated_by, task_code,
        state_id, parent_task_id
      ) values (
        ${companyId}, 'office', ${v.title}, ${v.description}, ${v.taskStatus}, ${v.taskPriority},
        ${v.projectId}, ${v.departmentId}, ${v.mainAssigneeEmployeeId}, ${v.assigneeUserId},
        ${v.creatorUserId}, ${v.reporterEmployeeId}, ${v.dueAt}, ${v.startAt}, ${v.createdBy}, ${v.createdBy}, ${v.taskCode},
        ${v.stateId}, ${v.parentTaskId}
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

  // ══ S5-TASK-SUBTASK-1 (DECISIONS-05) — cây việc con ═══════════════════════════════

  /**
   * D-33 — KHOÁ HÀNG, MỘT LUẬT CHO MỌI ĐƯỜNG GHI ĐỔI CẤU TRÚC CÂY.
   *
   * Khoá TOÀN BỘ tập hàng thao tác sẽ chạm, bằng ĐÚNG MỘT câu, `ORDER BY id` (thứ tự khoá TOÀN CỤC).
   * Tập theo từng đường: create `{P}` · update parentTaskId `{oldP, T, newP}` · delete cha
   * `{P} ∪ children` · delete con `{T}` · reorder `{P} ∪ children` · update projectId của task-có-con `{T}`.
   *
   * ⚠️ VÌ SAO KHÔNG TÁCH THÀNH NHIỀU LỆNH KHOÁ LẺ: node `LockRows` nằm TRÊN `Sort` nên MỘT câu bảo đảm
   * hàng được khoá đúng thứ tự đã sắp; tách ra là mất bảo đảm đó ⇒ deadlock quay lại.
   * ⚠️ VÌ SAO id-TĂNG-DẦN TOÀN CỤC chứ không phải "cha trước": "cha trước" gây ABBA với
   * `PATCH A{parent:B}` ‖ `PATCH B{parent:A}`; trộn "cha trước" (delete) với "id tăng dần" (update)
   * cũng ABBA. Một luật cho mọi đường mới thoát.
   * ⚠️ KHÔNG JOIN trong câu khoá (idiom repo — attendance-adjustment.repository.ts:105-108: joined
   * FOR UPDATE khoá lây employee/user rows).
   *
   * Caller PHẢI ĐỌC LẠI dữ liệu sau khi hàm này trả về — giá trị đọc trước khi khoá là bản chụp cũ.
   */
  async lockTasksForTreeWriteTx(tx: TenantTx, companyId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const res = await tx.execute(sql`
      select id from tasks
       where company_id = ${companyId} and id = any(${sql.param(unique)}::uuid[])
       order by id
         for update
    `);
    return (res.rows as unknown as { id: string }[]).map((r) => r.id);
  }

  /** ACTIVE_CHILD (D-32 — CẤU TRÚC, kể cả Cancelled): dùng cho xoá lan, luật độ sâu, reorder. */
  async listActiveChildrenTx(
    tx: TenantTx,
    companyId: string,
    parentId: string,
  ): Promise<
    {
      id: string;
      taskCode: string | null;
      title: string;
      taskType: string;
      workflowStepId: string | null;
    }[]
  > {
    const res = await tx.execute(sql`
      select id, task_code as "taskCode", title, task_type as "taskType",
             workflow_step_id as "workflowStepId"
        from tasks
       where company_id = ${companyId} and parent_task_id = ${parentId} and deleted_at is null
       order by id
    `);
    return res.rows as unknown as {
      id: string;
      taskCode: string | null;
      title: string;
      taskType: string;
      workflowStepId: string | null;
    }[];
  }

  /** Có ACTIVE_CHILD nào không (D-32) — luật (d) của D-33 và luật D-36a. */
  async hasActiveChildrenTx(tx: TenantTx, companyId: string, taskId: string): Promise<boolean> {
    const res = await tx.execute(sql`
      select 1 from tasks tk
       where tk.company_id = ${companyId} and tk.id = ${taskId} and ${activeChildExists("tk")}
       limit 1
    `);
    return res.rows.length > 0;
  }

  /**
   * D-34 — tiến độ thẻ cha, MỘT truy vấn cho N thẻ (KHÔNG N+1; khuôn mẫu
   * task-checklists.repository.countProgressByTaskIdsTx).
   * Mẫu số = COUNTABLE_CHILD (LOẠI Cancelled — việc đã huỷ không còn là việc); tử số = con 'Done'.
   * Lưu ý cặp đôi với D-33: con Cancelled VẪN giữ cha ngoài tập lá ở MV/báo cáo — hai vị từ khác nhau
   * có chủ đích, xem docblock activeChildExists/countableChildExists ở đầu file.
   */
  async countSubtaskProgressByParentIdsTx(
    tx: TenantTx,
    companyId: string,
    parentIds: string[],
  ): Promise<Map<string, { done: number; total: number }>> {
    const out = new Map<string, { done: number; total: number }>();
    if (parentIds.length === 0) return out;
    const res = await tx.execute(sql`
      select parent_task_id as "parentId",
             count(*) filter (where task_status = 'Done')::int as "done",
             count(*)::int                                     as "total"
        from tasks
       where company_id = ${companyId}
         and parent_task_id = any(${sql.param(parentIds)}::uuid[])
         and deleted_at is null
         and task_status is distinct from 'Cancelled'
       group by parent_task_id
    `);
    for (const r of res.rows as unknown as { parentId: string; done: number; total: number }[]) {
      out.set(r.parentId, { done: Number(r.done), total: Number(r.total) });
    }
    return out;
  }

  /**
   * D-36 — writer HẸP xoá cột của việc con. KHÔNG phải state-change nghiệp vụ mà là hệ quả cơ học của
   * "việc con ẩn khỏi board". Tách riêng vì: `TaskCorePatchValues` KHÔNG có `stateId` (mở ra là tạo
   * đường ghi state THỨ HAI) và `setTaskStateTx` mang ràng buộc R9 "CHỈ gọi từ applyStateChangeTx".
   * Vị từ `parent_task_id is not null` khiến writer này KHÔNG THỂ chạm task gốc, kể cả khi gọi nhầm.
   */
  async clearTaskStateForSubtaskTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    actorUserId: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update tasks
         set state_id = null, updated_at = now(), updated_by = ${actorUserId}
       where id = ${taskId} and company_id = ${companyId} and deleted_at is null
         and parent_task_id is not null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  /** Gán/gỡ cha. Writer DUY NHẤT của parent_task_id — gate + bất biến cây nằm ở TaskCoreService. */
  async setParentTaskTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    parentTaskId: string | null,
    actorUserId: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      update tasks
         set parent_task_id = ${parentTaskId}, updated_at = now(), updated_by = ${actorUserId}
       where id = ${taskId} and company_id = ${companyId} and deleted_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  /**
   * TASK-API-702 — ghi sort_order bằng MỘT câu (không loop N lệnh). Caller đã validate tập id khớp
   * chính xác tập ACTIVE_CHILD của cha, NHƯNG câu này VẪN tự mang company_id + parent_task_id +
   * deleted_at trong WHERE: defense-in-depth trên RLS, không chỉ dựa vào kiểm tra ở tầng trên.
   * Trả số hàng đã ghi để caller ASSERT khớp kỳ vọng (lệch ⇒ rollback, không im lặng ghi thiếu).
   */
  async setSubtaskOrderTx(
    tx: TenantTx,
    companyId: string,
    parentId: string,
    orderedIds: string[],
  ): Promise<number> {
    if (orderedIds.length === 0) return 0;
    const values = sql.join(
      orderedIds.map((id, i) => sql`(${id}::uuid, ${i}::int)`),
      sql`, `,
    );
    const res = await tx.execute(sql`
      update tasks t
         -- ⚠️ CHỈ ghi sort_order — KHÔNG đụng updated_at/updated_by.
         -- Quyền của reorder chỉ kiểm trên CHA (D-33), nên câu này chạm cả việc con NGOÀI phạm vi ghi
         -- của actor. Ghi updated_by lên những hàng đó là viết đè quyền-tác-giả cuối cùng của một bản
         -- ghi mà actor không được sửa — hỏng tính toàn vẹn dấu vết, lại KHÔNG có activity/audit đi kèm
         -- (reorder cố ý không ghi nhật ký). Đổi thứ tự là TRÌNH BÀY: chỉ cột trình bày được đổi.
         set sort_order = v.ord
        from (values ${values}) as v(id, ord)
       where t.id = v.id
         and t.company_id     = ${companyId}
         and t.parent_task_id = ${parentId}
         and t.deleted_at is null
       returning t.id
    `);
    return res.rows.length;
  }
}
