import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lte, gte, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { goals, type Goal } from "../db/schema/goals";

/**
 * S5-GOAL-BE-1 — persistence GOAL (DB-11 §6.1/§8). Drizzle TYPED trên `goals` (schema/goals.ts đã đồng
 * bộ 100% cột với migration 0504 ⇒ KHÔNG cần raw-SQL như TaskCoreRepository).
 *
 * BẤT BIẾN #1: MỌI method chạy TRONG tx của `withTenant` (RLS+FORCE) và WHERE luôn AND `company_id`
 *   tường minh (defense-in-depth trên RLS — không dựa vào một lớp duy nhất).
 * BẤT BIẾN #2: KHÔNG hard-delete — `softDeleteTx` chỉ UPDATE deleted_at/deleted_by. Bảng ledger
 *   `goal_updates` KHÔNG được chạm ở WO này (check-in/finalize thuộc S5-GOAL-BE-2).
 *
 * ⚠️ Mọi câu đọc/ghi để bảng `goals` KHÔNG alias: predicate scope (buildReadScopeExists) correlate qua
 * cột typed `goals.*` nên đặt alias sẽ làm vị từ trỏ sai bảng.
 */

export interface GoalListFilter {
  level?: string;
  departmentId?: string;
  projectId?: string;
  employeeId?: string;
  parentGoalId?: string;
  status?: string;
  /** Giao nhau với kỳ của goal: period_end >= periodFrom. */
  periodFrom?: string;
  /** Giao nhau với kỳ của goal: period_start <= periodTo. */
  periodTo?: string;
  /**
   * GOAL-API-013 (/me/goals): "mục tiêu của tôi" = phụ trách HOẶC là chủ thể goal cá nhân.
   * Giá trị LUÔN đến từ token (service resolve), KHÔNG từ payload client.
   */
  mineEmployeeId?: string;
  limit: number;
  offset: number;
}

export interface GoalInsertValues {
  goalCode: string;
  name: string;
  description: string | null;
  level: string;
  departmentId: string | null;
  projectId: string | null;
  employeeId: string | null;
  parentGoalId: string | null;
  ownerEmployeeId: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  measureType: string;
  targetValue: string | null;
  unit: string | null;
  progressMode: string;
  weight: string;
  status: string;
  createdBy: string;
}

/** Patch: `undefined` = không đổi; `null` = xoá giá trị (neo/parent/unit/target). */
export interface GoalPatchValues {
  name?: string;
  description?: string | null;
  level?: string;
  departmentId?: string | null;
  projectId?: string | null;
  employeeId?: string | null;
  parentGoalId?: string | null;
  ownerEmployeeId?: string;
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  measureType?: string;
  targetValue?: string | null;
  unit?: string | null;
  progressMode?: string;
  weight?: string;
  status?: string;
}

/** Hàng tham chiếu tối thiểu của goal cha (chiều cấp + đi ngược cây chống chu trình). */
export interface GoalRefRow {
  id: string;
  level: string;
  name: string;
  goalCode: string;
  parentGoalId: string | null;
}

export interface EmployeeRefRow {
  id: string;
  userId: string | null;
  status: string;
  orgUnitId: string | null;
}

export interface ProjectRefRow {
  id: string;
  departmentId: string | null;
}

@Injectable()
export class GoalsRepository {
  // ── Data-scope EXISTS (lọc TẠI DB, defense-in-depth trên RLS) ─────────────────

