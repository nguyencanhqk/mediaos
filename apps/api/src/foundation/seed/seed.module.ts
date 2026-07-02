import { Module } from "@nestjs/common";
import { PermissionModule } from "../../permission/permission.module";
import { MASTER_DATA_SEED_CONFIG, loadMasterDataSeedConfig } from "./master-data-seed.config";
import { MasterDataSeedBootstrapService } from "./master-data-seed-bootstrap.service";
import { MasterDataSeedRunner } from "./master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "./master-data-seeder.registry";
import { SeedController } from "./seed.controller";
import { SeedTrackingService } from "./seed-tracking.service";

/**
 * S3-FND-SEEDRUN-1 — SeedModule: hạ tầng RUNTIME per-company master-data seed.
 *
 * Providers: SeedTrackingService (FOUNDATION-BE-8 — trước đây chỉ dựng tay ở test, nay wire DI) +
 * MasterDataSeederRegistry (sổ đăng ký seeder) + MasterDataSeedRunner (chạy reconcile) + config + bootstrap
 * trigger (OnApplicationBootstrap, gated env). DatabaseService đến từ DatabaseModule (@Global).
 *
 * EXPORTS: MasterDataSeederRegistry + SeedTrackingService + MasterDataSeedRunner — module nghiệp vụ
 * (ATT/LEAVE/HR) import SeedModule rồi `register()` seeder của mình (inversion of dependency: SeedModule
 * KHÔNG import ATT/LEAVE). Wire vào FoundationModule ADDITIVE (CLAUDE §9.3) → app.module (đã có FoundationModule).
 */
@Module({
  // S2-FND-BE-2 (ADDITIVE): PermissionModule cho PermissionGuard stack (GET /foundation/seeds gate
  // view:foundation-seed, is_sensitive). DatabaseModule/EventsModule là @Global (SeedTrackingService dùng
  // DatabaseService.withTenant sẵn có).
  imports: [PermissionModule],
  controllers: [SeedController],
  providers: [
    SeedTrackingService,
    MasterDataSeederRegistry,
    MasterDataSeedRunner,
    { provide: MASTER_DATA_SEED_CONFIG, useFactory: loadMasterDataSeedConfig },
    MasterDataSeedBootstrapService,
  ],
  exports: [SeedTrackingService, MasterDataSeederRegistry, MasterDataSeedRunner],
})
export class SeedModule {}
