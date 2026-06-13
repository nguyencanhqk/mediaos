import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { approvalRules } from "../db/schema/approval";
import { approvalRequests, approvalSteps } from "../db/schema/workflow";

/**
 * Repository for the multi-level approval path (G8-1, APR-001/002).
 *
 * BẤT BIẾN: every query is company-scoped + flows through withTenant (set_config app.current_company_id)
 * so RLS + FORCE enforce tenant isolation at the DB layer — never on dev discipline (CLAUDE §2).
 *
 * approval_requests = SOURCE OF TRUTH (ADR-0016): current_level / max_level live here. approval_steps is
 * an append-only projection (app role has SELECT + INSERT only — no UPDATE/DELETE; one decision per
 * (request_id, level) enforced by approval_steps_request_level_uq from migration 0008).
 */
@Injectable()
export class ApprovalRulesRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Levels + their designated approver for the workflow_step behind a request, ordered by level asc.
   * A step inherits its rules via its workflow_definition; the approver is resolved to a concrete
   * user id at rule-creation time. Returns [] when no rules are configured (caller decides policy).
   */
  findRulesForStep(companyId: string, workflowStepId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: approvalRules.id,
          companyId: approvalRules.companyId,
          level: approvalRules.level,
          approverUserId: approvalRules.approverUserId,
        })
        .from(approvalRules)
        .innerJoin(
          approvalRequests,
          // M1 defence-in-depth: pin company_id on both sides of the JOIN (RLS + withTenant are the
          // primary guards, but an explicit cross-column equality makes cross-tenant impossible even
          // if withTenant were ever called with a wrong companyId).
          and(
            eq(approvalRequests.workflowStepId, approvalRules.workflowStepId),
            eq(approvalRequests.companyId, approvalRules.companyId),
          ),
        )
        .where(
          and(
            eq(approvalRules.companyId, companyId),
            eq(approvalRequests.companyId, companyId),
            eq(approvalRequests.workflowStepId, workflowStepId),
          ),
        )
        .orderBy(asc(approvalRules.level)),
    );
  }

  findApprovalRequestById(companyId: string, requestId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(approvalRequests)
        .where(and(eq(approvalRequests.companyId, companyId), eq(approvalRequests.id, requestId)))
        .limit(1),
    );
  }

  /**
   * Serialize concurrent decisions on the SAME request: two approvers at the same level (or the
   * level-N+1 approver racing the bump) queue on this row lock instead of lost-updating current_level.
   * Mirror of WorkflowRepository.lockInstanceForUpdateInTx (FS10 race-safety). Caller MUST be inside
   * the same tx as the subsequent createApprovalStep / bumpCurrentLevel.
   */
  lockApprovalRequestForUpdateInTx(companyId: string, requestId: string, tx: TenantTx) {
    return tx
      .select({ id: approvalRequests.id, currentLevel: approvalRequests.currentLevel })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.companyId, companyId), eq(approvalRequests.id, requestId)))
      .for("update");
  }

  /** Append-only INSERT into approval_steps (projection). uq(request_id, level) ⇒ 23505 on duplicate. */
  createApprovalStep(
    companyId: string,
    data: {
      approvalRequestId: string;
      level: number;
      approverUserId: string;
      decision: "approved" | "revision_requested";
      comment: string | null;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(approvalSteps)
      .values({
        companyId,
        approvalRequestId: data.approvalRequestId,
        level: data.level,
        approverUserId: data.approverUserId,
        decision: data.decision,
        comment: data.comment,
      })
      .returning();
  }

  /**
   * Open the next approval level: UPDATE approval_requests.current_level (the source of truth).
   * Request STAYS pending. Guard the row count at the call site (a 0-row update ⇒ inconsistent state).
   */
  bumpCurrentLevel(companyId: string, requestId: string, nextLevel: number, tx: TenantTx) {
    return tx
      .update(approvalRequests)
      .set({ currentLevel: nextLevel })
      .where(
        and(
          eq(approvalRequests.companyId, companyId),
          eq(approvalRequests.id, requestId),
          eq(approvalRequests.status, "pending"),
        ),
      )
      .returning();
  }

  /**
   * Approval inbox (multi-type): pending requests where `actorUserId` is the approver of the request's
   * CURRENT level (never expose a request whose level has not reached the actor yet). Company-scoped via
   * withTenant; cross-tenant ⇒ 0 rows (RLS). Joins the rule for the request's current_level to the actor.
   */
  findInboxForApprover(companyId: string, actorUserId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          requestId: approvalRequests.id,
          workflowStepId: approvalRequests.workflowStepId,
          currentLevel: approvalRequests.currentLevel,
          maxLevel: approvalRequests.maxLevel,
          status: approvalRequests.status,
          createdAt: approvalRequests.createdAt,
        })
        .from(approvalRequests)
        .innerJoin(
          approvalRules,
          and(
            eq(approvalRules.workflowStepId, approvalRequests.workflowStepId),
            eq(approvalRules.level, approvalRequests.currentLevel),
            eq(approvalRules.companyId, companyId),
          ),
        )
        .where(
          and(
            eq(approvalRequests.companyId, companyId),
            eq(approvalRequests.status, "pending"),
            eq(approvalRules.approverUserId, actorUserId),
          ),
        )
        .orderBy(asc(approvalRequests.createdAt)),
    );
  }
}
