import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  DataScope,
  DecomposeGoalItemRequest,
  DecomposeGoalRequest,
  DecomposeGoalResultDto,
  TaskCorePriorityDto,
  TaskTemplatePriorityDto,
} from "@mediaos/contracts";
import { GOAL_DECOMPOSE_MAX } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { SequenceService } from "../foundation/sequences/sequence.service";
import { GoalProgressEngineService } from "../tasks/goal-progress-engine.service";
import { TaskActivityService } from "../tasks/task-activity.service";
import { TaskChecklistsRepository } from "../tasks/task-checklists.repository";
import { TaskCoreService } from "../tasks/task-core.service";
import { allocateTaskCodeOutsideTx } from "../tasks/task-code.util";
import type { Goal } from "../db/schema/goals";
import { GoalAccessService, type GoalRequestUser as RequestUser } from "./goal-access.service";
import { GOAL_ERR } from "./goals.errors";
import { GoalsRepository } from "./goals.repository";
import { TaskTemplatesService } from "./task-templates.service";

/**
 * `task_template_items.default_priority` LOWERCASE (CHECK mig 0526, DB-06 §8.5 legacy) →
 * `tasks.task_priority` TitleCase (CHECK mig 0478). MỘT map duy nhất cho cả hệ thống; `'none'` ⇒ null
 * (task không đặt ưu tiên). Truyền thẳng giá trị lowercase vào task = vỡ CHECK ⇒ 500 mờ.
 */
const TEMPLATE_TO_TASK_PRIORITY: Record<TaskTemplatePriorityDto, TaskCorePriorityDto | null> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: null,
};

/** Tiêu đề checklist sinh ra khi áp template (DB-11 §6.4: `checklist` JSONB → `task_checklists`). */
const DECOMPOSE_CHECKLIST_TITLE = "Việc cần làm";

/** Neo SUY TỪ MỤC TIÊU — task sinh ra phải tự thoả GOAL-ERR-008 tại thời điểm tạo. */
interface DecomposeAnchor {
  level: string;
  projectId: string | null;
  departmentId: string | null;
  employeeId: string | null;
}

/**
 * S5-GOAL-TPL-1 — GoalDecomposeService (GOAL-API-011 · GOAL-FUNC-007 · GOAL-SCREEN-004).
 *
 * ── TẤT-CẢ-HOẶC-KHÔNG (yêu cầu cứng của WO) ───────────────────────────────────────────────────────
 * N task + checklist + activity + audit ghi TRONG **MỘT** transaction: item thứ k vi phạm ⇒ rollback
 * HẾT, không để lại "một nửa cây việc" mà người dùng phải dọn tay. Vì thế KHÔNG gọi
 * `TaskCoreService.createTask` (nó tự mở `withTenant` ⇒ N transaction) mà gọi `createTaskInTx` — CÙNG
 * thân hàm, CÙNG gate, nhận `tx` của lane này (xem docblock ở đó).
 *
 * ── HAI CỔNG QUYỀN, CỐ Ý (không bypass gate TASK) ─────────────────────────────────────────────────
 *   • `('update','goal')` — phân rã ĐỔI TẬP ĐO của mục tiêu (giống gắn task ⇒ cùng cặp; SPEC-10 §11
 *     không định nghĩa cặp riêng và mig 0506 chỉ seed 7 cặp — bịa cặp mới = 403 cho MỌI người);
 *   • `('create','task')` (+ `('update-state','task')` khi có cột board) — qua `resolveCreateGate` của
 *     TASK. Bỏ cổng này thì ai sửa được mục tiêu sẽ tạo được việc cho bất kỳ ai, vòng qua toàn bộ luật
 *     D-24/D-27 của TASK.
 * `manage:task-template` CỐ Ý **không** đòi ở đây: dùng danh mục ≠ quản trị danh mục (§11).
 *
 * ── THỨ TỰ 3 PHA (bắt buộc) ──────────────────────────────────────────────────────────────────────
 *   1. Pha ĐỌC (tx riêng): gate mục tiêu + template, suy NEO ⇒ biết có dự án hay không;
 *   2. Gate TASK + cấp N mã `task_code` — **NGOÀI** business tx (`allocateTaskCodeOutsideTx` mở
 *      connection riêng + `FOR UPDATE` counter; gọi trong tx đang mở = giữ 2 connection/lock suốt tx
 *      dài, bài học S5-SEQ-HARDEN-1). Rollback ⇒ mã bị "đốt" (gap OK, đúng thiết kế counter);
 *   3. Business tx: **KIỂM LẠI TOÀN BỘ** (fail-closed — trạng thái có thể đổi giữa 2 pha) rồi ghi.
 */
