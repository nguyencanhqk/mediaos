import { Injectable } from "@nestjs/common";
import type { DataScope } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { DataScopeService, type ScopeContext } from "../permission/data-scope.service";
import {
  buildGoalActorScope,
  findActiveActorEmployeeTx,
  selectReadableGoalIdsTx,
} from "../goals/goal-read-scope";

/** Người xem như request mang tới (`req.user`); `viaApiKey` do lớp xác thực khoá API đặt. */
export interface GoalRefUser {
  id: string;
  companyId: string;
  viaApiKey?: boolean;
}

/**
 * Ngữ cảnh đọc mục tiêu của người xem, resolve NGOÀI transaction (engine quyền + `resolveContext` mở
 * kết nối riêng — gọi trong tx ghi là kết nối thứ hai giữ cùng lúc). `scope = null` ⇒ che mọi tham
 * chiếu mục tiêu (không có cặp đọc mục tiêu, hoặc request đến qua khoá API).
 */
export interface GoalRefViewer {
  readonly userId: string;
  readonly companyId: string;
  readonly scope: DataScope | null;
  readonly ctx: ScopeContext;
}

/** Người xem «che hết» — dùng khi caller không có ngữ cảnh (kết quả bị bỏ, hoặc fail-closed). */
export function hiddenGoalRefViewer(user: { id: string; companyId: string }): GoalRefViewer {
  return {
    userId: user.id,
    companyId: user.companyId,
    scope: null,
    ctx: { userId: user.id, companyId: user.companyId },
  };
}

/**
 * S20-SEC-GOALNAMEDTO-1 — quyết định THEO LÔ «người xem đọc được mục tiêu G không» cho tham chiếu mục
 * tiêu đi kèm dữ liệu việc (`goalId`/`goalCode`/`goalName`, nhật ký phân rã).
 *
 * BẤT BIẾN: cùng dữ liệu, cùng quyết định — tập trả về = các mục tiêu mà đường đọc mục tiêu chuẩn
 * (`GET /goals/:id`: cặp `('view','goal')` + phạm vi đọc của chính mục tiêu) cho phép. Cùng engine
 * (`resolveOrNull` = `resolveAndAssert` không ném) và cùng hàm dựng phạm vi (`buildGoalActorScope`)
 * với `GoalAccessService.resolveActorScope`; khác duy nhất: thiếu cặp ⇒ che thay vì 403.
 * Ngoại lệ chặt hơn (không lỏng hơn): request mang cờ khoá API ⇒ che hết.
 *
 * Không nuốt lỗi: lỗi engine/truy vấn ném tiếp (KHÔNG biến thành «che hết» câm). Trên tx chung mọi
 * truy vấn tuần tự (một kết nối pg không chạy song song hai truy vấn).
 */
@Injectable()
export class TaskGoalRefPolicy {
  constructor(
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
  ) {}

  async resolveViewer(user: GoalRefUser): Promise<GoalRefViewer> {
    if (user.viaApiKey === true) return hiddenGoalRefViewer(user);
    const scope = await this.dataScope.resolveOrNull(user.id, user.companyId, "view", "goal");
    if (scope == null) return hiddenGoalRefViewer(user);
    // Company/System không dùng ngữ cảnh HR (không vị từ) ⇒ không đọc thêm.
    const ctx: ScopeContext =
      scope === "Company" || scope === "System"
        ? { userId: user.id, companyId: user.companyId }
        : await this.dataScope.resolveContext(user.id, user.companyId);
    return { userId: user.id, companyId: user.companyId, scope, ctx };
  }

  /** Tập id đọc được trong `candidateIds` — tối đa MỘT truy vấn lô trên `tx`; rỗng/che ⇒ 0 truy vấn. */
  async visibleGoalIdsTx(
    tx: TenantTx,
    viewer: GoalRefViewer,
    candidateIds: readonly string[],
  ): Promise<Set<string>> {
    const ids = [...new Set(candidateIds)];
    if (ids.length === 0 || viewer.scope == null) return new Set();
    const needsPredicate = viewer.scope !== "Company" && viewer.scope !== "System";
    const actorEmp = needsPredicate
      ? await findActiveActorEmployeeTx(tx, viewer.companyId, viewer.userId)
      : undefined;
    const actor = buildGoalActorScope(
      viewer.scope,
      viewer.ctx,
      actorEmp?.id ?? null,
      { id: viewer.userId, companyId: viewer.companyId },
      this.dataScope,
    );
    return selectReadableGoalIdsTx(tx, viewer.companyId, ids, actor.readScopeExists);
  }

  /** Bản cho đường trang trí SAU tx đọc: resolve lười (0 lời gọi khi không có ứng viên), tự `withTenant`. */
  async visibleGoalIds(user: GoalRefUser, candidateIds: readonly string[]): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();
    const viewer = await this.resolveViewer(user);
    if (viewer.scope == null) return new Set();
    return this.db.withTenant(user.companyId, (tx) =>
      this.visibleGoalIdsTx(tx, viewer, candidateIds),
    );
  }
}
