import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { OfficeTaskStatusDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import type { TenantTx } from "../db/db.service";
import { contentItems, projects } from "../db/schema/media";
import { teamMembers } from "../db/schema/org";
import { users } from "../db/schema/users";
import { taskComments, tasks, workflowSteps } from "../db/schema/workflow";

// ─── Pagination (G9-2 DB-8/SF-2) ──────────────────────────────────────────────
// Thay magic-cap `.limit(500)` cũ (silent-truncation: tenant >500 task mất row mà không báo).
// Board-wide list nhận limit/offset TƯỜNG MINH; G9-3 nối UI phân trang trên cùng method này.
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
/**
 * My Tasks là per-assignee → bị chặn tự nhiên bởi số task giao cho 1 người; dùng ceiling an toàn,
 * KHÔNG phân trang ở G9-2 (UI "Công việc của tôi" chưa phân trang — giữ shape array, tránh regression).
 */
const MY_TASKS_CAP = MAX_PAGE_SIZE;

export interface Pagination {
  limit?: number;
  offset?: number;
}

/** Kẹp limit về [1, MAX_PAGE_SIZE]; thiếu/không hợp lệ → DEFAULT_PAGE_SIZE. */
function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
}

/** Offset không âm. */
function safeOffset(offset?: number): number {
  if (!offset || offset <= 0) return 0;
  return Math.floor(offset);
}

/** Cột trả ra cho TaskDto — join workflow_steps / content_items / projects (đều LEFT — null cho task non-video). */
const TASK_COLUMNS = {
  id: tasks.id,
  companyId: tasks.companyId,
  taskType: tasks.taskType,
  title: tasks.title,
  status: tasks.status,
  origin: tasks.origin,
  revisionRound: tasks.revisionRound,
  dueDate: tasks.dueDate,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  assigneeUserId: tasks.assigneeUserId,
  // workflow context (null cho task không thuộc workflow)
  stepId: workflowSteps.id,
  stepCode: workflowSteps.stepCode,
  stepName: workflowSteps.stepName,
  stepStatus: workflowSteps.status,
  submissionUrl: workflowSteps.submissionUrl,
  submissionNote: workflowSteps.submissionNote,
  workflowInstanceId: tasks.workflowInstanceId,
  // content context (null cho task non-video)
  contentItemId: tasks.contentItemId,
  contentTitle: contentItems.title,
  // project context (null nếu không gắn dự án)
  projectId: tasks.projectId,
  projectName: projects.name,
} as const;

export interface ListTasksFilter {
  taskType?: string;
  status?: string;
  projectId?: string;
  assigneeUserId?: string;
}

export interface CreateTaskData {
  taskType: string;
  title: string;
  assigneeUserId: string | null;
  projectId: string | null;
  dueDate: string | null;
}

