import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { ApprovalRulesRepository } from "./approval-rules.repository";
import { ApprovalMultilevelService } from "./approval-multilevel.service";
import { ApprovalInboxController } from "./approval-inbox.controller";

/**
 * G8-1 — Approval module (multi-level approval + inbox).
 *
 * Imports WorkflowModule to reuse the proven single-level G4-5 ApprovalService for the FINAL level
 * (close request + approve workflow_step + DAG fan-out + complete). PermissionModule provides the
 * PermissionGuard used by the inbox controller (fail-closed). EventsModule = audit + outbox (in-tx).
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule, WorkflowModule],
  providers: [ApprovalRulesRepository, ApprovalMultilevelService],
  controllers: [ApprovalInboxController],
  exports: [ApprovalMultilevelService],
})
export class ApprovalModule {}
