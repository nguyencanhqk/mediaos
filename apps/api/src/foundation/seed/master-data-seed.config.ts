import { loadEnv } from "../../config/env.schema";

/** DI token cho cấu hình seed-on-boot (inject vào bootstrap service → test dựng thẳng, không mock module). */
export const MASTER_DATA_SEED_CONFIG = Symbol("MASTER_DATA_SEED_CONFIG");

export interface MasterDataSeedConfig {
  /** MASTER_DATA_SEED_ON_BOOT === 'true' (kill-switch vận hành). */
  enabled: boolean;
  /** NODE_ENV === 'test' → seed-on-boot TỰ TẮT (spec gọi runner trực tiếp; tránh đua/nhiễu test). */
  isTestEnv: boolean;
  /** NODE_ENV — ghi vào seed_batches.environment để truy vết. */
  environment: string;
}

/** Đọc cấu hình từ env (đã validate ở env.schema). Factory cho provider MASTER_DATA_SEED_CONFIG. */
export function loadMasterDataSeedConfig(): MasterDataSeedConfig {
  const env = loadEnv();
  return {
    enabled: env.MASTER_DATA_SEED_ON_BOOT === "true",
    isTestEnv: env.NODE_ENV === "test",
    environment: env.NODE_ENV,
  };
}
