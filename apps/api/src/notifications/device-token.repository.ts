import { and, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { deviceTokens } from "../db/schema";
import type { DeviceToken, DeviceTokenPlatform } from "../db/schema/device-tokens";

export class DeviceTokenRepository {
  constructor(private readonly tx: TenantTx) {}

  async upsert(params: {
    userId: string;
    token: string;
    platform: DeviceTokenPlatform;
  }): Promise<void> {
    await this.tx
      .insert(deviceTokens)
      .values({
        userId: params.userId,
        token: params.token,
        platform: params.platform,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: {
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
          deletedAt: null,
        },
      });
  }

  async softDelete(params: { token: string; userId: string }): Promise<void> {
    await this.tx
      .update(deviceTokens)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(deviceTokens.token, params.token),
          eq(deviceTokens.userId, params.userId),
          isNull(deviceTokens.deletedAt),
        ),
      );
  }

  async findActiveByUser(userId: string): Promise<DeviceToken[]> {
    return this.tx
      .select()
      .from(deviceTokens)
      .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.deletedAt)));
  }
}
