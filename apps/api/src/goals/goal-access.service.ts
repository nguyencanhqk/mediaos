import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { DataScopeService, type ScopeContext } from "../permission/data-scope.service";
import { ProjectAccessService } from "../tasks/project-access.service";
import type { Goal } from "../db/schema/goals";
import { GOAL_ERR } from "./goals.errors";
import { GoalsRepository } from "./goals.repository";

export interface GoalRequestUser {
  id: string;
  companyId: string;
}

/** Ngữ cảnh phạm vi của actor, resolve MỘT LẦN mỗi request rồi dùng cho cả đọc lẫn ghi. */
export interface GoalActorScope {
  scope: DataScope;
  ctx: ScopeContext;
  deptOrgUnitIds: string[];
  actorEmployeeId: string | null;
  /** undefined = Company/System (thấy toàn tenant, KHÔNG áp predicate). */
  readScopeExists?: SQL;
}

/** Trạng thái ĐÍCH của một phép ghi (create/update sau merge, hoặc bản ghi đã lưu). */
export interface GoalWriteTarget {
  level: string;
  projectId: string | null;
  employeeId: string | null;
  ownerEmployeeId: string;
  anchorDepartmentId: string | null;
}

/**
 * S5-GOAL-BE-2 — GoalAccessService: TOÀN BỘ lớp phạm vi/gate của module GOAL, tách NGUYÊN VĂN khỏi
 * `GoalsService` (S5-GOAL-BE-1) bằng một phép DI CHUYỂN THUẦN (không đổi luật, không đổi thông điệp).
 *
 * Vì sao tách: BE-2 thêm 3 đường ghi mới (check-in · finalize/reopen · link/unlink task) và CẢ BA phải
 * đi qua ĐÚNG các luật này. Để chúng ở `GoalsService` thì hoặc phải import chéo service (cycle), hoặc
 * copy luật sang 3 nơi — bản sao thứ hai của luật quyền là bản sao sẽ trôi.
 *
 * ⚠️ QUY ƯỚC 403-vs-404 CỦA GOAL (NGƯỢC pattern fail-closed-404 của TASK — đừng copy nguyên khối):
 *   goal TỒN TẠI trong tenant nhưng ngoài phạm vi actor ⇒ **403** (SPEC-10 §20.2: minh bạch in-tenant);
 *   goal/tham chiếu thuộc công ty khác ⇒ **404** (không bao giờ lộ tồn tại chéo tenant).
 */
