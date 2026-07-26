import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { SequenceModule } from "../foundation/sequences/sequence.module";
import { TasksModule } from "../tasks/tasks.module";
import { GoalsController } from "./goals.controller";
import { MeGoalsController } from "./me-goals.controller";
import { GoalsService } from "./goals.service";
import { GoalsValidationService } from "./goals-validation.service";
import { GoalsRepository } from "./goals.repository";
// S5-GOAL-BE-2 (additive) — vòng đo: lớp phạm vi tách riêng · sổ goal_updates · check-in/chốt kỳ ·
// gắn/tháo task · job đối soát đêm.
import { GoalAccessService } from "./goal-access.service";
import { GoalUpdatesRepository } from "./goal-updates.repository";
import { GoalCheckinService } from "./goal-checkin.service";
import { GoalTasksLinkService } from "./goal-tasks-link.service";
import { GoalReconciliationJobHandler } from "./goal-reconciliation.job-handler";
// S5-GOAL-TPL-1 (additive) — Đợt D: danh mục task template (GOAL-API-012) + phân rã (GOAL-API-011).
import { TaskTemplatesController } from "./task-templates.controller";
import { TaskTemplatesService } from "./task-templates.service";
import { TaskTemplatesRepository } from "./task-templates.repository";
import { GoalDecomposeService } from "./goal-decompose.service";

/**
 * S5-GOAL-BE-1/BE-2 — GoalsModule (SPEC-10 · DB-11).
 *
 * imports:
 *   • PermissionModule — PermissionGuard + DataScopeService (lớp quyền 1);
 *   • SequenceModule   — cấp `goal_code` (counter 'goal' seed 0506; KHÔNG ensure-on-miss, fail-loud);
 *   • TasksModule      — TÁI DÙNG ProjectAccessService (lớp quyền 2 cho goal cấp dự án, DECISIONS-04
 *                        D-23/D-24) + GoalProgressEngineService/TaskCoreRepository (S5-GOAL-BE-2).
 *                        KHÔNG re-implement: hai bản sao = hai cửa quyền / hai con số trôi khỏi nhau.
 * AuditService + OutboxService đến từ EventsModule (@Global) — ghi TRONG cùng tx nghiệp vụ.
 *
 * ⚠️ CHIỀU PHỤ THUỘC MỘT HƯỚNG: GoalsModule → TasksModule. Vì thế engine đo tiến độ nằm ở `tasks/`
 * (nguồn số là `tasks`/`projects`); đặt nó ở đây sẽ buộc TasksModule import ngược ⇒ cycle DI.
 *
 * `GoalReconciliationJobHandler` chỉ cần nằm trong `providers` — SchedulerModule gom qua DiscoveryService
 * theo metadata `@SystemJobHandler()`; GoalsModule KHÔNG import SchedulerModule và ngược lại.
 */
/**
 * S5-GOAL-TPL-1 (additive) — Đợt D: `TaskTemplatesController` (/task-templates, gate
 * `manage:task-template` seed mig 0527) + `GoalDecomposeService` (route `POST /goals/:id/decompose` khai
 * trong `GoalsController`). Phân rã dùng LẠI từ TasksModule (đã import): `TaskCoreService.createTaskInTx`
 * (gate + insert + activity + audit của TASK), `TaskChecklistsRepository` (checklist → 2 bảng của TASK),
 * `GoalProgressEngineService` (recompute). KHÔNG provider bản sao — 2 đường ghi task là 2 luật sẽ trôi.
 *
 * `SequenceModule` (đã import cho `goal_code`) cũng cấp `SequenceService` mà phân rã cần để lấy N
 * `task_code` TRƯỚC business tx (`allocateTaskCodeOutsideTx`).
 */
@Module({
  imports: [PermissionModule, SequenceModule, TasksModule],
  controllers: [GoalsController, MeGoalsController, TaskTemplatesController],
  providers: [
    GoalsService,
    GoalsValidationService,
    GoalsRepository,
    GoalAccessService,
    GoalUpdatesRepository,
    GoalCheckinService,
    GoalTasksLinkService,
    GoalReconciliationJobHandler,
    TaskTemplatesService,
    TaskTemplatesRepository,
    GoalDecomposeService,
  ],
  exports: [GoalsService],
})
export class GoalsModule {}
