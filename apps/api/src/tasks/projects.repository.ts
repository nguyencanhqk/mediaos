import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { projectMembers, projects, type Project, type ProjectMember } from "../db/schema/media";
import { orgUnits } from "../db/schema/org";
import { users } from "../db/schema/users";

/**
 * S4-TASK-BE-1 — persistence Project + project_members (DB-06 §7.1/§7.2, cột TitleCase MỚI mig 0478).
 *
 * BẤT BIẾN #1: MỌI method chạy TRONG tx của `withTenant` (RLS+FORCE) VÀ WHERE luôn AND company_id tường
 * minh (defense-in-depth trên RLS). Cross-tenant ⇒ RLS lọc 0 row ⇒ service map 404 (không lộ tồn tại).
 * BẤT BIẾN #2: KHÔNG hard-delete — close/delete set cột trạng thái/deleted_at; soft-remove member.
 *
 * SCHEMA LEGACY (2 unique song song): project_members.user_id NOT NULL + partial-unique
 * project_members_active_uq(company,project,user_id) WHERE deleted_at IS NULL (LIVE) VÀ mới
 * uq_project_members_active_employee(company,project,employee_id) WHERE deleted_at IS NULL AND
 * member_status='Active' AND employee_id IS NOT NULL. Chống-trùng ĐO trên CẢ HAI (service).
 */

export interface ProjectListFilter {
  status?: string;
  ownerEmployeeId?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface ProjectDetailRow {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  description: string | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  priority: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  memberCount: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
}

export interface ProjectMemberRow {
  id: string;
  projectId: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  departmentName: string | null;
  projectRole: string | null;
  status: string | null;
  joinedAt: Date | null;
  removedAt: Date | null;
}

export interface EmployeeForMember {
  id: string;
  userId: string | null;
  status: string;
  deletedAt: Date | null;
}

export interface ProjectInsertValues {
  name: string;
  projectCode: string | null;
  description: string | null;
  ownerEmployeeId: string | null;
  departmentId: string | null;
  projectPriority: string | null;
  projectStatus: string;
  startDate: string | null;
  endDate: string | null;
  createdBy: string;
}

export interface ProjectPatchValues {
  name?: string;
  projectCode?: string | null;
  description?: string | null;
  ownerEmployeeId?: string | null;
  departmentId?: string | null;
  projectPriority?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface MemberInsertValues {
  projectId: string;
  userId: string;
  employeeId: string;
  projectRole: string;
  invitedBy: string;
  createdBy: string;
}

/** S4-TASK-BE-5 — 1 dòng workload theo người phụ trách chính (task active ∉ Done/Cancelled). */
export interface AssigneeWorkloadRow {
  employeeId: string;
  employeeName: string | null;
  activeCount: number;
}

/** S4-TASK-BE-5 — số liệu thô cho GET /projects/:id/report (đếm + workload). */
export interface ProjectReportAggregate {
  countsByStatus: Record<string, number>;
  overdueCount: number;
  assigneeWorkload: AssigneeWorkloadRow[];
}

/** 5 cột task_status FSM cố định (chk_tasks_task_status 0478) — khởi tạo counts = 0 để đủ khóa. */
const TASK_REPORT_STATUSES = ["Todo", "In Progress", "In Review", "Done", "Cancelled"] as const;

@Injectable()
export class ProjectsRepository {
  // ── Data-scope EXISTS (mirror hr-read: filter AT THE DB, không lọc client-side) ──────────────

  /**
   * EXISTS-join correlated cho DATA-SCOPE ĐỌC: project được giữ khi có ≥1 member ACTIVE (member_status=
   * 'Active', chưa xoá) mà hàng employee_profiles của member thoả `scopeCond` (DataScopeService.
   * buildEmployeeScopeCondition — predicate over employee_profiles). employee @Own = member là chính mình;
   * manager @Team = member thuộc cây quản lý. Company/System KHÔNG gọi hàm này (service bỏ qua ⇒ thấy tất).
   *
   * Tên bảng trong subquery (`project_members`/`employee_profiles`) KHÔNG trùng alias outer (owner_emp/…)
   * ⇒ tham chiếu bind đúng phạm vi con; `${projects.id}` correlate tới hàng project ngoài.
   */
  buildScopeExists(companyId: string, scopeCond: SQL): SQL {
    // Idiom đã chứng minh trong repo này (temp-file-cleanup.repository.ts): tên bảng subquery viết THÔ,
    // cột dùng object drizzle (render tên có định danh khớp bảng thô), correlate `${projects.id}`, bind
    // `${companyId}`. scopeCond render `"employee_profiles"."…"` — khớp FROM employee_profiles ở subquery.
    return sql`exists (
      select 1
        from project_members
        join employee_profiles on ${employeeProfiles.id} = ${projectMembers.employeeId}
       where ${projectMembers.companyId} = ${companyId}
         and ${projectMembers.projectId} = ${projects.id}
         and ${projectMembers.memberStatus} = ${"Active"}
         and ${projectMembers.deletedAt} is null
         and ${employeeProfiles.deletedAt} is null
         and ${scopeCond}
    )`;
  }

