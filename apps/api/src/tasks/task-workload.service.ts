import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  TASK_WORKLOAD_MAX_ROWS,
  type TaskWorkloadCounts,
  type TaskWorkloadQuery,
  type TaskWorkloadResponse,
  type TaskWorkloadRow,
} from "@mediaos/contracts";
import { resolveCompanyTz } from "../dashboard/dashboard-company-tz.util";
import { DatabaseService } from "../db/db.service";
import { TaskCoreService } from "./task-core.service";
import { TaskWorkloadRepository, type WorkloadAggregateRow } from "./task-workload.repository";
import { buildWorkloadPersonPredicate, dueSoonWindowEnd } from "./task-workload.predicates";
import type { GoalRefUser } from "./task-goal-ref.policy";

/** Đồng hồ tiêm được để test cố định thời điểm (chống đỏ theo giờ trong ngày). */
export type WorkloadClock = () => Date;
/** Token KHÔNG được provide ở module ⇒ `@Optional()` cho undefined ⇒ dùng đồng hồ thật; chỉ unit tiêm. */
export const WORKLOAD_CLOCK = Symbol("WORKLOAD_CLOCK");

const toCounts = (r: WorkloadAggregateRow): TaskWorkloadCounts => ({
  activeCount: r.activeCount,
  overdueCount: r.overdueCount,
  dueSoon7dCount: r.dueSoon7dCount,
  inReviewCount: r.inReviewCount,
  maxOverdueDays: r.maxOverdueDays,
});

/** Nhóm số lớn hơn xếp trước; null (không có việc quá hạn) xếp sau mọi số. */
function compareRows(a: TaskWorkloadRow, b: TaskWorkloadRow): number {
  if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount;
  const ad = a.maxOverdueDays ?? -1;
  const bd = b.maxOverdueDays ?? -1;
  if (ad !== bd) return bd - ad;
  if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
  if ((a.displayName === null) !== (b.displayName === null)) return a.displayName === null ? 1 : -1;
  const byName = (a.displayName ?? "").localeCompare(b.displayName ?? "", "vi");
  return byName !== 0 ? byName : a.employeeId.localeCompare(b.employeeId);
}

/**
 * S20-TASK-WORKLOAD-1 — «Đội của tôi» (GET /tasks/workload). Phạm vi = CHÍNH bộ dựng của GET /tasks
 * (`TaskCoreService.resolveReadScope`) + vị từ «người xuất hiện» (plan D2/D3). KHÔNG mã lỗi/quyền mới.
 */
@Injectable()
export class TaskWorkloadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly core: TaskCoreService,
    private readonly repo: TaskWorkloadRepository,
    @Optional() @Inject(WORKLOAD_CLOCK) private readonly clock: WorkloadClock = () => new Date(),
  ) {}

  async getWorkload(user: GoalRefUser, query: TaskWorkloadQuery): Promise<TaskWorkloadResponse> {
    // ⚠️ `resolveCompanyTz` tự mở `withTenant` riêng ⇒ gọi TRƯỚC, KHÔNG trong callback: lồng hai withTenant =
    // hai connection trên PgBouncer transaction-mode ⇒ treo dưới tải. Ghim bằng unit service (thứ tự gọi).
    const tz = await resolveCompanyTz(this.db, user.companyId);
    const now = this.clock();
    const windowEnd = dueSoonWindowEnd(now, tz);

    const { aggregate, names, scope } = await this.db.withTenant(user.companyId, async (tx) => {
      const rs = await this.core.resolveReadScope(tx, user);
      const aggregate = await this.repo.aggregateTx(tx, {
        companyId: user.companyId,
        projectId: query.projectId,
        departmentId: query.departmentId,
        scopeExists: rs.exists,
        personPredicate: buildWorkloadPersonPredicate(rs.scope, rs.scopeCond),
        tz,
        now,
        windowEnd,
      });
      const ids = aggregate.flatMap((r) => (r.employeeId ? [r.employeeId] : []));
      const names = await this.repo.assigneeNamesTx(tx, user.companyId, ids);
      return { aggregate, names, scope: rs.scope };
    });

    return this.assemble(aggregate, names, scope);
  }

  private assemble(
    aggregate: readonly WorkloadAggregateRow[],
    names: ReadonlyMap<string, string | null>,
    scope: string,
  ): TaskWorkloadResponse {
    const unassignedRow = aggregate.find((r) => r.employeeId === null);
    // Own không bao giờ có «Chưa giao» (SQL đã bỏ vế NULL — phòng thủ kép ở đây).
    const unassigned = unassignedRow && scope !== "Own" ? toCounts(unassignedRow) : null;
    // Gán TƯỜNG MINH từng trường (không spread hàng DB) ⇒ DTO đóng đúng 7 khoá.
    const people: TaskWorkloadRow[] = aggregate.flatMap((r) =>
      r.employeeId === null
        ? []
        : [
            {
              employeeId: r.employeeId,
              displayName: names.get(r.employeeId) ?? null,
              ...toCounts(r),
            },
          ],
    );
    people.sort(compareRows);
    return {
      items: people.slice(0, TASK_WORKLOAD_MAX_ROWS),
      unassigned,
      truncated: people.length > TASK_WORKLOAD_MAX_ROWS,
    };
  }
}
