import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  DataScope,
  GoalStatusDto,
  GoalTaskLinkResultDto,
  LinkGoalTasksRequest,
  TaskCoreResponseDto,
} from "@mediaos/contracts";
import type { SQL } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { DataScopeService } from "../permission/data-scope.service";
import { ProjectAccessService } from "../tasks/project-access.service";
import { GoalProgressEngineService } from "../tasks/goal-progress-engine.service";
import { TaskCoreRepository } from "../tasks/task-core.repository";
import { toTaskCoreDto } from "../tasks/task-core.mapper";
import type { Goal } from "../db/schema/goals";
import {
  GoalAccessService,
  type GoalActorScope,
  type GoalRequestUser as RequestUser,
} from "./goal-access.service";
import { GOAL_ERR } from "./goals.errors";
import { GoalsRepository, type TaskRefRow } from "./goals.repository";

/** Trần số việc trả về cho tab "Công việc gắn" của màn hình chi tiết mục tiêu. */
const LINKED_TASKS_LIMIT = 200;

/**
 * S20-SEC-GOALLINKGATE-1 · GOAL-ERR-016 — trạng thái mục tiêu ĐÍCH được nhận việc (quy tắc DƯƠNG: tập
 * cho phép, KHÔNG phải tập cấm ⇒ trạng thái lạ/tương lai bị từ chối). `Draft` được gắn (quyết định owner
 * 25/10/2026 — chuẩn bị tập việc trước khi chạy); `Completed`/`Cancelled` đã đóng.
 */
const LINKABLE_GOAL_STATUSES: ReadonlySet<string> = new Set<GoalStatusDto>(["Draft", "Active"]);

/**
 * S5-GOAL-BE-2 — GoalTasksLinkService (GOAL-API-010: gắn bulk · tháo · liệt kê việc của mục tiêu).
 *
 * ── QUYẾT ĐỊNH CỦA LANE: gắn/tháo dùng LẠI cặp `('update','goal')` ────────────────────────────────
 * SPEC-10 §11 KHÔNG định nghĩa cặp riêng cho link/unlink, và migration 0506 chỉ seed 7 cặp
 * (access/view/create/update/delete/checkin/finalize). Gắn task vào mục tiêu là SỬA mục tiêu (đổi tập
 * đo của nó ⇒ đổi `progress_percent`) nên nó thuộc `update:goal`. Bịa một cặp mới ở tầng code mà không
 * có seed = cặp không tồn tại trong `permissions` ⇒ `resolveAndAssert` ném 403 cho MỌI người, kể cả
 * admin (và lane này KHÔNG được tạo migration). Ghi rõ ở docs/plans/S5-GOAL-BE-2.md để review không
 * hiểu nhầm là thiếu seed.
 *
 * ── GOAL-ERR-008 (SPEC-10 §12): hai vế KHÁC NHAU, đừng gộp ────────────────────────────────────────
 *   · mục tiêu `employee` → assignee chính của task PHẢI là đúng nhân viên đó ⇒ **CHẶN 422**;
 *   · mục tiêu `project`  → task PHẢI thuộc đúng dự án đó                     ⇒ **CHẶN 422**;
 *   · mục tiêu `department` → task không liên quan phòng ⇒ **CẢNH BÁO MỀM, VẪN GẮN** (spec ghi rõ
 *     "không chặn": việc liên phòng phục vụ mục tiêu phòng là chuyện bình thường).
 *
 * ── BẤT BIẾN #1 ───────────────────────────────────────────────────────────────────────────────────
 * `taskId` do client gửi ⇒ đọc task LUÔN dưới `company_id` tường minh (`lockTaskRefsTx`), chồng lên
 * RLS + FK tổng hợp `(company_id, goal_id)` của migration 0535: ba lớp, không dựa vào một lớp duy nhất.
 *
 * ── S20-SEC-GOALLINKGATE-1: «chuyển» = «tháo khỏi mục tiêu đang giữ» + «gắn vào đích» ─────────────
 *   · Mục tiêu đang giữ việc nhận ĐÚNG quyết định của đường tháo (`assertGoalWritableTx` — CÙNG hàm,
 *     không biểu thức quyền thứ hai). Ngoại lệ ghi rõ: mục tiêu đang giữ đã xoá mềm ⇒ cho (không đường
 *     nào khác gỡ được việc khỏi nó) và vẫn ghi audit ở đó. Không đọc được hàng ⇒ từ chối (fail-closed).
 *   · Đích chỉ nhận việc khi trạng thái ∈ `LINKABLE_GOAL_STATUSES` (GOAL-ERR-016).
 *   · Kiểm + ghi trong MỘT transaction trên hàng ĐÃ KHOÁ, thứ tự task → goal (khớp writer TASK): chốt kỳ
 *     hay đổi liên kết đồng thời phải chờ khoá ⇒ quyết định không bao giờ dựa trên giá trị đã cũ.
 */
