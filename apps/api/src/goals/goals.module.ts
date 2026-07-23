import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { SequenceModule } from "../foundation/sequences/sequence.module";
import { TasksModule } from "../tasks/tasks.module";
import { GoalsController } from "./goals.controller";
import { MeGoalsController } from "./me-goals.controller";
import { GoalsService } from "./goals.service";
import { GoalsValidationService } from "./goals-validation.service";
import { GoalsRepository } from "./goals.repository";

/**
 * S5-GOAL-BE-1 — GoalsModule (SPEC-10 · DB-11).
 *
 * imports:
 *   • PermissionModule — PermissionGuard + DataScopeService (lớp quyền 1);
 *   • SequenceModule   — cấp `goal_code` (counter 'goal' seed 0506; KHÔNG ensure-on-miss, fail-loud);
 *   • TasksModule      — TÁI DÙNG ProjectAccessService (lớp quyền 2 cho goal cấp dự án, DECISIONS-04
 *                        D-23/D-24). KHÔNG re-implement logic project_role: hai bản sao = hai cửa quyền
 *                        trôi khỏi nhau. TasksModule đã export service này (thêm ở WO này, 1 dòng).
 * AuditService đến từ EventsModule (@Global) — ghi audit trong cùng tx nghiệp vụ.
 */
@Module({
  imports: [PermissionModule, SequenceModule, TasksModule],
  controllers: [GoalsController, MeGoalsController],
  providers: [GoalsService, GoalsValidationService, GoalsRepository],
  exports: [GoalsService],
})
export class GoalsModule {}