@Injectable()
export class GoalAccessService {
  constructor(
    private readonly repo: GoalsRepository,
    private readonly dataScope: DataScopeService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * Gate cặp (action,'goal') + dựng ngữ cảnh phạm vi. `resolveAndAssert` ném 403 khi actor KHÔNG có
   * grant — trùng lớp PermissionGuard ở controller (defense-in-depth, không thừa: service còn được
   * gọi từ job/bridge trong tương lai).
   */
  async resolveActorScope(
    tx: TenantTx,
    user: GoalRequestUser,
    action: string,
  ): Promise<GoalActorScope> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, action, "goal");
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
    // Bậc phòng ban CHỈ có nghĩa với scope 'Department' (phòng mình ∪ phòng mình phụ trách — mirror
    // DataScopeService.departmentOrgUnitIds). Với Own/Team phải để RỖNG: nếu không, người scope Own
    // sẽ đọc/ghi được MỌI mục tiêu cấp phòng của phòng mình = nới quyền câm.
    const deptOrgUnitIds =
      scope === "Department"
        ? [...new Set([...(ctx.orgUnitId ? [ctx.orgUnitId] : []), ...(ctx.headedOrgUnitIds ?? [])])]
        : [];
    const base: GoalActorScope = {
      scope,
      ctx,
      deptOrgUnitIds,
      actorEmployeeId: actorEmp?.id ?? null,
    };
    if (scope === "Company" || scope === "System") return base;
    return {
      ...base,
      readScopeExists: this.repo.buildReadScopeExists(
        user.companyId,
        this.dataScope.buildEmployeeScopeCondition(scope, ctx),
        deptOrgUnitIds,
        base.actorEmployeeId,
        user.id,
      ),
    };
  }

  /** 404 khi không thuộc tenant · 403 khi thuộc tenant nhưng ngoài phạm vi ĐỌC (§20.2). */
  async loadReadableGoalTx(
    tx: TenantTx,
    user: GoalRequestUser,
    id: string,
    actor: GoalActorScope,
  ): Promise<Goal> {
    const goal = await this.repo.findByIdTx(tx, user.companyId, id);
    if (!goal) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
    if (!actor.readScopeExists) return goal;
    const inScope = await this.repo.isInReadScopeTx(tx, user.companyId, id, actor.readScopeExists);
    if (!inScope) throw new ForbiddenException(GOAL_ERR.FORBIDDEN);
    return goal;
  }

  /**
   * GẮN CHA = liên kết dữ liệu giữa hai nhánh cây ⇒ chỉ được gắn vào mục tiêu actor NHÌN THẤY
   * (phạm vi của cặp ('view','goal'), KHÔNG phải phạm vi ghi). Vì sao dùng view chứ không dùng write:
   * nhân viên @Own hợp lệ khi treo mục tiêu cá nhân dưới mục tiêu PHÒNG MÌNH (thấy được), nhưng KHÔNG
   * được treo sang phòng khác — treo được sang phòng khác là đẩy dữ liệu của mình vào cây người ta.
   * Cha ngoài tenant đã bị chặn từ validator (404) trước khi tới đây.
   */
  async assertParentVisible(
    tx: TenantTx,
    user: GoalRequestUser,
    parentGoalId: string | null,
  ): Promise<void> {
    if (!parentGoalId) return;
    const viewActor = await this.resolveActorScope(tx, user, "view");
    if (!viewActor.readScopeExists) return;
    const visible = await this.repo.isInReadScopeTx(
      tx,
      user.companyId,
      parentGoalId,
      viewActor.readScopeExists,
    );
    if (!visible) throw new ForbiddenException(GOAL_ERR.FORBIDDEN_PARENT);
  }

  /**
   * Phạm vi GHI trên bản ghi ĐANG CÓ (update/delete/check-in/finalize/link) — anchor resolve từ chính
   * hàng đó. Ở đường này `ownerEmployeeId` là dữ liệu ĐÃ LƯU (người khác gán cho actor), KHÔNG do actor
   * tự khai trong request ⇒ cho phép vế "người phụ trách" (xem `assertWriteTarget`).
   */
  async assertWriteAllowedOnExisting(
    tx: TenantTx,
    user: GoalRequestUser,
    actor: GoalActorScope,
    goal: Goal,
    anchorDepartmentId: string | null,
  ): Promise<void> {
    if (actor.scope === "Company" || actor.scope === "System") return;
    await this.assertWriteTarget(
      tx,
      user,
      actor,
      {
        level: goal.level,
        projectId: goal.projectId,
        employeeId: goal.employeeId,
        ownerEmployeeId: goal.ownerEmployeeId,
        anchorDepartmentId,
      },
      true,
    );
  }

  /**
   * Phạm vi GHI trên bản ghi đã lưu, TỰ resolve phòng-ban-suy-ra (đường tắt cho các writer BE-2:
   * check-in/finalize/link — chúng luôn thao tác trên hàng ĐÃ CÓ, không có "trạng thái đích" như PATCH).
   */
  async assertCanWriteExistingGoal(
    tx: TenantTx,
    user: GoalRequestUser,
    actor: GoalActorScope,
    goal: Goal,
  ): Promise<void> {
    const anchorDepartmentId = await this.anchorDepartmentOf(tx, user.companyId, goal);
    await this.assertWriteAllowedOnExisting(tx, user, actor, goal, anchorDepartmentId);
  }

  /**
   * Phạm vi GHI trên trạng thái ĐÍCH (create/update sau merge).
   *
   * 🔒 LEO QUYỀN ĐÃ CHẶN (finding HIGH-1, FULL gate 2026-07-23 — có repro 201 nơi phải 403):
   * `ownerEmployeeId` ở đường này do CLIENT khai, và khi vắng thì validator suy về CHÍNH ACTOR
   * (`GoalsValidationService.resolveOwner`). Nếu chấp nhận vế "actor là người phụ trách" ở đây thì mọi
   * trưởng đơn vị chỉ cần bỏ trống `ownerEmployeeId` là tạo được mục tiêu neo vào PHÒNG/DỰ ÁN BẤT KỲ
   * (create:goal@Department ≈ @Company) rồi giữ nguyên quyền sửa/xoá vì vẫn là owner.
   * ⇒ CREATE: chỉ chấp nhận neo trong phòng actor (`allowOwnerFallback = false`).
   * ⇒ UPDATE: chấp nhận vế owner CHỈ KHI **bộ ba neo giữ NGUYÊN Y HỆT** — giữ được quyền sửa TẠI CHỖ
   *   mục tiêu mình ĐƯỢC GIAO ở phòng khác, nhưng cấm mọi kiểu DI DỜI.
   *
   * ⚠️ So `department_id/project_id/employee_id` (ĐỊNH DANH neo), KHÔNG so `anchorDepartmentId`
   * (finding MEDIUM-4, gate vòng 2): `anchorDepartmentId` là giá trị SUY RA (dự án → phòng dự án),
   * nên hai dự án khác nhau CÙNG một phòng cho ra cùng giá trị ⇒ người phụ trách chuyển được mục tiêu
   * sang dự án mình không có vai trò, miễn cùng phòng. Không vượt biên phòng nhưng làm bẩn rollup
   * `progress_mode='project'` ở S5-GOAL-BE-2. Đừng "tối giản" lại thành so phòng.
   */
  async assertWriteAllowed(
    tx: TenantTx,
    user: GoalRequestUser,
    actor: GoalActorScope,
    target: GoalWriteTarget,
    current?: { departmentId: string | null; projectId: string | null; employeeId: string | null },
    desiredAnchors?: {
      departmentId: string | null;
      projectId: string | null;
      employeeId: string | null;
    },
  ): Promise<void> {
    if (actor.scope === "Company" || actor.scope === "System") return;
    const anchorUnchanged =
      current !== undefined &&
      desiredAnchors !== undefined &&
      current.departmentId === desiredAnchors.departmentId &&
      current.projectId === desiredAnchors.projectId &&
      current.employeeId === desiredAnchors.employeeId;
    await this.assertWriteTarget(tx, user, actor, target, anchorUnchanged);
  }

  /**
   * Luật ghi khi scope < Company (theo THỨ TỰ):
   *   1. cấp DỰ ÁN  — Owner/Manager Active của đúng dự án ⇒ CHO, kể cả khác phòng ban (SPEC-10 §11
   *      ghi chú: vai trò dự án cắt ngang phòng ban). KHÔNG phải member đủ vai ⇒ RƠI XUỐNG luật scope
   *      bên dưới (trưởng đơn vị vẫn quản mục tiêu dự án THUỘC PHÒNG MÌNH — "department = cả 3 cấp
   *      trong phòng"); đừng đổi thành throw sớm.
   *   2. Own        — CHỈ mục tiêu cá nhân của chính actor (nhân viên không tạo mục tiêu phòng/dự án).
   *   3. Department — neo nằm trong phòng actor (phòng mình ∪ phòng mình phụ trách) HOẶC actor là người
   *                  phụ trách chính mục tiêu đó **và `allowOwnerFallback`**.
   * Không khớp ⇒ 403 (bản ghi vẫn tồn tại với actor — GOAL minh bạch in-tenant).
   *
   * `allowOwnerFallback` = "được phép dùng vế NGƯỜI PHỤ TRÁCH". Bật cho trạng thái ĐÃ LƯU (update/delete
   * trên hàng hiện có, hoặc update không di dời neo); TẮT cho trạng thái ĐÍCH của CREATE — nơi
   * `ownerEmployeeId` do client khai/suy về chính actor nên vế owner TỰ THOẢ (chi tiết ở
   * `assertWriteAllowed`). Đừng gộp lại thành một luật "cho gọn".
   */
  async assertWriteTarget(
    tx: TenantTx,
    user: GoalRequestUser,
    actor: GoalActorScope,
    target: GoalWriteTarget,
    allowOwnerFallback: boolean,
  ): Promise<void> {
    if (target.level === "project" && target.projectId) {
      const membership = await this.projectAccess.getMembershipTx(
        tx,
        user.companyId,
        target.projectId,
        actor.actorEmployeeId,
        user.id,
      );
      if (membership && (membership.role === "Owner" || membership.role === "Manager")) return;
    }

    if (actor.scope === "Own") {
      const isOwnEmployeeGoal =
        target.level === "employee" &&
        actor.actorEmployeeId !== null &&
        target.employeeId === actor.actorEmployeeId &&
        target.ownerEmployeeId === actor.actorEmployeeId;
      if (isOwnEmployeeGoal) return;
      throw new ForbiddenException(GOAL_ERR.FORBIDDEN_CREATE);
    }

    const inDepartment =
      target.anchorDepartmentId !== null &&
      actor.deptOrgUnitIds.includes(target.anchorDepartmentId);
    const isOwner =
      allowOwnerFallback &&
      actor.actorEmployeeId !== null &&
      target.ownerEmployeeId === actor.actorEmployeeId;
    if (inDepartment || isOwner) return;
    throw new ForbiddenException(GOAL_ERR.FORBIDDEN_CREATE);
  }

  /**
   * GOAL-ERR-005 — goal đã chốt kỳ thì ĐÓNG BĂNG (SPEC-10 §12 · §13.4). MỌI đường ghi của GOAL
   * (update · delete · check-in · link/unlink · phân rã) gọi hàm này TRƯỚC khi chạm dữ liệu. Recompute
   * tự động không dùng hàm này mà tự bỏ qua im lặng (goal đã chốt KHÔNG phải lỗi của người đổi task).
   */
  assertNotFinalized(goal: Goal): void {
    if (goal.finalizedAt) throw new UnprocessableEntityException(GOAL_ERR.FINALIZED);
  }

  /** Phòng ban SUY RA của một goal đã lưu (dự án → phòng dự án · nhân viên → phòng nhân viên). */
  async anchorDepartmentOf(tx: TenantTx, companyId: string, goal: Goal): Promise<string | null> {
    if (goal.departmentId) return goal.departmentId;
    if (goal.projectId) {
      const project = await this.repo.resolveProjectTx(tx, companyId, goal.projectId);
      return project?.departmentId ?? null;
    }
    if (goal.employeeId) {
      const employee = await this.repo.resolveEmployeeTx(tx, companyId, goal.employeeId);
      return employee?.orgUnitId ?? null;
    }
    return null;
  }
}