  private memberCountSql(companyId: string): SQL<number> {
    return sql<number>`(
      select count(*)::int
        from project_members
       where ${projectMembers.companyId} = ${companyId}
         and ${projectMembers.projectId} = ${projects.id}
         and ${projectMembers.memberStatus} = ${"Active"}
         and ${projectMembers.deletedAt} is null
    )`;
  }

  /**
   * Projection detail. `ownerNameExpr`/`deptNameExpr` là SQL đã dựng SẴN từ alias có kiểu ở call-site
   * (tránh truyền alias-table qua tham số — ReturnType<typeof alias> xoá generic ⇒ mất cột .fullName/.name).
   */
  private detailSelect(
    companyId: string,
    ownerNameExpr: SQL<string | null>,
    deptNameExpr: SQL<string | null>,
  ) {
    return {
      id: projects.id,
      companyId: projects.companyId,
      code: projects.projectCode,
      name: projects.name,
      description: projects.description,
      ownerEmployeeId: projects.ownerEmployeeId,
      ownerName: ownerNameExpr,
      departmentId: projects.departmentId,
      departmentName: deptNameExpr,
      priority: projects.projectPriority,
      status: projects.projectStatus,
      startDate: projects.startDate,
      endDate: projects.endDate,
      memberCount: this.memberCountSql(companyId),
      createdBy: projects.createdBy,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      closedAt: projects.closedAt,
      closedBy: projects.closedBy,
    };
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  async listTx(
    tx: TenantTx,
    companyId: string,
    filter: ProjectListFilter,
    scopeExists?: SQL,
  ): Promise<ProjectDetailRow[]> {
    const ownerEmp = alias(employeeProfiles, "owner_emp");
    const ownerUser = alias(users, "owner_user");
    const dept = alias(orgUnits, "dept");

    const conds: SQL[] = [eq(projects.companyId, companyId), isNull(projects.deletedAt)];
    if (filter.status) conds.push(eq(projects.projectStatus, filter.status));
    if (filter.ownerEmployeeId) conds.push(eq(projects.ownerEmployeeId, filter.ownerEmployeeId));
    if (filter.search) {
      const term = `%${filter.search}%`;
      const searchCond = or(
        sql`${projects.name} ilike ${term}`,
        sql`${projects.projectCode} ilike ${term}`,
      );
      if (searchCond) conds.push(searchCond);
    }
    if (scopeExists) conds.push(scopeExists);

    return tx
      .select(
        this.detailSelect(
          companyId,
          sql<string | null>`${ownerUser.fullName}`,
          sql<string | null>`${dept.name}`,
        ),
      )
      .from(projects)
      .leftJoin(ownerEmp, eq(ownerEmp.id, projects.ownerEmployeeId))
      .leftJoin(ownerUser, eq(ownerUser.id, ownerEmp.userId))
      .leftJoin(dept, eq(dept.id, projects.departmentId))
      .where(and(...conds))
      .orderBy(desc(projects.createdAt))
      .limit(filter.limit)
      .offset(filter.offset);
  }

  /** Detail 1 project (ANDs scopeExists khi Own/Team ⇒ out-of-scope trả undefined = 404 nhất quán). */
  async findDetailByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    scopeExists?: SQL,
  ): Promise<ProjectDetailRow | undefined> {
    const ownerEmp = alias(employeeProfiles, "owner_emp");
    const ownerUser = alias(users, "owner_user");
    const dept = alias(orgUnits, "dept");

    const conds: SQL[] = [
      eq(projects.id, id),
      eq(projects.companyId, companyId),
      isNull(projects.deletedAt),
    ];
    if (scopeExists) conds.push(scopeExists);

    const [row] = await tx
      .select(
        this.detailSelect(
          companyId,
          sql<string | null>`${ownerUser.fullName}`,
          sql<string | null>`${dept.name}`,
        ),
      )
      .from(projects)
      .leftJoin(ownerEmp, eq(ownerEmp.id, projects.ownerEmployeeId))
      .leftJoin(ownerUser, eq(ownerUser.id, ownerEmp.userId))
      .leftJoin(dept, eq(dept.id, projects.departmentId))
      .where(and(...conds))
      .limit(1);
    return row;
  }

