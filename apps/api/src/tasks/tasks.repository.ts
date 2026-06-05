import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import type { TenantTx } from "../db/db.service";
import { contentItems } from "../db/schema/media";
import { users } from "../db/schema/users";
import { taskComments, tasks, workflowSteps } from "../db/schema/workflow";

@Injectable()
export class TasksRepository {
  constructor(private readonly db: DatabaseService) {}

  findByAssignee(companyId: string, userId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: tasks.id,
          companyId: tasks.companyId,
          title: tasks.title,
          status: tasks.status,
          origin: tasks.origin,
          revisionRound: tasks.revisionRound,
          dueDate: tasks.dueDate,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          assigneeUserId: tasks.assigneeUserId,
          stepId: workflowSteps.id,
          stepCode: workflowSteps.stepCode,
          stepName: workflowSteps.stepName,
          stepStatus: workflowSteps.status,
          submissionUrl: workflowSteps.submissionUrl,
          submissionNote: workflowSteps.submissionNote,
          contentItemId: tasks.contentItemId,
          contentTitle: contentItems.title,
        })
        .from(tasks)
        .leftJoin(workflowSteps, eq(tasks.workflowStepId, workflowSteps.id))
        .leftJoin(contentItems, eq(tasks.contentItemId, contentItems.id))
        .where(
          and(
            eq(tasks.companyId, companyId),
            eq(tasks.assigneeUserId, userId),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(desc(tasks.createdAt)),
    );
  }

  findById(companyId: string, taskId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.companyId, companyId),
            eq(tasks.id, taskId),
            isNull(tasks.deletedAt),
          ),
        )
        .limit(1),
    );
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  findCommentsByTaskId(companyId: string, taskId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          id: taskComments.id,
          taskId: taskComments.taskId,
          userId: taskComments.userId,
          userFullName: users.fullName,
          body: taskComments.body,
          createdAt: taskComments.createdAt,
        })
        .from(taskComments)
        .innerJoin(users, eq(taskComments.userId, users.id))
        .where(
          and(
            eq(taskComments.companyId, companyId),
            eq(taskComments.taskId, taskId),
          ),
        )
        .orderBy(taskComments.createdAt),
    );
  }

  createComment(
    companyId: string,
    data: { taskId: string; userId: string; body: string },
    tx: TenantTx,
  ) {
    return tx
      .insert(taskComments)
      .values({
        companyId,
        taskId: data.taskId,
        userId: data.userId,
        body: data.body,
      })
      .returning();
  }
}