@Injectable()
export class GoalTasksLinkService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GoalsRepository,
    private readonly access: GoalAccessService,
    private readonly engine: GoalProgressEngineService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
    private readonly taskCore: TaskCoreRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * GET /goals/:id/tasks — việc đang gắn mục tiêu.
   *
   * HAI CỔNG, CỐ Ý: cặp `('view','goal')` (thấy mục tiêu) VÀ phạm vi đọc của cặp `('read','task')`
   * (thấy việc). Đọc bằng đúng projection + mapper hợp nhất của TASK (`TaskCoreRepository.listTx` →
   * `toTaskCoreDto`) nên trường trả về giống hệt `GET /tasks` — KHÔNG dựng mapper thứ hai (bài học
   * 3-mapper PR #247). Nếu chỉ gate `view:goal` thì người thấy mục tiêu sẽ đọc được tiêu đề/người phụ
   * trách của những việc mà chính họ không có quyền mở (bài học
   * `read-path-gate-pair-must-match-download-pair`).
   */
  async listLinkedTasks(user: RequestUser, goalId: string): Promise<TaskCoreResponseDto[]> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "view");
      await this.access.loadReadableGoalTx(tx, user, goalId, actor);

      const taskScope = await this.dataScope.resolveAndAssert(
        user.id,
        user.companyId,
        "read",
        "task",
      );
      let scopeExists: SQL | undefined;
      if (taskScope !== "Company" && taskScope !== "System") {
        const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
        const actorEmp = await this.taskCore.findActiveEmployeeByUserTx(
          tx,
          user.companyId,
          user.id,
        );
        scopeExists = this.taskCore.buildReadScopeExists(
          user.companyId,
          this.dataScope.buildEmployeeScopeCondition(taskScope, ctx),
          actorEmp?.id ?? null,
          user.id,
        );
      }
      const rows = await this.taskCore.listTx(
        tx,
        user.companyId,
        { goalId, limit: LINKED_TASKS_LIMIT, offset: 0 },
        scopeExists,
      );
      return rows.map((row) => toTaskCoreDto(row));
    });
  }

  /**
   * POST /goals/:id/tasks — gắn BULK (gồm cả CHUYỂN việc đang thuộc mục tiêu khác).
   * Tất-cả-hoặc-không: mọi quyết định chạy TRƯỚC mọi phép ghi; một việc bị từ chối ⇒ 0 hàng ghi.
   */
  async linkTasks(
    user: RequestUser,
    goalId: string,
    dto: LinkGoalTasksRequest,
  ): Promise<GoalTaskLinkResultDto> {
    // Khử trùng lặp TRƯỚC (không phân biệt hoa/thường — Postgres trả uuid chữ thường): gửi cùng một id
    // 50 lần không được biến thành 50 lần "đã gắn".
    const taskIds = [...new Set(dto.taskIds.map((id) => id.toLowerCase()))];
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "update");
      // Fail-fast trên hàng CHƯA khoá: giữ thứ tự lỗi cũ, không khoá việc khi đích đã hỏng.
      const unlocked = await this.loadWritableGoalTx(tx, user, actor, goalId);
      this.assertLinkTargetOpen(unlocked);
      const taskScope = await this.resolveTaskWriteScope(user);

      // Khoá task → goal (thứ tự cố định), rồi quyết định LẠI trên hàng đã khoá.
      const tasks = await this.lockTasksInOrderTx(tx, user, taskIds);
      const heldIds = tasks.map((t) => t.goalId).filter((id): id is string => id !== null);
      const locked = await this.lockWritableGoalsTx(tx, user, actor, unlocked.id, heldIds);
      this.assertLinkTargetOpen(locked.goal);

      const warnings: GoalTaskLinkResultDto["warnings"] = [];
      const toMove = await this.decideLinkTx(
        tx,
        { user, actor, taskScope, ...locked },
        tasks,
        warnings,
      );
      await this.writeLinksTx(tx, user, locked.goal.id, toMove);
      return {
        goalId,
        linked: toMove.length,
        alreadyLinked: tasks.length - toMove.length,
        warnings,
      };
    });
  }

  /** DELETE /goals/:id/tasks/:taskId — tháo. Task không gắn ĐÚNG mục tiêu này ⇒ 404 (không tháo mù). */
  async unlinkTask(
    user: RequestUser,
    goalId: string,
    taskId: string,
  ): Promise<GoalTaskLinkResultDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "update");
      const unlocked = await this.loadWritableGoalTx(tx, user, actor, goalId);
      const taskScope = await this.resolveTaskWriteScope(user);
      const [task] = await this.repo.lockTaskRefsTx(tx, user.companyId, [taskId.toLowerCase()]);
      if (!task) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("công việc"));
      await this.assertTaskWritableTx(tx, user, task.id, taskScope);
      const { goal } = await this.lockWritableGoalsTx(tx, user, actor, unlocked.id, []);

      const cleared = await this.repo.clearTaskGoalTx(
        tx,
        user.companyId,
        task.id,
        goal.id,
        user.id,
      );
      if (!cleared)
        throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("liên kết công việc–mục tiêu"));

      await this.audit.record(tx, {
        action: "GoalTaskUnlinked",
        objectType: "goal",
        objectId: goal.id,
        actorUserId: user.id,
        before: { taskId: task.id, taskCode: task.taskCode },
      });
      await this.engine.recomputeGoalTx(tx, user.companyId, goal.id);
      await this.engine.recomputeProjectGoalsTx(tx, user.companyId, task.projectId);
      return { goalId, linked: 0, alreadyLinked: 0, warnings: [] };
    });
  }

  // ── Nội bộ ───────────────────────────────────────────────────────────────────

  /**
   * 🔒 CỔNG THỨ HAI — PHÍA TASK (finding gate S5-GOAL-BE-2, tự soi).
   *
   * Gắn/tháo GHI THẲNG cột `tasks.goal_id` ⇒ đây là một phép GHI LÊN TASK, không chỉ lên mục tiêu.
   * Nếu chỉ gate `('update','goal')` thì một trưởng đơn vị có `update:goal @Department` gắn được
   * **BẤT KỲ** công việc nào trong tenant vào mục tiêu CẤP PHÒNG của mình (vế `department` của
   * GOAL-ERR-008 chỉ cảnh báo mềm, không chặn) — tức là sửa hàng `tasks` của phòng khác, và làm thẻ
   * việc của người ta hiện tên mục tiêu của mình. Vì vậy phải qua ĐÚNG cặp `('update','task')` + vị từ
   * scope mode `'write'` của TASK, dùng LẠI `ProjectAccessService` (một nguồn logic — KHÔNG copy thân hàm).
   *
   * ⚠️ Ngoài phạm vi ⇒ **404** (quy ước fail-closed của TASK), KHÁC quy ước 403-minh-bạch-in-tenant của
   * GOAL. Hai module hai quy ước — đây là ranh giới, đừng "thống nhất cho gọn".
   */
  private resolveTaskWriteScope(user: RequestUser): Promise<DataScope> {
    return this.dataScope.resolveAndAssert(user.id, user.companyId, "update", "task");
  }

  private assertTaskWritableTx(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    taskScope: DataScope,
  ): Promise<void> {
    return this.projectAccess.assertTaskInScopeTx(tx, user, taskId, taskScope, "write");
  }

  /** GOAL-ERR-008 — CHẶN cho employee/project, CẢNH BÁO MỀM cho department (SPEC-10 §12). */
  private assertLinkAllowed(
    goal: Goal,
    task: TaskRefRow,
    warnings: GoalTaskLinkResultDto["warnings"],
  ): void {
    if (goal.level === "employee") {
      if (task.mainAssigneeEmployeeId !== goal.employeeId) {
        throw new UnprocessableEntityException(
          GOAL_ERR.LINK_ANCHOR(
            `mục tiêu cá nhân chỉ nhận công việc do chính nhân viên đó phụ trách (${task.taskCode ?? task.id}).`,
          ),
        );
      }
      return;
    }
    if (goal.level === "project") {
      if (task.projectId !== goal.projectId) {
        throw new UnprocessableEntityException(
          GOAL_ERR.LINK_ANCHOR(
            `mục tiêu cấp dự án chỉ nhận công việc thuộc đúng dự án đó (${task.taskCode ?? task.id}).`,
          ),
        );
      }
      return;
    }
    if (goal.level === "department") {
      const related =
        task.departmentId === goal.departmentId || task.projectDepartmentId === goal.departmentId;
      if (!related) {
        warnings.push({
          taskId: task.id,
          taskCode: task.taskCode,
          message:
            "Công việc này không thuộc phòng ban của mục tiêu — vẫn gắn được, kiểm tra lại nếu không cố ý.",
        });
      }
    }
  }

  /**
   * MỘT nguồn quyết định GHI lên một mục tiêu cho đường gắn/tháo/chuyển: phạm vi GHI trên chính hàng
   * đó (`update:goal`) → GOAL-ERR-005. Gọi cho: đích của gắn · mục tiêu đang giữ việc khi chuyển ·
   * mục tiêu của đường tháo — cùng hàm ⇒ cùng dữ liệu cho cùng quyết định.
   * `assertNotFinalized` phải ở đây chứ không ở controller: mục tiêu đã chốt kỳ mà còn gắn/tháo được
   * việc thì `progress_percent` đã chốt sẽ mâu thuẫn với tập việc mà UI hiển thị.
   */
  private async assertGoalWritableTx(
    tx: TenantTx,
    user: RequestUser,
    actor: GoalActorScope,
    goal: Goal,
  ): Promise<void> {
    await this.access.assertCanWriteExistingGoal(tx, user, actor, goal);
    this.access.assertNotFinalized(goal);
  }

  /** Fail-fast trên hàng CHƯA khoá (404 ngoài tenant/đã xoá → quyết định ghi). */
  private async loadWritableGoalTx(
    tx: TenantTx,
    user: RequestUser,
    actor: GoalActorScope,
    goalId: string,
  ): Promise<Goal> {
    const goal = await this.repo.findByIdTx(tx, user.companyId, goalId);
    if (!goal) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
    await this.assertGoalWritableTx(tx, user, actor, goal);
    return goal;
  }

  /** GOAL-ERR-016 — đích chỉ nhận việc khi trạng thái thuộc tập cho phép (quy tắc DƯƠNG). */
  private assertLinkTargetOpen(goal: Goal): void {
    if (!LINKABLE_GOAL_STATUSES.has(goal.status)) {
      throw new UnprocessableEntityException(GOAL_ERR.LINK_CLOSED(goal.status));
    }
  }

  /** Khoá các việc của lô (thứ tự id) rồi trả lại theo THỨ TỰ request; thiếu việc nào ⇒ 404 cả lô. */
  private async lockTasksInOrderTx(
    tx: TenantTx,
    user: RequestUser,
    taskIds: readonly string[],
  ): Promise<TaskRefRow[]> {
    const rows = await this.repo.lockTaskRefsTx(tx, user.companyId, taskIds);
    const byId = new Map(rows.map((t) => [t.id, t]));
    return taskIds.map((id) => {
      const task = byId.get(id);
      if (!task) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("công việc"));
      return task;
    });
  }

  /**
   * Khoá đích + các mục tiêu đang giữ việc (SAU khoá task), rồi quyết định LẠI trên hàng đích đã khoá —
   * chốt kỳ đồng thời đã commit trong lúc chờ khoá thì bị thấy ở đây.
   */
  private async lockWritableGoalsTx(
    tx: TenantTx,
    user: RequestUser,
    actor: GoalActorScope,
    goalId: string,
    heldIds: readonly string[],
  ): Promise<{ goal: Goal; goalsById: ReadonlyMap<string, Goal> }> {
    const ids = [...new Set([goalId, ...heldIds])];
    const rows = await this.repo.lockGoalsTx(tx, user.companyId, ids);
    const goalsById = new Map(rows.map((g) => [g.id, g]));
    const goal = goalsById.get(goalId);
    if (!goal || goal.deletedAt !== null) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
    await this.assertGoalWritableTx(tx, user, actor, goal);
    return { goal, goalsById };
  }

  /**
   * Quyết định cho TỪNG việc của lô, TRƯỚC mọi phép ghi. Trả các việc cần ghi (bỏ việc đã gắn đúng đích).
   * Việc đang thuộc mục tiêu khác ⇒ mục tiêu đó qua `assertHeldGoalReleasableTx` (một lần/mục tiêu).
   */
  private async decideLinkTx(
    tx: TenantTx,
    c: LinkDecisionContext,
    tasks: readonly TaskRefRow[],
    warnings: GoalTaskLinkResultDto["warnings"],
  ): Promise<TaskRefRow[]> {
    const toMove: TaskRefRow[] = [];
    const released = new Set<string>();
    for (const task of tasks) {
      await this.assertTaskWritableTx(tx, c.user, task.id, c.taskScope);
      this.assertLinkAllowed(c.goal, task, warnings);
      if (task.goalId === c.goal.id) continue;
      if (task.goalId !== null && !released.has(task.goalId)) {
        await this.assertHeldGoalReleasableTx(tx, c, task.goalId);
        released.add(task.goalId);
      }
      toMove.push(task);
    }
    return toMove;
  }

  /**
   * Mục tiêu ĐANG GIỮ việc nhận đúng quyết định của đường tháo (`assertGoalWritableTx`), trên hàng đã khoá.
   * Ngoại lệ (quy tắc DƯƠNG): hàng đọc được và đã xoá mềm ⇒ cho — đường tháo trả 404 cho nó nên không
   * còn đường nào khác gỡ việc ra. Không đọc được hàng ⇒ từ chối (fail-closed, KHÔNG «vắng ⇒ cho»).
   */
  private async assertHeldGoalReleasableTx(
    tx: TenantTx,
    c: LinkDecisionContext,
    heldGoalId: string,
  ): Promise<void> {
    const held = c.goalsById.get(heldGoalId);
    if (!held) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
    if (held.deletedAt !== null) return;
    await this.assertGoalWritableTx(tx, c.user, c.actor, held);
  }

  /**
   * Ghi liên kết + audit ở CẢ HAI đầu (append-only) + tính lại tiến độ cả hai. Chỉ chạy sau khi MỌI
   * quyết định đã qua (`decideLinkTx`).
   */
  private async writeLinksTx(
    tx: TenantTx,
    user: RequestUser,
    goalId: string,
    toMove: readonly TaskRefRow[],
  ): Promise<void> {
    const previousGoalIds = new Set<string>();
    const projectIds = new Set<string>();
    for (const task of toMove) {
      const written = await this.repo.setTaskGoalTx(tx, user.companyId, task.id, goalId, user.id);
      if (!written) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("công việc"));
      await this.audit.record(tx, {
        action: "GoalTaskLinked",
        objectType: "goal",
        objectId: goalId,
        actorUserId: user.id,
        after: { taskId: task.id, taskCode: task.taskCode, previousGoalId: task.goalId },
      });
      if (task.goalId !== null) {
        previousGoalIds.add(task.goalId);
        await this.audit.record(tx, {
          action: "GoalTaskUnlinked",
          objectType: "goal",
          objectId: task.goalId,
          actorUserId: user.id,
          before: { taskId: task.id, taskCode: task.taskCode },
          after: { movedToGoalId: goalId },
        });
      }
      if (task.projectId) projectIds.add(task.projectId);
    }

    // Tiến độ đổi ở CẢ HAI đầu: mục tiêu mới nhận thêm việc, mục tiêu CŨ mất việc. Bỏ vế thứ hai là
    // để lại một con số cũ đúng-trông-như-thật ở mục tiêu người khác đang theo dõi.
    await this.engine.recomputeGoalTx(tx, user.companyId, goalId);
    for (const prev of previousGoalIds) await this.engine.recomputeGoalTx(tx, user.companyId, prev);
    for (const projectId of projectIds) {
      await this.engine.recomputeProjectGoalsTx(tx, user.companyId, projectId);
    }
  }
}

/** Dữ liệu quyết định của MỘT request gắn — resolve một lần, dùng cho mọi việc của lô. */
interface LinkDecisionContext {
  user: RequestUser;
  actor: GoalActorScope;
  taskScope: DataScope;
  goal: Goal;
  goalsById: ReadonlyMap<string, Goal>;
}
