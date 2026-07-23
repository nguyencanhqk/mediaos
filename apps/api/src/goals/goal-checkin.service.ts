import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  CheckinGoalRequest,
  FinalizeGoalRequest,
  GoalCoreResponseDto,
  GoalUpdateResponseDto,
  ListGoalUpdatesQueryRequest,
} from "@mediaos/contracts";
import { GOAL_PAGE_LIMIT_MAX } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { GoalProgressEngineService } from "../tasks/goal-progress-engine.service";
import type { Goal } from "../db/schema/goals";
import { GoalAccessService, type GoalRequestUser as RequestUser } from "./goal-access.service";
import { goalFinalizedPayload } from "./goal-noti.payload";
import { GOAL_ERR } from "./goals.errors";
import { toGoalCoreDto, toGoalUpdateDto } from "./goals.mapper";
import { GoalsRepository } from "./goals.repository";
import { GoalUpdatesRepository } from "./goal-updates.repository";

const DEFAULT_UPDATES_LIMIT = 50;

/**
 * S5-GOAL-BE-2 — GoalCheckinService: check-in (GOAL-API-007/008) + chốt kỳ/mở lại (GOAL-API-009).
 *
 * BA ĐIỂM ĐỂ REVIEW SOI THẲNG:
 *  1. **Ledger `goal_updates` append-only** — chỉ INSERT (GoalUpdatesRepository không có update/delete);
 *     app role còn bị Postgres REVOKE UPDATE/DELETE ở migration 0504 nên đây là hai lớp, không phải một
 *     quy ước. Recompute TỰ ĐỘNG không ghi sổ (DB-11 §6.2) — chỉ 3 hành vi CỦA NGƯỜI mới ghi.
 *  2. **GOAL-ERR-005 (đóng băng sau chốt kỳ)** ép ở TỪNG đường ghi (`assertNotFinalized`), không phải
 *     ở một chỗ chung "chắc là ai cũng đi qua".
 *  3. **Quyền**: check-in đi cặp `('checkin','goal')`, chốt kỳ/mở lại đi cặp `('finalize','goal')` —
 *     hai cặp KHÁC NHAU đã seed ở 0506. Sau khi qua cặp còn phải qua data-scope GHI trên chính hàng đó
 *     (`assertCanWriteExistingGoal`): có quyền `checkin` KHÔNG có nghĩa được check-in mục tiêu phòng khác.
 */
