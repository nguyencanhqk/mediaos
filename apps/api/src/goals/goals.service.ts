import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  CreateGoalRequest,
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
import { OutboxService } from "../events/outbox.service";
import { SequenceService } from "../foundation/sequences/sequence.service";
import { GoalProgressEngineService } from "../tasks/goal-progress-engine.service";
import type { Goal } from "../db/schema/goals";
import { GOAL_ERR } from "./goals.errors";
import {
  GoalAccessService,
  type GoalActorScope,
  type GoalRequestUser as RequestUser,
} from "./goal-access.service";
import { buildGoalTree, toGoalCoreDto } from "./goals.mapper";
import { goalAssignedPayload } from "./goal-noti.payload";
import { GoalsRepository, type GoalListFilter, type GoalPatchValues } from "./goals.repository";
import {
  GoalsValidationService,
  type GoalDesiredState,
  type ResolvedGoalWrite,
} from "./goals-validation.service";

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
 * PHÂN TẦNG QUYỀN (2 lớp — mirror TASK đợt C nhưng MÃ LỖI KHÁC) nằm TRỌN ở `GoalAccessService`
 * (S5-GOAL-BE-2 tách ra để 3 đường ghi mới — check-in/finalize/link — dùng CHUNG một bản luật):
 *   lớp 1 = cặp (action,'goal') + data_scope (PermissionGuard ở controller + resolveAndAssert);
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
    private readonly sequence: SequenceService,
    private readonly access: GoalAccessService,
    private readonly engine: GoalProgressEngineService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────────

  async listGoals(user: RequestUser, query: ListGoalsQueryRequest): Promise<GoalCoreResponseDto[]> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "view");
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
      const actor = await this.access.resolveActorScope(tx, user, "view");
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
      const actor = await this.access.resolveActorScope(tx, user, "view");
      const goal = await this.access.loadReadableGoalTx(tx, user, id, actor);
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
      const actor = await this.access.resolveActorScope(tx, user, "create");
      const desired = this.desiredFromCreate(dto);
      const resolved = await this.validator.resolve(tx, user.companyId, desired, {
        actorEmployeeId: actor.actorEmployeeId,
      });
      await this.assertWriteAllowed(tx, user, actor, resolved);
      await this.access.assertParentVisible(tx, user, resolved.values.parentGoalId);

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
      // SPEC-10 §17 GOAL_ASSIGNED — CHỈ khi giao cho NGƯỜI KHÁC. Tự đặt mục tiêu cho mình thì im lặng.
      await this.enqueueGoalAssignedIfNeeded(tx, user, actor, row, null);
      // Mục tiêu mới đã có thể đo được ngay (mode 'project'/'children' có sẵn nguồn số) ⇒ recompute
      // để `progress_percent` không đứng NULL cho tới lần đổi task đầu tiên. Rồi tính lại CHA: một con
      // mới xuất hiện làm đổi mẫu số rollup của cha dù tiến độ con chưa đo được.
      await this.engine.recomputeGoalTx(tx, user.companyId, row.id);
      await this.engine.recomputeParentTx(tx, user.companyId, row.parentGoalId);
      const measured = await this.repo.findByIdTx(tx, user.companyId, row.id);
      return toGoalCoreDto(measured ?? row);
    });
  }

  /** GOAL-API-004 — re-validate TOÀN BỘ trạng thái sau merge (không patch từng field rời rạc). */
  async updateGoal(
    user: RequestUser,
    id: string,
    dto: UpdateGoalRequest,
  ): Promise<GoalCoreResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "update");
      const current = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!current) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
      const currentAnchorDepartmentId = await this.access.anchorDepartmentOf(
        tx,
        user.companyId,
        current,
      );
      await this.access.assertWriteAllowedOnExisting(
        tx,
        user,
        actor,
        current,
        currentAnchorDepartmentId,
      );
      this.access.assertNotFinalized(current);

      const desired = this.desiredFromUpdate(current, dto);
      const resolved = await this.validator.resolve(tx, user.companyId, desired, {
        goalId: id,
        actorEmployeeId: actor.actorEmployeeId,
      });
      await this.assertWriteAllowed(tx, user, actor, resolved, {
        departmentId: current.departmentId,
        projectId: current.projectId,
        employeeId: current.employeeId,
      });
      if (resolved.values.parentGoalId !== current.parentGoalId) {
        await this.access.assertParentVisible(tx, user, resolved.values.parentGoalId);
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
      await this.enqueueGoalAssignedIfNeeded(tx, user, actor, updated, current);

      // GOAL-ERR-013 — đổi cách đo (hoặc đổi neo/measure/target) ⇒ số cũ KHÔNG còn nghĩa: recompute
      // NGAY trong cùng tx. Gọi vô điều kiện (engine tự no-op khi không có gì đổi) thay vì chỉ khi
      // `progressMode` đổi: đổi `project_id` của goal mode='project' hay `target_value` của mode
      // 'manual' cũng làm cache sai y hệt mà không đụng tới cột progress_mode.
      await this.engine.recomputeGoalTx(tx, user.companyId, id);
      // ⚠️ CHA PHẢI ĐƯỢC TÍNH LẠI RIÊNG (bug thật, int-spec P4 bắt được): huỷ/đổi trọng số/di dời một
      // mục tiêu con KHÔNG làm tiến độ CỦA CHÍNH NÓ đổi ⇒ `recomputeGoalTx` không bubble, và cha giữ
      // số cũ. Tính CẢ cha CŨ lẫn cha MỚI khi mục tiêu vừa đổi nhánh.
      await this.engine.recomputeParentTx(tx, user.companyId, current.parentGoalId);
      if (updated.parentGoalId !== current.parentGoalId) {
        await this.engine.recomputeParentTx(tx, user.companyId, updated.parentGoalId);
      }
      const measured = await this.repo.findByIdTx(tx, user.companyId, id);
      return toGoalCoreDto(measured ?? updated);
    });
  }

  /** GOAL-API-005 — xoá MỀM; còn goal con chưa xoá ⇒ 422 GOAL-ERR-007 (KHÔNG xoá lan). */
  async deleteGoal(user: RequestUser, id: string): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "delete");
      const current = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!current) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
      const anchorDepartmentId = await this.access.anchorDepartmentOf(tx, user.companyId, current);
      await this.access.assertWriteAllowedOnExisting(tx, user, actor, current, anchorDepartmentId);
      this.access.assertNotFinalized(current);

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
      // Con biến mất khỏi rollup của cha (SPEC-10 §13.1 mode='children' chỉ đếm con `deleted_at IS NULL`).
      await this.engine.recomputeParentTx(tx, user.companyId, current.parentGoalId);
    });
  }

  // ── Thông báo (SPEC-10 §17) ──────────────────────────────────────────────────

  /**
   * GOAL_ASSIGNED — "được giao mục tiêu mới". Điều kiện phát (SPEC-10 §17): goal **cấp employee** và
   * `owner_employee_id` ≠ nhân viên của actor. Tự đặt mục tiêu cho chính mình ⇒ IM LẶNG (không ai muốn
   * nhận thông báo về việc mình vừa làm).
   *
   * Ở đường UPDATE chỉ phát khi người phụ trách THỰC SỰ ĐỔI (`before.ownerEmployeeId !== after`) —
   * nếu không, mỗi lần sửa tiêu đề lại bắn một thông báo "được giao mục tiêu mới" cho cùng một người.
   *
   * Enqueue TRONG tx nghiệp vụ (outbox) ⇒ rollback thì thông báo cũng biến mất. Recipient KHÔNG resolve
   * ở đây: `GoalNotiBridgeRegistrar` đọc audience HIỆN TẠI lúc consumer chạy (mirror TASK).
   */
  private async enqueueGoalAssignedIfNeeded(
    tx: TenantTx,
    user: RequestUser,
    actor: GoalActorScope,
    goal: Goal,
    before: Goal | null,
  ): Promise<void> {
    if (goal.level !== "employee") return;
    if (actor.actorEmployeeId !== null && goal.ownerEmployeeId === actor.actorEmployeeId) return;
    if (before !== null && before.ownerEmployeeId === goal.ownerEmployeeId) return;
    const assignerName = await this.repo.findUserDisplayNameTx(tx, user.companyId, user.id);
    await this.outbox.enqueue(tx, {
      eventType: "goal.assigned",
      payload: goalAssignedPayload(goal, assignerName ?? "Hệ thống"),
    });
  }

  // ── Scope helpers (uỷ quyền TOÀN BỘ cho GoalAccessService — S5-GOAL-BE-2) ────

  /**
   * Cầu nối HẸP giữa `ResolvedGoalWrite` (đầu ra của validator) và `GoalAccessService.assertWriteAllowed`
   * (nhận trạng thái ĐÍCH thuần dữ liệu). Giữ ở đây vì chỉ create/update mới có khái niệm "trạng thái đích";
   * 3 writer mới của BE-2 thao tác trên hàng ĐÃ LƯU nên gọi thẳng `assertCanWriteExistingGoal`.
   */
  private async assertWriteAllowed(
    tx: TenantTx,
    user: RequestUser,
    actor: GoalActorScope,
    resolved: ResolvedGoalWrite,
    current?: { departmentId: string | null; projectId: string | null; employeeId: string | null },
  ): Promise<void> {
    await this.access.assertWriteAllowed(
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
      current,
      {
        departmentId: resolved.values.departmentId,
        projectId: resolved.values.projectId,
        employeeId: resolved.values.employeeId,
      },
    );
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