@Injectable()
export class TasksRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Query nền dùng chung: SELECT + 3 LEFT JOIN. Caller thêm `.where(...).orderBy(...)`. */
  private baseQuery(tx: TenantTx) {
    return tx
      .select(TASK_COLUMNS)
      .from(tasks)
      .leftJoin(workflowSteps, eq(tasks.workflowStepId, workflowSteps.id))
      .leftJoin(contentItems, eq(tasks.contentItemId, contentItems.id))
      .leftJoin(projects, eq(tasks.projectId, projects.id));
  }

  // ─── Reads (TaskDto shape) ───────────────────────────────────────────────────

  /** Task được giao cho user hiện tại (My Tasks — gộp MỌI nguồn). Per-assignee → bounded (MY_TASKS_CAP). */
  findByAssignee(companyId: string, userId: string) {
    return this.db.withTenant(companyId, (tx) =>
      this.baseQuery(tx)
        .where(
          and(
            eq(tasks.companyId, companyId),
            eq(tasks.assigneeUserId, userId),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(desc(tasks.createdAt))
        .limit(MY_TASKS_CAP),
    );
  }

  /** Task Board tổng — lọc tuỳ chọn theo task_type / status / project / assignee + phân trang (G9-3). */
  listAll(companyId: string, filters: ListTasksFilter, page?: Pagination) {
    const conditions: (SQL | undefined)[] = [
      eq(tasks.companyId, companyId),
      isNull(tasks.deletedAt),
    ];
    if (filters.taskType) conditions.push(eq(tasks.taskType, filters.taskType));
    if (filters.status) conditions.push(eq(tasks.status, filters.status));
    if (filters.projectId) conditions.push(eq(tasks.projectId, filters.projectId));
    if (filters.assigneeUserId) conditions.push(eq(tasks.assigneeUserId, filters.assigneeUserId));

    return this.db.withTenant(companyId, (tx) =>
      this.baseQuery(tx)
        .where(and(...conditions))
        .orderBy(desc(tasks.createdAt))
        .limit(clampLimit(page?.limit))
        .offset(safeOffset(page?.offset)),
    );
  }

  /** Project Tasks — mọi task gắn 1 dự án + phân trang (G9-3). */
  listByProject(companyId: string, projectId: string, page?: Pagination) {
    return this.db.withTenant(companyId, (tx) =>
      this.baseQuery(tx)
        .where(
          and(
            eq(tasks.companyId, companyId),
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(desc(tasks.createdAt))
        .limit(clampLimit(page?.limit))
        .offset(safeOffset(page?.offset)),
    );
  }

  /** Team Tasks — task giao cho thành viên của 1 team (subquery cùng tenant tx) + phân trang (G9-3). */
  listByTeam(companyId: string, teamId: string, page?: Pagination) {
    return this.db.withTenant(companyId, (tx) => {
      const memberIds = tx
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        // isNull(deletedAt): chỉ thành viên ĐANG active — ex-member (soft-deleted) không lọt
        // vào Team board (đồng bộ org.repository.listTeamMembers; gate G9-1 SF-1).
        .where(
          and(
            eq(teamMembers.companyId, companyId),
            eq(teamMembers.teamId, teamId),
            isNull(teamMembers.deletedAt),
          ),
        );
      return this.baseQuery(tx)
        .where(
          and(
            eq(tasks.companyId, companyId),
            isNull(tasks.deletedAt),
            inArray(tasks.assigneeUserId, memberIds),
          ),
        )
        .orderBy(desc(tasks.createdAt))
        .limit(clampLimit(page?.limit))
        .offset(safeOffset(page?.offset));
    });
  }

  /** 1 task theo id ở dạng DTO đầy đủ (dùng sau create/update để trả về client). */
  findByIdFull(companyId: string, taskId: string, tx: TenantTx) {
    return this.baseQuery(tx)
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
  }

  // ─── Tenant-FK guards (G9-2 SEC-1, in-tx) ─────────────────────────────────────
  // DB FK (assignee_user_id/project_id) tham chiếu PK toàn cục → giá trị chéo tenant vẫn thoả ràng
  // buộc DB; RLS chỉ chặn ĐỌC LẠI, KHÔNG chặn GHI giá trị FK của tenant khác. Guard app-side bắt buộc.
  // Truy vấn đi qua tenant tx (RLS đã set app.current_company_id) + eq(company_id) defense-in-depth.

  /** assignee phải tồn tại, cùng tenant, đang active (status='active') và chưa xoá mềm. */
  async assigneeActiveTx(tx: TenantTx, companyId: string, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          eq(users.id, userId),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** project_id (nếu có) phải tồn tại, cùng tenant và chưa xoá mềm. */
  async projectExistsTx(tx: TenantTx, companyId: string, projectId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.companyId, companyId),
          eq(projects.id, projectId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Row thô (cho guard nghiệp vụ — phân biệt task workflow vs office). */
  findRawByIdTx(tx: TenantTx, companyId: string, taskId: string) {
    return tx
      .select({
        id: tasks.id,
        taskType: tasks.taskType,
        workflowStepId: tasks.workflowStepId,
        status: tasks.status,
      })
      .from(tasks)
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
  }

  // ─── Writes ──────────────────────────────────────────────────────────────────

  createTask(companyId: string, data: CreateTaskData, tx: TenantTx) {
    return tx
      .insert(tasks)
      .values({
        companyId,
        taskType: data.taskType,
        title: data.title,
        assigneeUserId: data.assigneeUserId,
        projectId: data.projectId,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        status: "not_started",
        origin: "initial",
      })
      .returning({ id: tasks.id });
  }

  /** SEC-2: status bị giới hạn về luồng office rút gọn (OfficeTaskStatusDto) — không nhận status workflow. */
  updateStatus(companyId: string, taskId: string, status: OfficeTaskStatusDto, tx: TenantTx) {
    return tx
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
  }

  softDelete(companyId: string, taskId: string, tx: TenantTx) {
    return tx
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  findCommentsByTaskId(companyId: string, taskId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: taskComments.id,
          taskId: taskComments.taskId,
          userId: taskComments.userId,
          userFullName: users.fullName,
          body: taskComments.body,
          createdAt: taskComments.createdAt,
        })
        .from(taskComments)
        .innerJoin(users, eq(taskComments.userId, users.id))
        .where(
          and(
            eq(taskComments.companyId, companyId),
            eq(taskComments.taskId, taskId),
          ),
        )
        .orderBy(taskComments.createdAt),
    );
  }

  createComment(
    companyId: string,
    data: { taskId: string; userId: string; body: string },
    tx: TenantTx,
  ) {
    return tx
      .insert(taskComments)
      .values({
        companyId,
        taskId: data.taskId,
        userId: data.userId,
        body: data.body,
      })
      .returning();
  }
}
