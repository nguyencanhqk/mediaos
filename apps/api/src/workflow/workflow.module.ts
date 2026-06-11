import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { WorkflowFsmService } from "./workflow-fsm.service";
import { WorkflowRepository } from "./workflow.repository";
import { WorkflowService } from "./workflow.service";
import { ApprovalService } from "./approval.service";
import { WorkflowController } from "./workflow.controller";
import { WorkflowTemplatesRepository } from "./workflow-templates.repository";
import { WorkflowTemplatesService } from "./workflow-templates.service";
import { WorkflowTemplatesController } from "./workflow-templates.controller";

@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule],
  providers: [
    WorkflowFsmService,
    WorkflowRepository,
    WorkflowService,
    ApprovalService,
    WorkflowTemplatesRepository,
    WorkflowTemplatesService,
  ],
  controllers: [WorkflowController, WorkflowTemplatesController],
  exports: [WorkflowService, ApprovalService, WorkflowTemplatesService],
})
export class WorkflowModule {}
