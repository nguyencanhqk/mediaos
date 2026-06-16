import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TaskAttachmentsController } from "./task-attachments.controller";
import { TasksService } from "./tasks.service";
import { TaskAttachmentsService } from "./task-attachments.service";
import { TasksRepository } from "./tasks.repository";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [EventsModule, PermissionModule, StorageModule],
  controllers: [TasksController, TaskAttachmentsController],
  providers: [TasksService, TaskAttachmentsService, TasksRepository],
  exports: [TasksService],
})
export class TasksModule {}
