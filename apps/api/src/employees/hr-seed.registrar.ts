import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { HrMasterDataSeeder } from "./hr-master-data.seeder";

/**
 * S2-FND-SEED-2 — đăng ký HrMasterDataSeeder vào MasterDataSeederRegistry lúc onModuleInit (mirror
 * AttSeedRegistrar/LeaveSeedRegistrar).
 *
 * INVERSION OF DEPENDENCY: SeedModule/foundation KHÔNG import HR — module HR (EmployeesModule) tự register
 * seeder của mình. onModuleInit chạy TRƯỚC OnApplicationBootstrap của MasterDataSeedRunner ⇒ seeder đã có
 * mặt khi runner reconcile. seedKey 'hr.master-data' phải duy nhất toàn hệ (registry throw nếu trùng —
 * fail-fast cấu hình).
 */
@Injectable()
export class HrSeedRegistrar implements OnModuleInit {
  private readonly logger = new Logger(HrSeedRegistrar.name);

  constructor(
    private readonly registry: MasterDataSeederRegistry,
    private readonly seeder: HrMasterDataSeeder,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.seeder);
    this.logger.log(`registered ${this.seeder.seedKey}@${this.seeder.seedVersion}`);
  }
}
