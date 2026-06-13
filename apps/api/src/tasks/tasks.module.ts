import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { TasksRepository } from "./tasks.repository";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";

@Module({
  imports: [EventsModule, PermissionModule],
  controllers: [TasksController],
  providers: [TasksService, TasksRepository],
  exports: [TasksService],
})
export class TasksModule {}
