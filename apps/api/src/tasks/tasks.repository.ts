import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { OfficeTaskStatusDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import type { TenantTx } from "../db/db.service";
import { contentItems, projects } from "../db/schema/media";
import { teamMembers } from "../db/schema/org";
import { users } from "../db/schema/users";
import {
  labels,
  projectStates,
  taskAttachments,
  taskComments,
  taskLabels,
  tasks,
  workflowSteps,
} from "../db/schema/workflow";

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
  // PM-1 (apps/projects, mig 0420) — work item kiểu Plane. displayId compute ở service từ identifier+sequence.
  priority: tasks.priority,
  description: tasks.description,
  startDate: tasks.startDate,
  sequence: tasks.sequence,
  projectIdentifier: projects.identifier,
  // state tùy biến (LEFT JOIN project_states — null cho task chưa map state).
  stateId: tasks.stateId,
  stateName: projectStates.name,
  stateGroup: projectStates.stateGroup,
  stateColor: projectStates.color,
} as const;

export interface ListTasksFilter {
  taskType?: string;
  status?: string;
  projectId?: string;
  assigneeUserId?: string;
  // PM-1: lọc board theo state tùy biến / ưu tiên / nhãn.
  stateId?: string;
  priority?: string;
  labelId?: string;
}

/** Patch field work item (PM-1) — chỉ field CÓ MẶT mới đổi (partial). undefined = giữ nguyên. */
export interface UpdateTaskFieldsData {
  title?: string;
  description?: string | null;
  priority?: string;
  stateId?: string | null;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
}

export interface CreateTaskData {
  taskType: string;
  title: string;
  assigneeUserId: string | null;
  projectId: string | null;
  dueDate: string | null;
  // PM-1 (apps/projects, mig 0420) — work item kiểu Plane (tất cả optional; luồng office cũ bỏ qua).
  priority?: string;
  description?: string | null;
  stateId?: string | null;
  sequence?: number | null;
  startDate?: string | null;
}

