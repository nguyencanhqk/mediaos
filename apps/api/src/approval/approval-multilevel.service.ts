import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { ApprovalService } from "../workflow/approval.service";
import { ApprovalRulesRepository } from "./approval-rules.repository";

const PG_UNIQUE_VIOLATION = "23505";

/** Concurrent same-(request, level) decision loses the FOR UPDATE race → 23505 on the append-only uq. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === PG_UNIQUE_VIOLATION
  );
}

interface RuleRow {
  level: number;
  approverUserId: string;
}

/**
 * G8-1 — Multi-level approval (APR-001/002): a later approval level OPENS only when the previous level
 * is approved.
 *
 * ADR-0016 source of truth: approval_requests.current_level / max_level. approval_steps is an
 * append-only projection (one decision per (request_id, level), uq from migration 0008; app role has
 * SELECT + INSERT only — no UPDATE/DELETE).
 *
 * Branching (the crown-jewel decision — kept OUT of the battle-tested G4-5 path):
 *   - level < max_level  → append approval_steps(level=current_level, approved) + bump current_level
 *                          (UPDATE approval_requests). Request STAYS pending. NO workflow_step approve,
 *                          NO DAG fan-out, NO workflow complete.
 *   - level == max_level → delegate to the proven single-level G4-5 ApprovalService.approve() which
 *                          closes the request + approves the workflow_step + fans out the DAG +
 *                          completes the workflow when all required steps are approved.
 *
 * reject at ANY level closes the request (revision_requested) via ApprovalService.requestRevision()
 * and never bumps — a rejection at level 1 must not silently advance to level 2.
 */
@Injectable()
export class ApprovalMultilevelService {
  private readonly logger = new Logger(ApprovalMultilevelService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly rules: ApprovalRulesRepository,
    private readonly finalApproval: ApprovalService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * POST /approval/requests/:id/approve — approve the request at ITS current level.
   * Gated: actor MUST be the configured approver of `request.current_level` (PermissionGuard already
   * verified the actor holds approve:approval-request — this is the per-level reviewer gate on top).
   */
  async approveLevel(companyId: string, requestId: string, actorId: string, comment?: string) {
    const request = await this.loadPendingRequest(companyId, requestId);

    // Final level → reuse the proven G4-5 close + fan-out + complete path verbatim. No early-close.
    if (request.currentLevel >= request.maxLevel) {
      await this.assertActorIsCurrentLevelApprover(companyId, request.workflowStepId, request.currentLevel, actorId);
      return this.finalApproval.approve(companyId, requestId, actorId, comment);
    }

    // Intermediate level → append step + bump current_level, request stays pending.
    return this.db
      .withTenant(companyId, async (tx) => {
        // Serialize per-request: two approvers (or the level-N+1 approver racing the bump) queue here
        // instead of lost-updating current_level. uq(request_id, level) is the final backstop.
        await this.rules.lockApprovalRequestForUpdateInTx(companyId, requestId, tx);
        await this.assertActorIsCurrentLevelApprover(
          companyId,
          request.workflowStepId,
          request.currentLevel,
          actorId,
        );

        const [approvalStepRow] = await this.rules.createApprovalStep(
          companyId,
          {
            approvalRequestId: requestId,
            level: request.currentLevel,
            approverUserId: actorId,
            decision: "approved",
            comment: comment ?? null,
          },
          tx,
        );

        const nextLevel = request.currentLevel + 1;
        const [bumped] = await this.rules.bumpCurrentLevel(companyId, requestId, nextLevel, tx);
        // A 0-row bump would leave the step recorded while current_level is stale (inconsistent state
        // committed in-tx). Fail-closed → rollback the whole decision.
        if (!bumped) {
          throw new InternalServerErrorException("Failed to open next approval level");
        }

        await this.audit.record(tx, {
          action: "ApprovalLevelApproved",
          objectType: "approval_request",
          objectId: requestId,
          actorUserId: actorId,
          after: {
            level: request.currentLevel,
            nextLevel,
            maxLevel: request.maxLevel,
            approvalStepId: approvalStepRow?.id,
          },
        });

        await this.outbox.enqueue(tx, {
          eventType: "approval.level_approved",
          payload: {
            requestId,
            level: request.currentLevel,
            nextLevel,
            approvedBy: actorId,
          },
        });

        return bumped;
      })
      .catch((err: unknown) => this.mapError(err, "approveLevel", companyId, requestId));
  }

  /**
   * POST /approval/requests/:id/reject — reject at the current level. Closes the request
   * (revision_requested) + creates defect + revision task via the G4-5 path. Never bumps.
   */
  async rejectLevel(
    companyId: string,
    requestId: string,
    actorId: string,
    description: string,
    comment?: string,
  ) {
    const request = await this.loadPendingRequest(companyId, requestId);
    await this.assertActorIsCurrentLevelApprover(
      companyId,
      request.workflowStepId,
      request.currentLevel,
      actorId,
    );
    return this.finalApproval.requestRevision(companyId, requestId, actorId, description, comment);
  }

  /** GET /approval/inbox — requests pending at a level the actor approves (never future levels). */
  async inbox(companyId: string, actorId: string) {
    return this.rules.findInboxForApprover(companyId, actorId);
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private async loadPendingRequest(companyId: string, requestId: string) {
    const [request] = await this.rules.findApprovalRequestById(companyId, requestId);
    if (!request) throw new NotFoundException(`Approval request not found: ${requestId}`);
    if (request.status !== "pending") {
      throw new ConflictException(`Approval request is not pending (status=${request.status})`);
    }
    return request;
  }

  private async assertActorIsCurrentLevelApprover(
    companyId: string,
    workflowStepId: string,
    currentLevel: number,
    actorId: string,
  ): Promise<void> {
    const rules = (await this.rules.findRulesForStep(companyId, workflowStepId)) as RuleRow[];
    const currentRule = rules.find((r) => r.level === currentLevel);
    // Fail-closed: no rule for the current level ⇒ nobody can approve (mirror G7 S2 null-reviewer).
    if (!currentRule) {
      throw new ConflictException(
        `No approver configured for level ${currentLevel} — cannot approve`,
      );
    }
    if (currentRule.approverUserId !== actorId) {
      throw new ConflictException("Not your level yet — you are not the approver of the current level");
    }
  }

  private mapError(err: unknown, op: string, companyId: string, requestId: string): never {
    if (
      err instanceof NotFoundException ||
      err instanceof ConflictException ||
      err instanceof InternalServerErrorException
    ) {
      throw err;
    }
    if (isUniqueViolation(err)) {
      throw new ConflictException("This level has already been decided");
    }
    this.logger.error(`${op} unexpected error`, { err, companyId, requestId });
    throw err;
  }
}
