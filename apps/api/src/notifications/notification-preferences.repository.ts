import { BadRequestException, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { notificationPreferences, notificationRules } from "../db/schema/communication";
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

  /**
   * Kiểm tra notification_rules.mandatory cho companyId + notificationType.
   * Bắt buộc truyền companyId của caller — KHÔNG leak sang tenant khác.
   * RLS + FORCE đảm bảo at DB layer; eq(companyId) là defense-in-depth ở app layer.
   */
  async isMandatory(companyId: string, notificationType: NotificationType): Promise<boolean> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select({ mandatory: notificationRules.mandatory })
        .from(notificationRules)
        .where(
          and(
            eq(notificationRules.companyId, companyId),
            eq(notificationRules.notificationType, notificationType),
          ),
        )
        .limit(1);
      return row?.mandatory ?? false;
    });
  }

  /**
   * Upsert preference row.
   *
   * Guard: nếu enabled=false && rule là mandatory → throw BadRequestException.
   * Immutable path: KHÔNG mutate — throw trả lỗi, không ghi row sai.
   */
  async upsert(
    companyId: string,
    userId: string,
    notificationType: NotificationType,
    enabled: boolean,
  ) {
    // Guard opt-out mandatory (NOTI-002): chỉ chặn tắt, không chặn bật lại.
    if (!enabled) {
      const mandatory = await this.isMandatory(companyId, notificationType);
      if (mandatory) {
        throw new BadRequestException("mandatory notification cannot be disabled");
      }
    }

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
   *
   * Logic thứ tự (NOTI-002):
   *   1. Nếu rule.mandatory=true → RETURN true bất kể pref row (mandatory thắng stale pref).
   *   2. Nếu không mandatory → kiểm tra pref row; default = true nếu chưa có (opt-out model).
   *
   * Bảo đảm companyId đúng caller ở mọi query.
   */
  async isTypeEnabled(
    companyId: string,
    userId: string,
    notificationType: NotificationType,
  ): Promise<boolean> {
    // Step 1: mandatory short-circuit
    const mandatory = await this.isMandatory(companyId, notificationType);
    if (mandatory) return true;

    // Step 2: pref row lookup (opt-out model)
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
