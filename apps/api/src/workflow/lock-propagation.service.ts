import { Injectable, Logger } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { computeTransitiveDescendants, type DagContext } from "./workflow-dag";
import { WorkflowRepository } from "./workflow.repository";

/**
 * LockPropagationService — G7-4a (BR-006 / WF-003 "downstream_blocked_by_revision").
 *
 * When step N is sent to revision, every TRANSITIVE descendant of N in the DAG is locked
 * (caused_by = N); independent branches are never touched (LK2). A descendant re-opens only when
 * NO active lock remains on it, so a join blocked by multiple sources stays blocked until all of
 * them are re-approved (LK5). Pure orchestration: the DAG walk is pure (`computeTransitiveDescendants`)
 * and all writes/reads go through the repo within the caller's tx (so they sit inside any per-instance
 * FOR UPDATE lock the caller holds). node-postgres has one connection per tx → callers MUST await
 * these sequentially, never Promise.all on the same tx.
 */
@Injectable()
export class LockPropagationService {
  private readonly logger = new Logger(LockPropagationService.name);

  constructor(private readonly repo: WorkflowRepository) {}

  /**
   * Lock every transitive descendant of `revisedStep` (caused_by = revisedStep.id). Inserts are
   * idempotent (onConflictDoNothing vs wf_step_locks_active_uq) so a replayed / repeated revision is
   * a no-op. Returns the locked instance-step ids (descendants); [] when there are none.
   */
  async propagateRevisionLock(
    companyId: string,
    revisedStep: { id: string; nodeKey: string | null; stepCode: string },
    ctx: DagContext,
    tx: TenantTx,
  ): Promise<string[]> {
    const descendantStepIds = computeTransitiveDescendants(
      { nodeKey: revisedStep.nodeKey, stepCode: revisedStep.stepCode },
      ctx,
    );

    // An empty result is normal for a leaf step. But if the revised step itself can't be resolved in
    // the DAG, computeTransitiveDescendants fails closed (locks nothing) — surface that as a data
    // problem instead of silently under-locking (a descendant could then bypass the revision).
    if (descendantStepIds.length === 0) {
      const sourceResolves = ctx.defSteps.some(
        (d) => d.nodeKey === (revisedStep.nodeKey ?? revisedStep.stepCode),
      );
      if (!sourceResolves) {
        this.logger.warn("propagateRevisionLock: revised step not found in DAG — locked nothing", {
          companyId,
          revisedStepId: revisedStep.id,
          nodeKey: revisedStep.nodeKey ?? revisedStep.stepCode,
        });
      }
      return descendantStepIds;
    }

    // Sequential awaits — node-postgres can't run concurrent queries on one tx connection.
    for (const lockedStepId of descendantStepIds) {
      const [inserted] = await this.repo.insertStepLockInTx(
        companyId,
        { lockedStepId, causedByStepId: revisedStep.id },
        tx,
      );
      // No row = onConflictDoNothing fired. Benign: the partial-uq is on (company, locked, caused_by),
      // so the only possible conflict is an ALREADY-ACTIVE lock from THIS SAME source (a repeated
      // revision before re-approve). The descendant stays locked — no lost causal link. Debug only.
      if (!inserted) {
        this.logger.debug("propagateRevisionLock: lock already active (idempotent re-revision)", {
          companyId,
          lockedStepId,
          causedByStepId: revisedStep.id,
        });
      }
    }
    return descendantStepIds;
  }

  /** Release every active lock caused by `reapprovedStepId` (on its re-approve). Idempotent replay. */
  async releaseLocksForReapproved(
    companyId: string,
    reapprovedStepId: string,
    tx: TenantTx,
  ): Promise<void> {
    await this.repo.releaseStepLocksByCauseInTx(companyId, reapprovedStepId, tx);
  }

  /** True when an active `downstream_blocked_by_revision` lock still sits on `stepId` (single-step guard). */
  async isStepLocked(companyId: string, stepId: string, tx: TenantTx): Promise<boolean> {
    const active = await this.repo.findActiveLocksByStepIdInTx(companyId, stepId, tx);
    return active.length > 0;
  }

  /**
   * Subset of `stepIds` that still carry an active lock — ONE query for the approve() fan-out
   * open-filter (no N+1). Returns a Set for O(1) membership.
   */
  async findLockedStepIds(
    companyId: string,
    stepIds: string[],
    tx: TenantTx,
  ): Promise<Set<string>> {
    const rows = await this.repo.findActiveLockedStepIdsInTx(companyId, stepIds, tx);
    return new Set(rows.map((r) => r.lockedStepId));
  }
}
