import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { DashboardConfigSeeder } from "./dashboard-config.seeder";

/**
 * S4-DASH-SEED-1 — đăng ký DashboardConfigSeeder vào MasterDataSeederRegistry lúc onModuleInit.
 *
 * INVERSION OF DEPENDENCY (master-data-seeder.types.ts:12-14, mirror AttSeedRegistrar): SeedModule/foundation
 * KHÔNG import DASH — module DASH tự register seeder của mình. onModuleInit chạy TRƯỚC OnApplicationBootstrap
 * của MasterDataSeedRunner ⇒ seeder đã có mặt khi runner reconcile. seedKey 'dash.default-configs' phải duy
 * nhất toàn hệ (registry throw nếu trùng — fail-fast cấu hình).
 */
@Injectable()
export class DashSeedRegistrar implements OnModuleInit {
  private readonly logger = new Logger(DashSeedRegistrar.name);

  constructor(
    private readonly registry: MasterDataSeederRegistry,
    private readonly seeder: DashboardConfigSeeder,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.seeder);
    this.logger.log(`registered ${this.seeder.seedKey}@${this.seeder.seedVersion}`);
  }
}
