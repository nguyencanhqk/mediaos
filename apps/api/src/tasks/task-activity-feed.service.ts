import { Injectable, NotFoundException } from "@nestjs/common";
import type { ListTaskActivityQueryRequest, TaskActivityLogResponseDto } from "@mediaos/contracts";
import { TASK_ACTIVITY_PAGE_LIMIT_MAX } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import {
  TaskActivityFeedRepository,
  type TaskActivityLogRow,
} from "./task-activity-feed.repository";

interface RequestUser {
  id: string;
  companyId: string;
}

const ERR = {
  TASK_NOT_FOUND: "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.",
  // Symbolic mirror projects.service/task-kanban.service (SPEC-06 map TASK-ERR-008 → *-PROJECT-NOT-FOUND).
  PROJECT_NOT_FOUND: "TASK-ERR-PROJECT-NOT-FOUND: không tìm thấy dự án.",
} as const;

const DEFAULT_LIMIT = 50;

/**
 * S4-TASK-BE-4 — TaskActivityFeedService (SPEC-06 §14.19, API-06 §16.7 · TASK-API-602).
 *
 * Gate `view:task-audit-log` (sensitive=true, seed 0485 — CHỈ hr/company-admin @Company, employee/manager
 * 403 theo ĐÚNG thiết kế TASK-ERR-042). Grant nạp CHỈ scope Company ⇒ KHÔNG cần lọc data-scope thêm ở đây
 * (khác các route khác trong module) — chỉ còn guard tenant + task tồn tại. Log là ledger append-only NÊN
 * ĐỌC ĐƯỢC CẢ task đã soft-delete (durability lịch sử — taskExistsTx KHÔNG lọc deleted_at).
 */
@Injectable()
export class TaskActivityFeedService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskActivityFeedRepository,
  ) {}

  async list(
    user: RequestUser,
    taskId: string,
    query: ListTaskActivityQueryRequest,
  ): Promise<TaskActivityLogResponseDto[]> {
    const limit = this.clampLimit(query.limit);
    const offset = query.offset && query.offset > 0 ? query.offset : 0;
    return this.db.withTenant(user.companyId, async (tx) => {
      const exists = await this.repo.taskExistsTx(tx, user.companyId, taskId);
      if (!exists) throw new NotFoundException(ERR.TASK_NOT_FOUND);
      const rows = await this.repo.listByTaskTx(tx, user.companyId, taskId, { limit, offset });
      return rows.map((r) => this.toDto(r));
    });
  }

  /**
   * S5-TASK-WORKSPACE-1 — feed theo DỰ ÁN (TASK-API-601, tab "Hoạt động" của workspace dự án). Cùng
   * gate `view:task-audit-log` + cùng lý do KHÔNG lọc data-scope như list() (grant chỉ @Company).
   * Project soft-delete vẫn đọc được (ledger durability — projectExistsTx không lọc deleted_at).
   */
  async listByProject(
    user: RequestUser,
    projectId: string,
    query: ListTaskActivityQueryRequest,
  ): Promise<TaskActivityLogResponseDto[]> {
    const limit = this.clampLimit(query.limit);
    const offset = query.offset && query.offset > 0 ? query.offset : 0;
    return this.db.withTenant(user.companyId, async (tx) => {
      const exists = await this.repo.projectExistsTx(tx, user.companyId, projectId);
      if (!exists) throw new NotFoundException(ERR.PROJECT_NOT_FOUND);
      const rows = await this.repo.listByProjectTx(tx, user.companyId, projectId, {
        limit,
        offset,
      });
      return rows.map((r) => this.toDto(r));
    });
  }

  private clampLimit(limit?: number): number {
    if (!limit || limit <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(limit), TASK_ACTIVITY_PAGE_LIMIT_MAX);
  }

  private toDto(row: TaskActivityLogRow): TaskActivityLogResponseDto {
    return {
      id: row.id,
      taskId: row.taskId,
      projectId: row.projectId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      oldValues: row.oldValues,
      newValues: row.newValues,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
