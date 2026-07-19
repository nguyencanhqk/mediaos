import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { projectMembers } from "../db/schema/media";
import { DataScopeService } from "../permission/data-scope.service";
import { TaskCoreRepository, type TaskScopeMode } from "./task-core.repository";

interface RequestUser {
  id: string;
  companyId: string;
}

/** Vai trò per-project (CHECK chk_project_members_project_role — mig 0478). */
export type ProjectRole = "Owner" | "Manager" | "Member" | "Viewer";

/** Membership Active của actor trong 1 dự án (role đã coalesce NULL→Member theo D-24). */
export interface ProjectMembership {
  role: ProjectRole;
  memberId: string;
}

const ERR = {
  PROJECT_FORBIDDEN: "TASK-ERR-PROJECT-FORBIDDEN: không đủ quyền trên dự án này.",
  TASK_NOT_FOUND: "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.",
} as const;

/** Xếp hạng role MẠNH NHẤT khi actor khớp nhiều hàng member (legacy user_id-only + hàng employee_id). */
const ROLE_RANK: Record<ProjectRole, number> = { Owner: 0, Manager: 1, Member: 2, Viewer: 3 };

/**
 * S5-TASK-PROJROLE-1 (đợt C — DECISIONS-04 D-23/D-24) — tầng đọc `project_members.project_role` DUY NHẤT.
 *
 * Mô hình 2 lớp (API-06 §6.3): lớp 1 = pair + data_scope (PermissionGuard + DataScopeService — KHÔNG đổi);
 * lớp 2 = membership + role, CHỈ khi tầm với của actor không đến từ org-scope (Company/System bypass —
 * SPEC-06 §18.6.8). KHÔNG thêm bậc 'Project' vào data_scope engine (D-22 giữ nguyên).
 *
 * Quy ước NULL (D-24): `project_role` NULL (member legacy media-era user_id-only, cột 0478 additive)
 * = Member cho read/collab — KHÔNG write-rộng, KHÔNG govern. Coalesce ngay tại đây để caller không
 * phải nhớ luật.
 *
 * BẤT BIẾN #1: mọi query AND company_id tường minh + chạy trong TenantTx (RLS+FORCE lớp dưới).
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    private readonly dataScope: DataScopeService,
    private readonly coreRepo: TaskCoreRepository,
  ) {}

  /**
   * Membership Active MẠNH NHẤT của actor trong `projectId` (null = không phải member Active).
   * Predicate identity MIRROR memberPredicate của buildReadScopeExists (employee_id OR user_id) —
   * hai nơi lệch nhau là hai cửa quyền khác nhau cho cùng một người.
   */
  async getMembershipTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    actorEmployeeId: string | null,
    actorUserId: string,
  ): Promise<ProjectMembership | null> {
    const identity = actorEmployeeId
      ? sql`(${projectMembers.employeeId} = ${actorEmployeeId} or ${projectMembers.userId} = ${actorUserId})`
      : sql`${projectMembers.userId} = ${actorUserId}`;
    const rows = await tx
      .select({ id: projectMembers.id, role: projectMembers.projectRole })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.memberStatus, "Active"),
          isNull(projectMembers.deletedAt),
          identity,
        ),
      );
    if (rows.length === 0) return null;
    let best: ProjectMembership | null = null;
    for (const r of rows) {
      const role = this.coalesceRole(r.role);
      if (!best || ROLE_RANK[role] < ROLE_RANK[best.role]) best = { role, memberId: r.id };
    }
    return best;
  }

  /** Dự án còn ≥1 Owner-member Active không? (phân slug OWNER_REQUIRED vs NOT_OWNER — D-25). */
  async hasActiveOwnerTx(tx: TenantTx, companyId: string, projectId: string): Promise<boolean> {
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
        ),
      );
    return (row?.n ?? 0) > 0;
  }

  /** 403 PROJECT-FORBIDDEN khi actor không phải member Active với role thuộc `allowedRoles` (D-24). */
  async assertProjectRoleTx(
    tx: TenantTx,
    user: RequestUser,
    projectId: string,
    actorEmployeeId: string | null,
    allowedRoles: readonly ProjectRole[],
    errMessage: string = ERR.PROJECT_FORBIDDEN,
  ): Promise<ProjectMembership> {
    const membership = await this.getMembershipTx(
      tx,
      user.companyId,
      projectId,
      actorEmployeeId,
      user.id,
    );
    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException(errMessage);
    }
    return membership;
  }

  /**
   * DRY assertInScopeForWrite (trước đây 2 bản trùng lặp ở TaskCoreService + TaskActionsService):
   * scope Company/System ⇒ bỏ qua; ngược lại task phải nằm trong (assignee-scope OR membership-theo-mode)
   * ⇒ else 404 (không lộ tồn tại). `mode` thread PER-OPERATION từ caller (BLOCKING #1/#residual của
   * plan-reviewer): 'write' cho mutate (loadMutable, update/move/delete) · 'read' cho watch
   * (loadWatchable — watch là read-affordance, D-24 cho MỌI role) · 'collab' cho comment/checklist/file.
   */
  async assertTaskInScopeTx(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    scope: DataScope,
    mode: TaskScopeMode,
  ): Promise<void> {
    if (scope === "Company" || scope === "System") return;
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
    const scopeExists = this.coreRepo.buildReadScopeExists(
      user.companyId,
      scopeCond,
      actorEmp?.id ?? null,
      user.id,
      mode,
    );
    const scoped = await this.coreRepo.findScopedByIdTx(tx, user.companyId, taskId, scopeExists);
    if (!scoped) throw new NotFoundException(ERR.TASK_NOT_FOUND);
  }

  /** NULL→Member (D-24); giá trị ngoài enum (không thể xảy ra nhờ CHECK) fail về Viewer cho an toàn. */
  private coalesceRole(role: string | null): ProjectRole {
    if (role === null) return "Member";
    if (role === "Owner" || role === "Manager" || role === "Member" || role === "Viewer") {
      return role;
    }
    return "Viewer";
  }
}
