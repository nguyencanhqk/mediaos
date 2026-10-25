import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { goals } from "../db/schema/goals";
import type { DataScopeService, ScopeContext } from "../permission/data-scope.service";

/**
 * S20-SEC-GOALNAMEDTO-1 — phạm vi ĐỌC mục tiêu dưới dạng hàm THUẦN (không DI, không import `tasks/`).
 *
 * Vì sao tách khỏi `GoalAccessService`/`GoalsRepository`: quyết định «người xem đọc được mục tiêu G»
 * cần ở HAI nơi — đường đọc mục tiêu chuẩn (`GET /goals/:id`) và tham chiếu mục tiêu đi kèm dữ liệu
 * việc (`TaskGoalRefPolicy`). `GoalsModule → TasksModule` là phụ thuộc MỘT CHIỀU nên TasksModule không
 * inject được `GoalAccessService`; chép luật sang `tasks/` là bản sao thứ hai sẽ trôi. Ở đây là bản
 * DUY NHẤT: `GoalAccessService.resolveActorScope` và `GoalsRepository` ủy quyền một dòng về đây.
 */

/** Ngữ cảnh phạm vi của actor, resolve MỘT LẦN mỗi request rồi dùng cho cả đọc lẫn ghi. */
export interface GoalActorScope {
  scope: DataScope;
  ctx: ScopeContext;
  deptOrgUnitIds: string[];
  actorEmployeeId: string | null;
  /** undefined = Company/System (thấy toàn tenant, KHÔNG áp predicate). */
  readScopeExists?: SQL;
}

export interface GoalActorEmployeeRow {
  id: string;
  userId: string | null;
  status: string;
  orgUnitId: string | null;
}

/** Hai hàm THUẦN của DataScopeService mà phạm vi mục tiêu cần (không I/O). */
export type GoalScopeBuilders = Pick<
  DataScopeService,
  "departmentOrgUnitIds" | "buildEmployeeScopeCondition"
>;

/**
 * Vị từ phạm vi ĐỌC cho scope < Company (Own/Team/Department). Goal được giữ khi:
 *   (A) người phụ trách (`owner_employee_id`) thoả `scopeCond` — predicate over `employee_profiles`
 *       của DataScopeService (Own = chính actor · Department = cùng phòng/phòng actor phụ trách);
 *   (B) goal CẤP PHÒNG neo vào phòng của actor (`department_id ∈ deptOrgUnitIds`) — người phụ trách
 *       có thể ở phòng khác (vd admin tạo hộ), nhưng mục tiêu VẪN là của phòng đó;
 *   (C) goal CẤP NHÂN VIÊN của người thoả `scopeCond` (chủ thể có thể khác người phụ trách);
 *   (D) goal CẤP DỰ ÁN mà actor là thành viên Active của dự án — minh bạch theo dự án, KHÔNG theo
 *       phòng ban (SPEC-10 §11 ghi chú: vai trò dự án cắt ngang phòng ban).
 * Company/System KHÔNG gọi hàm này (thấy toàn tenant).
 *
 * ⚠️ Correlate qua cột typed `goals.*` ⇒ câu dùng vị từ này KHÔNG được alias bảng `goals`.
 */
export function buildGoalReadScopeExists(
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

/** employee_profiles ACTIVE của actor (userId) trong tenant — nguồn vế người phụ trách/chủ thể. */
export async function findActiveActorEmployeeTx(
  tx: TenantTx,
  companyId: string,
  userId: string,
): Promise<GoalActorEmployeeRow | undefined> {
  const res = await tx.execute(sql`
      select id, user_id as "userId", status, org_unit_id as "orgUnitId"
        from employee_profiles
       where company_id = ${companyId} and user_id = ${userId}
         and status = 'active' and deleted_at is null
       limit 1
    `);
  return (res.rows as unknown as GoalActorEmployeeRow[])[0];
}

/**
 * Dựng ngữ cảnh phạm vi từ scope ĐÃ resolve. Bậc phòng ban CHỈ có nghĩa với scope 'Department' (phòng
 * mình ∪ phòng mình phụ trách — `DataScopeService.departmentOrgUnitIds`). Với Own/Team phải để RỖNG:
 * nếu không, người scope Own sẽ đọc/ghi được MỌI mục tiêu cấp phòng của phòng mình = nới quyền câm.
 */
export function buildGoalActorScope(
  scope: DataScope,
  ctx: ScopeContext,
  actorEmployeeId: string | null,
  user: { id: string; companyId: string },
  dataScope: GoalScopeBuilders,
): GoalActorScope {
  const deptOrgUnitIds = scope === "Department" ? dataScope.departmentOrgUnitIds(ctx) : [];
  const base: GoalActorScope = { scope, ctx, deptOrgUnitIds, actorEmployeeId };
  if (scope === "Company" || scope === "System") return base;
  return {
    ...base,
    readScopeExists: buildGoalReadScopeExists(
      user.companyId,
      dataScope.buildEmployeeScopeCondition(scope, ctx),
      deptOrgUnitIds,
      actorEmployeeId,
      user.id,
    ),
  };
}

/**
 * Tập id mục tiêu đọc được trong `ids` — MỘT truy vấn cho cả lô. Cùng WHERE với đường đọc chuẩn:
 * `id` + `company_id` + chưa xoá mềm + (vị từ phạm vi khi scope < Company). `ids` rỗng ⇒ 0 truy vấn.
 */
export async function selectReadableGoalIdsTx(
  tx: TenantTx,
  companyId: string,
  ids: readonly string[],
  readScopeExists?: SQL,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const conds: SQL[] = [
    inArray(goals.id, [...ids]),
    eq(goals.companyId, companyId),
    isNull(goals.deletedAt),
  ];
  if (readScopeExists) conds.push(readScopeExists);
  const rows = await tx
    .select({ id: goals.id })
    .from(goals)
    .where(and(...conds));
  return new Set(rows.map((r) => r.id));
}
