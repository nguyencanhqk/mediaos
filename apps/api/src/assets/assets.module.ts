import { Module } from "@nestjs/common";
import { SequenceModule } from "../foundation/sequences/sequence.module";
import { PermissionModule } from "../permission/permission.module";
import { AssetAccessService } from "./asset-access.service";
import { AssetAssignmentsRepository } from "./asset-assignments.repository";
import { AssetCategoriesController } from "./asset-categories.controller";
import { AssetCategoriesRepository } from "./asset-categories.repository";
import { AssetCategoriesService } from "./asset-categories.service";
import { AssetInventoriesController } from "./asset-inventories.controller";
import { AssetInventoryRepository } from "./asset-inventory.repository";
import { AssetInventoryService } from "./asset-inventory.service";
import { AssetLifecycleService } from "./asset-lifecycle.service";
import { AssetMaintenanceRepository } from "./asset-maintenance.repository";
import { AssetMaintenanceService } from "./asset-maintenance.service";
import { AssetsController } from "./assets.controller";
import { AssetsRepository } from "./assets.repository";
import { AssetsService } from "./assets.service";
import { MeAssetsController } from "./me-assets.controller";

/**
 * S11-ASSET-BE-1 — AssetsModule (SPEC-13 · DB-15 · API-14).
 *
 * imports:
 *   • PermissionModule — PermissionGuard + DataScopeService (scope đọc Own/Department/Company §13.6);
 *   • SequenceModule   — counter `asset_code` theo LOẠI (tạo cùng tx với loại; `nextCode` ngoài tx nghiệp vụ).
 * AuditService + OutboxService đến từ EventsModule (@Global) — ghi TRONG cùng tx nghiệp vụ.
 *
 * NOTI: registrar (`asset.assigned`/`asset.revoked` → ASSET_ASSIGNED/ASSET_REVOKED) + job `ASSET_MAINTENANCE_DUE`
 * sống ở `notifications/**` (tiền lệ GOAL/TASK) — module này KHÔNG import NotificationsModule và ngược lại.
 */
@Module({
  imports: [PermissionModule, SequenceModule],
  controllers: [
    AssetCategoriesController,
    AssetsController,
    AssetInventoriesController,
    MeAssetsController,
  ],
  providers: [
    AssetAccessService,
    AssetCategoriesRepository,
    AssetCategoriesService,
    AssetsRepository,
    AssetsService,
    AssetAssignmentsRepository,
    AssetLifecycleService,
    AssetMaintenanceRepository,
    AssetMaintenanceService,
    AssetInventoryRepository,
    AssetInventoryService,
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