@Injectable()
export class TasksRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Query nền dùng chung: SELECT + 4 LEFT JOIN (workflow_steps/content_items/projects/project_states). */
  private baseQuery(tx: TenantTx) {
    return (
      tx
        .select(TASK_COLUMNS)
        .from(tasks)
        .leftJoin(workflowSteps, eq(tasks.workflowStepId, workflowSteps.id))
        .leftJoin(contentItems, eq(tasks.contentItemId, contentItems.id))
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        // PM-1: state tùy biến — LEFT JOIN cùng tenant (eq(company_id) defense-in-depth ngoài RLS).
        .leftJoin(
          projectStates,
          and(eq(tasks.stateId, projectStates.id), eq(projectStates.companyId, tasks.companyId)),
        )
    );
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

  /** Task Board tổng — lọc tuỳ chọn theo task_type / status / project / assignee / state / priority / label + phân trang. */
  listAll(companyId: string, filters: ListTasksFilter, page?: Pagination) {
    const conditions: (SQL | undefined)[] = [
      eq(tasks.companyId, companyId),
      isNull(tasks.deletedAt),
    ];
    if (filters.taskType) conditions.push(eq(tasks.taskType, filters.taskType));
    if (filters.status) conditions.push(eq(tasks.status, filters.status));
    if (filters.projectId) conditions.push(eq(tasks.projectId, filters.projectId));
    if (filters.assigneeUserId) conditions.push(eq(tasks.assigneeUserId, filters.assigneeUserId));
    // PM-1 filters.
    if (filters.stateId) conditions.push(eq(tasks.stateId, filters.stateId));
    if (filters.priority) conditions.push(eq(tasks.priority, filters.priority));
    const labelId = filters.labelId;

    return this.db.withTenant(companyId, (tx) => {
      if (labelId) {
        // labelId: chỉ task có gán nhãn này (subselect cùng tenant — task_labels keyed company_id + RLS).
        const taggedTaskIds = tx
          .select({ taskId: taskLabels.taskId })
          .from(taskLabels)
          .where(and(eq(taskLabels.companyId, companyId), eq(taskLabels.labelId, labelId)));
        conditions.push(inArray(tasks.id, taggedTaskIds));
      }
      return this.baseQuery(tx)
        .where(and(...conditions))
        .orderBy(desc(tasks.createdAt))
        .limit(clampLimit(page?.limit))
        .offset(safeOffset(page?.offset));
    });
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

  /**
   * S4-TASK-BE-1 — BLOCK-NEW-TASK: dự án có đang ở trạng thái kết thúc không (đọc CỘT MỚI project_status
   * TitleCase mig 0478, KHÔNG cột legacy `status` lowercase). true ⇒ Completed/Cancelled/Archived hoặc
   * đã soft-delete. Gọi SAU projectExistsTx (existence + tenant đã guard) — chỉ quyết định chặn tạo task.
   */
  async projectBlocksNewTaskTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ projectStatus: projects.projectStatus, deletedAt: projects.deletedAt })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)))
      .limit(1);
    if (!row) return false;
    if (row.deletedAt !== null) return true;
    return (
      row.projectStatus === "Completed" ||
      row.projectStatus === "Cancelled" ||
      row.projectStatus === "Archived"
    );
  }

  /**
   * team_id phải tồn tại, cùng tenant và chưa xoá mềm (G9-4 SEC-1 mirror projectExistsTx).
   * Guard bắt buộc trước khi listByTeam — DB FK toàn cục không chặn đọc chéo tenant.
   */
  async teamExistsTx(tx: TenantTx, companyId: string, teamId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.companyId, companyId),
          eq(teamMembers.teamId, teamId),
          isNull(teamMembers.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * True nếu user là assignee của task (cùng tenant, chưa xoá). Dùng cho gate upload attachment:
   * người được giao việc (có thể 0-quyền create:task global) vẫn được đính kèm (nhánh OR owner/assignee).
   */
  async isTaskAssigneeTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    userId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.companyId, companyId),
          eq(tasks.id, taskId),
          eq(tasks.assigneeUserId, userId),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Row thô (cho guard nghiệp vụ — phân biệt task workflow vs office; projectId cho guard nhãn/state). */
  findRawByIdTx(tx: TenantTx, companyId: string, taskId: string) {
    return tx
      .select({
        id: tasks.id,
        taskType: tasks.taskType,
        workflowStepId: tasks.workflowStepId,
        status: tasks.status,
        projectId: tasks.projectId,
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
        // PM-1: thuộc tính work item (default priority='none' ở DB nếu không truyền).
        priority: data.priority ?? "none",
        description: data.description ?? null,
        stateId: data.stateId ?? null,
        sequence: data.sequence ?? null,
        startDate: data.startDate ? new Date(data.startDate) : null,
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

  // ─── PM-1 (apps/projects, mig 0420) — work item: sequence + field update ──────

  /**
   * Cấp số sequence kế tiếp cho 1 project — ATOMIC: UPDATE … RETURNING giữ row-lock trên hàng projects
   * (KHÔNG max()+1 — đua nhau cấp trùng). Trả số mới, hoặc null nếu project không tồn tại/đã xoá.
   */
  async allocateSequenceTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
  ): Promise<number | null> {
    const [row] = await tx
      .update(projects)
      .set({ lastTaskSequence: sql`${projects.lastTaskSequence} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(projects.companyId, companyId),
          eq(projects.id, projectId),
          isNull(projects.deletedAt),
        ),
      )
      .returning({ sequence: projects.lastTaskSequence });
    return row ? row.sequence : null;
  }

  /** Patch field work item — chỉ set cột CÓ MẶT (partial) + updatedAt. Trả [] nếu 0 row → caller 404. */
  updateTaskFieldsTx(
    companyId: string,
    taskId: string,
    fields: UpdateTaskFieldsData,
    tx: TenantTx,
  ) {
    const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.description !== undefined) patch.description = fields.description;
    if (fields.priority !== undefined) patch.priority = fields.priority;
    if (fields.stateId !== undefined) patch.stateId = fields.stateId;
    if (fields.assigneeUserId !== undefined) patch.assigneeUserId = fields.assigneeUserId;
    if (fields.dueDate !== undefined)
      patch.dueDate = fields.dueDate ? new Date(fields.dueDate) : null;
    if (fields.startDate !== undefined)
      patch.startDate = fields.startDate ? new Date(fields.startDate) : null;
    return tx
      .update(tasks)
      .set(patch)
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
  }

  // ─── PM-1 — project_states (tenant-scoped, soft-delete) ───────────────────────

  /** Liệt kê state chưa xoá của 1 project (order theo sort_order). */
  listStatesByProject(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(projectStates)
        .where(
          and(
            eq(projectStates.companyId, companyId),
            eq(projectStates.projectId, projectId),
            isNull(projectStates.deletedAt),
          ),
        )
        .orderBy(asc(projectStates.sortOrder), asc(projectStates.createdAt)),
    );
  }

  /** 1 state theo id (chưa xoá, cùng tenant) — guard nghiệp vụ + trả về sau create/update. */
  findStateByIdTx(tx: TenantTx, companyId: string, stateId: string) {
    return tx
      .select()
      .from(projectStates)
      .where(
        and(
          eq(projectStates.companyId, companyId),
          eq(projectStates.id, stateId),
          isNull(projectStates.deletedAt),
        ),
      )
      .limit(1);
  }

  /** True nếu state thuộc ĐÚNG project trong tenant (chưa xoá) — guard set state_id cho task. */
  async stateInProjectTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    stateId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: projectStates.id })
      .from(projectStates)
      .where(
        and(
          eq(projectStates.companyId, companyId),
          eq(projectStates.projectId, projectId),
          eq(projectStates.id, stateId),
          isNull(projectStates.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Default state (is_default=true, chưa xoá) của project — dùng làm state mặc định khi tạo task. */
  async findDefaultStateTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ id: projectStates.id })
      .from(projectStates)
      .where(
        and(
          eq(projectStates.companyId, companyId),
          eq(projectStates.projectId, projectId),
          eq(projectStates.isDefault, true),
          isNull(projectStates.deletedAt),
        ),
      )
      .limit(1);
    return row ? row.id : null;
  }

  createStateTx(
    companyId: string,
    data: {
      projectId: string;
      name: string;
      stateGroup: string;
      color?: string;
      isDefault?: boolean;
      sortOrder?: number;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(projectStates)
      .values({
        companyId,
        projectId: data.projectId,
        name: data.name,
        stateGroup: data.stateGroup,
        color: data.color ?? "#64748b",
        isDefault: data.isDefault ?? false,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();
  }

  updateStateTx(
    companyId: string,
    stateId: string,
    data: {
      name?: string;
      stateGroup?: string;
      color?: string;
      sortOrder?: number;
      isDefault?: boolean;
    },
    tx: TenantTx,
  ) {
    const patch: Partial<typeof projectStates.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.stateGroup !== undefined) patch.stateGroup = data.stateGroup;
    if (data.color !== undefined) patch.color = data.color;
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    if (data.isDefault !== undefined) patch.isDefault = data.isDefault;
    return tx
      .update(projectStates)
      .set(patch)
      .where(
        and(
          eq(projectStates.companyId, companyId),
          eq(projectStates.id, stateId),
          isNull(projectStates.deletedAt),
        ),
      )
      .returning();
  }

  /** Bỏ cờ default mọi state KHÁC trong CÙNG project (đảm bảo ≤1 default/project). */
  clearOtherDefaultsTx(
    companyId: string,
    projectId: string,
    keepStateId: string | null,
    tx: TenantTx,
  ) {
    const conds = [
      eq(projectStates.companyId, companyId),
      eq(projectStates.projectId, projectId),
      eq(projectStates.isDefault, true),
      isNull(projectStates.deletedAt),
    ];
    if (keepStateId) conds.push(sql`${projectStates.id} <> ${keepStateId}`);
    return tx
      .update(projectStates)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(...conds))
      .returning({ id: projectStates.id });
  }

  softDeleteStateTx(companyId: string, stateId: string, tx: TenantTx) {
    return tx
      .update(projectStates)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(projectStates.companyId, companyId),
          eq(projectStates.id, stateId),
          isNull(projectStates.deletedAt),
        ),
      )
      .returning({ id: projectStates.id });
  }

  /** Đếm task (chưa xoá) đang tham chiếu 1 state — chặn xoá state đang dùng. */
  async countTasksByStateTx(tx: TenantTx, companyId: string, stateId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(eq(tasks.companyId, companyId), eq(tasks.stateId, stateId), isNull(tasks.deletedAt)),
      );
    return row ? row.n : 0;
  }

  // ─── PM-1 — labels (tenant-scoped, soft-delete) ───────────────────────────────

  listLabelsByProject(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(labels)
        .where(
          and(
            eq(labels.companyId, companyId),
            eq(labels.projectId, projectId),
            isNull(labels.deletedAt),
          ),
        )
        .orderBy(asc(labels.name)),
    );
  }

  findLabelByIdTx(tx: TenantTx, companyId: string, labelId: string) {
    return tx
      .select()
      .from(labels)
      .where(and(eq(labels.companyId, companyId), eq(labels.id, labelId), isNull(labels.deletedAt)))
      .limit(1);
  }

  createLabelTx(
    companyId: string,
    data: { projectId: string; name: string; color?: string; createdBy: string | null },
    tx: TenantTx,
  ) {
    return tx
      .insert(labels)
      .values({
        companyId,
        projectId: data.projectId,
        name: data.name,
        color: data.color ?? "#6366f1",
        createdBy: data.createdBy,
      })
      .returning();
  }

  updateLabelTx(
    companyId: string,
    labelId: string,
    data: { name?: string; color?: string },
    tx: TenantTx,
  ) {
    const patch: Partial<typeof labels.$inferInsert> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.color !== undefined) patch.color = data.color;
    return tx
      .update(labels)
      .set(patch)
      .where(and(eq(labels.companyId, companyId), eq(labels.id, labelId), isNull(labels.deletedAt)))
      .returning();
  }

  softDeleteLabelTx(companyId: string, labelId: string, tx: TenantTx) {
    return tx
      .update(labels)
      .set({ deletedAt: new Date() })
      .where(and(eq(labels.companyId, companyId), eq(labels.id, labelId), isNull(labels.deletedAt)))
      .returning({ id: labels.id });
  }

  // ─── PM-1 — task_labels (M:N link, HARD-delete khi gỡ) ────────────────────────

  /**
   * Nhãn của 1 tập task (1 query, group ở JS — tránh N+1). Trả mọi nhãn chưa xoá gắn vào các task id đó.
   * row.taskId để caller gom theo task. KHÔNG xoá link khi nhãn soft-deleted → lọc deleted_at IS NULL.
   */
  listLabelsForTaskIds(companyId: string, taskIds: string[]) {
    if (taskIds.length === 0) return Promise.resolve([] as never[]);
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          taskId: taskLabels.taskId,
          id: labels.id,
          companyId: labels.companyId,
          projectId: labels.projectId,
          name: labels.name,
          color: labels.color,
          createdBy: labels.createdBy,
          createdAt: labels.createdAt,
        })
        .from(taskLabels)
        .innerJoin(labels, and(eq(taskLabels.labelId, labels.id), isNull(labels.deletedAt)))
        .where(and(eq(taskLabels.companyId, companyId), inArray(taskLabels.taskId, taskIds)))
        .orderBy(asc(labels.name)),
    );
  }

  /** True nếu task ĐÃ gán nhãn này (idempotent add). */
  async taskLabelExistsTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    labelId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: taskLabels.id })
      .from(taskLabels)
      .where(
        and(
          eq(taskLabels.companyId, companyId),
          eq(taskLabels.taskId, taskId),
          eq(taskLabels.labelId, labelId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  addTaskLabelTx(companyId: string, taskId: string, labelId: string, tx: TenantTx) {
    return tx
      .insert(taskLabels)
      .values({ companyId, taskId, labelId })
      .onConflictDoNothing({
        target: [taskLabels.companyId, taskLabels.taskId, taskLabels.labelId],
      })
      .returning({ id: taskLabels.id });
  }

  removeTaskLabelTx(companyId: string, taskId: string, labelId: string, tx: TenantTx) {
    return tx
      .delete(taskLabels)
      .where(
        and(
          eq(taskLabels.companyId, companyId),
          eq(taskLabels.taskId, taskId),
          eq(taskLabels.labelId, labelId),
        ),
      )
      .returning({ id: taskLabels.id });
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
        .where(and(eq(taskComments.companyId, companyId), eq(taskComments.taskId, taskId)))
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

  // ─── Attachments (B4) ────────────────────────────────────────────────────────
  // company_id ở MỌI query + qua withTenant tx (RLS hàng rào thật, eq(company_id) defense-in-depth).
  // Append-only: INSERT metadata; xoá = soft-delete (set deleted_at) — KHÔNG hard-delete.

  /** Insert metadata row cho 1 attachment (trong tx withTenant). storage_key do SERVER sinh. */
  createAttachment(
    companyId: string,
    data: {
      taskId: string;
      uploadedBy: string;
      storageKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(taskAttachments)
      .values({
        companyId,
        taskId: data.taskId,
        uploadedBy: data.uploadedBy,
        storageKey: data.storageKey,
        fileName: data.fileName,
        contentType: data.contentType,
        sizeBytes: data.sizeBytes,
      })
      .returning({
        id: taskAttachments.id,
        taskId: taskAttachments.taskId,
        fileName: taskAttachments.fileName,
        contentType: taskAttachments.contentType,
        sizeBytes: taskAttachments.sizeBytes,
        uploadedBy: taskAttachments.uploadedBy,
        createdAt: taskAttachments.createdAt,
      });
  }

  /**
   * Soft-delete 1 attachment (set deleted_at). App role có column-grant UPDATE(deleted_at) — CHỈ cột
   * này, nội dung bất biến. Trả [] nếu 0 row (RLS/cross-tenant/không tồn tại/đã xoá) → caller 404.
   */
  softDeleteAttachment(companyId: string, taskId: string, attachmentId: string, tx: TenantTx) {
    return tx
      .update(taskAttachments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(taskAttachments.companyId, companyId),
          eq(taskAttachments.taskId, taskId),
          eq(taskAttachments.id, attachmentId),
          isNull(taskAttachments.deletedAt),
        ),
      )
      .returning({ id: taskAttachments.id });
  }

  /** Liệt kê attachment chưa xoá của 1 task (RLS scope tenant). KHÔNG trả storage_key ra DTO. */
  listAttachmentsByTask(companyId: string, taskId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: taskAttachments.id,
          taskId: taskAttachments.taskId,
          fileName: taskAttachments.fileName,
          contentType: taskAttachments.contentType,
          sizeBytes: taskAttachments.sizeBytes,
          uploadedBy: taskAttachments.uploadedBy,
          createdAt: taskAttachments.createdAt,
        })
        .from(taskAttachments)
        .where(
          and(
            eq(taskAttachments.companyId, companyId),
            eq(taskAttachments.taskId, taskId),
            isNull(taskAttachments.deletedAt),
          ),
        )
        .orderBy(desc(taskAttachments.createdAt)),
    );
  }

  /**
   * Đọc 1 attachment chưa xoá theo id (trong tx) — gồm storage_key cho presigned GET. RLS đã scope
   * tenant; eq(company_id)+eq(task_id) defense-in-depth (URL chứa taskId, chặn id-của-task-khác).
   */
  findAttachmentByIdTx(tx: TenantTx, companyId: string, taskId: string, attachmentId: string) {
    return tx
      .select({
        id: taskAttachments.id,
        taskId: taskAttachments.taskId,
        companyId: taskAttachments.companyId,
        storageKey: taskAttachments.storageKey,
        fileName: taskAttachments.fileName,
        contentType: taskAttachments.contentType,
        sizeBytes: taskAttachments.sizeBytes,
        uploadedBy: taskAttachments.uploadedBy,
        createdAt: taskAttachments.createdAt,
      })
      .from(taskAttachments)
      .where(
        and(
          eq(taskAttachments.companyId, companyId),
          eq(taskAttachments.taskId, taskId),
          eq(taskAttachments.id, attachmentId),
          isNull(taskAttachments.deletedAt),
        ),
      )
      .limit(1);
  }
}