@Injectable()
export class GoalDecomposeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly goalsRepo: GoalsRepository,
    private readonly access: GoalAccessService,
    private readonly templates: TaskTemplatesService,
    private readonly taskCore: TaskCoreService,
    private readonly checklists: TaskChecklistsRepository,
    private readonly activity: TaskActivityService,
    private readonly engine: GoalProgressEngineService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
  ) {}

  async decompose(
    user: RequestUser,
    goalId: string,
    dto: DecomposeGoalRequest,
  ): Promise<DecomposeGoalResultDto> {
    // Trần NGHIỆP VỤ (GOAL-ERR-009) — rẻ nhất, kiểm trước khi chạm DB. Zod chỉ chặn trần CỨNG 200 để mã
    // lỗi nghiệp vụ có chỗ trả 422 (xem contracts/goal.ts GOAL_DECOMPOSE_HARD_MAX).
    if (dto.items.length === 0) {
      throw new UnprocessableEntityException(GOAL_ERR.DECOMPOSE_EMPTY);
    }
    if (dto.items.length > GOAL_DECOMPOSE_MAX) {
      throw new UnprocessableEntityException(
        GOAL_ERR.DECOMPOSE_LIMIT(GOAL_DECOMPOSE_MAX, dto.items.length),
      );
    }

    // ── Pha 1 — ĐỌC: gate mục tiêu + template, suy neo (cần biết có dự án để gate cột board) ──────
    const anchor = await this.db.withTenant(user.companyId, async (tx) => {
      const goal = await this.loadDecomposableGoalTx(tx, user, goalId);
      await this.templates.loadTemplateForDecomposeTx(tx, user.companyId, dto.templateId);
      return this.anchorOf(goal);
    });

    // ── Pha 2 — gate TASK (NGOÀI tx) + cấp N mã ──────────────────────────────────────────────────
    // `stateId` của item ĐẦU TIÊN có cột đại diện cho cả request ở bước gate cặp quyền (cột nào cũng đòi
    // đúng cặp `update-state:task`); TÍNH HỢP LỆ của từng cột (thuộc đúng dự án) kiểm trong tx, mỗi item.
    const firstStateId = dto.items.find((item) => item.stateId)?.stateId ?? undefined;
    const createScope = await this.taskCore.resolveCreateGate(user, {
      ...(firstStateId ? { stateId: firstStateId } : {}),
      ...(anchor.projectId ? { projectId: anchor.projectId } : {}),
      parentTaskId: null,
    });
    const taskCodes: string[] = [];
    for (let i = 0; i < dto.items.length; i += 1) {
      taskCodes.push(await allocateTaskCodeOutsideTx(this.db, this.sequence, user.companyId));
    }

    // ── Pha 3 — GHI: một transaction cho toàn bộ ────────────────────────────────────────────────
    return this.db.withTenant(user.companyId, async (tx) => {
      // KIỂM LẠI, KHÔNG tin pha 1: giữa 2 pha mục tiêu có thể bị chốt kỳ/huỷ/đổi neo, hoặc quyền bị thu
      // hồi. Đây là vế fail-closed của mẫu "cấp mã ngoài tx" — bỏ nó là mở một cửa sổ đua ghi được.
      const goal = await this.loadDecomposableGoalTx(tx, user, goalId);
      const template = await this.templates.loadTemplateForDecomposeTx(
        tx,
        user.companyId,
        dto.templateId,
      );
      const liveAnchor = this.anchorOf(goal);
      // Neo đổi giữa 2 pha đến mức cột board mất chỗ dựa ⇒ TỪ CHỐI thay vì âm thầm bỏ cột (task nằm
      // ngoài board là task người dùng không nhìn thấy ở nơi họ vừa chọn cột cho nó).
      if (firstStateId && !liveAnchor.projectId) {
        throw new BadRequestException(
          GOAL_ERR.DECOMPOSE(
            "mục tiêu này không thuộc dự án nào nên không đặt được cột board cho việc",
          ),
        );
      }

      const created: DecomposeGoalResultDto["tasks"] = [];
      for (const [index, item] of dto.items.entries()) {
        const task = await this.createOneTx(tx, user, goal, liveAnchor, item, {
          createScope,
          taskCode: taskCodes[index] as string,
        });
        created.push(task);
      }

      // Tiến độ: mục tiêu vừa nhận N việc (mode 'tasks' — mẫu số đổi từ 0 ⇒ NULL sang 0%) + mục tiêu
      // mode 'project' của dự án (đếm-lá). MỘT lần sau vòng lặp thay vì N lần trong vòng lặp
      // (`deferGoalRecompute`) — recompute là hàm của trạng thái CUỐI, không tích luỹ.
      await this.engine.recomputeForTaskTx(tx, user.companyId, goalId, liveAnchor.projectId);

      await this.audit.record(tx, {
        action: "GoalDecomposed",
        objectType: "goal",
        objectId: goalId,
        actorUserId: user.id,
        after: {
          templateId: template.id,
          templateName: template.name,
          created: created.length,
          taskIds: created.map((t) => t.id),
        },
      });

      return {
        goalId,
        templateId: template.id,
        created: created.length,
        tasks: created,
      };
    });
  }

  // ── Nội bộ ───────────────────────────────────────────────────────────────────

  /**
   * Gate mục tiêu cho phân rã: cặp `('update','goal')` → phạm vi GHI trên chính hàng đó → GOAL-ERR-005
   * (đã chốt kỳ, dùng lại `assertNotFinalized` — MỘT hàm cho mọi đường ghi) → GOAL-ERR-009 (Cancelled).
   *
   * `Cancelled` khác `Draft`: mục tiêu nháp vẫn được phân rã (lập kế hoạch trước khi kích hoạt là luồng
   * bình thường); mục tiêu ĐÃ HUỶ thì không — tạo việc cho nó là tạo việc không ai theo.
   */
  private async loadDecomposableGoalTx(
    tx: TenantTx,
    user: RequestUser,
    goalId: string,
  ): Promise<Goal> {
    const actor = await this.access.resolveActorScope(tx, user, "update");
    const goal = await this.goalsRepo.findByIdTx(tx, user.companyId, goalId);
    if (!goal) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
    await this.access.assertCanWriteExistingGoal(tx, user, actor, goal);
    this.access.assertNotFinalized(goal);
    if (goal.status === "Cancelled") {
      throw new UnprocessableEntityException(GOAL_ERR.DECOMPOSE_CANCELLED);
    }
    return goal;
  }

  /** Neo SUY TỪ MỤC TIÊU (plan §3 D4) — client KHÔNG gửi neo, nên không có cửa lệch GOAL-ERR-008. */
  private anchorOf(goal: Goal): DecomposeAnchor {
    return {
      level: goal.level,
      projectId: goal.level === "project" ? goal.projectId : null,
      departmentId: goal.level === "department" ? goal.departmentId : null,
      employeeId: goal.level === "employee" ? goal.employeeId : null,
    };
  }

  private async createOneTx(
    tx: TenantTx,
    user: RequestUser,
    goal: Goal,
    anchor: DecomposeAnchor,
    item: DecomposeGoalItemRequest,
    ctx: { createScope: DataScope; taskCode: string },
  ): Promise<DecomposeGoalResultDto["tasks"][number]> {
    const assigneeEmployeeId = this.resolveAssignee(anchor, item);
    const priority = item.priority ? TEMPLATE_TO_TASK_PRIORITY[item.priority] : null;

    // Neo (project/department/assignee) do SERVER đặt; phần người dùng chọn ở preview (tiêu đề/mô tả/
    // ưu tiên/hạn/cột/assignee) đi qua ĐÚNG gate TASK bên trong createTaskInTx.
    const task = await this.taskCore.createTaskInTx(
      tx,
      user,
      {
        title: item.title,
        ...(item.description ? { description: item.description } : {}),
        ...(anchor.projectId ? { projectId: anchor.projectId } : {}),
        ...(anchor.departmentId ? { departmentId: anchor.departmentId } : {}),
        ...(assigneeEmployeeId ? { assigneeEmployeeId } : {}),
        ...(priority ? { priority } : {}),
        ...(item.stateId ? { stateId: item.stateId } : {}),
        ...(item.dueAt ? { dueAt: item.dueAt } : {}),
        ...(item.startAt ? { startAt: item.startAt } : {}),
      },
      {
        createScope: ctx.createScope,
        taskCode: ctx.taskCode,
        // Task mang `goal_id` NGAY lúc INSERT (SPEC-10 §10 FUNC-007) — không insert rồi UPDATE.
        goalId: goal.id,
        // Recompute MỘT lần ở cuối `decompose` cho cả lô.
        deferGoalRecompute: true,
      },
    );

    await this.applyChecklistTx(tx, user, task.id, item.checklist ?? []);

    // Vết "sinh ra từ đâu" trên chính dòng thời gian của việc — người nhận việc phải trả lời được "việc
    // này ở đâu ra" mà không cần mở audit log (audit là của quản trị, activity là của người làm việc).
    await this.activity.record(tx, {
      action: "TASK_GOAL_DECOMPOSED",
      targetType: "Task",
      targetId: task.id,
      taskId: task.id,
      projectId: anchor.projectId,
      actorUserId: user.id,
      newValues: { goalId: goal.id, goalCode: goal.goalCode, templateItemId: item.templateItemId },
      message: `Tạo từ phân rã mục tiêu ${goal.name}`,
    });

    return { id: task.id, taskCode: task.taskCode, title: item.title };
  }

  /**
   * GOAL-ERR-008 vế CHẶN cho mục tiêu cấp nhân viên: việc phải do CHÍNH nhân viên đó phụ trách. Neo ép
   * ở đây (không chờ người dùng chọn đúng) nhưng nếu client khai một người KHÁC thì phải 422, KHÔNG âm
   * thầm ghi đè — ghi đè im lặng nghĩa là người dùng thấy tên A ở preview mà việc lại về tay B.
   *
   * Mục tiêu cấp phòng/dự án: assignee tuỳ item; tính hợp lệ (thuộc phạm vi giao việc / là thành viên
   * dự án) do gate TASK kiểm — KHÔNG kiểm lại ở đây (2 bản sao luật assignee sẽ trôi).
   */
  private resolveAssignee(anchor: DecomposeAnchor, item: DecomposeGoalItemRequest): string | null {
    if (anchor.level !== "employee") return item.assigneeEmployeeId ?? null;
    if (item.assigneeEmployeeId && item.assigneeEmployeeId !== anchor.employeeId) {
      throw new UnprocessableEntityException(
        GOAL_ERR.LINK_ANCHOR(
          `mục tiêu cá nhân chỉ nhận công việc do chính nhân viên đó phụ trách (việc "${item.title}").`,
        ),
      );
    }
    return anchor.employeeId;
  }

  /**
   * `checklist` JSONB của task mẫu → `task_checklists` + `task_checklist_items` (DB-11 §6.4), qua ĐÚNG
   * repository của TASK. `is_required_for_done = false`: template không biết chính sách "bắt buộc xong
   * checklist" của từng dự án, và bật nó ở đây sẽ khoá luồng Done của việc vừa sinh ra.
   */
  private async applyChecklistTx(
    tx: TenantTx,
    user: RequestUser,
    taskId: string,
    checklist: string[],
  ): Promise<void> {
    const titles = checklist.map((t) => t.trim()).filter((t) => t.length > 0);
    if (titles.length === 0) return;
    const list = await this.checklists.insertChecklistTx(tx, user.companyId, {
      taskId,
      title: DECOMPOSE_CHECKLIST_TITLE,
      isRequiredForDone: false,
      orderIndex: 0,
      createdBy: user.id,
    });
    for (const [index, title] of titles.entries()) {
      await this.checklists.insertItemTx(tx, user.companyId, {
        taskId,
        checklistId: list.id,
        title,
        orderIndex: index,
        createdBy: user.id,
      });
    }
  }
}
