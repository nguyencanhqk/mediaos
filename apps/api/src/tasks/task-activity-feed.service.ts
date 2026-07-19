import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ListTaskActivityQueryRequest, TaskActivityLogResponseDto } from "@mediaos/contracts";
import { TASK_ACTIVITY_PAGE_LIMIT_MAX } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
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
  // D-29: giữ mã lỗi TASK-ERR-042 (SPEC-06 — không đủ quyền xem nhật ký) cho nhánh không-liên-quan.
  NOT_INVOLVED:
    "TASK-ERR-042: bạn không liên quan công việc này — chỉ người liên quan (người thực hiện/giao việc/tạo/theo dõi) hoặc người có quyền xem nhật ký công việc xem được lịch sử.",
} as const;

const DEFAULT_LIMIT = 50;

/**
 * S4-TASK-BE-4 — TaskActivityFeedService (SPEC-06 §14.19, API-06 §16.7 · TASK-API-602).
 *
 * S5-TASK-DETAIL-1 (GAP 2, DECISIONS-04 D-29) — TÁCH GATE lịch sử task-level:
 *   - Guard route đổi `view:task-audit-log` → `read:task`; service cho qua khi actor giữ pair
 *     `view:task-audit-log` (mọi scope — override đầy đủ, hr/company-admin như cũ, kể cả task
 *     soft-deleted) HOẶC là NGƯỜI LIÊN QUAN của đúng task (assignee/creator/reporter/watcher).
 *   - Không thuộc cả hai → 403 TASK-ERR-042. Task không tồn tại/cross-tenant → 404 TRƯỚC involvement.
 *   - Feed DỰ ÁN (listByProject, TASK-API-601) GIỮ gate sensitive ở controller — KHÔNG nới ở đây.
 * Log là ledger append-only NÊN ĐỌC ĐƯỢC CẢ task đã soft-delete (taskExistsTx KHÔNG lọc deleted_at).
 *
 * GAP 1 kèm theo: enrich `assigneeName` vào old/new values của log đổi assignee (batch 1 query/trang,
 * KHÔNG N+1) — log lịch sử chỉ lưu employeeId, FE cần tên để render "cũ → mới" (SPEC-06 §13.12).
 * Giá trị ĐÃ LƯU trong log (vd stateName tại-thời-điểm) KHÔNG bị ghi đè.
 */
@Injectable()
export class TaskActivityFeedService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskActivityFeedRepository,
    private readonly permission: PermissionService,
  ) {}

  async list(
    user: RequestUser,
    taskId: string,
    query: ListTaskActivityQueryRequest,
  ): Promise<TaskActivityLogResponseDto[]> {
    const limit = this.clampLimit(query.limit);
    const offset = query.offset && query.offset > 0 ? query.offset : 0;
    // Pre-tx (mirror bẫy 5b — không mở connection thứ hai trong tx): pair audit đầy đủ?
    const auditScope = await this.permission.resolveStrongestScope(
      user.id,
      user.companyId,
      "view",
      "task-audit-log",
      { isSensitive: true },
    );
    return this.db.withTenant(user.companyId, async (tx) => {
      const exists = await this.repo.taskExistsTx(tx, user.companyId, taskId);
      if (!exists) throw new NotFoundException(ERR.TASK_NOT_FOUND);
      if (auditScope === null) {
        const involved = await this.repo.isUserInvolvedTx(tx, user.companyId, taskId, user.id);
        if (!involved) throw new ForbiddenException(ERR.NOT_INVOLVED);
      }
      const rows = await this.repo.listByTaskTx(tx, user.companyId, taskId, { limit, offset });
      return this.toDtosWithNamesTx(tx, user.companyId, rows);
    });
  }

  /**
   * S5-TASK-WORKSPACE-1 — feed theo DỰ ÁN (TASK-API-601, tab "Hoạt động" của workspace dự án). Gate
   * `view:task-audit-log` GIỮ NGUYÊN ở controller (D-29: nhìn chéo mọi task trong dự án = sensitive)
   * ⇒ KHÔNG lọc data-scope thêm ở đây (grant chỉ @Company). Project soft-delete vẫn đọc được
   * (ledger durability — projectExistsTx không lọc deleted_at).
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
      return this.toDtosWithNamesTx(tx, user.companyId, rows);
    });
  }

  private clampLimit(limit?: number): number {
    if (!limit || limit <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(limit), TASK_ACTIVITY_PAGE_LIMIT_MAX);
  }

  /** GAP 1 — gom assigneeEmployeeId từ old/new values cả trang → 1 query tên → embed assigneeName. */
  private async toDtosWithNamesTx(
    tx: TenantTx,
    companyId: string,
    rows: TaskActivityLogRow[],
  ): Promise<TaskActivityLogResponseDto[]> {
    const ids = new Set<string>();
    for (const row of rows) {
      for (const values of [row.oldValues, row.newValues]) {
        const id = this.readAssigneeId(values);
        if (id) ids.add(id);
      }
    }
    const names = await this.repo.findEmployeeNamesTx(tx, companyId, [...ids]);
    return rows.map((r) => this.toDto(r, names));
  }

  private readAssigneeId(values: unknown): string | null {
    if (values === null || typeof values !== "object" || Array.isArray(values)) return null;
    const id = (values as Record<string, unknown>).assigneeEmployeeId;
    return typeof id === "string" ? id : null;
  }

  /** Immutable: trả object MỚI; giá trị ĐÃ LƯU (vd assigneeName tương lai ghi sẵn) không bị ghi đè. */
  private enrichValues(values: unknown, names: Map<string, string | null>): unknown {
    const id = this.readAssigneeId(values);
    if (!id || !names.has(id)) return values;
    const obj = values as Record<string, unknown>;
    if ("assigneeName" in obj) return values;
    return { ...obj, assigneeName: names.get(id) ?? null };
  }

  private toDto(
    row: TaskActivityLogRow,
    names: Map<string, string | null>,
  ): TaskActivityLogResponseDto {
    return {
      id: row.id,
      taskId: row.taskId,
      projectId: row.projectId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      oldValues: this.enrichValues(row.oldValues, names),
      newValues: this.enrichValues(row.newValues, names),
      message: row.message,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
