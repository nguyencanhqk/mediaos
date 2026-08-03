import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
import { ChatModule } from "../chat/chat.module";
import { OrgRepository } from "./org.repository";
import { OrgService } from "./org.service";
import { OrgController } from "./org.controller";
// S2-HR-BE-3 (additive): HR department CRUD + master data CRUD.
import { HrDepartmentController } from "./hr-department.controller";
import { HrDepartmentRepository } from "./hr-department.repository";
import { HrDepartmentService } from "./hr-department.service";
import { HrMasterDataController } from "./hr-master-data.controller";
import { HrMasterDataRepository } from "./hr-master-data.repository";
import { HrMasterDataService } from "./hr-master-data.service";

// PermissionModule cung cấp PermissionService cho PermissionGuard (F2 — guard các mutation org/team).
// (de-media-fy CLEAN-DECOUPLE-1: gỡ ChatModule — auto group-chat phòng ban G10-2 thuộc cụm chat out-of-scope.)
// S2-HR-BE-3: HrDepartmentController (HR.DEPARTMENT.*) + HrMasterDataController (HR.MASTER_DATA.MANAGE) — additive.
// S7-CHAT-BE-5: ChatModule quay lại — KHÔNG phải hoàn tác de-media-fy. Phòng chat theo phòng ban là
// hạng mục SPEC-15 §13.3 của module CHAT trong phạm vi, khác hẳn "auto group-chat G10-2" bị gỡ trước đây.
@Module({
  imports: [DatabaseModule, PermissionModule, ChatModule],
  providers: [
    OrgRepository,
    OrgService,
    HrDepartmentRepository,
    HrDepartmentService,
    HrMasterDataRepository,
    HrMasterDataService,
  ],
  controllers: [OrgController, HrDepartmentController, HrMasterDataController],
  exports: [OrgService, HrDepartmentService, HrMasterDataService],
})
export class OrgModule {}
