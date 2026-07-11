import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import {
  officeTaskStatusSchema,
  type CreateTaskRequest,
  type LabelDto,
  type OfficeTaskStatusDto,
  type TaskTypeDto,
  type UpdateTaskFieldsRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { TasksRepository, type ListTasksFilter, type Pagination } from "./tasks.repository";

interface RequestUser {
  id: string;
  companyId: string;
}

/**
 * Task types driven by the workflow engine (FSM). Their lifecycle/status is owned by
 * the workflow (submit → review → approve/return), NEVER by the manual shortened flow.
 * Manual status-update / delete on these is rejected to protect the FSM invariant (G7/ADR-0016).
 */
// `satisfies TaskTypeDto[]` ép kiểm tra compile-time: mỗi literal phải là task_type hợp lệ trong
// contracts (nguồn sự thật). office/meeting_action/finance/hr KHÔNG thuộc FSM → CỐ Ý loại trừ
// (status sửa tay được qua luồng rút gọn). Thêm FSM type mới ở contracts → thêm vào đây (tsc bắt typo).
const WORKFLOW_TASK_TYPES = new Set<string>([
  "workflow_step",
  "production",
  "review",
  "revision",
] satisfies TaskTypeDto[]);

/** Hàng task thô từ repo có đủ trường để tính displayId (PM-1). */
type TaskRowWithSeq = { id: string; projectIdentifier: string | null; sequence: number | null };

/**
 * PM-1 — tính displayId `{IDENT}-{seq}` (vd "WEB-12"). null nếu project chưa đặt identifier hoặc task
 * không có sequence (task không gắn project). Giữ immutability: trả COPY mới (không mutate row gốc).
 */
function addDisplayId<T extends TaskRowWithSeq>(row: T): T & { displayId: string | null } {
  const displayId =
    row.projectIdentifier && row.sequence !== null
      ? `${row.projectIdentifier}-${row.sequence}`
      : null;
  return { ...row, displayId };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TasksRepository,
    private readonly audit: AuditService,
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────────

  async getMyTasks(companyId: string, userId: string) {
    const rows = await this.repo.findByAssignee(companyId, userId);
    return rows.map(addDisplayId);
  }

  /**
   * Board reads (G9-3 nối controller + gate read:task). `page` được forward để KHÔNG bị kẹp ngầm.
   * PM-1: trả BoardTaskDto (đính labels[] aggregate trong 1 query — tránh N+1) + displayId compute.
   */
  async listBoard(companyId: string, filters: ListTasksFilter, page?: Pagination) {
    const rows = await this.repo.listAll(companyId, filters, page);
    return this.attachLabels(companyId, rows);
  }

  /**
   * Project Tasks (G9-4) — SEC-1 guard: projectId phải thuộc cùng tenant trước khi list.
   * Trả 404 nếu project không tồn tại (không phân biệt not-found / cross-tenant — tránh oracle).
   */
  async listByProject(companyId: string, projectId: string, page?: Pagination) {
    const rows = await this.db.withTenant(companyId, async (tx) => {
      const exists = await this.repo.projectExistsTx(tx, companyId, projectId);
      if (!exists) throw new NotFoundException(`Project not found: ${projectId}`);
      return this.repo.listByProject(companyId, projectId, page);
    });
    return this.attachLabels(companyId, rows);
  }

  /**
   * Team Tasks (G9-4) — SEC-1 guard: teamId phải thuộc cùng tenant trước khi list.
   * Trả 404 nếu team không tồn tại (không phân biệt not-found / cross-tenant — tránh oracle).
   */
  async listByTeam(companyId: string, teamId: string, page?: Pagination) {
    const rows = await this.db.withTenant(companyId, async (tx) => {
      const exists = await this.repo.teamExistsTx(tx, companyId, teamId);
      if (!exists) throw new NotFoundException(`Team not found: ${teamId}`);
      return this.repo.listByTeam(companyId, teamId, page);
    });
    return this.attachLabels(companyId, rows);
  }

  // ─── Manual task lifecycle (G9-2 / G9-3) ─────────────────────────────────────

  /** Tạo task tay (office). Không cần content/workflow — bản chất Task Hub hợp nhất (BẤT BIẾN #4). */
  async createTask(user: RequestUser, dto: CreateTaskRequest) {
    return this.createHubTask(user, {
      taskType: dto.taskType,
      title: dto.title,
      assigneeUserId: dto.assigneeUserId ?? null,
      projectId: dto.projectId ?? null,
      dueDate: dto.dueDate ?? null,
      // PM-1: thuộc tính work item (optional — luồng office cũ bỏ trống).
      priority: dto.priority,
      description: dto.description ?? null,
      stateId: dto.stateId ?? null,
      startDate: dto.startDate ?? null,
    });
  }

  /**
   * G10-4 — Tạo action-item sau họp vào Task Hub (`task_type='meeting_action'`, BẤT BIẾN #4: KHÔNG
   * bảng task riêng). Domain Meeting là writer hợp lệ duy nhất của meeting_action — API tạo tay
   * (`POST /tasks`) vẫn office-only (`manualTaskTypeSchema`). Guard FK + audit y như createTask.
   */
  async createMeetingActionTask(
    user: RequestUser,
    input: { title: string; assigneeUserId?: string | null; dueDate?: string | null },
  ) {
    return this.createHubTask(user, {
      taskType: "meeting_action",
      title: input.title,
      assigneeUserId: input.assigneeUserId ?? null,
      projectId: null,
      dueDate: input.dueDate ?? null,
    });
  }

  /**
   * Lõi tạo task vào Task Hub dùng chung cho mọi nguồn không thuộc FSM (office tay + meeting_action…).
   * SEC-1 tenant-FK guard TRƯỚC insert/audit: FK trỏ PK toàn cục nên giá trị chéo tenant vẫn thoả ràng
   * buộc DB — phải chặn app-side. Mọi FK cho phép NULL (chỉ guard khi có giá trị).
   */
  private async createHubTask(
    user: RequestUser,
    data: {
      taskType: TaskTypeDto;
      title: string;
      assigneeUserId: string | null;
      projectId: string | null;
      dueDate: string | null;
      // PM-1 (apps/projects, mig 0420) — work item kiểu Plane (đều optional).
      priority?: string;
      description?: string | null;
      stateId?: string | null;
      startDate?: string | null;
      // S4-TASK-BE-1: cờ NỘI BỘ (KHÔNG expose qua API) — bỏ qua chặn tạo task dưới dự án đã đóng. MVP luôn
      // false (chặn cứng). Cờ dành cho luồng WO sau cần override có kiểm soát (KHÔNG nới lỏng đường API).
      allowClosedProject?: boolean;
    },
  ) {
    return this.db.withTenant(user.companyId, async (tx) => {
      if (data.assigneeUserId) {
        const ok = await this.repo.assigneeActiveTx(tx, user.companyId, data.assigneeUserId);
        if (!ok) {
          throw new BadRequestException(
            "Người nhận việc không hợp lệ (không cùng công ty hoặc đã ngưng hoạt động).",
          );
        }
      }
      if (data.projectId) {
        const ok = await this.repo.projectExistsTx(tx, user.companyId, data.projectId);
        if (!ok) throw new NotFoundException(`Project not found: ${data.projectId}`);

        // S4-TASK-BE-1 — BLOCK-NEW-TASK: đọc CỘT MỚI project_status TitleCase (Completed/Cancelled/
        // Archived), KHÔNG đọc cột legacy `status` lowercase. Dự án đã kết thúc ⇒ chặn cứng (MVP). Dự án
        // đã soft-delete đã bị projectExistsTx trả 404 ở trên. Cờ allowClosedProject dành cho WO sau.
        // GHI NHẬN (S4-TASK-BE-2): project MỚI (tạo qua ProjectsService) chưa có project_states legacy →
        // nhánh stateId/allocateSequence bên dưới có thể fail độc lập; mối nối đó thuộc phạm vi WO sau.
        if (!data.allowClosedProject) {
          const blocked = await this.repo.projectBlocksNewTaskTx(
            tx,
            user.companyId,
            data.projectId,
          );
          if (blocked) {
            throw new BadRequestException(
              "Dự án đã đóng/huỷ/lưu trữ — không thể tạo công việc mới trong dự án này.",
            );
          }
        }
      }

      // PM-1: nếu có stateId tường minh → guard nó thuộc ĐÚNG project (cần project trước). stateId mà
      // KHÔNG có project → vô nghĩa (state luôn theo project) → BadRequest.
      let stateId = data.stateId ?? null;
      if (stateId) {
        if (!data.projectId) {
          throw new BadRequestException("stateId chỉ hợp lệ khi task gắn với một project.");
        }
        const ok = await this.repo.stateInProjectTx(tx, user.companyId, data.projectId, stateId);
        if (!ok) throw new BadRequestException("Trạng thái không thuộc project của công việc.");
      }

      // PM-1: project-scoped → cấp sequence ATOMIC; nếu chưa chỉ định state → dùng default state của project.
      let sequence: number | null = null;
      if (data.projectId) {
        sequence = await this.repo.allocateSequenceTx(tx, user.companyId, data.projectId);
        if (sequence === null) throw new NotFoundException(`Project not found: ${data.projectId}`);
        if (!stateId) {
          stateId = await this.repo.findDefaultStateTx(tx, user.companyId, data.projectId);
        }
      }

      const [created] = await this.repo.createTask(
        user.companyId,
        {
          taskType: data.taskType,
          title: data.title,
          assigneeUserId: data.assigneeUserId,
          projectId: data.projectId,
          dueDate: data.dueDate,
          priority: data.priority,
          description: data.description ?? null,
          stateId,
          sequence,
          startDate: data.startDate ?? null,
        },
        tx,
      );
      if (!created) throw new InternalServerErrorException("Failed to create task");

      await this.audit.record(tx, {
        action: "TaskCreated",
        objectType: "task",
        objectId: created.id,
        actorUserId: user.id,
        after: {
          taskType: data.taskType,
          title: data.title,
          assigneeUserId: data.assigneeUserId,
          projectId: data.projectId,
          priority: data.priority ?? "none",
          stateId,
          sequence,
        },
      });

      const [full] = await this.repo.findByIdFull(user.companyId, created.id, tx);
      if (!full) throw new InternalServerErrorException("Failed to load created task");
      return addDisplayId(full);
    });
  }

  /**
   * Đổi status theo luồng rút gọn (Chưa bắt đầu → Đang làm → Hoàn thành) cho task KHÔNG vòng duyệt.
   * Từ chối task workflow-driven — chúng PHẢI đi qua FSM (submit/approve/return), không sửa status tay.
   */
  async updateStatus(user: RequestUser, taskId: string, status: OfficeTaskStatusDto) {
    // SEC-2 (defense-in-depth): chỉ chấp nhận status luồng office rút gọn ngay tại biên service,
    // không dựa duy nhất vào ZodValidationPipe ở controller. Status workflow (waiting_review/approved/
    // revision) bị từ chối — FSM mới được phép đặt chúng (G7/ADR-0016).
    const parsedStatus = officeTaskStatusSchema.safeParse(status);
    if (!parsedStatus.success) {
      throw new BadRequestException(
        "Trạng thái không hợp lệ cho luồng rút gọn (chỉ: not_started, in_progress, completed).",
      );
    }
    const nextStatus: OfficeTaskStatusDto = parsedStatus.data;

    return this.db.withTenant(user.companyId, async (tx) => {
      const [task] = await this.repo.findRawByIdTx(tx, user.companyId, taskId);
      if (!task) throw new NotFoundException(`Task not found: ${taskId}`);

      if (task.workflowStepId !== null || WORKFLOW_TASK_TYPES.has(task.taskType)) {
        throw new BadRequestException(
          "Task thuộc workflow — đổi trạng thái qua workflow (submit/duyệt/trả về), không sửa tay.",
        );
      }

      const [updated] = await this.repo.updateStatus(user.companyId, taskId, nextStatus, tx);
      if (!updated) throw new NotFoundException(`Task not found: ${taskId}`);

      await this.audit.record(tx, {
        action: "TaskStatusChanged",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        before: { status: task.status },
        after: { status },
      });

      const [full] = await this.repo.findByIdFull(user.companyId, taskId, tx);
      if (!full) throw new InternalServerErrorException("Failed to load updated task");
      return addDisplayId(full);
    });
  }

  // ─── PM-1 (apps/projects, mig 0420) — work item field update + nhãn ───────────

  /**
   * Cập nhật field work item (PATCH /tasks/:id). CHỈ áp task KHÔNG thuộc FSM (như updateStatus/deleteTask)
   * — task workflow-driven do engine quản (status/field qua submit/duyệt/trả). Nếu đổi stateId → guard state
   * thuộc ĐÚNG project của task. Audit objectType 'task' action 'TaskUpdated' kèm field đã đổi.
   */
  async updateTaskFields(user: RequestUser, taskId: string, fields: UpdateTaskFieldsRequest) {
    return this.db.withTenant(user.companyId, async (tx) => {
      const [task] = await this.repo.findRawByIdTx(tx, user.companyId, taskId);
      if (!task) throw new NotFoundException(`Task not found: ${taskId}`);

      if (task.workflowStepId !== null || WORKFLOW_TASK_TYPES.has(task.taskType)) {
        throw new BadRequestException(
          "Task thuộc workflow — sửa qua workflow (submit/duyệt/trả về), không cập nhật tay.",
        );
      }

      // SEC-1: assignee mới phải cùng tenant + active (FK toàn cục — guard app-side bắt buộc).
      if (fields.assigneeUserId) {
        const ok = await this.repo.assigneeActiveTx(tx, user.companyId, fields.assigneeUserId);
        if (!ok) {
          throw new BadRequestException(
            "Người nhận việc không hợp lệ (không cùng công ty hoặc đã ngưng hoạt động).",
          );
        }
      }

      // PM-1: stateId mới phải thuộc ĐÚNG project của task (cần project_id của task).
      if (fields.stateId) {
        if (!task.projectId) {
          throw new BadRequestException("Không thể đặt trạng thái cho công việc chưa gắn project.");
        }
        const ok = await this.repo.stateInProjectTx(
          tx,
          user.companyId,
          task.projectId,
          fields.stateId,
        );
        if (!ok) throw new BadRequestException("Trạng thái không thuộc project của công việc.");
      }

      const [updated] = await this.repo.updateTaskFieldsTx(user.companyId, taskId, fields, tx);
      if (!updated) throw new NotFoundException(`Task not found: ${taskId}`);

      await this.audit.record(tx, {
        action: "TaskUpdated",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        before: { changed: Object.keys(fields) },
        after: fields,
      });

      const [full] = await this.repo.findByIdFull(user.companyId, taskId, tx);
      if (!full) throw new InternalServerErrorException("Failed to load updated task");
      return addDisplayId(full);
    });
  }

  /**
   * Gán nhãn cho work item. Guard task + label cùng tenant VÀ cùng project (nhãn theo project). Idempotent:
   * gán lại nhãn đã có → no-op (unique). Audit objectType 'task' action 'TaskLabelAdded'.
   */
  async addLabelToTask(user: RequestUser, taskId: string, labelId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const [task] = await this.repo.findRawByIdTx(tx, user.companyId, taskId);
      if (!task) throw new NotFoundException(`Task not found: ${taskId}`);
      // Workflow-driven task do FSM quản — KHÔNG gắn nhãn tay (đồng bộ guard update/delete/status).
      if (task.workflowStepId !== null || WORKFLOW_TASK_TYPES.has(task.taskType)) {
        throw new BadRequestException("Task thuộc workflow — không gắn nhãn tay.");
      }
      const [label] = await this.repo.findLabelByIdTx(tx, user.companyId, labelId);
      if (!label) throw new NotFoundException(`Label not found: ${labelId}`);
      // Nhãn theo project → task phải cùng project với nhãn (chặn gắn nhãn project khác).
      if (task.projectId !== label.projectId) {
        throw new BadRequestException("Nhãn và công việc phải thuộc cùng một project.");
      }

      const already = await this.repo.taskLabelExistsTx(tx, user.companyId, taskId, labelId);
      if (already) return; // idempotent — không re-insert, không audit lặp.

      await this.repo.addTaskLabelTx(user.companyId, taskId, labelId, tx);
      await this.audit.record(tx, {
        action: "TaskLabelAdded",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        after: { labelId },
      });
    });
  }

  /** Gỡ nhãn khỏi work item (hard-delete link M:N). Audit objectType 'task' action 'TaskLabelRemoved'. */
  async removeLabelFromTask(user: RequestUser, taskId: string, labelId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const [task] = await this.repo.findRawByIdTx(tx, user.companyId, taskId);
      if (!task) throw new NotFoundException(`Task not found: ${taskId}`);
      if (task.workflowStepId !== null || WORKFLOW_TASK_TYPES.has(task.taskType)) {
        throw new BadRequestException("Task thuộc workflow — không gỡ nhãn tay.");
      }

      const [removed] = await this.repo.removeTaskLabelTx(user.companyId, taskId, labelId, tx);
      if (!removed) throw new NotFoundException("Nhãn chưa được gán cho công việc này.");

      await this.audit.record(tx, {
        action: "TaskLabelRemoved",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
        after: { labelId },
      });
    });
  }

  /** Soft-delete task tay. Workflow-driven task không được xoá tay (engine quản vòng đời). */
  async deleteTask(user: RequestUser, taskId: string) {
    await this.db.withTenant(user.companyId, async (tx) => {
      const [task] = await this.repo.findRawByIdTx(tx, user.companyId, taskId);
      if (!task) throw new NotFoundException(`Task not found: ${taskId}`);

      if (task.workflowStepId !== null || WORKFLOW_TASK_TYPES.has(task.taskType)) {
        throw new BadRequestException("Không thể xoá tay task thuộc workflow.");
      }

      const [deleted] = await this.repo.softDelete(user.companyId, taskId, tx);
      if (!deleted) throw new NotFoundException(`Task not found: ${taskId}`);

      await this.audit.record(tx, {
        action: "TaskDeleted",
        objectType: "task",
        objectId: taskId,
        actorUserId: user.id,
      });
    });
  }

  // ─── Comments ────────────────────────────────────────────────────────────────
  // @deprecated S4-TASK-BE-4: TasksController KHÔNG còn gọi 2 method dưới đây (route GET/POST
  // /tasks/:taskId/comments đã chuyển sang TaskCommentsService — gate read/comment:task + data-scope
  // + soft-delete/PATCH mới, xem tasks.controller.ts). GIỮ NGUYÊN (KHÔNG xoá) — tránh phá
  // tasks.service.spec.ts mock hiện có; xoá hẳn thuộc phạm vi dọn dẹp WO sau.

  async getComments(companyId: string, taskId: string) {
    await this.assertTaskExists(companyId, taskId);
    return this.repo.findCommentsByTaskId(companyId, taskId);
  }

  async addComment(companyId: string, taskId: string, userId: string, body: string) {
    const comment = await this.db.withTenant(companyId, async (tx) => {
      const [task] = await this.repo.findRawByIdTx(tx, companyId, taskId);
      if (!task) throw new NotFoundException(`Task not found: ${taskId}`);

      const [created] = await this.repo.createComment(companyId, { taskId, userId, body }, tx);
      if (!created) throw new InternalServerErrorException("Failed to create comment");

      await this.audit.record(tx, {
        action: "TaskCommentAdded",
        objectType: "task",
        objectId: taskId,
        actorUserId: userId,
        after: { body },
      });
      return created;
    });

    // Re-fetch with user join to return full CommentDto.
    const comments = await this.repo.findCommentsByTaskId(companyId, taskId);
    return comments.find((c) => c.id === comment.id) ?? comment;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * PM-1 — tính displayId + đính labels[] cho 1 tập hàng task → BoardTaskDto[]. Nhãn lấy trong 1 query
   * (listLabelsForTaskIds) rồi gom theo task ở JS (tránh N+1). row gốc giữ nguyên (trả copy mới).
   */
  private async attachLabels<T extends TaskRowWithSeq>(
    companyId: string,
    rows: T[],
  ): Promise<(T & { displayId: string | null; labels: LabelDto[] })[]> {
    if (rows.length === 0) return [];
    const labelRows = await this.repo.listLabelsForTaskIds(
      companyId,
      rows.map((r) => r.id),
    );
    const byTask = new Map<string, LabelDto[]>();
    for (const { taskId, ...label } of labelRows) {
      const list = byTask.get(taskId) ?? [];
      list.push({
        ...label,
        createdAt:
          label.createdAt instanceof Date ? label.createdAt.toISOString() : label.createdAt,
      } as LabelDto);
      byTask.set(taskId, list);
    }
    return rows.map((r) => ({ ...addDisplayId(r), labels: byTask.get(r.id) ?? [] }));
  }

  private async assertTaskExists(companyId: string, taskId: string): Promise<void> {
    const [task] = await this.db.withTenant(companyId, (tx) =>
      this.repo.findRawByIdTx(tx, companyId, taskId),
    );
    if (!task) throw new NotFoundException(`Task not found: ${taskId}`);
  }
}
