import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  DataScope,
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
import { GoalAccessService, type GoalRequestUser as RequestUser } from "./goal-access.service";
import { GOAL_ERR } from "./goals.errors";
import { GoalsRepository, type TaskRefRow } from "./goals.repository";

/** Trần số việc trả về cho tab "Công việc gắn" của màn hình chi tiết mục tiêu. */
const LINKED_TASKS_LIMIT = 200;

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
 * ── BẤT BIẾN #1 ở đây quan trọng hơn mọi chỗ khác ────────────────────────────────────────────────
 * `taskId` do client gửi và FK `tasks.goal_id → goals.id` là FK ĐƠN CỘT, KHÔNG ép cùng-tenant (finding
 * MEDIUM gate S5-GOAL-DB-1 đã chứng minh tận DB). `resolveTaskRefTx` dưới `company_id` là hàng phòng
 * thủ DUY NHẤT: bỏ nó thì công ty A gắn được task của công ty B (hoặc vỡ FK thành 500).
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

  /** POST /goals/:id/tasks — gắn BULK. Tất-cả-hoặc-không: một task vi phạm GOAL-ERR-008 ⇒ 422, 0 hàng ghi. */
  async linkTasks(
    user: RequestUser,
    goalId: string,
    dto: LinkGoalTasksRequest,
  ): Promise<GoalTaskLinkResultDto> {
    // Khử trùng lặp TRƯỚC: gửi cùng một id 50 lần không được biến thành 50 lần "đã gắn".
    const taskIds = [...new Set(dto.taskIds)];
    return this.db.withTenant(user.companyId, async (tx) => {
      const goal = await this.loadWritableGoalTx(tx, user, goalId);
      const taskScope = await this.resolveTaskWriteScope(user);

      const warnings: GoalTaskLinkResultDto["warnings"] = [];
      const previousGoalIds = new Set<string>();
      const projectIds = new Set<string>();
      let linked = 0;
      let alreadyLinked = 0;

      for (const taskId of taskIds) {
        const task = await this.repo.resolveTaskRefTx(tx, user.companyId, taskId);
        if (!task) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("công việc"));
        await this.assertTaskWritableTx(tx, user, taskId, taskScope);
        this.assertLinkAllowed(goal, task, warnings);

        if (task.goalId === goalId) {
          alreadyLinked += 1;
          continue;
        }
        const written = await this.repo.setTaskGoalTx(tx, user.companyId, taskId, goalId, user.id);
        if (!written) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("công việc"));
        if (task.goalId) previousGoalIds.add(task.goalId);
        if (task.projectId) projectIds.add(task.projectId);
        linked += 1;

        await this.audit.record(tx, {
          action: "GoalTaskLinked",
          objectType: "goal",
          objectId: goalId,
          actorUserId: user.id,
          after: { taskId, taskCode: task.taskCode, previousGoalId: task.goalId },
        });
      }

      // Tiến độ đổi ở CẢ HAI đầu: mục tiêu mới nhận thêm việc, mục tiêu CŨ mất việc. Bỏ vế thứ hai là
      // để lại một con số cũ đúng-trông-như-thật ở mục tiêu người khác đang theo dõi.
      await this.engine.recomputeGoalTx(tx, user.companyId, goalId);
      for (const prev of previousGoalIds)
        await this.engine.recomputeGoalTx(tx, user.companyId, prev);
      for (const projectId of projectIds) {
        await this.engine.recomputeProjectGoalsTx(tx, user.companyId, projectId);
      }

      return { goalId, linked, alreadyLinked, warnings };
    });
  }

  /** DELETE /goals/:id/tasks/:taskId — tháo. Task không gắn ĐÚNG mục tiêu này ⇒ 404 (không tháo mù). */
  async unlinkTask(
    user: RequestUser,
    goalId: string,
    taskId: string,
  ): Promise<GoalTaskLinkResultDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      await this.loadWritableGoalTx(tx, user, goalId);
      const taskScope = await this.resolveTaskWriteScope(user);
      const task = await this.repo.resolveTaskRefTx(tx, user.companyId, taskId);
      if (!task) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("công việc"));
      await this.assertTaskWritableTx(tx, user, taskId, taskScope);

      const cleared = await this.repo.clearTaskGoalTx(tx, user.companyId, taskId, goalId, user.id);
      if (!cleared)
        throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("liên kết công việc–mục tiêu"));

      await this.audit.record(tx, {
        action: "GoalTaskUnlinked",
        objectType: "goal",
        objectId: goalId,
        actorUserId: user.id,
        before: { taskId, taskCode: task.taskCode },
      });
      await this.engine.recomputeGoalTx(tx, user.companyId, goalId);
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
   * Gate CHUNG cho cả 3 đường ghi: cặp `('update','goal')` → phạm vi GHI trên chính hàng đó → GOAL-ERR-005.
   * `assertNotFinalized` phải ở đây chứ không ở controller: mục tiêu đã chốt kỳ mà còn gắn/tháo được
   * việc thì `progress_percent` đã chốt sẽ mâu thuẫn với tập việc mà UI hiển thị.
   */
  private async loadWritableGoalTx(tx: TenantTx, user: RequestUser, goalId: string): Promise<Goal> {
    const actor = await this.access.resolveActorScope(tx, user, "update");
    const goal = await this.repo.findByIdTx(tx, user.companyId, goalId);
    if (!goal) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
    await this.access.assertCanWriteExistingGoal(tx, user, actor, goal);
    this.access.assertNotFinalized(goal);
    return goal;
  }
}
