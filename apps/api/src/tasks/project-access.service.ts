import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { projectMembers } from "../db/schema/media";
import { DataScopeService } from "../permission/data-scope.service";
import { ProjectMembershipService } from "./project-membership.service";
import { TaskCoreRepository, type TaskScopeMode } from "./task-core.repository";

interface RequestUser {
  id: string;
  companyId: string;
}

/**
 * S8-CHAT-UX-BE-2 — hai kiểu này ĐÃ CHUYỂN sang `project-membership.service.ts` (module lá) cùng với
 * truy vấn dùng chúng. Re-export để mọi import sẵn có giữ nguyên đường dẫn — **KHÔNG** khai lại ở đây:
 * hai định nghĩa cùng tên là hai thứ TypeScript coi là khác nhau ngay khi một bên thêm role mới.
 */
import type { ProjectMembership, ProjectRole } from "./project-membership.service";
export type { ProjectMembership, ProjectRole };

const ERR = {
  PROJECT_FORBIDDEN: "TASK-ERR-PROJECT-FORBIDDEN: không đủ quyền trên dự án này.",
  TASK_NOT_FOUND: "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.",
} as const;

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
    private readonly membership: ProjectMembershipService,
  ) {}

  /**
   * Membership Active MẠNH NHẤT của actor trong `projectId` (null = không phải member Active).
   *
   * ⟲ **S8-CHAT-UX-BE-2 — thân hàm ĐÃ CHUYỂN sang `ProjectMembershipService` (module lá).** Hàm này
   * giữ nguyên chữ ký và trở thành lớp uỷ quyền mỏng: CHAT cần đọc vai trò dự án nhưng không import
   * được `TasksModule` (vòng `Chat → Tasks → Chat`). Xem jsdoc `ProjectMembershipService`.
   *
   * ⚠️ KHÔNG viết lại truy vấn ở đây. Vị từ identity MIRROR `memberPredicate` của
   * `buildReadScopeExists` — ba bản sao thì cả ba sẽ trôi khỏi nhau.
   */
  getMembershipTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    actorEmployeeId: string | null,
    actorUserId: string,
  ): Promise<ProjectMembership | null> {
    return this.membership.getMembershipTx(tx, companyId, projectId, actorEmployeeId, actorUserId);
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
    const ok = await this.checkTaskInScopeTx(tx, user, taskId, scope, mode);
    if (!ok) throw new NotFoundException(ERR.TASK_NOT_FOUND);
  }

  /**
   * S5-TASK-SUBTASK-1 (DECISIONS-05 D-38) — bản KHÔNG NÉM của assertTaskInScopeTx.
   *
   * Xoá lan cần duyệt HẾT việc con rồi mới quyết (tất-cả-hoặc-không), nên không dùng được bản ném 404.
   * ⚠️ MỘT NGUỒN LOGIC: `assertTaskInScopeTx` = hàm này + throw. KHÔNG copy thân hàm sang chỗ khác —
   * hai bản sao là chỗ hai đường quyền trôi khỏi nhau.
   * ⚠️ `mode` PHẢI đúng vế: quyết định CHẶN xoá dùng 'write'; nếu ai đó truyền 'read' cho vế chặn thì
   * danh sách bị chặn sẽ luôn rỗng (hỏng CÂM) hoặc con đọc-được-nhưng-không-ghi-được bị xoá oan.
   */
  async checkTaskInScopeTx(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    scope: DataScope,
    mode: TaskScopeMode,
  ): Promise<boolean> {
    if (scope === "Company" || scope === "System") return true;
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
    return scoped !== undefined;
  }
}
