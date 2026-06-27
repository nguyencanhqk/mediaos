import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { AttMasterDataSeeder } from "./att-master-data.seeder";

/**
 * S3-ATT-SEED-1 (PART B) — đăng ký AttMasterDataSeeder vào MasterDataSeederRegistry lúc onModuleInit.
 *
 * INVERSION OF DEPENDENCY (mirror PermissionCacheInvalidator ↔ EventBus.register): SeedModule/foundation
 * KHÔNG import ATT — module ATT tự register seeder của mình. onModuleInit chạy TRƯỚC OnApplicationBootstrap
 * của MasterDataSeedRunner ⇒ seeder đã có mặt khi runner reconcile. seedKey 'att.master-data' phải duy nhất
 * toàn hệ (registry throw nếu trùng — fail-fast cấu hình).
 */
@Injectable()
export class AttSeedRegistrar implements OnModuleInit {
  private readonly logger = new Logger(AttSeedRegistrar.name);

  constructor(
    private readonly registry: MasterDataSeederRegistry,
    private readonly seeder: AttMasterDataSeeder,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.seeder);
    this.logger.log(`registered ${this.seeder.seedKey}@${this.seeder.seedVersion}`);
  }
}
