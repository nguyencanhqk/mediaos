import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import type { TenantTx } from "../db/db.service";
import {
  approvalRequests,
  contentItems,
  tasks,
  workflowDefinitionSteps,
  workflowDefinitions,
  workflowInstances,
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

  updateInstanceStepOrder(
    companyId: string,
    instanceId: string,
    currentStepOrder: number,
    tx: TenantTx,
  ) {
    return tx
      .update(workflowInstances)
      .set({ currentStepOrder })
      .where(
        and(
          eq(workflowInstances.companyId, companyId),
          eq(workflowInstances.id, instanceId),
        ),
      )
      .returning();
  }

  // ─── Steps ────────────────────────────────────────────────────────────────

  createSteps(
    companyId: string,
    instanceId: string,
    stepsData: Array<{
      stepOrder: number;
      stepCode: string;
      stepName: string;
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

  startStep(companyId: string, stepId: string, tx: TenantTx) {
    return tx
      .update(workflowSteps)
      .set({ status: "in_progress", startedAt: new Date() })
      .where(
        and(eq(workflowSteps.companyId, companyId), eq(workflowSteps.id, stepId)),
      )
      .returning();
  }

  submitStep(companyId: string, stepId: string, tx: TenantTx) {
    return tx
      .update(workflowSteps)
      .set({ status: "waiting_review", submittedAt: new Date() })
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
