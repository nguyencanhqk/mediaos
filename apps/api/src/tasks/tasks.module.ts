import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TaskAttachmentsController } from "./task-attachments.controller";
import { ProjectStatesController } from "./project-states.controller";
import { LabelsController } from "./labels.controller";
import { TasksService } from "./tasks.service";
import { TaskAttachmentsService } from "./task-attachments.service";
import { ProjectStatesService } from "./project-states.service";
import { LabelsService } from "./labels.service";
import { TasksRepository } from "./tasks.repository";
// S4-TASK-BE-1 (additive) — Project domain (SPEC-06): controller/service/repo + activity-log helper.
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectsRepository } from "./projects.repository";
import { TaskActivityService } from "./task-activity.service";
// S4-TASK-BE-2 (additive) — Task core (SPEC-06): CRUD + my-tasks + filter, tách khỏi Task Hub legacy.
import { TaskCoreService } from "./task-core.service";
import { TaskCoreRepository } from "./task-core.repository";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [EventsModule, PermissionModule, StorageModule],
  controllers: [
    TasksController,
    TaskAttachmentsController,
    // PM-1 (apps/projects, mig 0420) — project_states + labels CRUD.
    ProjectStatesController,
    LabelsController,
    // S4-TASK-BE-1 — Project (dự án SPEC-06) + member.
    ProjectsController,
  ],
  providers: [
    TasksService,
    TaskAttachmentsService,
    TasksRepository,
    // PM-1 services (tái dùng TasksRepository cho project_states/labels/task_labels).
    ProjectStatesService,
    LabelsService,
    // S4-TASK-BE-1 — Project stack + append-only activity-log writer (cùng tx nghiệp vụ).
    ProjectsService,
    ProjectsRepository,
    TaskActivityService,
    // S4-TASK-BE-2 — Task core stack (tái dùng TasksRepository cho project guard + TaskActivityService).
    TaskCoreService,
    TaskCoreRepository,
  ],
  exports: [TasksService],
})
export class TasksModule {}