  /**
   * Vị từ phạm vi ĐỌC cho scope < Company (Own/Team/Department). Goal được giữ khi:
   *   (A) người phụ trách (`owner_employee_id`) thoả `scopeCond` — predicate over `employee_profiles`
   *       của DataScopeService (Own = chính actor · Department = cùng phòng/phòng actor phụ trách);
   *   (B) goal CẤP PHÒNG neo vào phòng của actor (`department_id ∈ deptOrgUnitIds`) — người phụ trách
   *       có thể ở phòng khác (vd admin tạo hộ), nhưng mục tiêu VẪN là của phòng đó;
   *   (C) goal CẤP NHÂN VIÊN của người thoả `scopeCond` (chủ thể có thể khác người phụ trách);
   *   (D) goal CẤP DỰ ÁN mà actor là thành viên Active của dự án — minh bạch theo dự án, KHÔNG theo
   *       phòng ban (SPEC-10 §11 ghi chú: vai trò dự án cắt ngang phòng ban).
   * Company/System KHÔNG gọi hàm này (service bỏ qua predicate ⇒ thấy toàn tenant).
   */
  buildReadScopeExists(
    companyId: string,
    scopeCond: SQL,
    deptOrgUnitIds: string[],
    actorEmployeeId: string | null,
    actorUserId: string,
  ): SQL {
    const ownerExists = sql`exists (
      select 1 from employee_profiles
       where employee_profiles.id = ${goals.ownerEmployeeId}
         and employee_profiles.deleted_at is null
         and ${scopeCond}
    )`;
    const subjectExists = sql`(${goals.employeeId} is not null and exists (
      select 1 from employee_profiles
       where employee_profiles.id = ${goals.employeeId}
         and employee_profiles.deleted_at is null
         and ${scopeCond}
    ))`;
    const deptCond =
      deptOrgUnitIds.length > 0
        ? sql`(${goals.departmentId} is not null and ${inArray(goals.departmentId, deptOrgUnitIds)})`
        : sql`false`;
    const memberPredicate = actorEmployeeId
      ? sql`(pm.employee_id = ${actorEmployeeId} or pm.user_id = ${actorUserId})`
      : sql`pm.user_id = ${actorUserId}`;
    const projectMemberExists = sql`(${goals.projectId} is not null and exists (
      select 1 from project_members pm
       where pm.company_id = ${companyId}
         and pm.project_id = ${goals.projectId}
         and pm.member_status = 'Active'
         and pm.deleted_at is null
         and ${memberPredicate}
    ))`;
    return sql`(${ownerExists} or ${subjectExists} or ${deptCond} or ${projectMemberExists})`;
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  /** Điều kiện lọc dùng chung cho list/tree (KHÔNG gồm predicate scope — caller AND thêm). */
  private filterConds(companyId: string, f: GoalListFilter): SQL[] {
    const conds: SQL[] = [eq(goals.companyId, companyId), isNull(goals.deletedAt)];
    if (f.level) conds.push(eq(goals.level, f.level));
    if (f.departmentId) conds.push(eq(goals.departmentId, f.departmentId));
    if (f.projectId) conds.push(eq(goals.projectId, f.projectId));
    if (f.employeeId) conds.push(eq(goals.employeeId, f.employeeId));
    if (f.parentGoalId) conds.push(eq(goals.parentGoalId, f.parentGoalId));
    if (f.status) conds.push(eq(goals.status, f.status));
    if (f.periodFrom) conds.push(gte(goals.periodEnd, f.periodFrom));
    if (f.periodTo) conds.push(lte(goals.periodStart, f.periodTo));
    if (f.mineEmployeeId) {
      conds.push(
        sql`(${goals.ownerEmployeeId} = ${f.mineEmployeeId} or ${goals.employeeId} = ${f.mineEmployeeId})`,
      );
    }
    return conds;
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    filter: GoalListFilter,
    scopeExists?: SQL,
  ): Promise<Goal[]> {
    const conds = this.filterConds(companyId, filter);
    if (scopeExists) conds.push(scopeExists);
    return tx
      .select()
      .from(goals)
      .where(and(...conds))
      .orderBy(desc(goals.periodStart), asc(goals.goalCode))
      .limit(filter.limit)
      .offset(filter.offset);
  }

  /**
   * Hàng theo id CHỈ ràng company (KHÔNG scope): dùng để phân biệt 404 (không thuộc tenant) với 403
   * (thuộc tenant nhưng ngoài phạm vi). Thứ tự này là quy ước riêng của GOAL — SPEC-10 §20.2.
   */
  async findByIdTx(tx: TenantTx, companyId: string, id: string): Promise<Goal | undefined> {
    const [row] = await tx
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.companyId, companyId), isNull(goals.deletedAt)))
      .limit(1);
    return row;
  }

  /** Goal có nằm trong phạm vi ĐỌC của actor không (scope < Company). */
  async isInReadScopeTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    scopeExists: SQL,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: goals.id })
      .from(goals)
      .where(
        and(eq(goals.id, id), eq(goals.companyId, companyId), isNull(goals.deletedAt), scopeExists),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Số goal con CÒN SỐNG (deleted_at IS NULL) — định nghĩa "con active" của GOAL-ERR-007 (chốt tại
   * docs/plans/S5-GOAL-BE-1.md: con chưa xoá mềm, KỂ CẢ Cancelled — huỷ ≠ biến mất khỏi cây).
   */
  async countNonDeletedChildrenTx(
    tx: TenantTx,
    companyId: string,
    parentId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(goals)
      .where(
        and(
          eq(goals.companyId, companyId),
          eq(goals.parentGoalId, parentId),
          isNull(goals.deletedAt),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /** Goal cùng tenant theo id (kể cả để đi ngược cây) — undefined ⇒ caller trả 404. */
  async findGoalRefTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<GoalRefRow | undefined> {
    const [row] = await tx
      .select({
        id: goals.id,
        level: goals.level,
        name: goals.name,
        goalCode: goals.goalCode,
        parentGoalId: goals.parentGoalId,
      })
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.companyId, companyId), isNull(goals.deletedAt)))
      .limit(1);
    return row;
  }

  // ── Resolve tham chiếu client gửi lên — LUÔN dưới company_id (404 khi chéo tenant) ────

  async resolveDepartmentTx(
    tx: TenantTx,
    companyId: string,
    departmentId: string,
  ): Promise<{ id: string } | undefined> {
    const res = await tx.execute(sql`
      select id from org_units
       where id = ${departmentId} and company_id = ${companyId} and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as { id: string }[])[0];
  }

  async resolveProjectTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
  ): Promise<ProjectRefRow | undefined> {
    const res = await tx.execute(sql`
      select id, department_id as "departmentId" from projects
       where id = ${projectId} and company_id = ${companyId} and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as ProjectRefRow[])[0];
  }

  async resolveEmployeeTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeRefRow | undefined> {
    const res = await tx.execute(sql`
      select id, user_id as "userId", status, org_unit_id as "orgUnitId"
        from employee_profiles
       where id = ${employeeId} and company_id = ${companyId} and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as EmployeeRefRow[])[0];
  }

  /** employee_profiles ACTIVE của actor (userId) trong tenant — nguồn own-scope của /me/goals. */
  async findActiveEmployeeByUserTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<EmployeeRefRow | undefined> {
    const res = await tx.execute(sql`
      select id, user_id as "userId", status, org_unit_id as "orgUnitId"
        from employee_profiles
       where company_id = ${companyId} and user_id = ${userId}
         and status = 'active' and deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as EmployeeRefRow[])[0];
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  async insertTx(tx: TenantTx, companyId: string, v: GoalInsertValues): Promise<Goal> {
    const [row] = await tx
      .insert(goals)
      .values({
        companyId,
        goalCode: v.goalCode,
        name: v.name,
        description: v.description,
        level: v.level,
        departmentId: v.departmentId,
        projectId: v.projectId,
        employeeId: v.employeeId,
        parentGoalId: v.parentGoalId,
        ownerEmployeeId: v.ownerEmployeeId,
        periodType: v.periodType,
        periodStart: v.periodStart,
        periodEnd: v.periodEnd,
        measureType: v.measureType,
        targetValue: v.targetValue,
        unit: v.unit,
        progressMode: v.progressMode,
        weight: v.weight,
        status: v.status,
        createdBy: v.createdBy,
        updatedBy: v.createdBy,
      })
      .returning();
    if (!row) throw new Error("insertTx: INSERT goals trả về 0 row");
    return row;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: GoalPatchValues,
    updatedBy: string,
  ): Promise<Goal | undefined> {
    const [row] = await tx
      .update(goals)
      .set({ ...patch, updatedAt: new Date(), updatedBy })
      .where(and(eq(goals.id, id), eq(goals.companyId, companyId), isNull(goals.deletedAt)))
      .returning();
    return row;
  }

  /** BẤT BIẾN #2 — xoá MỀM. Không bao giờ gọi tx.delete(goals). */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    deletedBy: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .update(goals)
      .set({
        deletedAt: new Date(),
        deletedBy,
        updatedAt: new Date(),
        updatedBy: deletedBy,
      })
      .where(and(eq(goals.id, id), eq(goals.companyId, companyId), isNull(goals.deletedAt)))
      .returning({ id: goals.id });
    return row;
  }
}
