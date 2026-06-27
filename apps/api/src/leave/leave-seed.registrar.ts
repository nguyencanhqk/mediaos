import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { LeaveMasterDataSeeder } from "./leave-master-data.seeder";

/**
 * S3-LEAVE-SEED-1 (PART B) — đăng ký LeaveMasterDataSeeder vào MasterDataSeederRegistry lúc onModuleInit.
 *
 * INVERSION OF DEPENDENCY (mirror AttSeedRegistrar / PermissionCacheInvalidator ↔ EventBus.register):
 * SeedModule/foundation KHÔNG import LEAVE — module LEAVE tự register seeder của mình. onModuleInit chạy
 * TRƯỚC OnApplicationBootstrap của MasterDataSeedRunner ⇒ seeder đã có mặt khi runner reconcile. seedKey
 * 'leave.master-data' phải duy nhất toàn hệ (registry throw nếu trùng — fail-fast cấu hình).
 */
@Injectable()
export class LeaveSeedRegistrar implements OnModuleInit {
  private readonly logger = new Logger(LeaveSeedRegistrar.name);

  constructor(
    private readonly registry: MasterDataSeederRegistry,
    private readonly seeder: LeaveMasterDataSeeder,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.seeder);
    this.logger.log(`registered ${this.seeder.seedKey}@${this.seeder.seedVersion}`);
  }
}