@Injectable()
export class GoalCheckinService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GoalsRepository,
    private readonly updates: GoalUpdatesRepository,
    private readonly access: GoalAccessService,
    private readonly engine: GoalProgressEngineService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * GOAL-API-007 — check-in tiến độ. GOAL-ERR-006: CHỈ khi `status='Active'` và actor nằm trong phạm vi
   * GHI của chính mục tiêu đó. Draft = chưa chạy, Completed/Cancelled = đã đóng ⇒ không có gì để đo.
   *
   * Thứ tự CỐ Ý: ghi `current_value` → recompute (engine quyết `progress_percent` theo mode) → đọc lại
   * → ghi sổ. Ghi sổ CUỐI CÙNG để `new_progress_percent` là con số THẬT SỰ nằm trong DB, không phải con
   * số service tự tính rồi hy vọng engine đồng ý (sổ ledger nói dối còn tệ hơn không có sổ).
   */
  async checkIn(
    user: RequestUser,
    goalId: string,
    dto: CheckinGoalRequest,
  ): Promise<GoalCoreResponseDto> {
    if (
      dto.currentValue !== undefined &&
      dto.currentValue !== null &&
      dto.progressPercent !== undefined &&
      dto.progressPercent !== null
    ) {
      throw new UnprocessableEntityException(GOAL_ERR.CHECKIN_AMBIGUOUS);
    }
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "checkin");
      const goal = await this.loadWritableGoalTx(tx, user, goalId, actor);
      this.access.assertNotFinalized(goal);
      if (goal.status !== "Active") {
        throw new UnprocessableEntityException(GOAL_ERR.CHECKIN_STATUS(goal.status));
      }

      const input = dto.currentValue ?? dto.progressPercent ?? null;
      const nextCurrent = input === null ? goal.currentValue : String(input);
      if (nextCurrent !== goal.currentValue) {
        const written = await this.repo.setCurrentValueTx(
          tx,
          user.companyId,
          goalId,
          nextCurrent,
          user.id,
        );
        if (!written) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
      }
      await this.engine.recomputeGoalTx(tx, user.companyId, goalId);
      const after = await this.repo.findByIdTx(tx, user.companyId, goalId);
      if (!after) throw new NotFoundException(GOAL_ERR.NOT_FOUND);

      await this.updates.insertTx(tx, user.companyId, {
        goalId,
        updateType: "checkin",
        actorUserId: user.id,
        oldCurrentValue: goal.currentValue,
        newCurrentValue: after.currentValue,
        oldProgressPercent: goal.progressPercent,
        newProgressPercent: after.progressPercent,
        confidence: dto.confidence ?? null,
        note: dto.note ?? null,
      });
      await this.audit.record(tx, {
        action: "GoalCheckedIn",
        objectType: "goal",
        objectId: goalId,
        actorUserId: user.id,
        before: { currentValue: goal.currentValue, progressPercent: goal.progressPercent },
        after: { currentValue: after.currentValue, progressPercent: after.progressPercent },
      });
      return toGoalCoreDto(after);
    });
  }

  /** GOAL-API-008 — sổ check-in. Phạm vi ĐỌC (cặp `('view','goal')`), phân trang. */
  async listUpdates(
    user: RequestUser,
    goalId: string,
    query: ListGoalUpdatesQueryRequest,
  ): Promise<GoalUpdateResponseDto[]> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "view");
      await this.access.loadReadableGoalTx(tx, user, goalId, actor);
      const limit = Math.min(
        query.limit && query.limit > 0 ? Math.floor(query.limit) : DEFAULT_UPDATES_LIMIT,
        GOAL_PAGE_LIMIT_MAX,
      );
      const rows = await this.updates.listByGoalTx(
        tx,
        user.companyId,
        goalId,
        limit,
        query.offset && query.offset > 0 ? query.offset : 0,
      );
      return rows.map(toGoalUpdateDto);
    });
  }

  /**
   * GOAL-API-009 chốt kỳ. GOAL-ERR-014: CHỈ `Active` hoặc `Completed` (Draft chưa từng chạy, Cancelled
   * đã bỏ ⇒ không có gì để chốt). Đã chốt rồi ⇒ GOAL-ERR-005.
   *
   * Recompute LẦN CUỐI **trước** khi đóng băng: sau khi `finalized_at` có giá trị thì engine bỏ qua
   * mục tiêu này vĩnh viễn (§13.4), nên con số tại thời điểm chốt phải đúng ngay lúc đó — chốt xong mới
   * phát hiện cache cũ thì không còn đường sửa ngoài reopen.
   */
  async finalize(
    user: RequestUser,
    goalId: string,
    dto: FinalizeGoalRequest,
  ): Promise<GoalCoreResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "finalize");
      const goal = await this.loadWritableGoalTx(tx, user, goalId, actor);
      this.access.assertNotFinalized(goal);
      if (goal.status !== "Active" && goal.status !== "Completed") {
        throw new UnprocessableEntityException(GOAL_ERR.FINALIZE_STATUS(goal.status));
      }

      await this.engine.recomputeGoalTx(tx, user.companyId, goalId);
      const measured = await this.repo.findByIdTx(tx, user.companyId, goalId);
      if (!measured) throw new NotFoundException(GOAL_ERR.NOT_FOUND);

      // Vị từ `finalized_at is null` của writer = khoá chống ĐUA: request thứ hai ghi 0 hàng ⇒ 422.
      const frozen = await this.repo.setFinalizedTx(tx, user.companyId, goalId, true, user.id);
      if (!frozen) throw new UnprocessableEntityException(GOAL_ERR.FINALIZED);

      await this.updates.insertTx(tx, user.companyId, {
        goalId,
        updateType: "finalize",
        actorUserId: user.id,
        oldCurrentValue: goal.currentValue,
        newCurrentValue: frozen.currentValue,
        oldProgressPercent: goal.progressPercent,
        newProgressPercent: frozen.progressPercent,
        confidence: null,
        note: dto.note ?? null,
      });
      await this.audit.record(tx, {
        action: "GoalFinalized",
        objectType: "goal",
        objectId: goalId,
        actorUserId: user.id,
        before: { finalizedAt: null, progressPercent: goal.progressPercent },
        after: { finalizedAt: frozen.finalizedAt, progressPercent: frozen.progressPercent },
      });
      await this.outbox.enqueue(tx, {
        eventType: "goal.finalized",
        payload: goalFinalizedPayload(frozen),
      });
      return toGoalCoreDto(frozen);
    });
  }

  /**
   * GOAL-API-009 mở lại — CÙNG cặp quyền `('finalize','goal')` (SPEC-10 §12 GOAL-ERR-005: "muốn sửa →
   * reopen trước, cần quyền finalize"). Sau khi clear `finalized_at`, gọi lại engine NGAY: trong thời
   * gian bị đóng băng, task/mục tiêu con vẫn chạy tiếp nên cache gần như chắc chắn đã cũ.
   */
  async reopen(
    user: RequestUser,
    goalId: string,
    dto: FinalizeGoalRequest,
  ): Promise<GoalCoreResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const actor = await this.access.resolveActorScope(tx, user, "finalize");
      const goal = await this.loadWritableGoalTx(tx, user, goalId, actor);
      if (!goal.finalizedAt) throw new UnprocessableEntityException(GOAL_ERR.NOT_FINALIZED);

      const reopened = await this.repo.setFinalizedTx(tx, user.companyId, goalId, false, user.id);
      if (!reopened) throw new UnprocessableEntityException(GOAL_ERR.NOT_FINALIZED);

      await this.updates.insertTx(tx, user.companyId, {
        goalId,
        updateType: "reopen",
        actorUserId: user.id,
        oldCurrentValue: goal.currentValue,
        newCurrentValue: reopened.currentValue,
        oldProgressPercent: goal.progressPercent,
        newProgressPercent: reopened.progressPercent,
        confidence: null,
        note: dto.note ?? null,
      });
      await this.audit.record(tx, {
        action: "GoalReopened",
        objectType: "goal",
        objectId: goalId,
        actorUserId: user.id,
        before: { finalizedAt: goal.finalizedAt },
        after: { finalizedAt: null },
      });

      await this.engine.recomputeGoalTx(tx, user.companyId, goalId);
      const after = await this.repo.findByIdTx(tx, user.companyId, goalId);
      return toGoalCoreDto(after ?? reopened);
    });
  }

  /** 404 chéo tenant · 403 ngoài phạm vi GHI của actor (quy ước GOAL — SPEC-10 §20.2). */
  private async loadWritableGoalTx(
    tx: TenantTx,
    user: RequestUser,
    goalId: string,
    actor: Awaited<ReturnType<GoalAccessService["resolveActorScope"]>>,
  ): Promise<Goal> {
    const goal = await this.repo.findByIdTx(tx, user.companyId, goalId);
    if (!goal) throw new NotFoundException(GOAL_ERR.NOT_FOUND);
    await this.access.assertCanWriteExistingGoal(tx, user, actor, goal);
    return goal;
  }
}
