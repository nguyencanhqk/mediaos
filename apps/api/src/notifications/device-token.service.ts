import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { DeviceTokenRepository } from "./device-token.repository";
import type { DeviceTokenPlatform } from "../db/schema/device-tokens";

@Injectable()
export class DeviceTokenService {
  constructor(private readonly db: DatabaseService) {}

  async register(params: {
    companyId: string;
    userId: string;
    token: string;
    platform: DeviceTokenPlatform;
  }): Promise<void> {
    await this.db.withTenant(params.companyId, async (tx) => {
      const repo = new DeviceTokenRepository(tx);
      await repo.upsert({
        userId: params.userId,
        token: params.token,
        platform: params.platform,
      });
    });
  }

  async unregister(params: {
    companyId: string;
    token: string;
    userId: string;
  }): Promise<void> {
    await this.db.withTenant(params.companyId, async (tx) => {
      const repo = new DeviceTokenRepository(tx);
      await repo.softDelete({ token: params.token, userId: params.userId });
    });
  }
}
