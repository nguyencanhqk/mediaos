import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { notificationPreferences } from "../db/schema/communication";
import type { NotificationType } from "@mediaos/contracts";

@Injectable()
export class NotificationPreferencesRepository {
  constructor(private readonly db: DatabaseService) {}

  findByUser(companyId: string, userId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.companyId, companyId),
            eq(notificationPreferences.userId, userId),
          ),
        ),
    );
  }

  upsert(
    companyId: string,
    userId: string,
    notificationType: NotificationType,
    enabled: boolean,
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(notificationPreferences)
        .values({
          companyId,
          userId,
          notificationType,
          enabled,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.companyId,
            notificationPreferences.userId,
            notificationPreferences.notificationType,
          ],
          set: { enabled, updatedAt: new Date() },
        })
        .returning(),
    );
  }

  /**
   * Kiểm tra xem user có muốn nhận notification loại này không.
   * Default = true nếu chưa có preference row (opt-out model).
   */
  async isTypeEnabled(
    companyId: string,
    userId: string,
    notificationType: NotificationType,
  ): Promise<boolean> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select({ enabled: notificationPreferences.enabled })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.companyId, companyId),
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.notificationType, notificationType),
          ),
        )
        .limit(1);
      // No row → default enabled (opt-out model)
      return row?.enabled ?? true;
    });
  }
}
