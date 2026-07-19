import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import type { TaskWatcherResponseDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { ProjectAccessService } from "./project-access.service";
import { TaskActionsRepository } from "./task-actions.repository";

interface RequestUser {
  id: string;
  companyId: string;
}

const ERR_NOT_FOUND = "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.";

/**
 * S5-TASK-DETAIL-1 (GAP 4) — GET /tasks/:id/watchers: danh sách người theo dõi Active/Muted.
 * TÁCH khỏi TaskActionsService (file đó chạm trần 800 dòng — CLAUDE.md §5) — read-only, KHÔNG
 * activity/audit. Cùng luật với add/remove watcher: gate watch:task (controller) + task tồn tại
 * (404) + ProjectAccessService mode 'read' (D-24 — watch là read-affordance, ngoài scope → 404
 * nhất quán). Mutation watcher (add/remove, self-only) VẪN ở TaskActionsService.
 */
@Injectable()
export class TaskWatchersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskActionsRepository,
    private readonly dataScope: DataScopeService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async listWatchers(user: RequestUser, taskId: string): Promise<TaskWatcherResponseDto[]> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "watch", "task");
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findActionRawTx(tx, user.companyId, taskId);
      if (!raw) throw new NotFoundException(ERR_NOT_FOUND);
      await this.projectAccess.assertTaskInScopeTx(tx, user, taskId, scope, "read");
      const rows = await this.repo.listActiveWatchersTx(tx, user.companyId, taskId);
      return rows.map((r) => {
        const createdAt = this.toIso(r.createdAt);
        if (createdAt === null) {
          throw new InternalServerErrorException("Watcher thiếu created_at bắt buộc.");
        }
        return {
          id: r.id,
          taskId: r.taskId,
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          userId: r.userId,
          watcherType: r.watcherType,
          status: r.status,
          createdAt,
        };
      });
    });
  }

  private toIso(v: string | Date | null): string | null {
    if (v == null) return null;
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  }
}
