import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { OrgRepository } from "./org.repository";
import { OrgService } from "./org.service";
import { OrgController } from "./org.controller";

// PermissionModule cung cấp PermissionService cho PermissionGuard (F2 — guard các mutation org/team).
// (de-media-fy CLEAN-DECOUPLE-1: gỡ ChatModule — auto group-chat phòng ban G10-2 thuộc cụm chat out-of-scope.)
@Module({
  imports: [DatabaseModule, PermissionModule],
  providers: [OrgRepository, OrgService],
  controllers: [OrgController],
  exports: [OrgService],
})
export class OrgModule {}
