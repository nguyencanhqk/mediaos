import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { SQL } from "drizzle-orm";
import type {
  CreateTaskCoreRequest,
  DataScope,
  ListTaskCoreQueryRequest,
  MoveTaskStateRequest,
  MyTaskItemDto,
  TaskCorePriorityDto,
  TaskCoreResponseDto,
  TaskCoreSourceDto,
  TaskCoreStatusDto,
  UpdateTaskCoreRequest,
} from "@mediaos/contracts";
import { TASK_CORE_PAGE_LIMIT_MAX } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { DataScopeService } from "../permission/data-scope.service";
import { PermissionService } from "../permission/permission.service";
import { SequenceService } from "../foundation/sequences/sequence.service";
import { allocateTaskCode } from "./task-code.util";
import { TasksRepository } from "./tasks.repository";
import {
  TaskCoreRepository,
  type EmployeeForScope,
  type MyTaskRow,
  type TaskCoreRow,
  type TaskRawRow,
} from "./task-core.repository";
import { TaskActivityService } from "./task-activity.service";
import { TaskActionsService } from "./task-actions.service";
import { coalesceTaskStatus, type TaskCoreStatus } from "./task-fsm";
import { STATE_GROUP_TO_STATUS, type ProjectStateGroup } from "./task-state-sync";

interface RequestUser {
  id: string;
  companyId: string;
}

/**
 * Task types do workflow engine (FSM) làm chủ vòng đời — task core KHÔNG sửa/xoá tay (mirror TasksService,
 * G7/ADR-0016). Regression: giữ nguyên guard hiện có, KHÔNG phá luồng chính.
 */
const WORKFLOW_TASK_TYPES = new Set<string>(["workflow_step", "production", "review", "revision"]);

const DEFAULT_LIST_LIMIT = 50;

/** Mã lỗi TASK (SPEC-01 §9 MODULE-ERR-XXX) — fail-loud, KHÔNG nuốt nhánh lỗi (silent-failure). */
const ERR = {
  NOT_FOUND: "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.",
  WORKFLOW_LOCKED:
    "TASK-ERR-TASK-WORKFLOW: công việc thuộc workflow — sửa/xoá qua workflow (submit/duyệt/trả về), không thao tác tay.",
  PROJECT_NOT_FOUND: "TASK-ERR-TASK-PROJECT-NOT-FOUND: không tìm thấy dự án.",
  PROJECT_CLOSED:
    "TASK-ERR-TASK-PROJECT-CLOSED: dự án đã đóng/huỷ/lưu trữ — không thể tạo/chuyển công việc vào dự án này.",
  DEPT_INVALID: "TASK-ERR-TASK-DEPT-INVALID: phòng ban không thuộc công ty.",
  ASSIGNEE_NOT_FOUND: "TASK-ERR-TASK-ASSIGNEE-NOT-FOUND: không tìm thấy nhân viên nhận việc.",
  ASSIGNEE_NOT_ACTIVE:
    "TASK-ERR-TASK-ASSIGNEE-INACTIVE: nhân viên nhận việc đã nghỉ/ngưng hoạt động — không thể giao.",
  ASSIGNEE_NO_ACCOUNT:
    "TASK-ERR-TASK-ASSIGNEE-NO-ACCOUNT: nhân viên nhận việc chưa có tài khoản người dùng.",
  ASSIGNEE_OUT_OF_SCOPE:
    "TASK-ERR-TASK-ASSIGNEE-OUT-OF-SCOPE: nhân viên nhận việc ngoài phạm vi giao việc của bạn.",
  // S5-TASK-PIPELINE-1 (API-06 §15.2/§26.2#12-13) — đường ghi state_id.
  STATE_NOT_FOUND: "TASK-ERR-STATE-NOT-FOUND: không tìm thấy cột.",
  STATE_INVALID: "TASK-ERR-STATE-INVALID: cột không thuộc dự án của công việc.",
} as const;

