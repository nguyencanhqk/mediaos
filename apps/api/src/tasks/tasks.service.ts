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
  type OfficeTaskStatusDto,
  type TaskTypeDto,
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

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TasksRepository,
    private readonly audit: AuditService,
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────────

  getMyTasks(companyId: string, userId: string) {
    return this.repo.findByAssignee(companyId, userId);
  }

  // Board reads (G9-3 nối controller + gate read:task). `page` được forward để KHÔNG bị kẹp ngầm ở
  // DEFAULT_PAGE_SIZE — caller (G9-3) khai báo limit/offset tường minh.
  listBoard(companyId: string, filters: ListTasksFilter, page?: Pagination) {
    return this.repo.listAll(companyId, filters, page);
  }

  /**
   * Project Tasks (G9-4) — SEC-1 guard: projectId phải thuộc cùng tenant trước khi list.
   * Trả 404 nếu project không tồn tại (không phân biệt not-found / cross-tenant — tránh oracle).
   */
  async listByProject(companyId: string, projectId: string, page?: Pagination) {
    return this.db.withTenant(companyId, async (tx) => {
      const exists = await this.repo.projectExistsTx(tx, companyId, projectId);
      if (!exists) throw new NotFoundException(`Project not found: ${projectId}`);
      return this.repo.listByProject(companyId, projectId, page);
    });
  }

  /**
   * Team Tasks (G9-4) — SEC-1 guard: teamId phải thuộc cùng tenant trước khi list.
   * Trả 404 nếu team không tồn tại (không phân biệt not-found / cross-tenant — tránh oracle).
   */
  async listByTeam(companyId: string, teamId: string, page?: Pagination) {
    return this.db.withTenant(companyId, async (tx) => {
      const exists = await this.repo.teamExistsTx(tx, companyId, teamId);
      if (!exists) throw new NotFoundException(`Team not found: ${teamId}`);
      return this.repo.listByTeam(companyId, teamId, page);
    });
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
      }

      const [created] = await this.repo.createTask(
        user.companyId,
        {
          taskType: data.taskType,
          title: data.title,
          assigneeUserId: data.assigneeUserId,
          projectId: data.projectId,
          dueDate: data.dueDate,
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
        },
      });

      const [full] = await this.repo.findByIdFull(user.companyId, created.id, tx);
      if (!full) throw new InternalServerErrorException("Failed to load created task");
      return full;
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
      return full;
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

  private async assertTaskExists(companyId: string, taskId: string): Promise<void> {
    const [task] = await this.db.withTenant(companyId, (tx) =>
      this.repo.findRawByIdTx(tx, companyId, taskId),
    );
    if (!task) throw new NotFoundException(`Task not found: ${taskId}`);
  }
}
