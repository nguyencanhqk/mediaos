import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { ChatModule } from "../chat/chat.module";
import { OrgRepository } from "./org.repository";
import { OrgService } from "./org.service";
import { OrgController } from "./org.controller";

// PermissionModule cung cấp PermissionService cho PermissionGuard (F2 — guard các mutation org/team).
// ChatModule (exports ChatService) cho G10-2 auto-tạo group chat phòng ban khi tạo org_unit.
@Module({
  imports: [DatabaseModule, PermissionModule, ChatModule],
  providers: [OrgRepository, OrgService],
  controllers: [OrgController],
  exports: [OrgService],
})
export class OrgModule {}
