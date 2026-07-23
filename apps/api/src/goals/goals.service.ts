import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { SQL } from "drizzle-orm";
import type {
  CreateGoalRequest,
  DataScope,
  GoalCoreResponseDto,
  GoalDetailResponseDto,
  GoalTreeNodeDto,
  GoalTreeQueryRequest,
  ListGoalsQueryRequest,
  MeGoalsQueryRequest,
  UpdateGoalRequest,
} from "@mediaos/contracts";
import { GOAL_PAGE_LIMIT_MAX } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { DataScopeService, type ScopeContext } from "../permission/data-scope.service";
import { SequenceService } from "../foundation/sequences/sequence.service";
import { ProjectAccessService } from "../tasks/project-access.service";
import type { Goal } from "../db/schema/goals";
import { GOAL_ERR } from "./goals.errors";
import { buildGoalTree, toGoalCoreDto } from "./goals.mapper";
import { GoalsRepository, type GoalListFilter, type GoalPatchValues } from "./goals.repository";
import {
  GoalsValidationService,
  type GoalDesiredState,
  type ResolvedGoalWrite,
} from "./goals-validation.service";

interface RequestUser {
  id: string;
  companyId: string;
}

/** Ngữ cảnh phạm vi của actor, resolve MỘT LẦN mỗi request rồi dùng cho cả đọc lẫn ghi. */
interface GoalActorScope {
  scope: DataScope;
  ctx: ScopeContext;
  deptOrgUnitIds: string[];
  actorEmployeeId: string | null;
  /** undefined = Company/System (thấy toàn tenant, KHÔNG áp predicate). */
  readScopeExists?: SQL;
}

const DEFAULT_LIST_LIMIT = 50;
/** Trần số nút một lần dựng cây (cây 1 phòng/1 kỳ ~200 nút — SPEC-10 §19). */
const TREE_NODE_CAP = 500;
/** sequence_counters seed 0506: key 'goal', scope Company, prefix 'GOAL-' pad 4 ⇒ GOAL-0001. */
const GOAL_CODE_SEQUENCE_KEY = "goal";

