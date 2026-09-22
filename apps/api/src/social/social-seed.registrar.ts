import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { SocialMasterDataSeeder } from "./social-master-data.seeder";

/**
 * S16-SOCIAL-BE-2A (nợ (a) của DB-2) — đăng ký `SocialMasterDataSeeder` vào
 * `MasterDataSeederRegistry` lúc `onModuleInit`. Khuôn `att-seed.registrar.ts`.
 *
 * INVERSION OF DEPENDENCY: `SeedModule`/foundation KHÔNG import SOCIAL — module SOCIAL tự register
 * seeder của mình. `onModuleInit` chạy TRƯỚC `OnApplicationBootstrap` của `MasterDataSeedRunner` ⇒
 * seeder đã có mặt khi runner reconcile từng company. `seedKey 'social.master-data'` phải duy nhất
 * toàn hệ (registry throw nếu trùng — fail-fast cấu hình lúc boot).
 *
 * ⚠️ Lớp RIÊNG, không nhét vào `SocialModule.onModuleInit` (nơi đã đăng ký `SocialFileResolver`):
 * giữ đúng khuôn 1 registrar/1 registry của ATT/LEAVE, và để lỗi seedKey trùng chỉ ra đúng file này.
 */
@Injectable()
export class SocialSeedRegistrar implements OnModuleInit {
  private readonly logger = new Logger(SocialSeedRegistrar.name);

  constructor(
    private readonly registry: MasterDataSeederRegistry,
    private readonly seeder: SocialMasterDataSeeder,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.seeder);
    this.logger.log(`registered ${this.seeder.seedKey}@${this.seeder.seedVersion}`);
  }
}
