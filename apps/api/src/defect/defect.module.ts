import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { TasksModule } from "../tasks/tasks.module";
import { DefectRepository } from "./defect.repository";
import { DefectService } from "./defect.service";
import { DefectController } from "./defect.controller";

@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule, TasksModule],
  providers: [DefectRepository, DefectService],
  controllers: [DefectController],
  exports: [DefectService],
})
export class DefectModule {}
