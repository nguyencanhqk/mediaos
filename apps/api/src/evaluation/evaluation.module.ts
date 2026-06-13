import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { EvaluationRepository } from "./evaluation.repository";
import { EvaluationService } from "./evaluation.service";
import { EvaluationController } from "./evaluation.controller";

/**
 * G8-3 — Evaluation module (template + tiêu chí + chấm điểm gắn workflow step).
 *
 * DI: DatabaseService (DatabaseModule) + AuditService/OutboxService (EventsModule @Global).
 * PermissionModule KHÔNG global → import tường minh để EvaluationService gọi PermissionService.can()
 * (fail-closed manage:evaluation-template / score:evaluation) + PermissionGuard ở controller.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule],
  providers: [EvaluationRepository, EvaluationService],
  controllers: [EvaluationController],
  exports: [EvaluationService],
})
export class EvaluationModule {}
