import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { PayrollMasterDataSeeder } from "./payroll-master-data.seeder";

/**
 * S15-PAYROLL-DB-1 — đăng ký `PayrollMasterDataSeeder` vào `MasterDataSeederRegistry` lúc onModuleInit.
 *
 * INVERSION OF DEPENDENCY (mirror `AttSeedRegistrar` / `DashSeedRegistrar`): foundation/SeedModule
 * KHÔNG import PAYROLL — module PAYROLL tự register seeder của mình. `onModuleInit` chạy TRƯỚC
 * `OnApplicationBootstrap` của `MasterDataSeedRunner` ⇒ seeder đã có mặt khi runner reconcile.
 * `seedKey = 'payroll.master-data'` phải duy nhất toàn hệ (registry throw nếu trùng — fail-fast cấu hình).
 */
@Injectable()
export class PayrollSeedRegistrar implements OnModuleInit {
  private readonly logger = new Logger(PayrollSeedRegistrar.name);

  constructor(
    private readonly registry: MasterDataSeederRegistry,
    private readonly seeder: PayrollMasterDataSeeder,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.seeder);
    this.logger.log(`registered ${this.seeder.seedKey}@${this.seeder.seedVersion}`);
  }
}
