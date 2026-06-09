import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { WorkflowFsmService } from "./workflow-fsm.service";
import { WorkflowRepository } from "./workflow.repository";
import { WorkflowService } from "./workflow.service";
import { ApprovalService } from "./approval.service";
import { WorkflowController } from "./workflow.controller";

@Module({
  imports: [DatabaseModule, EventsModule],
  providers: [WorkflowFsmService, WorkflowRepository, WorkflowService, ApprovalService],
  controllers: [WorkflowController],
  exports: [WorkflowService, ApprovalService],
})
export class WorkflowModule {}
