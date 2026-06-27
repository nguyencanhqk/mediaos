import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { MASTER_DATA_SEED_CONFIG, type MasterDataSeedConfig } from "./master-data-seed.config";
import { MasterDataSeedRunner } from "./master-data-seed-runner.service";

/**
 * S3-FND-SEEDRUN-1 — trigger seed master-data LÚC KHỞI ĐỘNG (runtime, KHÔNG migration).
 *
 * OnApplicationBootstrap chạy SAU mọi onModuleInit ⇒ mọi module ATT/LEAVE/HR đã `register()` seeder xong
 * trước khi reconcile (đúng thứ tự). Gated:
 *   - NODE_ENV==='test' → no-op (spec gọi runner trực tiếp; KHÔNG auto-seed lúc test/CI).
 *   - MASTER_DATA_SEED_ON_BOOT='false' → no-op (kill-switch vận hành).
 *
 * runner.reconcileAllCompanies() KHÔNG BAO GIỜ throw ⇒ seed lỗi KHÔNG sập boot (chỉ log). KHÔNG await chặn
 * lâu các module khác — bootstrap hook là async, Nest chờ resolve nhưng reconcile fail-safe nên luôn kết thúc.
 */
@Injectable()
export class MasterDataSeedBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MasterDataSeedBootstrapService.name);

  constructor(
    private readonly runner: MasterDataSeedRunner,
    @Inject(MASTER_DATA_SEED_CONFIG) private readonly config: MasterDataSeedConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.isTestEnv) {
      this.logger.debug("NODE_ENV=test — KHÔNG auto-seed master-data (spec gọi runner trực tiếp).");
      return;
    }
    if (!this.config.enabled) {
      this.logger.log("MASTER_DATA_SEED_ON_BOOT=false — bỏ qua seed master-data lúc boot.");
      return;
    }

    const summary = await this.runner.reconcileAllCompanies();
    this.logger.log(
      `master-data seed-on-boot: ${summary.companiesScanned} company, ` +
        `${summary.seedersRegistered} seeder, ${summary.succeeded} ok, ${summary.failed} lỗi.`,
    );
  }
}
