import { Module, type OnModuleInit } from "@nestjs/common";
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
// S4-TASK-BE-3 (additive) — Task actions crown-FSM (assign/change-status/priority/deadline/watch).
import { TaskActionsService } from "./task-actions.service";
import { TaskActionsRepository } from "./task-actions.repository";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { StorageModule } from "../storage/storage.module";
// S4-TASK-BE-3 — SettingService (checklist-required gate; exports từ foundation SettingsModule).
import { SettingsModule } from "../foundation/settings/settings.module";
// S4-TASK-BE-4 (additive) — Kanban board + move · comment/mention · checklist/items · activity feed.
import { TaskKanbanService } from "./task-kanban.service";
import { TaskCommentsService } from "./task-comments.service";
import { TaskCommentsRepository } from "./task-comments.repository";
import { TaskChecklistsService } from "./task-checklists.service";
import { TaskChecklistsRepository } from "./task-checklists.repository";
import { TaskActivityFeedService } from "./task-activity-feed.service";
import { TaskActivityFeedRepository } from "./task-activity-feed.repository";
// S4-TASK-BE-5 (additive) — Task File (đính kèm công việc): controller/service/repo + resolver
// (module='TASK', entity='task') registered into the shared FilePolicyService in onModuleInit.
// FilesModule exports FileService (link/getDownloadUrl/deleteFile) + FilePolicyService (registerResolver).
import { FilesModule } from "../foundation/files/files.module";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import { TaskFilesController } from "./task-files.controller";
import { TaskFileService } from "./task-file.service";
import { TaskFileRepository } from "./task-file.repository";
import { TaskFileResolver } from "./task-file.resolver";

@Module({
  imports: [EventsModule, PermissionModule, StorageModule, SettingsModule, FilesModule],
  controllers: [
    TasksController,
    TaskAttachmentsController,
    // PM-1 (apps/projects, mig 0420) — project_states + labels CRUD.
    ProjectStatesController,
    LabelsController,
    // S4-TASK-BE-1 — Project (dự án SPEC-06) + member.
    ProjectsController,
    // S4-TASK-BE-5 — Task File (đính kèm công việc) — /tasks/:taskId/files.
    TaskFilesController,
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
    // S4-TASK-BE-3 — Task actions crown-FSM stack (tái dùng TaskCoreRepository/DataScope/Outbox/Setting).
    TaskActionsService,
    TaskActionsRepository,
    // S4-TASK-BE-4 — Kanban board + move (tái dùng TaskCoreRepository/TasksRepository/TaskActionsService).
    TaskKanbanService,
    // S4-TASK-BE-4 — Comment/mention.
    TaskCommentsService,
    TaskCommentsRepository,
    // S4-TASK-BE-4 — Checklist/items.
    TaskChecklistsService,
    TaskChecklistsRepository,
    // S4-TASK-BE-4 — Activity feed (read-only task_activity_logs).
    TaskActivityFeedService,
    TaskActivityFeedRepository,
    // S4-TASK-BE-5 — Task File stack + resolver (registered in onModuleInit below).
    TaskFileService,
    TaskFileRepository,
    TaskFileResolver,
  ],
  // S4-DASH-BE-2 (additive): + TaskCoreService (MY_TASKS/TASK_ALERTS) + ProjectsService (PROJECT_PROGRESS
  // authorize getProject TRƯỚC listByProject — GAP vòng reconcile: plan cũ chỉ ghi TaskCoreService). DASH
  // inject qua DI — KHÔNG re-provide instance thứ 2, KHÔNG method mới. Chỉ thêm vào exports[].
  exports: [TasksService, TaskCoreService, ProjectsService],
})
export class TasksModule implements OnModuleInit {
  /**
   * S4-TASK-BE-5 — register the task file-access resolver into the shared singleton FilePolicyService at
   * bootstrap. FilePolicyService comes from FilesModule (imported above, same container instance), so this
   * governs view/download/link/delete/unlink for module='TASK' entity='task' link rows. ADDITIVE — no
   * app.module.ts touch, no rewrite of the FilePolicy registry (append-only wiring, mirror EmployeesModule).
   * Missing this registration ⇒ FilePolicy fail-closes task-linked files to 'deny-no-resolver' (403 câm).
   */
  constructor(
    private readonly filePolicy: FilePolicyService,
    private readonly taskFileResolver: TaskFileResolver,
  ) {}

  onModuleInit(): void {
    this.filePolicy.registerResolver(this.taskFileResolver);
  }
}
