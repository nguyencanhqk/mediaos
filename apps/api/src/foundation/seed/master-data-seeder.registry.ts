import { Injectable, Logger } from "@nestjs/common";
import type { ModuleMasterDataSeeder } from "./master-data-seeder.types";

/**
 * S3-FND-SEEDRUN-1 — sổ đăng ký seeder master-data (mirror EventBus, ADR-0009).
 *
 * Module nghiệp vụ (ATT/LEAVE/HR) `register()` seeder của mình lúc onModuleInit (chạy TRƯỚC
 * OnApplicationBootstrap của runner ⇒ mọi đăng ký xong trước khi reconcile). Runner đọc `list()`.
 *
 * INVERSION OF DEPENDENCY: registry/runner KHÔNG biết về ATT/LEAVE — chỉ giữ interface. seedKey PHẢI duy
 * nhất toàn hệ (1 batch/seedKey) → trùng ⇒ throw fail-fast (cấu hình sai phát hiện ngay lúc boot, KHÔNG seed
 * nhầm/đè im lặng).
 */
@Injectable()
export class MasterDataSeederRegistry {
  private readonly logger = new Logger(MasterDataSeederRegistry.name);
  private readonly byKey = new Map<string, ModuleMasterDataSeeder>();

  /** Đăng ký 1 seeder. Throw nếu seedKey rỗng hoặc trùng (fail-fast cấu hình). */
  register(seeder: ModuleMasterDataSeeder): void {
    const seedKey = seeder.seedKey?.trim();
    if (!seedKey) {
      throw new Error(
        "MasterDataSeederRegistry.register: seedKey rỗng — seeder phải khai seedKey.",
      );
    }
    if (!seeder.seedVersion?.trim()) {
      throw new Error(
        `MasterDataSeederRegistry.register: seedVersion rỗng cho seedKey='${seedKey}'.`,
      );
    }
    if (this.byKey.has(seedKey)) {
      throw new Error(
        `MasterDataSeederRegistry.register: seedKey trùng '${seedKey}' (phải duy nhất toàn hệ).`,
      );
    }
    this.byKey.set(seedKey, seeder);
    this.logger.log(`registered master-data seeder: ${seedKey}@${seeder.seedVersion}`);
  }

  /** Mọi seeder đã đăng ký (rỗng nếu chưa module nào register). */
  list(): readonly ModuleMasterDataSeeder[] {
    return [...this.byKey.values()];
  }

  /** Số seeder đã đăng ký. */
  size(): number {
    return this.byKey.size;
  }
}