/**
 * S4-TASK-BE-2 — TaskCoreService (SPEC-06 task CRUD + my-tasks + filter). Business logic (KHÔNG ở controller).
 *
 * BẤT BIẾN #1: mọi query đi qua db.withTenant(companyId) (RLS+FORCE) + repo AND company_id tường minh.
 * BẤT BIẾN #2: soft-delete (KHÔNG hard-delete); audit + task_activity_logs ghi TRONG cùng tx nghiệp vụ.
 * PHÂN QUYỀN: controller gate cặp seed 0485 (read/create/update/delete:task); service thêm DATA-SCOPE ĐỌC
 *   (Own/Team EXISTS-join assignee + membership project) và scope-check assignee trên WRITE (fail-closed,
 *   tương-lai-sẵn-sàng dù create/update:task cho emp/mgr HIỆN HOÃN ở TASK_DEFERRED_GRANTS ⇒ chỉ actor
 *   Company gọi được hôm nay).
 */
@Injectable()
export class TaskCoreService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskCoreRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
    private readonly activity: TaskActivityService,
    // S5-NOTI-FIX-2 (additive) — cấp task_code (SequenceModule wired vào TasksModule).
    private readonly sequence: SequenceService,
    // S5-TASK-PIPELINE-1 (lane be-write) — auto-map qua changeStatusTx (lõi nhận tx, KHÔNG wrapper —
    // bẫy M1 deadlock) + isChecklistGateEnabled (hợp đồng đọc setting TRƯỚC tx).
    private readonly taskActions: TaskActionsService,
    // resolveStrongestScope KHÔNG-NÉM cho pair update-status: chỉ 403 khi auto-map THẬT SỰ đổi status
    // (plan 4b — kéo cùng nhóm không đòi update-status); null = thiếu pair, quyết trong tx (race-safe).
    private readonly permission: PermissionService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────────

  async listTasks(
    user: RequestUser,
    query: ListTaskCoreQueryRequest,
  ): Promise<TaskCoreResponseDto[]> {
    const limit = this.clampLimit(query.limit);
    const offset = query.offset && query.offset > 0 ? query.offset : 0;
    const rows = await this.db.withTenant(user.companyId, async (tx) => {
      const scopeExists = await this.resolveReadScopeExists(tx, user);
      return this.repo.listTx(
        tx,
        user.companyId,
        {
          status: query.status,
          priority: query.priority,
          assigneeEmployeeId: query.assigneeEmployeeId,
          projectId: query.projectId,
          dueFrom: query.dueFrom,
          dueTo: query.dueTo,
          overdue: query.overdue,
          limit,
          offset,
        },
        scopeExists,
      );
    });
    return rows.map((r) => this.toDto(r));
  }

  async getTask(user: RequestUser, id: string): Promise<TaskCoreResponseDto> {
    const row = await this.db.withTenant(user.companyId, async (tx) => {
      const scopeExists = await this.resolveReadScopeExists(tx, user);
      return this.repo.findScopedByIdTx(tx, user.companyId, id, scopeExists);
    });
    if (!row) throw new NotFoundException(ERR.NOT_FOUND);
    return this.toDto(row);
  }

  async getMyTasks(user: RequestUser): Promise<MyTaskItemDto[]> {
    // Gate read:task (TASK-API-210 — /my vẫn cần quyền đọc task); KHÔNG lọc scope (task CỦA CHÍNH MÌNH).
    await this.dataScope.resolveAndAssert(user.id, user.companyId, "read", "task");
    const rows = await this.db.withTenant(user.companyId, async (tx) => {
      const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      return this.repo.findMyTasksTx(tx, user.companyId, user.id, actorEmp?.id ?? null);
    });
    return rows.map((r) => this.toMyDto(r));
  }

  // ── Create ─────────────────────────────────────────────────────────────────────

  async createTask(user: RequestUser, dto: CreateTaskCoreRequest): Promise<TaskCoreResponseDto> {
    // Gate + scope (double-gate với PermissionGuard controller — defense-in-depth). Company/System = toàn tenant.
    const createScope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "create",
      "task",
    );
    // 3c — tạo THẲNG vào cột (nút "+ Thêm công việc" đáy cột board): stateId tường minh đòi THÊM
    // update-state:task (403 TRƯỚC khi tạo — không tạo task rồi mới chặn). Cột phải thuộc project.
    if (dto.stateId !== undefined) {
      await this.dataScope.resolveAndAssert(user.id, user.companyId, "update-state", "task");
      if (!dto.projectId) throw new BadRequestException(ERR.STATE_INVALID);
    }
    // S5-NOTI-FIX-2 / S5-TASK-HRCODE-1: cấp task_code Ở TX RIÊNG TRƯỚC business tx (mirror
    // allocateEmployeeCode) — counter FOR UPDATE serialize (0 dup) rồi COMMIT ngay, KHÔNG giữ lock suốt tx
    // insert dài. Rollback business tx ⇒ mã bị "đốt" (gap OK). Ném TRƯỚC insert nếu không cấp được ⇒ KHÔNG
    // tạo task task_code=NULL câm. Delegate tiện ích DÙNG CHUNG (task-code.util) — CÙNG logic + 1 điểm map
    // lỗi Inactive→409 với HR task (leave/attendance-adjustment). POST /tasks nay trả 409 (không 500 raw).
    const taskCode = await allocateTaskCode(this.db, this.sequence, user.companyId);
    return this.db.withTenant(user.companyId, async (tx) => {
      const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);

      if (dto.projectId) await this.assertProjectUsable(tx, user.companyId, dto.projectId);
      if (dto.departmentId) await this.assertDepartment(tx, user.companyId, dto.departmentId);

      const assignee = dto.assigneeEmployeeId
        ? await this.resolveAssignee(tx, user, createScope, dto.assigneeEmployeeId)
        : null;

      // S5-TASK-PIPELINE-1 — cột + status khởi tạo (plan 1/3c, API-06 §26.2#15):
      //   stateId tường minh ⇒ validate thuộc ĐÚNG project (404/400) + status suy từ nhóm (KHÔNG
      //   hardcode 'Todo' — chống desync-lúc-sinh); không ⇒ is_default của project + 'Todo'
      //   (nhất quán by-construction — seed 0420/0500 default là nhóm unstarted).
      let stateId: string | null = null;
      let initialStatus: TaskCoreStatus = "Todo";
      if (dto.stateId !== undefined && dto.projectId) {
        const state = await this.repo.findStateForWriteTx(tx, user.companyId, dto.stateId);
        if (!state) throw new NotFoundException(ERR.STATE_NOT_FOUND);
        if (state.projectId !== dto.projectId) throw new BadRequestException(ERR.STATE_INVALID);
        stateId = state.id;
        initialStatus = STATE_GROUP_TO_STATUS[state.stateGroup as ProjectStateGroup] ?? "Todo";
      } else if (dto.projectId) {
        const fallback = await this.repo.findDefaultStateTx(tx, user.companyId, dto.projectId);
        stateId = fallback?.id ?? null; // project 0 state ⇒ NULL (hợp lệ)
      }

      const created = await this.repo.insertTaskCoreTx(tx, user.companyId, {
        title: dto.title,
        description: dto.description ?? null,
        projectId: dto.projectId ?? null,
        departmentId: dto.departmentId ?? null,
        mainAssigneeEmployeeId: assignee?.employeeId ?? null,
        assigneeUserId: assignee?.userId ?? null,
        reporterEmployeeId: actorEmp?.id ?? null,
        taskPriority: dto.priority ?? null,
        dueAt: dto.dueAt ?? null,
        startAt: dto.startAt ?? null,
        creatorUserId: user.id,
        createdBy: user.id,
        taskCode,
        stateId,
        taskStatus: initialStatus,
      });

      await this.activity.record(tx, {
        action: "TASK_CREATED",
        targetType: "Task",
        targetId: created.id,
        taskId: created.id,
        projectId: dto.projectId ?? null,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        newValues: {
          title: dto.title,
          status: initialStatus,
          stateId,
          assigneeEmployeeId: assignee?.employeeId ?? null,
          projectId: dto.projectId ?? null,
        },
        message: `Tạo công việc ${dto.title}`,
      });
      await this.audit.record(tx, {
        action: "TaskCreated",
        objectType: "task",
        objectId: created.id,
        actorUserId: user.id,
        after: {
          title: dto.title,
          status: initialStatus,
          stateId,
          assigneeEmployeeId: assignee?.employeeId ?? null,
          projectId: dto.projectId ?? null,
        },
      });

      return this.reload(tx, user.companyId, created.id);
    });
  }

  // ── Update (KHÔNG đổi status — action riêng ngoài phạm vi WO) ────────────────────

  async updateTask(
    user: RequestUser,
    id: string,
    dto: UpdateTaskCoreRequest,
  ): Promise<TaskCoreResponseDto> {
    const updateScope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "update",
      "task",
    );
    // 3b — GATE + AUTO-MAP Ở METHOD DÙNG CHUNG, KHÔNG ở route: payload có stateId ⇒ PATCH không được
    // thành CỬA THỨ HAI đổi cột (403 TRƯỚC mọi ghi khi thiếu update-state:task).
    const stateCtx = dto.stateId !== undefined ? await this.prepareStateWrite(user) : null;
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findRawByIdTx(tx, user.companyId, id);
      if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
      // Regression: task workflow-driven do FSM quản — KHÔNG cập nhật tay (giữ guard hiện có TasksService).
      if (raw.workflowStepId !== null || WORKFLOW_TASK_TYPES.has(raw.taskType)) {
        throw new BadRequestException(ERR.WORKFLOW_LOCKED);
      }
      // DATA-SCOPE WRITE: scope < Company ⇒ task phải nằm trong phạm vi update của actor (fail-closed).
      await this.assertInScopeForWrite(tx, user, id, updateScope);

      if (dto.projectId) await this.assertProjectUsable(tx, user.companyId, dto.projectId);
      if (dto.departmentId) await this.assertDepartment(tx, user.companyId, dto.departmentId);

      const patch: Parameters<TaskCoreRepository["updateTaskCoreTx"]>[3] = {};
      if (dto.title !== undefined) patch.title = dto.title;
      if (dto.description !== undefined) patch.description = dto.description;
      if (dto.projectId !== undefined) patch.projectId = dto.projectId;
      if (dto.departmentId !== undefined) patch.departmentId = dto.departmentId;
      if (dto.priority !== undefined) patch.taskPriority = dto.priority;
      if (dto.dueAt !== undefined) patch.dueAt = dto.dueAt;
      if (dto.startAt !== undefined) patch.startAt = dto.startAt;
      if (dto.assigneeEmployeeId !== undefined) {
        if (dto.assigneeEmployeeId === null) {
          patch.mainAssigneeEmployeeId = null;
          patch.assigneeUserId = null;
        } else {
          const assignee = await this.resolveAssignee(
            tx,
            user,
            updateScope,
            dto.assigneeEmployeeId,
          );
          patch.mainAssigneeEmployeeId = assignee.employeeId;
          patch.assigneeUserId = assignee.userId;
        }
      }

      const updated = await this.repo.updateTaskCoreTx(tx, user.companyId, id, patch, user.id);
      if (!updated) throw new NotFoundException(ERR.NOT_FOUND);

      // 3b — đổi cột qua PATCH đi CÙNG method dùng chung với move-state (gate update-state đã resolve
      // pre-tx ở prepareStateWrite). Chạy SAU patch để dùng projectId hiệu lực (PATCH có thể đổi project).
      if (dto.stateId !== undefined && stateCtx) {
        const effectiveProjectId = dto.projectId !== undefined ? dto.projectId : raw.projectId;
        await this.applyStateChangeTx(tx, user, id, raw, effectiveProjectId, dto.stateId, stateCtx);
      }

      // Audit KHÔNG NÓI DỐI (finding gate lane contracts): stateId có bản ghi TASK_STATE_CHANGED
      // RIÊNG (trong applyStateChangeTx) ⇒ loại khỏi TASK_UPDATED; PATCH chỉ-có-stateId ⇒ bỏ hẳn
      // TASK_UPDATED (không ghi bản ghi rỗng).
      const auditedDto = { ...dto };
      delete (auditedDto as Record<string, unknown>).stateId;
      const auditedChanges = this.changedFields(auditedDto);
      if (Object.keys(auditedChanges).length > 0) {
        const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
        await this.activity.record(tx, {
          action: "TASK_UPDATED",
          targetType: "Task",
          targetId: id,
          taskId: id,
          projectId: raw.projectId,
          actorUserId: user.id,
          actorEmployeeId: actorEmp?.id ?? null,
          newValues: auditedChanges,
          message: "Cập nhật công việc",
        });
        await this.audit.record(tx, {
          action: "TaskUpdated",
          objectType: "task",
          objectId: id,
          actorUserId: user.id,
          before: { changed: Object.keys(auditedChanges) },
          after: auditedChanges,
        });
      }

      return this.reload(tx, user.companyId, id);
    });
  }

  // ── S5-TASK-PIPELINE-1 (lane be-write) — move-state + method dùng chung đổi cột ──

  /**
   * POST /tasks/:id/move-state (TASK-API-213, API-06 §15.2) — kéo thẻ sang CỘT pipeline.
   * Double-gate: PermissionGuard(update-state:task) ở controller + resolveAndAssert + data-scope
   * write (ngoài scope ⇒ 404) + workflow guard (⇒ 400). Auto-map nhóm→status qua changeStatusTx
   * TRONG CÙNG TX (atomic — FSM/quyền/checklist từ chối ⇒ cột KHÔNG đổi).
   */
  async moveState(
    user: RequestUser,
    taskId: string,
    dto: MoveTaskStateRequest,
  ): Promise<TaskCoreResponseDto> {
    const stateCtx = await this.prepareStateWrite(user);
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findRawByIdTx(tx, user.companyId, taskId);
      if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
      if (raw.workflowStepId !== null || WORKFLOW_TASK_TYPES.has(raw.taskType)) {
        throw new BadRequestException(ERR.WORKFLOW_LOCKED);
      }
      await this.assertInScopeForWrite(tx, user, taskId, stateCtx.scopeState);
      await this.applyStateChangeTx(tx, user, taskId, raw, raw.projectId, dto.stateId, stateCtx);
      return this.reload(tx, user.companyId, taskId);
    });
  }

  /**
   * Ngữ cảnh pre-tx cho MỌI đường ghi state_id (plan 4b + hợp đồng changeStatusTx):
   *   - scopeState: cổng 403 của pair update-state:task (resolve NGOÀI tx — B1).
   *   - scopeStatus: resolve KHÔNG-NÉM pair update-status:task — null = thiếu; CHỈ 403 khi auto-map
   *     thật sự đổi status (kéo cùng nhóm không đòi). TUYỆT ĐỐI không truyền scopeState vào đường
   *     status (scope confusion).
   *   - checklistGateEnabled: đọc TRƯỚC tx, VÔ ĐIỀU KIỆN — state_group mutable qua PATCH /states/:id
   *     nên "chỉ đọc khi đích là completed" theo snapshot pre-tx là race bypass câm cổng ĐK-3.
   */
  private async prepareStateWrite(user: RequestUser): Promise<{
    scopeState: DataScope;
    scopeStatus: DataScope | null;
    checklistGateEnabled: boolean;
  }> {
    const scopeState = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "update-state",
      "task",
    );
    const scopeStatus = await this.permission.resolveStrongestScope(
      user.id,
      user.companyId,
      "update-status",
      "task",
    );
    const checklistGateEnabled = await this.taskActions.isChecklistGateEnabled(user.companyId);
    return { scopeState, scopeStatus, checklistGateEnabled };
  }

  /**
   * MỘT đường ghi state_id (plan 3b — mọi lời gọi PATCH/move-state hội tụ tại đây; POST đi nhánh
   * insert riêng nhưng CÙNG luật). Trong tx caller:
   *   1. validate cột: không tồn tại/soft-deleted/cross-tenant ⇒ 404 STATE-NOT-FOUND (không lộ,
   *      API-06 §15.2); thuộc project khác ⇒ 400 STATE-INVALID; task không project ⇒ 400. KHÔNG ghi gì.
   *   2. same-column ⇒ no-op im lặng (0 activity/0 event — chống rác).
   *   3. auto-map: nhóm cột đích ≠ status hiện tại ⇒ ĐÒI update-status (403 TRƯỚC khi ghi cột —
   *      atomic §15.2#5) rồi ghi cột + changeStatusTx(scopeStatus THẬT) CÙNG tx; FSM/checklist từ
   *      chối ⇒ throw ⇒ rollback cả cột. Cùng nhóm ⇒ chỉ ghi cột.
   *   4. nhật ký: 1 TASK_STATE_CHANGED (old/new mang CẢ stateId VÀ stateName — cột đổi tên sau không
   *      sai lịch sử) + audit TaskStateChanged; KHÔNG outbox (registry §9.5 không có TASK_STATE_*).
   */
  private async applyStateChangeTx(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    raw: TaskRawRow,
    projectId: string | null,
    stateId: string,
    ctx: { scopeState: DataScope; scopeStatus: DataScope | null; checklistGateEnabled: boolean },
  ): Promise<void> {
    if (!projectId) throw new BadRequestException(ERR.STATE_INVALID);
    const state = await this.repo.findStateForWriteTx(tx, user.companyId, stateId);
    if (!state) throw new NotFoundException(ERR.STATE_NOT_FOUND);
    if (state.projectId !== projectId) throw new BadRequestException(ERR.STATE_INVALID);
    if (raw.stateId === state.id) return; // no-op — không event/log rác

    // Quyết auto-map TRƯỚC khi ghi: thiếu update-status mà kéo đổi nhóm ⇒ 403 VÀ cột KHÔNG đổi.
    const newStatus = STATE_GROUP_TO_STATUS[state.stateGroup as ProjectStateGroup];
    const statusChanges = newStatus !== undefined && newStatus !== coalesceTaskStatus(raw.taskStatus);
    if (statusChanges && ctx.scopeStatus === null) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    }

    const moved = await this.repo.setTaskStateTx(tx, user.companyId, taskId, state.id, user.id);
    if (!moved) throw new NotFoundException(ERR.NOT_FOUND);

    const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
    await this.activity.record(tx, {
      action: "TASK_STATE_CHANGED",
      targetType: "Task",
      targetId: taskId,
      taskId,
      projectId,
      actorUserId: user.id,
      actorEmployeeId: actorEmp?.id ?? null,
      oldValues: { stateId: raw.stateId, stateName: raw.stateName },
      newValues: { stateId: state.id, stateName: state.name },
      message: null,
    });
    await this.audit.record(tx, {
      action: "TaskStateChanged",
      objectType: "task",
      objectId: taskId,
      actorUserId: user.id,
      before: { stateId: raw.stateId, stateName: raw.stateName },
      after: { stateId: state.id, stateName: state.name },
    });

    if (statusChanges) {
      // scopeStatus = scope THẬT của pair update-status (4b — không mượn scopeState). changeStatusTx
      // tự loadMutable (404 ngoài scope status — PIN scope-confusion) + FSM + checklist + D-21 guard
      // (cột vừa ghi ĐÚNG nhóm ⇒ sync nội bộ skip, không giật). Throw ⇒ rollback cả cột (atomic).
      await this.taskActions.changeStatusTx(
        tx,
        user,
        taskId,
        { status: newStatus },
        ctx.scopeStatus as DataScope,
        ctx.checklistGateEnabled,
      );
    }
  }

  // ── Delete (soft) ────────────────────────────────────────────────────────────

  async deleteTask(user: RequestUser, id: string): Promise<void> {
    const deleteScope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "delete",
      "task",
      { isSensitive: true },
    );
    await this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findRawByIdTx(tx, user.companyId, id);
      if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
      if (raw.workflowStepId !== null || WORKFLOW_TASK_TYPES.has(raw.taskType)) {
        throw new BadRequestException(ERR.WORKFLOW_LOCKED);
      }
      await this.assertInScopeForWrite(tx, user, id, deleteScope);

      const deleted = await this.repo.softDeleteTx(tx, user.companyId, id, user.id);
      if (!deleted) throw new NotFoundException(ERR.NOT_FOUND);

      const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "TASK_DELETED",
        targetType: "Task",
        targetId: id,
        taskId: id,
        projectId: raw.projectId,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        message: "Xoá công việc",
      });
      await this.audit.record(tx, {
        action: "TaskDeleted",
        objectType: "task",
        objectId: id,
        actorUserId: user.id,
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** DATA-SCOPE ĐỌC: Company/System ⇒ undefined (toàn tenant); Own/Team/Department ⇒ EXISTS predicate. */
  private async resolveReadScopeExists(tx: TenantTx, user: RequestUser): Promise<SQL | undefined> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "read", "task");
    if (scope === "Company" || scope === "System") return undefined;
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
    return this.repo.buildReadScopeExists(user.companyId, scopeCond, actorEmp?.id ?? null, user.id);
  }

  /** WRITE scope: scope < Company ⇒ task phải nằm trong phạm vi (assignee-scope OR membership) ⇒ else 404. */
  private async assertInScopeForWrite(
    tx: TenantTx,
    user: RequestUser,
    id: string,
    scope: DataScope,
  ): Promise<void> {
    if (scope === "Company" || scope === "System") return;
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
    const scopeExists = this.repo.buildReadScopeExists(
      user.companyId,
      scopeCond,
      actorEmp?.id ?? null,
      user.id,
    );
    const scoped = await this.repo.findScopedByIdTx(tx, user.companyId, id, scopeExists);
    if (!scoped) throw new NotFoundException(ERR.NOT_FOUND);
  }

  /** Project tồn tại cùng tenant + KHÔNG kết thúc (đóng/huỷ/lưu trữ) — mirror createHubTask guard. */
  private async assertProjectUsable(
    tx: TenantTx,
    companyId: string,
    projectId: string,
  ): Promise<void> {
    if (!(await this.tasksRepo.projectExistsTx(tx, companyId, projectId))) {
      throw new NotFoundException(ERR.PROJECT_NOT_FOUND);
    }
    if (await this.tasksRepo.projectBlocksNewTaskTx(tx, companyId, projectId)) {
      throw new BadRequestException(ERR.PROJECT_CLOSED);
    }
  }

  private async assertDepartment(
    tx: TenantTx,
    companyId: string,
    departmentId: string,
  ): Promise<void> {
    if (!(await this.repo.orgUnitExistsTx(tx, companyId, departmentId))) {
      throw new BadRequestException(ERR.DEPT_INVALID);
    }
  }

  /**
   * Resolve assignee employee: tồn tại + ACTIVE + có tài khoản + TRONG PHẠM VI người giao (fail-loud/closed).
   * 400 cho not-found/inactive/no-account; 403 cho out-of-scope (giao ngoài quyền). Mirror ProjectsService.
   */
  private async resolveAssignee(
    tx: TenantTx,
    user: RequestUser,
    scope: DataScope,
    employeeId: string,
  ): Promise<{ employeeId: string; userId: string }> {
    const emp = await this.repo.findEmployeeForScopeTx(tx, user.companyId, employeeId);
    if (!emp || emp.deletedAt !== null) throw new BadRequestException(ERR.ASSIGNEE_NOT_FOUND);
    if (emp.status !== "active") throw new BadRequestException(ERR.ASSIGNEE_NOT_ACTIVE);
    if (!emp.userId) throw new BadRequestException(ERR.ASSIGNEE_NO_ACCOUNT);
    await this.assertAssigneeInScope(user, scope, emp);
    return { employeeId: emp.id, userId: emp.userId };
  }

  private async assertAssigneeInScope(
    user: RequestUser,
    scope: DataScope,
    emp: EmployeeForScope,
  ): Promise<void> {
    if (scope === "Company" || scope === "System") return;
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const inScope = this.dataScope.isEmployeeInScope(scope, ctx, {
      userId: emp.userId,
      companyId: user.companyId,
      orgUnitId: emp.orgUnitId,
      directManagerUserId: emp.directManagerUserId,
    });
    if (!inScope) throw new ForbiddenException(ERR.ASSIGNEE_OUT_OF_SCOPE);
  }

  private clampLimit(limit?: number): number {
    if (!limit || limit <= 0) return DEFAULT_LIST_LIMIT;
    return Math.min(Math.floor(limit), TASK_CORE_PAGE_LIMIT_MAX);
  }

  private changedFields(dto: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  private async reload(tx: TenantTx, companyId: string, id: string): Promise<TaskCoreResponseDto> {
    const row = await this.repo.findScopedByIdTx(tx, companyId, id);
    if (!row) throw new InternalServerErrorException("Không tải lại được công việc vừa ghi.");
    return this.toDto(row);
  }

  // ── Projection (raw tx.execute trả string cho timestamptz/boolean → normalize ISO/boolean) ─────

  /** timestamptz raw ('2026-… +00' hoặc Date) → ISO 8601 chuẩn (Z). null giữ null. */
  private toIso(v: string | Date | null): string | null {
    if (v == null) return null;
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  }

  /** boolean raw của Postgres qua tx.execute có thể là 't'/'f'|'true'|'false'|boolean → boolean chuẩn. */
  private toBool(v: boolean | string): boolean {
    return v === true || v === "true" || v === "t";
  }

  private toDto(row: TaskCoreRow): TaskCoreResponseDto {
    const createdAt = this.toIso(row.createdAt);
    const updatedAt = this.toIso(row.updatedAt);
    if (createdAt === null || updatedAt === null) {
      throw new InternalServerErrorException(
        "Task thiếu timestamp bắt buộc (createdAt/updatedAt).",
      );
    }
    return {
      id: row.id,
      companyId: row.companyId,
      title: row.title,
      description: row.description,
      taskType: row.taskType,
      status: (row.taskStatus as TaskCoreStatusDto | null) ?? null,
      priority: (row.taskPriority as TaskCorePriorityDto | null) ?? null,
      projectId: row.projectId,
      projectName: row.projectName,
      mainAssigneeEmployeeId: row.mainAssigneeEmployeeId,
      assigneeName: row.assigneeName,
      creatorUserId: row.creatorUserId,
      creatorName: row.creatorName,
      reporterEmployeeId: row.reporterEmployeeId,
      departmentId: row.departmentId,
      dueAt: this.toIso(row.dueAt),
      startAt: this.toIso(row.startAt),
      completedAt: this.toIso(row.completedAt),
      isOverdue: this.toBool(row.isOverdue),
      createdBy: row.createdBy,
      createdAt,
      updatedAt,
    };
  }

  private toMyDto(row: MyTaskRow): MyTaskItemDto {
    return { ...this.toDto(row), source: row.source as TaskCoreSourceDto };
  }
}
