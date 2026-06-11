import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import type { TenantTx } from "../db/db.service";
import {
  approvalRequests,
  approvalSteps,
  contentItems,
  defects,
  projects,
  tasks,
  workflowDefinitionSteps,
  workflowDefinitions,
  workflowInstances,
  workflowStepDependencies,
  workflowStepInstanceLocks,
  workflowSteps,
} from "../db/schema";

@Injectable()
export class WorkflowRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── Definitions ──────────────────────────────────────────────────────────

  findActiveDefinitionInTx(companyId: string, code: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.companyId, companyId),
          eq(workflowDefinitions.code, code),
          eq(workflowDefinitions.isActive, true),
          isNull(workflowDefinitions.deletedAt),
        ),
      )
      .limit(1);
  }

  findDefinitionStepsInTx(companyId: string, definitionId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowDefinitionSteps)
      .where(
        and(
          eq(workflowDefinitionSteps.companyId, companyId),
          eq(workflowDefinitionSteps.workflowDefinitionId, definitionId),
        ),
      )
      .orderBy(workflowDefinitionSteps.stepOrder);
  }

  // ─── Apply template (3b) ──────────────────────────────────────────────────

  /** Template phải published (D4: chỉ published mới apply được) + cùng tenant + chưa xoá. */
  findPublishedTemplateInTx(companyId: string, templateId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.companyId, companyId),
          eq(workflowDefinitions.id, templateId),
          eq(workflowDefinitions.status, "published"),
          isNull(workflowDefinitions.deletedAt),
        ),
      )
      .limit(1);
  }

  /** Cạnh DAG của template (để tính bước root = step không xuất hiện ở to_step_id). */
  findTemplateDependenciesInTx(companyId: string, templateId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowStepDependencies)
      .where(
        and(
          eq(workflowStepDependencies.companyId, companyId),
          eq(workflowStepDependencies.workflowDefinitionId, templateId),
        ),
      );
  }

  /** Project thuộc tenant (validate target khi appliesTo='project'). */
  findProjectByIdInTx(companyId: string, projectId: string, tx: TenantTx) {
    return tx
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.companyId, companyId),
          eq(projects.id, projectId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
  }

  // ─── Instances ────────────────────────────────────────────────────────────

  createInstance(
    companyId: string,
    data: {
      workflowDefinitionId: string;
      contentItemId: string;
      createdBy: string | null;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(workflowInstances)
      .values({
        companyId,
        workflowDefinitionId: data.workflowDefinitionId,
        contentItemId: data.contentItemId,
        createdBy: data.createdBy,
        status: "active",
        currentStepOrder: 1,
      })
      .returning();
  }

  /** 3b: tạo instance đa-target (content_item XOR project) + pin definition_version. */
  createInstanceForTemplate(
    companyId: string,
    data: {
      workflowDefinitionId: string;
      contentItemId: string | null;
      projectId: string | null;
      definitionVersion: number;
      createdBy: string | null;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(workflowInstances)
      .values({
        companyId,
        workflowDefinitionId: data.workflowDefinitionId,
        contentItemId: data.contentItemId,
        projectId: data.projectId,
        definitionVersion: data.definitionVersion,
        createdBy: data.createdBy,
        status: "active",
        currentStepOrder: 1,
      })
      .returning();
  }

  findInstanceById(companyId: string, instanceId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(workflowInstances)
        .where(
          and(
            eq(workflowInstances.companyId, companyId),
            eq(workflowInstances.id, instanceId),
          ),
        )
        .limit(1),
    );
  }

  /** Tìm workflow instance mới nhất của 1 content item (FE chỉ biết contentId). */
  findInstanceByContentItemId(companyId: string, contentItemId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(workflowInstances)
        .where(
          and(
            eq(workflowInstances.companyId, companyId),
            eq(workflowInstances.contentItemId, contentItemId),
          ),
        )
        .orderBy(sql`created_at DESC`)
        .limit(1),
    );
  }

  // ─── Steps ────────────────────────────────────────────────────────────────

  createSteps(
    companyId: string,
    instanceId: string,
    stepsData: Array<{
      stepOrder: number;
      stepCode: string;
      stepName: string;
      nodeKey?: string | null;
      assigneeUserId: string | null;
      reviewerUserId: string | null;
    }>,
    tx: TenantTx,
  ) {
    return tx
      .insert(workflowSteps)
      .values(
        stepsData.map((s) => ({
          companyId,
          workflowInstanceId: instanceId,
          stepOrder: s.stepOrder,
          stepCode: s.stepCode,
          stepName: s.stepName,
          nodeKey: s.nodeKey ?? null,
          status: "not_started" as const,
          assigneeUserId: s.assigneeUserId,
          reviewerUserId: s.reviewerUserId,
        })),
      )
      .returning();
  }

  findStepById(companyId: string, stepId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(workflowSteps)
        .where(
          and(eq(workflowSteps.companyId, companyId), eq(workflowSteps.id, stepId)),
        )
        .limit(1),
    );
  }

  findStepByIdInTx(companyId: string, stepId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowSteps)
      .where(and(eq(workflowSteps.companyId, companyId), eq(workflowSteps.id, stepId)))
      .limit(1);
  }

  findInstanceByIdInTx(companyId: string, instanceId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowInstances)
      .where(
        and(
          eq(workflowInstances.companyId, companyId),
          eq(workflowInstances.id, instanceId),
        ),
      )
      .limit(1);
  }

  /**
   * G7-3c-iii race-safety (BLOCKING #2 / FS10): take a per-instance row lock so concurrent
   * approvals of a join's deps serialize. MUST be called inside approve()'s tx, BEFORE any
   * dep-state read — the lock is held until commit, turning the lost-update race into a queue.
   */
  lockInstanceForUpdateInTx(companyId: string, instanceId: string, tx: TenantTx) {
    return tx
      .select({ id: workflowInstances.id })
      .from(workflowInstances)
      .where(
        and(
          eq(workflowInstances.companyId, companyId),
          eq(workflowInstances.id, instanceId),
        ),
      )
      .for("update");
  }

  // ─── Revision locks (G7-4a / BR-006) ──────────────────────────────────────
  // workflow_step_instance_locks: 1 ACTIVE row = locked_step_id is blocked because caused_by_step_id
  // is in revision. Soft-release (released_at) — never hard-deleted (audit-friendly + replay-safe).

  /** INSERT a lock; onConflictDoNothing vs wf_step_locks_active_uq → replay of a revision is idempotent. */
  insertStepLockInTx(
    companyId: string,
    data: { lockedStepId: string; causedByStepId: string },
    tx: TenantTx,
  ) {
    return tx
      .insert(workflowStepInstanceLocks)
      .values({
        companyId,
        lockedStepId: data.lockedStepId,
        causedByStepId: data.causedByStepId,
      })
      .onConflictDoNothing()
      .returning();
  }

  /** Soft-release EVERY active lock caused by `causedByStepId` (on its re-approve). Idempotent. */
  releaseStepLocksByCauseInTx(companyId: string, causedByStepId: string, tx: TenantTx) {
    return tx
      .update(workflowStepInstanceLocks)
      .set({ releasedAt: sql`now()` })
      .where(
        and(
          eq(workflowStepInstanceLocks.companyId, companyId),
          eq(workflowStepInstanceLocks.causedByStepId, causedByStepId),
          isNull(workflowStepInstanceLocks.releasedAt),
        ),
      );
  }

  /** ACTIVE locks on a single step (released_at IS NULL) — feeds the FSM start/submit lock guard. */
  findActiveLocksByStepIdInTx(companyId: string, lockedStepId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowStepInstanceLocks)
      .where(
        and(
          eq(workflowStepInstanceLocks.companyId, companyId),
          eq(workflowStepInstanceLocks.lockedStepId, lockedStepId),
          isNull(workflowStepInstanceLocks.releasedAt),
        ),
      );
  }

  /**
   * Distinct step ids (among `lockedStepIds`) that still carry an ACTIVE lock — ONE query for the
   * approve() fan-out open-filter (avoids an N+1 of findActiveLocksByStepIdInTx per candidate).
   * Empty input → empty result without hitting the DB.
   */
  findActiveLockedStepIdsInTx(companyId: string, lockedStepIds: string[], tx: TenantTx) {
    if (lockedStepIds.length === 0) return Promise.resolve([] as Array<{ lockedStepId: string }>);
    return tx
      .selectDistinct({ lockedStepId: workflowStepInstanceLocks.lockedStepId })
      .from(workflowStepInstanceLocks)
      .where(
        and(
          eq(workflowStepInstanceLocks.companyId, companyId),
          inArray(workflowStepInstanceLocks.lockedStepId, lockedStepIds),
          isNull(workflowStepInstanceLocks.releasedAt),
        ),
      );
  }

  findStepsByInstanceId(companyId: string, instanceId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(workflowSteps)
        .where(
          and(
            eq(workflowSteps.companyId, companyId),
            eq(workflowSteps.workflowInstanceId, instanceId),
          ),
        )
        .orderBy(workflowSteps.stepOrder),
    );
  }

  /**
   * tx variant — read all instance steps inside the caller's transaction.
   * G7-3c: dependency resolution (allDependenciesApproved) reads step status within the caller's
   * tx, never via a self-opened withTenant (that would be a different PgBouncer connection). This
   * keeps the read ready to sit inside the per-instance SELECT…FOR UPDATE lock added in 3c-iii
   * (plan §3c race-safety/FS10) — a self-opened read would escape that lock and re-introduce the race.
   */
  findStepsByInstanceIdInTx(companyId: string, instanceId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowSteps)
      .where(
        and(
          eq(workflowSteps.companyId, companyId),
          eq(workflowSteps.workflowInstanceId, instanceId),
        ),
      )
      .orderBy(workflowSteps.stepOrder);
  }

  /** PM gán assignee + reviewer cho 1 bước (không đổi status — chỉ metadata). */
  assignStep(
    companyId: string,
    stepId: string,
    data: { assigneeUserId: string | null; reviewerUserId: string | null },
    tx: TenantTx,
  ) {
    return tx
      .update(workflowSteps)
      .set({ assigneeUserId: data.assigneeUserId, reviewerUserId: data.reviewerUserId })
      .where(
        and(eq(workflowSteps.companyId, companyId), eq(workflowSteps.id, stepId)),
      )
      .returning();
  }

  startStep(companyId: string, stepId: string, tx: TenantTx) {
    return tx
      .update(workflowSteps)
      .set({ status: "in_progress", startedAt: new Date() })
      .where(
        and(eq(workflowSteps.companyId, companyId), eq(workflowSteps.id, stepId)),
      )
      .returning();
  }

  submitStep(
    companyId: string,
    stepId: string,
    data: { submissionUrl?: string | null; submissionNote?: string | null },
    tx: TenantTx,
  ) {
    return tx
      .update(workflowSteps)
      .set({
        status: "waiting_review",
        submittedAt: new Date(),
        submissionUrl: data.submissionUrl ?? null,
        submissionNote: data.submissionNote ?? null,
      })
      .where(
        and(eq(workflowSteps.companyId, companyId), eq(workflowSteps.id, stepId)),
      )
      .returning();
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────

  createTask(
    companyId: string,
    data: {
      workflowStepId: string;
      contentItemId: string | null;
      title: string;
      assigneeUserId: string | null;
      origin: "initial" | "revision";
      revisionRound: number;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(tasks)
      .values({
        companyId,
        taskType: "workflow_step",
        workflowStepId: data.workflowStepId,
        contentItemId: data.contentItemId,
        title: data.title,
        assigneeUserId: data.assigneeUserId,
        status: "not_started",
        origin: data.origin,
        revisionRound: data.revisionRound,
      })
      .onConflictDoNothing()
      .returning();
  }

  // ─── Approval requests ────────────────────────────────────────────────────

  createApprovalRequest(
    companyId: string,
    data: {
      workflowStepId: string;
      requestedBy: string;
      assigneeId: string | null;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(approvalRequests)
      .values({
        companyId,
        workflowStepId: data.workflowStepId,
        requestedBy: data.requestedBy,
        assigneeId: data.assigneeId,
        status: "pending",
        currentLevel: 1,
        maxLevel: 1,
      })
      .returning();
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

  findPendingApprovalRequests(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(approvalRequests)
        .where(
          and(eq(approvalRequests.companyId, companyId), eq(approvalRequests.status, "pending")),
        )
        .orderBy(approvalRequests.createdAt),
    );
  }

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

  closeApprovalRequest(
    companyId: string,
    requestId: string,
    data: { status: "approved" | "revision_requested"; comment: string | null },
    tx: TenantTx,
  ) {
    return tx
      .update(approvalRequests)
      .set({ status: data.status, decidedAt: new Date(), comment: data.comment })
      .where(and(eq(approvalRequests.companyId, companyId), eq(approvalRequests.id, requestId)))
      .returning();
  }

  approveStep(companyId: string, stepId: string, tx: TenantTx) {
    return tx
      .update(workflowSteps)
      .set({ status: "approved", approvedAt: new Date() })
      .where(and(eq(workflowSteps.companyId, companyId), eq(workflowSteps.id, stepId)))
      .returning();
  }

  setStepToRevision(companyId: string, stepId: string, tx: TenantTx) {
    return tx
      .update(workflowSteps)
      .set({ status: "revision" })
      .where(and(eq(workflowSteps.companyId, companyId), eq(workflowSteps.id, stepId)))
      .returning();
  }

  completeWorkflowInstance(companyId: string, instanceId: string, tx: TenantTx) {
    return tx
      .update(workflowInstances)
      .set({ status: "completed" })
      .where(and(eq(workflowInstances.companyId, companyId), eq(workflowInstances.id, instanceId)))
      .returning();
  }

  createDefect(
    companyId: string,
    data: {
      workflowStepId: string;
      responsibleUserId: string | null;
      causedByApprovalStepId: string | null;
      description: string;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(defects)
      .values({
        companyId,
        workflowStepId: data.workflowStepId,
        responsibleUserId: data.responsibleUserId,
        causedByApprovalStepId: data.causedByApprovalStepId,
        description: data.description,
      })
      .returning();
  }

  findTaskByStepId(companyId: string, workflowStepId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.companyId, companyId),
            eq(tasks.workflowStepId, workflowStepId),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(sql`revision_round DESC`)
        .limit(1),
    );
  }

  updateTaskStatus(
    companyId: string,
    taskId: string,
    status: string,
    tx: TenantTx,
  ) {
    return tx
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId)))
      .returning();
  }

  /** tx variant — dùng khi assign bước để đồng bộ assignee của task trong cùng transaction. */
  findActiveTaskByStepIdInTx(companyId: string, workflowStepId: string, tx: TenantTx) {
    return tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.companyId, companyId),
          eq(tasks.workflowStepId, workflowStepId),
          isNull(tasks.deletedAt),
        ),
      )
      .orderBy(sql`revision_round DESC`)
      .limit(1);
  }

  /** Gán assignee cho task (để task hiện trong "Công việc của tôi" của người được giao). */
  updateTaskAssignee(
    companyId: string,
    taskId: string,
    assigneeUserId: string | null,
    tx: TenantTx,
  ) {
    return tx
      .update(tasks)
      .set({ assigneeUserId, updatedAt: new Date() })
      .where(and(eq(tasks.companyId, companyId), eq(tasks.id, taskId)))
      .returning();
  }

  // ─── Content item ─────────────────────────────────────────────────────────

  findContentItemById(companyId: string, contentItemId: string, tx: TenantTx) {
    return tx
      .select()
      .from(contentItems)
      .where(
        and(
          eq(contentItems.companyId, companyId),
          eq(contentItems.id, contentItemId),
          isNull(contentItems.deletedAt),
        ),
      )
      .limit(1);
  }
}
