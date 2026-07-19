import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  ProjectStateGroupDto,
  TaskKanbanBoardDto,
  TaskKanbanStateColumnDto,
  TaskKanbanStatusColumnDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { TaskCoreRepository } from "./task-core.repository";
import { TasksRepository } from "./tasks.repository";
import { toTaskKanbanCardDto } from "./task-core.mapper";
import { TASK_CORE_STATUSES } from "./task-fsm";
import { TaskCommentsRepository } from "./task-comments.repository";
import { TaskChecklistsRepository } from "./task-checklists.repository";
import { TaskFileRepository } from "./task-file.repository";

interface RequestUser {
  id: string;
  companyId: string;
}

/** Trần list nội bộ cho 1 cột Kanban — MVP không phân trang board (SPEC-06 §6.8, không đặt limit rõ). */
const KANBAN_TASK_LIMIT = 500;

const ERR = {
  PROJECT_NOT_FOUND: "TASK-ERR-PROJECT-NOT-FOUND: không tìm thấy dự án.",
} as const;

/**
 * S4-TASK-BE-4 — TaskKanbanService (SPEC-06 §14.13, API-06 §15 · TASK-API-212).
 *
 * GET /projects/:id/kanban: nhóm task CỦA 1 project theo `task_status` (5 cột cố định FSM — task-fsm.ts).
 * Data-scope ĐỌC tái dùng CHÍNH `TaskCoreRepository.buildReadScopeExists` (mirror TaskCoreService) — employee
 * @Own chỉ thấy cột chứa task họ liên quan (assignee/member), manager @Team thấy team, hr/admin @Company toàn
 * bộ. Kéo-thả (đổi cột) đi qua route riêng `POST /tasks/:id/move` → CHÍNH `TaskActionsService.changeStatus`
 * (KHÔNG có method mutate ở đây — "không lách FSM", done_when).
 *
 * BẤT BIẾN #1: mọi query qua db.withTenant(companyId) + repo AND company_id tường minh.
 */
@Injectable()
export class TaskKanbanService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskCoreRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly dataScope: DataScopeService,
    private readonly commentsRepo: TaskCommentsRepository,
    private readonly checklistsRepo: TaskChecklistsRepository,
    private readonly filesRepo: TaskFileRepository,
  ) {}

  async getBoard(user: RequestUser, projectId: string): Promise<TaskKanbanBoardDto> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "view-kanban",
      "task",
    );
    return this.db.withTenant(user.companyId, async (tx) => {
      const exists = await this.tasksRepo.projectExistsTx(tx, user.companyId, projectId);
      if (!exists) throw new NotFoundException(ERR.PROJECT_NOT_FOUND);

      let scopeExists;
      if (scope !== "Company" && scope !== "System") {
        const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
        const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
        const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
        scopeExists = this.repo.buildReadScopeExists(
          user.companyId,
          scopeCond,
          actorEmp?.id ?? null,
          user.id,
        );
      }

      // S5-TASK-PIPELINE-1 (lane be-read): board CHỈ hiện task cha (plan mục 0 — parent_task_id IS
      // NULL; subtask ẩn khỏi board, CRUD thuộc S5-TASK-SUBTASK-1). Cột theo pipeline khi project có
      // state active; 0 state ⇒ fallback 5 cột FSM y hệt hành vi cũ.
      const states = await this.repo.listBoardStatesTx(tx, user.companyId, projectId);
      const rows = await this.repo.listTx(
        tx,
        user.companyId,
        { projectId, parentOnly: true, limit: KANBAN_TASK_LIMIT, offset: 0 },
        scopeExists,
      );

      // S5-TASK-BE-6 (SPEC-06 §13.8) — 3 aggregate GROUP-BY, KHÔNG per-card query (chống N+1). Chạy CÙNG tx
      // (withTenant) nên vẫn qua RLS+FORCE của tenant hiện tại.
      const taskIds = rows.map((row) => row.id);
      const [commentCounts, attachmentCounts, checklistProgress] = await Promise.all([
        this.commentsRepo.countByTaskIdsTx(tx, user.companyId, taskIds),
        this.filesRepo.countByTaskIdsTx(tx, user.companyId, taskIds),
        this.checklistsRepo.countProgressByTaskIdsTx(tx, user.companyId, taskIds),
      ]);
      const toCard = (row: (typeof rows)[number]) => {
        const progress = checklistProgress.get(row.id);
        return toTaskKanbanCardDto(row, {
          commentCount: commentCounts.get(row.id) ?? 0,
          attachmentCount: attachmentCounts.get(row.id) ?? 0,
          checklistDone: progress?.done ?? 0,
          checklistTotal: progress?.total ?? 0,
        });
      };

      if (states.length > 0) {
        // columnMode:'state' — cột dựng theo sortOrder (repo đã sort xác định); nhóm thẻ theo
        // state_id; thẻ state NULL/hỏng KHÔNG biến mất — rơi vào cột is_default (không có default
        // ⇒ cột đầu, mirror bậc thang D-20).
        const columns: TaskKanbanStateColumnDto[] = states.map((s) => ({
          columnMode: "state" as const,
          stateId: s.id,
          name: s.name,
          color: s.color,
          stateGroup: s.stateGroup as ProjectStateGroupDto,
          sortOrder: s.sortOrder,
          taskCount: 0,
          tasks: [],
        }));
        const byStateId = new Map(columns.map((c) => [c.stateId, c]));
        // isDefault qua raw tx.execute có thể là boolean HOẶC 't'/'true' (mirror toBool của mapper) —
        // truthiness trần sẽ coi 'f' là true ⇒ fallback sai câm (finding LIGHT gate).
        const isDefaultTrue = (v: boolean | string): boolean =>
          v === true || v === "true" || v === "t";
        const fallback = columns[states.findIndex((s) => isDefaultTrue(s.isDefault))] ?? columns[0];
        for (const row of rows) {
          const column = (row.stateId ? byStateId.get(row.stateId) : undefined) ?? fallback;
          column.tasks.push(toCard(row));
        }
        for (const column of columns) column.taskCount = column.tasks.length;
        return { projectId, columns };
      }

      const columns: TaskKanbanStatusColumnDto[] = TASK_CORE_STATUSES.map((status) => ({
        columnMode: "status" as const,
        status,
        tasks: [],
      }));
      const byStatus = new Map(columns.map((c) => [c.status, c]));
      for (const row of rows) {
        const status = (row.taskStatus as (typeof TASK_CORE_STATUSES)[number] | null) ?? "Todo";
        const column = byStatus.get(status) ?? byStatus.get("Todo");
        column?.tasks.push(toCard(row));
      }

      return { projectId, columns };
    });
  }
}
