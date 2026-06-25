import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { PermissionModule } from "../permission/permission.module";
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
@Module({
  imports: [DatabaseModule, PermissionModule],
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
