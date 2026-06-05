import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { TasksRepository } from "./tasks.repository";

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TasksRepository,
    private readonly audit: AuditService,
  ) {}

  async getMyTasks(companyId: string, userId: string) {
    const rows = await this.repo.findByAssignee(companyId, userId);
    return rows;
  }

  async getComments(companyId: string, taskId: string) {
    const [task] = await this.repo.findById(companyId, taskId);
    if (!task) throw new NotFoundException(`Task not found: ${taskId}`);
    return this.repo.findCommentsByTaskId(companyId, taskId);
  }

  async addComment(companyId: string, taskId: string, userId: string, body: string) {
    const [task] = await this.repo.findById(companyId, taskId);
    if (!task) throw new NotFoundException(`Task not found: ${taskId}`);

    const [comment] = await this.db.withTenant(companyId, async (tx) => {
      const created = await this.repo.createComment(companyId, { taskId, userId, body }, tx);
      await this.audit.record(tx, {
        action: "TaskCommentAdded",
        objectType: "task",
        objectId: taskId,
        actorUserId: userId,
        after: { body },
      });
      return created;
    });

    if (!comment) throw new NotFoundException("Failed to create comment");

    // Re-fetch with user join to return full CommentDto
    const comments = await this.repo.findCommentsByTaskId(companyId, taskId);
    return comments.find((c) => c.id === comment.id) ?? comment;
  }
}