/**
 * S5-GOAL-BE-1 — GoalsService (SPEC-10 §10 FUNC-001/002 · §15 GOAL-API-001..006 + 013).
 *
 * BẤT BIẾN #1: mọi truy vấn đi qua `db.withTenant(companyId)` (RLS+FORCE) + repo AND `company_id`.
 * BẤT BIẾN #2: xoá MỀM (`deleted_at`); audit ghi TRONG CÙNG tx nghiệp vụ (rollback ⇒ mất cả hai).
 *
 * PHÂN TẦNG QUYỀN (2 lớp — mirror TASK đợt C nhưng MÃ LỖI KHÁC):
 *   lớp 1 = cặp (action,'goal') + data_scope (PermissionGuard ở controller + resolveAndAssert ở đây);
 *   lớp 2 = vai trò DỰ ÁN (ProjectAccessService) cho goal cấp dự án — Owner/Manager ghi được kể cả
 *           khác phòng ban (SPEC-10 §11 ghi chú).
 *
 * ⚠️ QUY ƯỚC 403-vs-404 CỦA GOAL (NGƯỢC pattern fail-closed-404 của TASK — đừng copy nguyên khối):
 *   goal TỒN TẠI trong tenant nhưng ngoài phạm vi actor ⇒ **403** (SPEC-10 §20.2: minh bạch in-tenant);
 *   goal/tham chiếu thuộc công ty khác ⇒ **404** (không bao giờ lộ tồn tại chéo tenant).
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GoalsRepository,
    private readonly validator: GoalsValidationService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
    private readonly sequence: SequenceService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────────

  async listGoals(user: RequestUser, query: ListGoalsQueryRequest): Promise<GoalCoreResponseDto[]> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActorScope(tx, user, "view");
      const rows = await this.repo.listTx(
        tx,
        user.companyId,
        {
          level: query.level,
          departmentId: query.departmentId,
          projectId: query.projectId,
          employeeId: query.employeeId,
          parentGoalId: query.parentGoalId,
          status: query.status,
          periodFrom: query.periodFrom,
          periodTo: query.periodTo,
          limit: this.clampLimit(query.limit),
          offset: query.offset && query.offset > 0 ? query.offset : 0,
        },
        actor.readScopeExists,
      );
      return rows.map(toGoalCoreDto);
    });
  }

  /** GOAL-API-006 — cây theo kỳ/phòng, dựng in-memory từ danh sách phẳng đã lọc scope. */
  async getTree(user: RequestUser, query: GoalTreeQueryRequest): Promise<GoalTreeNodeDto[]> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActorScope(tx, user, "view");
      const rows = await this.repo.listTx(
        tx,
        user.companyId,
        {
          departmentId: query.departmentId,
          status: query.status,
          periodFrom: query.periodFrom,
          periodTo: query.periodTo,
          // Lấy DƯ 1 nút để PHÁT HIỆN tràn: cắt câm ở đúng trần sẽ biến nút mất-cha thành nút GỐC
          // (goals.mapper) ⇒ người dùng thấy một cây hợp lệ nhưng SAI CẤU TRÚC mà không có cách nào biết.
          limit: TREE_NODE_CAP + 1,
          offset: 0,
        },
        actor.readScopeExists,
      );
      if (rows.length > TREE_NODE_CAP) {
        throw new UnprocessableEntityException(GOAL_ERR.TREE_TOO_LARGE(TREE_NODE_CAP));
      }
      return buildGoalTree(rows);
    });
  }

  /** GOAL-API-003 — chi tiết + breadcrumb cha + đếm con. 404 chéo tenant · 403 ngoài phạm vi. */
  async getGoal(user: RequestUser, id: string): Promise<GoalDetailResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActorScope(tx, user, "view");
      const goal = await this.loadReadableGoalTx(tx, user, id, actor);
      const parent = goal.parentGoalId
        ? await this.repo.findGoalRefTx(tx, user.companyId, goal.parentGoalId)
        : undefined;
      const childCount = await this.repo.countNonDeletedChildrenTx(tx, user.companyId, goal.id);
      return {
        ...toGoalCoreDto(goal),
        parent: parent
          ? {
              id: parent.id,
              goalCode: parent.goalCode,
              name: parent.name,
              level: parent.level as GoalDetailResponseDto["level"],
            }
          : null,
        childCount,
      };
    });
  }

  /**
   * GOAL-API-013 — "Mục tiêu của tôi". Chủ thể resolve TỪ TOKEN (SPEC-09 §14.4): DTO không có
   * `employeeId` và service KHÔNG đọc field nào từ client để xác định người — chống IDOR tận gốc.
   * Actor chưa liên kết hồ sơ nhân viên ⇒ danh sách RỖNG (không lỗi).
   */
  async getMyGoals(user: RequestUser, query: MeGoalsQueryRequest): Promise<GoalCoreResponseDto[]> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      if (!actorEmp) return [];
      const filter: GoalListFilter = {
        status: query.status,
        periodFrom: query.periodFrom,
        periodTo: query.periodTo,
        mineEmployeeId: actorEmp.id,
        limit: this.clampLimit(query.limit),
        offset: query.offset && query.offset > 0 ? query.offset : 0,
      };
      const rows = await this.repo.listTx(tx, user.companyId, filter);
      return rows.map(toGoalCoreDto);
    });
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  /**
   * GOAL-API-002. `goal_code` cấp qua SequenceService Ở TX RIÊNG TRƯỚC tx nghiệp vụ (FOR UPDATE ⇒ 0 mã
   * trùng; rollback ⇒ "đốt" 1 số, gap chấp nhận được — cùng khuôn task_code).
   * ⚠️ KHÔNG ensure-on-miss/fallback: counter 'goal' đã seed cho MỌI company ở migration 0506 — thiếu là
   * LỖI SEED THẬT, phải nổ để thấy, không được che bằng counter tự chế (chỉ thị WO).
   */
  async createGoal(user: RequestUser, dto: CreateGoalRequest): Promise<GoalCoreResponseDto> {
    const { code } = await this.sequence.nextCode(user.companyId, {
      sequenceKey: GOAL_CODE_SEQUENCE_KEY,
    });
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActorScope(tx, user, "create");
      const desired = this.desiredFromCreate(dto);
      const resolved = await this.validator.resolve(tx, user.companyId, desired, {
        actorEmployeeId: actor.actorEmployeeId,
      });
      await this.assertWriteAllowed(tx, user, actor, resolved);
      await this.assertParentVisible(tx, user, resolved.values.parentGoalId);

      const v = resolved.values;
      const row = await this.repo.insertTx(tx, user.companyId, {
        goalCode: code,
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
        targetValue: v.targetValue === null ? null : String(v.targetValue),
        unit: v.unit,
        progressMode: v.progressMode,
        weight: String(v.weight),
        status: v.status,
        createdBy: user.id,
      });
      await this.audit.record(tx, {
        action: "GoalCreated",
        objectType: "goal",
        objectId: row.id,
        actorUserId: user.id,
        after: this.auditSnapshot(row),
      });
      return toGoalCoreDto(row);
    });
  }

  /** GOAL-API-004 — re-validate TOÀN BỘ trạng thái sau merge (không patch từng field rời rạc). */
  async updateGoal(
    user: RequestUser,
    id: string,
    dto: UpdateGoalRequest,
  ): Promise<GoalCoreResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActorScope(tx, user, "update");
      const current = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!current) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
      const currentAnchorDepartmentId = await this.anchorDepartmentOf(tx, user.companyId, current);
      await this.assertWriteAllowedOnExisting(tx, user, actor, current, currentAnchorDepartmentId);
      this.assertNotFinalized(current);

      const desired = this.desiredFromUpdate(current, dto);
      const resolved = await this.validator.resolve(tx, user.companyId, desired, {
        goalId: id,
        actorEmployeeId: actor.actorEmployeeId,
      });
      await this.assertWriteAllowed(tx, user, actor, resolved, {
        anchorDepartmentId: currentAnchorDepartmentId,
      });
      if (resolved.values.parentGoalId !== current.parentGoalId) {
        await this.assertParentVisible(tx, user, resolved.values.parentGoalId);
      }

      const v = resolved.values;
      const patch: GoalPatchValues = {
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
        targetValue: v.targetValue === null ? null : String(v.targetValue),
        unit: v.unit,
        progressMode: v.progressMode,
        weight: String(v.weight),
        status: v.status,
      };
      const updated = await this.repo.updateTx(tx, user.companyId, id, patch, user.id);
      if (!updated) throw new NotFoundException(GOAL_ERR.NOT_FOUND);

      await this.audit.record(tx, {
        action: "GoalUpdated",
        objectType: "goal",
        objectId: id,
        actorUserId: user.id,
        before: this.auditSnapshot(current),
        after: this.auditSnapshot(updated),
      });
      return toGoalCoreDto(updated);
    });
  }

  /** GOAL-API-005 — xoá MỀM; còn goal con chưa xoá ⇒ 422 GOAL-ERR-007 (KHÔNG xoá lan). */
  async deleteGoal(user: RequestUser, id: string): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.resolveActorScope(tx, user, "delete");
      const current = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!current) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
      const anchorDepartmentId = await this.anchorDepartmentOf(tx, user.companyId, current);
      await this.assertWriteAllowedOnExisting(tx, user, actor, current, anchorDepartmentId);
      this.assertNotFinalized(current);

      const children = await this.repo.countNonDeletedChildrenTx(tx, user.companyId, id);
      if (children > 0) throw new UnprocessableEntityException(GOAL_ERR.HAS_CHILDREN);

      const deleted = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
      if (!deleted) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
      await this.audit.record(tx, {
        action: "GoalDeleted",
        objectType: "goal",
        objectId: id,
        actorUserId: user.id,
        before: this.auditSnapshot(current),
      });
    });
  }

  // ── Scope helpers ────────────────────────────────────────────────────────────

  /**
   * Gate cặp (action,'goal') + dựng ngữ cảnh phạm vi. `resolveAndAssert` ném 403 khi actor KHÔNG có
   * grant — trùng lớp PermissionGuard ở controller (defense-in-depth, không thừa: service còn được
   * gọi từ job/bridge trong tương lai).
   */
  private async resolveActorScope(
    tx: TenantTx,
    user: RequestUser,
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
  private async loadReadableGoalTx(
    tx: TenantTx,
    user: RequestUser,
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
  private async assertParentVisible(
    tx: TenantTx,
    user: RequestUser,
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
   * Phạm vi GHI trên bản ghi ĐANG CÓ (update/delete) — anchor resolve từ chính hàng đó.
   * Ở đường này `ownerEmployeeId` là dữ liệu ĐÃ LƯU (người khác gán cho actor), KHÔNG do actor tự khai
   * trong request ⇒ cho phép vế "người phụ trách" (xem `assertWriteTarget`).
   */
  private async assertWriteAllowedOnExisting(
    tx: TenantTx,
    user: RequestUser,
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
   * Phạm vi GHI trên trạng thái ĐÍCH (create/update sau merge).
   *
   * 🔒 LEO QUYỀN ĐÃ CHẶN (finding HIGH-1, FULL gate 2026-07-23 — có repro 201 nơi phải 403):
   * `ownerEmployeeId` ở đường này do CLIENT khai, và khi vắng thì validator suy về CHÍNH ACTOR
   * (`GoalsValidationService.resolveOwner`). Nếu chấp nhận vế "actor là người phụ trách" ở đây thì mọi
   * trưởng đơn vị chỉ cần bỏ trống `ownerEmployeeId` là tạo được mục tiêu neo vào PHÒNG/DỰ ÁN BẤT KỲ
   * (create:goal@Department ≈ @Company) rồi giữ nguyên quyền sửa/xoá vì vẫn là owner.
   * ⇒ CREATE: chỉ chấp nhận neo trong phòng actor (`allowOwnerFallback = false`).
   * ⇒ UPDATE: chấp nhận vế owner CHỈ KHI neo KHÔNG ĐỔI (`currentAnchorDepartmentId`) — giữ được quyền
   *   sửa mục tiêu mình ĐƯỢC GIAO ở phòng khác, nhưng cấm dùng quyền owner để DI DỜI sang phòng thứ ba.
   */
  private async assertWriteAllowed(
    tx: TenantTx,
    user: RequestUser,
    actor: GoalActorScope,
    resolved: ResolvedGoalWrite,
    current?: { anchorDepartmentId: string | null },
  ): Promise<void> {
    if (actor.scope === "Company" || actor.scope === "System") return;
    const anchorUnchanged =
      current !== undefined && current.anchorDepartmentId === resolved.anchorDepartmentId;
    await this.assertWriteTarget(
      tx,
      user,
      actor,
      {
        level: resolved.values.level,
        projectId: resolved.values.projectId,
        employeeId: resolved.values.employeeId,
        ownerEmployeeId: resolved.values.ownerEmployeeId,
        anchorDepartmentId: resolved.anchorDepartmentId,
      },
      anchorUnchanged,
    );
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
  private async assertWriteTarget(
    tx: TenantTx,
    user: RequestUser,
    actor: GoalActorScope,
    target: {
      level: string;
      projectId: string | null;
      employeeId: string | null;
      ownerEmployeeId: string;
      anchorDepartmentId: string | null;
    },
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
   * GOAL-ERR-005 — goal đã chốt kỳ thì ĐÓNG BĂNG (SPEC-10 §12 · §15 GOAL-API-004).
   * BE-1 chưa có writer cho `finalized_at` (chốt/reopen = S5-GOAL-BE-2) nên nhánh này CHƯA kích hoạt
   * được qua API — nhưng route PATCH/DELETE đã LIVE, để trống là guard rơi giữa 2 WO: ngày BE-2 bật
   * chốt kỳ thì hai đường ghi này vẫn sửa/xoá được số ĐÃ CHỐT. Giữ nguyên, đừng dọn vì "chưa dùng".
   */
  private assertNotFinalized(goal: Goal): void {
    if (goal.finalizedAt) throw new UnprocessableEntityException(GOAL_ERR.FINALIZED);
  }

  /** Phòng ban SUY RA của một goal đã lưu (dự án → phòng dự án · nhân viên → phòng nhân viên). */
  private async anchorDepartmentOf(
    tx: TenantTx,
    companyId: string,
    goal: Goal,
  ): Promise<string | null> {
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

  // ── Chuẩn hoá payload → trạng thái mong muốn ─────────────────────────────────

  private desiredFromCreate(dto: CreateGoalRequest): GoalDesiredState {
    return {
      name: dto.name,
      description: dto.description ?? null,
      level: dto.level,
      departmentId: dto.departmentId ?? null,
      projectId: dto.projectId ?? null,
      employeeId: dto.employeeId ?? null,
      parentGoalId: dto.parentGoalId ?? null,
      ownerEmployeeId: dto.ownerEmployeeId ?? null,
      periodType: dto.periodType ?? "custom",
      periodStart: dto.periodStart ?? null,
      periodEnd: dto.periodEnd ?? null,
      measureType: dto.measureType ?? "percent",
      targetValue: dto.targetValue ?? null,
      unit: dto.unit ?? null,
      progressMode: dto.progressMode ?? "manual",
      weight: dto.weight ?? 1,
      status: dto.status ?? "Draft",
    };
  }

  /**
   * MERGE bản ghi hiện tại với payload. `undefined` = giữ nguyên; `null` = xoá giá trị.
   * ⚠️ Đổi `level` mà KHÔNG gửi neo mới ⇒ neo cũ giữ nguyên ⇒ validator bắt GOAL-ERR-001 (đúng ý:
   * đổi cấp phải kèm neo mới, không có "cấp mới neo cũ" im lặng).
   */
  private desiredFromUpdate(current: Goal, dto: UpdateGoalRequest): GoalDesiredState {
    const pick = <T>(next: T | null | undefined, prev: T | null): T | null =>
      next === undefined ? prev : (next ?? null);
    return {
      name: dto.name ?? current.name,
      description: pick(dto.description, current.description),
      level: dto.level ?? current.level,
      departmentId: pick(dto.departmentId, current.departmentId),
      projectId: pick(dto.projectId, current.projectId),
      employeeId: pick(dto.employeeId, current.employeeId),
      parentGoalId: pick(dto.parentGoalId, current.parentGoalId),
      ownerEmployeeId: pick(dto.ownerEmployeeId, current.ownerEmployeeId),
      periodType: dto.periodType ?? current.periodType,
      periodStart: dto.periodStart ?? current.periodStart,
      periodEnd: dto.periodEnd ?? current.periodEnd,
      measureType: dto.measureType ?? current.measureType,
      targetValue:
        dto.targetValue === undefined
          ? current.targetValue === null
            ? null
            : Number(current.targetValue)
          : (dto.targetValue ?? null),
      unit: pick(dto.unit, current.unit),
      progressMode: dto.progressMode ?? current.progressMode,
      weight: dto.weight ?? Number(current.weight),
      status: dto.status ?? current.status,
    };
  }

  /**
   * Snapshot audit — CHỈ trường nhận dạng/định vị/tiến độ (BẤT BIẾN #3: không PII, không số nhạy cảm).
   * Đúng phạm vi đã ghi chú sẵn ở schema/audit.ts cho object_type='goal'.
   */
  private auditSnapshot(row: Goal): Record<string, unknown> {
    return {
      goalCode: row.goalCode,
      name: row.name,
      level: row.level,
      departmentId: row.departmentId,
      projectId: row.projectId,
      employeeId: row.employeeId,
      parentGoalId: row.parentGoalId,
      ownerEmployeeId: row.ownerEmployeeId,
      periodType: row.periodType,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      progressMode: row.progressMode,
      progressPercent: row.progressPercent,
      weight: row.weight,
      status: row.status,
    };
  }

  private clampLimit(limit?: number): number {
    if (!limit || limit <= 0) return DEFAULT_LIST_LIMIT;
    return Math.min(Math.floor(limit), GOAL_PAGE_LIMIT_MAX);
  }
}
