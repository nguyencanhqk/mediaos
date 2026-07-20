import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
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
import {
  toTaskKanbanCardDto,
  toAvatarSubjects,
  signedUrlsForRow,
  toLabelChipsByTask,
} from "./task-core.mapper";
import { TASK_CORE_STATUSES } from "./task-fsm";
import { TaskCommentsRepository } from "./task-comments.repository";
import { TaskChecklistsRepository } from "./task-checklists.repository";
import { TaskFileRepository } from "./task-file.repository";
import { AvatarPresignService } from "../foundation/files/avatar-presign.service";
import { CoverPresignService } from "../foundation/files/cover-presign.service";

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
    // S5-TASK-AVATAR-1 (Nhóm C) — ký URL avatar người phụ trách cho thẻ board. CÙNG service mà
    // HR list/org-chart dùng ⇒ cùng luật self-defending (chỉ ký cặp employeeId↔fileId đã xác minh).
    private readonly avatars: AvatarPresignService,
    // S5-TASK-COVER-1 — ký ảnh bìa cho thẻ board. Đặt CUỐI (spec dựng theo VỊ TRÍ).
    private readonly covers: CoverPresignService,
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
      // S5-TASK-SUBTASK-1 — 4 aggregate GROUP-BY, AWAIT TUẦN TỰ (KHÔNG Promise.all).
      // ⚠️ Trước đây khối này dùng Promise.all trên CÙNG MỘT tx. node-postgres KHÔNG chạy được truy vấn
      // song song trên một tx connection — chúng serialize dù có Promise.all (và pattern đó vỡ ở pg@9;
      // xem workflow.service.ts:478-480 "Sequential awaits, NOT Promise.all"). Nghĩa là Promise.all ở
      // đây KHÔNG mang lại song song thật, chỉ mang lại rủi ro ⇒ đổi tuần tự khi thêm cái thứ tư.
      // Yêu cầu "KHÔNG N+1" nói về SỐ CÂU (1 aggregate cho N thẻ), không phải về tính song song.
      const commentCounts = await this.commentsRepo.countByTaskIdsTx(tx, user.companyId, taskIds);
      const attachmentCounts = await this.filesRepo.countByTaskIdsTx(tx, user.companyId, taskIds);
      const checklistProgress = await this.checklistsRepo.countProgressByTaskIdsTx(
        tx,
        user.companyId,
        taskIds,
      );
      // D-34 — tiến độ = tỉ lệ việc con hoàn thành. Board đã parentOnly ⇒ taskIds chính là id các thẻ CHA.
      const subtaskProgress = await this.repo.countSubtaskProgressByParentIdsTx(
        tx,
        user.companyId,
        taskIds,
      );
      // Gắn thẻ — nhãn cho MỌI thẻ board trong 1 query (không N+1), TUẦN TỰ trên cùng tx như trên.
      const labelsByTask = toLabelChipsByTask(
        await this.tasksRepo.listLabelsForTaskIdsTx(tx, user.companyId, taskIds),
      );
      // S5-TASK-AVATAR-1 (Nhóm C) — ký URL avatar người phụ trách, THEO LÔ và khử trùng người: một
      // người phụ trách 20 thẻ chỉ tốn MỘT hàng cần ký, không phải 20. Truyền `tx` để tái dùng đúng
      // kết nối đang mở (mở withTenant lồng nhau sẽ treo trên PgBouncer transaction-mode).
      // Fail-soft sẵn trong service: ký lỗi ⇒ không vào map ⇒ null ⇒ FE vẽ chữ cái đầu, KHÔNG 500 board.
      const avatars = await this.avatars.resolveEmployeeAvatars(
        user.companyId,
        toAvatarSubjects(rows),
        tx,
      );
      // S5-TASK-COVER-1 — ảnh bìa THEO LÔ cho cả board, cùng `tx`. TUẦN TỰ sau avatar chứ KHÔNG
      // Promise.all: hai truy vấn trên CÙNG một kết nối transaction sẽ hỏng ngẫu nhiên dưới tải.
      // Fail-soft như avatar: ký lỗi ⇒ không vào map ⇒ thẻ không bìa, KHÔNG 500 board.
      //
      // ⚠️ GATE RIÊNG CHO BÌA — KHÔNG dùng lại `scope` của board. Board gate bằng cặp
      // `view-kanban:task` (projects.controller), còn đường TẢI tệp gate bằng cặp `read:task`
      // (TaskFileService.getDownloadUrl + TaskFileResolver). `data_scope` là PER-(permission, role)
      // nên hai cặp có thể có scope KHÁC nhau: cấu hình `view-kanban@Company` + `read@Own` sẽ khiến
      // board ký ảnh GỐC full-res của attachment cho người KHÔNG tải được chính tệp đó.
      // Seed 0485 hiện cấp cả hai cặp cùng scope cho cả 4 role ⇒ chưa khai thác được ở cấu hình xuất
      // xưởng, nhưng đó là may mắn cấu hình, không phải bảo đảm. Fail-closed: không có grant
      // `read:task` ⇒ KHÔNG ký bìa nào (thẻ vẫn hiện, chỉ không có ảnh).
      //
      // ⚠️ CHỈ nuốt đúng `ForbiddenException` (= "không có grant", `DataScopeService.resolveAndAssert`
      // ném đúng loại này khi scope null). Bắt trần `.catch(() => false)` sẽ nuốt CẢ lỗi hạ tầng của
      // permission engine (mất kết nối DB, lỗi lập trình) và biến nó thành "board im lặng không có
      // bìa nào" — không exception, không log, không ai biết. Đúng lớp lỗi mà chính WO này đi vá ở
      // chỗ khác; không được tự tạo lại nó ở đây.
      let canReadTask = true;
      try {
        await this.dataScope.resolveAndAssert(user.id, user.companyId, "read", "task");
      } catch (err) {
        if (!(err instanceof ForbiddenException)) throw err;
        canReadTask = false;
      }
      const covers = canReadTask
        ? await this.covers.resolveTaskCovers(user.companyId, taskIds, tx)
        : new Map<string, string>();

      const toCard = (row: (typeof rows)[number]) => {
        const progress = checklistProgress.get(row.id);
        const subtasks = subtaskProgress.get(row.id);
        return {
          ...toTaskKanbanCardDto(
            row,
            {
              commentCount: commentCounts.get(row.id) ?? 0,
              attachmentCount: attachmentCounts.get(row.id) ?? 0,
              checklistDone: progress?.done ?? 0,
              checklistTotal: progress?.total ?? 0,
              // D-35 — checklist GIỮ badge riêng, KHÔNG gộp, KHÔNG thay bằng subtask: checklist là hạng mục
              // con trong đầu MỘT người, subtask là việc có chủ + hạn riêng. Hai khái niệm khác nhau.
              subtaskDone: subtasks?.done ?? 0,
              subtaskTotal: subtasks?.total ?? 0,
            },
            signedUrlsForRow(row, avatars, covers),
          ),
          labels: labelsByTask.get(row.id) ?? [],
        };
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
