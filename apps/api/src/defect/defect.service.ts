import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { CreateDefectRequest } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { TasksService } from "../tasks/tasks.service";
import { DefectRepository } from "./defect.repository";

@Injectable()
export class DefectService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DefectRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tasks: TasksService,
  ) {}

  /**
   * Create a defect record for a workflow step that was returned for revision.
   *
   * Sequence (all in one withTenant tx):
   * 1. Permission check: create:defect fail-closed (ForbiddenException before any DB write).
   * 2. Cross-tenant FK guard: verify workflowStepId belongs to company (NotFoundException).
   * 3. INSERT defect (append-only — bất biến #2).
   * 4. Create a revision task in Task Hub (BẤT BIẾN #4 — unified hub).
   * 5. Audit log + outbox in the same tx.
   */
  async createDefect(companyId: string, actorId: string, dto: CreateDefectRequest) {
    // 1. Permission check BEFORE opening tx.
    const decision = await this.permissions.can({
      userId: actorId,
      companyId,
      action: "create",
      resourceType: "defect",
    });
    if (!decision.allow) {
      throw new ForbiddenException("Không có quyền tạo defect record.");
    }

    return this.db.withTenant(companyId, async (tx) => {
      // 2. Cross-tenant FK guard.
      const step = await this.repo.findStepInTenant(tx, companyId, dto.workflowStepId);
      if (!step) {
        throw new NotFoundException(`Workflow step not found: ${dto.workflowStepId}`);
      }

      // 3. INSERT defect (append-only).
      const rows = await this.repo.insertDefect(
        companyId,
        {
          workflowStepId: dto.workflowStepId,
          causedByApprovalStepId: dto.causedByApprovalStepId ?? null,
          responsibleUserId: dto.responsibleUserId ?? null,
          defectType: dto.defectType,
          description: dto.description,
          revisionTaskId: null, // filled after task created
        },
        tx,
      );
      const defect = rows[0];
      if (!defect) throw new InternalServerErrorException("Failed to create defect record");

      // 4. Create revision follow-up task in Task Hub (BẤT BIẾN #4 — unified hub).
      // taskType must be a manual type ("office") — the workflow FSM owns "revision" lifecycle.
      // The title is prefixed "[Trả sửa]" so it is distinguishable on the board.
      const task = await this.tasks.createTask(
        { id: actorId, companyId },
        {
          taskType: "office",
          title: `[Trả sửa] ${dto.description.slice(0, 100)}`,
          assigneeUserId: dto.responsibleUserId ?? null,
          projectId: null,
          dueDate: null,
        },
      );

      // 5. Audit log (objectType must match CHECK in migration 0086).
      await this.audit.record(tx, {
        action: "DefectCreated",
        objectType: "defect",
        objectId: defect.id,
        actorUserId: actorId,
        after: {
          workflowStepId: dto.workflowStepId,
          defectType: dto.defectType,
          responsibleUserId: dto.responsibleUserId ?? null,
          revisionTaskId: task.id,
        },
      });

      // Outbox event for downstream consumers (e.g. notification to responsible user).
      await this.outbox.enqueue(tx, {
        eventType: "defect.created",
        payload: {
          defectId: defect.id,
          companyId,
          workflowStepId: dto.workflowStepId,
          responsibleUserId: dto.responsibleUserId ?? null,
          revisionTaskId: task.id,
        },
      });

      return { ...defect, revisionTaskId: task.id };
    });
  }

  /** List defects for a workflow step — tenant-scoped. Requires view:defect permission. */
  async listByStep(companyId: string, stepId: string) {
    return this.db.withTenant(companyId, (tx) => this.repo.listByStep(tx, companyId, stepId));
  }
}