  /** Hàng project THÔ (mọi cột) cho owner-check + lifecycle guard. Soft-deleted ⇒ undefined (404). */
  async findRawByIdTx(tx: TenantTx, companyId: string, id: string): Promise<Project | undefined> {
    const [row] = await tx
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, id), eq(projects.companyId, companyId), isNull(projects.deletedAt)),
      )
      .limit(1);
    return row;
  }

  async listMembersTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
  ): Promise<ProjectMemberRow[]> {
    const memberEmp = alias(employeeProfiles, "member_emp");
    const memberUser = alias(users, "member_user");
    const memberDept = alias(orgUnits, "member_dept");

    return tx
      .select({
        id: projectMembers.id,
        projectId: projectMembers.projectId,
        employeeId: projectMembers.employeeId,
        employeeName: sql<string | null>`${memberUser.fullName}`,
        employeeCode: sql<string | null>`${memberEmp.employeeCode}`,
        departmentName: sql<string | null>`${memberDept.name}`,
        projectRole: projectMembers.projectRole,
        status: projectMembers.memberStatus,
        joinedAt: projectMembers.joinedAt,
        removedAt: projectMembers.leftAt,
      })
      .from(projectMembers)
      .leftJoin(memberEmp, eq(memberEmp.id, projectMembers.employeeId))
      .leftJoin(memberUser, eq(memberUser.id, memberEmp.userId))
      .leftJoin(memberDept, eq(memberDept.id, memberEmp.orgUnitId))
      .where(
        and(
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.projectId, projectId),
          isNull(projectMembers.deletedAt),
        ),
      )
      .orderBy(desc(projectMembers.createdAt));
  }

  // ── Actor / lookup ─────────────────────────────────────────────────────────

  /** employee_profiles ACTIVE của actor (userId) trong tenant → {id,userId} | undefined (creator=owner). */
  async findActiveEmployeeByUserTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<{ id: string; userId: string | null } | undefined> {
    const [row] = await tx
      .select({ id: employeeProfiles.id, userId: employeeProfiles.userId })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          eq(employeeProfiles.status, "active"),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /** Resolve employee đích cho member-insert (KHÔNG lọc status ⇒ service quyết định active/loud-fail). */
  async findEmployeeForMemberTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeForMember | undefined> {
    const [row] = await tx
      .select({
        id: employeeProfiles.id,
        userId: employeeProfiles.userId,
        status: employeeProfiles.status,
        deletedAt: employeeProfiles.deletedAt,
      })
      .from(employeeProfiles)
      .where(and(eq(employeeProfiles.companyId, companyId), eq(employeeProfiles.id, employeeId)))
      .limit(1);
    return row;
  }

  async orgUnitExistsTx(tx: TenantTx, companyId: string, orgUnitId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.companyId, companyId), eq(orgUnits.id, orgUnitId)))
      .limit(1);
    return row !== undefined;
  }

  async nameExistsTx(
    tx: TenantTx,
    companyId: string,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    const conds: SQL[] = [
      eq(projects.companyId, companyId),
      eq(projects.name, name),
      isNull(projects.deletedAt),
    ];
    if (excludeId) conds.push(sql`${projects.id} <> ${excludeId}`);
    const [row] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(...conds))
      .limit(1);
    return row !== undefined;
  }

  async codeExistsTx(
    tx: TenantTx,
    companyId: string,
    code: string,
    excludeId?: string,
  ): Promise<boolean> {
    const conds: SQL[] = [
      eq(projects.companyId, companyId),
      eq(projects.projectCode, code),
      isNull(projects.deletedAt),
    ];
    if (excludeId) conds.push(sql`${projects.id} <> ${excludeId}`);
    const [row] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(...conds))
      .limit(1);
    return row !== undefined;
  }

  // ── Writes: project ──────────────────────────────────────────────────────────

  async insertProjectTx(
    tx: TenantTx,
    companyId: string,
    values: ProjectInsertValues,
  ): Promise<Project> {
    const [row] = await tx
      .insert(projects)
      .values({
        companyId,
        name: values.name,
        projectCode: values.projectCode,
        description: values.description,
        ownerEmployeeId: values.ownerEmployeeId,
        departmentId: values.departmentId,
        projectPriority: values.projectPriority,
        projectStatus: values.projectStatus,
        startDate: values.startDate,
        endDate: values.endDate,
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
      })
      .returning();
    if (!row) throw new Error("insertProjectTx: insert returned no row");
    return row;
  }

  async updateProjectTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: ProjectPatchValues,
    updatedBy: string,
  ): Promise<Project | undefined> {
    const values: Record<string, unknown> = { updatedAt: new Date(), updatedBy };
    const map: [keyof ProjectPatchValues, string][] = [
      ["name", "name"],
      ["projectCode", "projectCode"],
      ["description", "description"],
      ["ownerEmployeeId", "ownerEmployeeId"],
      ["departmentId", "departmentId"],
      ["projectPriority", "projectPriority"],
      ["startDate", "startDate"],
      ["endDate", "endDate"],
    ];
    for (const [key, col] of map) {
      if (patch[key] !== undefined) values[col] = patch[key];
    }
    const [row] = await tx
      .update(projects)
      .set(values)
      .where(
        and(eq(projects.id, id), eq(projects.companyId, companyId), isNull(projects.deletedAt)),
      )
      .returning();
    return row;
  }

  /** close → project_status='Completed' + closed/completed at/by (BẤT BIẾN #2: KHÔNG xoá dữ liệu). */
  async closeProjectTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    closedBy: string,
  ): Promise<Project | undefined> {
    const now = new Date();
    const [row] = await tx
      .update(projects)
      .set({
        projectStatus: "Completed",
        completedAt: now,
        closedAt: now,
        closedBy,
        updatedAt: now,
        updatedBy: closedBy,
      })
      .where(
        and(eq(projects.id, id), eq(projects.companyId, companyId), isNull(projects.deletedAt)),
      )
      .returning();
    return row;
  }

  /** Soft-delete (BẤT BIẾN #2). Trả row (undefined nếu đã bị xoá/không thuộc tenant). */
  async softDeleteProjectTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    deletedBy: string,
  ): Promise<Project | undefined> {
    const now = new Date();
    const [row] = await tx
      .update(projects)
      .set({ deletedAt: now, deletedBy, updatedAt: now, updatedBy: deletedBy })
      .where(
        and(eq(projects.id, id), eq(projects.companyId, companyId), isNull(projects.deletedAt)),
      )
      .returning();
    return row;
  }

  // ── Writes: member ───────────────────────────────────────────────────────────

  /** Có member ACTIVE cùng user_id chưa? (đo unique legacy project_members_active_uq). */
  async activeMemberByUserExistsTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          isNull(projectMembers.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Có member ACTIVE cùng employee_id chưa? (đo unique mới uq_project_members_active_employee). */
  async activeMemberByEmployeeExistsTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    employeeId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.employeeId, employeeId),
          eq(projectMembers.memberStatus, "Active"),
          isNull(projectMembers.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async insertMemberTx(
    tx: TenantTx,
    companyId: string,
    values: MemberInsertValues,
  ): Promise<ProjectMember> {
    const [row] = await tx
      .insert(projectMembers)
      .values({
        companyId,
        projectId: values.projectId,
        userId: values.userId,
        employeeId: values.employeeId,
        projectRole: values.projectRole,
        memberStatus: "Active",
        // status = cột legacy NOT NULL DEFAULT 'active' (0023) — giữ default, KHÔNG đụng.
        joinedAt: new Date(),
        invitedBy: values.invitedBy,
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
      })
      .returning();
    if (!row) throw new Error("insertMemberTx: insert returned no row");
    return row;
  }

  async findMemberByIdTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    memberId: string,
  ): Promise<ProjectMember | undefined> {
    const [row] = await tx
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.id, memberId),
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.projectId, projectId),
          isNull(projectMembers.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  async updateMemberRoleTx(
    tx: TenantTx,
    companyId: string,
    memberId: string,
    role: string,
    updatedBy: string,
  ): Promise<ProjectMember | undefined> {
    const [row] = await tx
      .update(projectMembers)
      .set({ projectRole: role, updatedAt: new Date(), updatedBy })
      .where(
        and(
          eq(projectMembers.id, memberId),
          eq(projectMembers.companyId, companyId),
          isNull(projectMembers.deletedAt),
        ),
      )
      .returning();
    return row;
  }

  /** Soft-remove member: deleted_at + member_status='Removed' + removed_by + left_at (để partial-unique
   * cho re-add). BẤT BIẾN #2: KHÔNG hard-delete. */
  async softRemoveMemberTx(
    tx: TenantTx,
    companyId: string,
    memberId: string,
    removedBy: string,
  ): Promise<ProjectMember | undefined> {
    const now = new Date();
    const [row] = await tx
      .update(projectMembers)
      .set({
        memberStatus: "Removed",
        removedBy,
        leftAt: now,
        deletedAt: now,
        deletedBy: removedBy,
        updatedAt: now,
        updatedBy: removedBy,
      })
      .where(
        and(
          eq(projectMembers.id, memberId),
          eq(projectMembers.companyId, companyId),
          isNull(projectMembers.deletedAt),
        ),
      )
      .returning();
    return row;
  }

  /** Đếm Owner ACTIVE còn lại (loại trừ memberId) — chặn xoá/hạ-cấp Owner cuối cùng. */
  async countOtherActiveOwnersTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    excludeMemberId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.projectRole, "Owner"),
          eq(projectMembers.memberStatus, "Active"),
          isNull(projectMembers.deletedAt),
          sql`${projectMembers.id} <> ${excludeMemberId}`,
        ),
      );
    return row?.n ?? 0;
  }

  // ── Report aggregate (S4-TASK-BE-5, SPEC-06 §16.1) ─────────────────────────────

  /**
   * Tổng hợp số liệu 1 project trên bảng `tasks`. Cột 0478 (task_status/main_assignee_employee_id/due_at)
   * CHƯA sync vào drizzle-typed `tasks` (chỉ cột legacy) ⇒ dùng raw `tx.execute(sql``)` tham chiếu tên cột
   * thô (mirror TaskCoreRepository — lane BỊ CẤM chạm schema/**). BẤT BIẾN #1: MỌI câu AND company_id tường
   * minh (defense-in-depth trên RLS+FORCE) + AND project_id + deleted_at IS NULL.
   *
   *   • countsByStatus: đếm theo task_status; NULL gộp 'Todo' (đồng nhất Kanban); đủ 5 khóa (0 nếu trống).
   *   • overdueCount: due_at < now() AND status ∉ (Done,Cancelled) — KHỚP định nghĩa overdue task-core/kanban.
   *   • assigneeWorkload: đếm task ACTIVE (status ∉ Done/Cancelled) theo main_assignee_employee_id (bỏ NULL),
   *     join tên qua employee_profiles→users, ORDER count DESC (tie-break id ⇒ ổn định), LIMIT top-N.
   */
  async aggregateReportTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    workloadLimit: number,
  ): Promise<ProjectReportAggregate> {
    const countsRes = await tx.execute(sql`
      select coalesce(task_status, 'Todo') as status, count(*)::int as n
        from tasks
       where company_id = ${companyId}
         and project_id = ${projectId}
         and deleted_at is null
       group by coalesce(task_status, 'Todo')
    `);
    const countsByStatus: Record<string, number> = {};
    for (const s of TASK_REPORT_STATUSES) countsByStatus[s] = 0;
    for (const r of countsRes.rows as unknown as { status: string; n: number }[]) {
      if (r.status in countsByStatus) countsByStatus[r.status] = Number(r.n);
    }

    const overdueRes = await tx.execute(sql`
      select count(*)::int as n
        from tasks
       where company_id = ${companyId}
         and project_id = ${projectId}
         and deleted_at is null
         and due_at is not null
         and due_at < now()
         and (task_status is null or task_status not in ('Done','Cancelled'))
    `);
    const overdueCount = Number((overdueRes.rows as unknown as { n: number }[])[0]?.n ?? 0);

    const workloadRes = await tx.execute(sql`
      select tk.main_assignee_employee_id as "employeeId",
             u.full_name                  as "employeeName",
             count(*)::int                as "activeCount"
        from tasks tk
        left join employee_profiles ae on ae.id = tk.main_assignee_employee_id
        left join users u             on u.id = ae.user_id
       where tk.company_id = ${companyId}
         and tk.project_id = ${projectId}
         and tk.deleted_at is null
         and tk.main_assignee_employee_id is not null
         and (tk.task_status is null or tk.task_status not in ('Done','Cancelled'))
       group by tk.main_assignee_employee_id, u.full_name
       order by count(*) desc, tk.main_assignee_employee_id asc
       limit ${workloadLimit}
    `);
    const assigneeWorkload = (workloadRes.rows as unknown as AssigneeWorkloadRow[]).map((r) => ({
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      activeCount: Number(r.activeCount),
    }));

    return { countsByStatus, overdueCount, assigneeWorkload };
  }
}
