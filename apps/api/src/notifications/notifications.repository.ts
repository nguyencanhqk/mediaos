import { Injectable } from "@nestjs/common";
import { and, count, desc, eq } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { notifications } from "../db/schema/communication";
import type { NotificationType } from "@mediaos/contracts";

@Injectable()
export class NotificationsRepository {
  constructor(private readonly db: DatabaseService) {}

  findByUser(companyId: string, userId: string, isRead?: boolean) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.companyId, companyId),
            eq(notifications.userId, userId),
            isRead !== undefined ? eq(notifications.isRead, isRead) : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(50),
    );
  }

  async countUnread(companyId: string, userId: string): Promise<number> {
    return this.db.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select({ n: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.companyId, companyId),
            eq(notifications.userId, userId),
            eq(notifications.isRead, false),
          ),
        );
      return row?.n ?? 0;
    });
  }

  markRead(companyId: string, notificationId: string, userId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.companyId, companyId),
            eq(notifications.id, notificationId),
            eq(notifications.userId, userId),
          ),
        )
        .returning(),
    );
  }

  markAllRead(companyId: string, userId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.companyId, companyId),
            eq(notifications.userId, userId),
            eq(notifications.isRead, false),
          ),
        )
        .returning({ id: notifications.id }),
    );
  }

  create(
    companyId: string,
    data: {
      userId: string;
      type: NotificationType;
      body: string;
      refId?: string | null;
      refType?: string | null;
    },
  ) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .insert(notifications)
        .values({
          companyId,
          userId: data.userId,
          type: data.type,
          body: data.body,
          refId: data.refId ?? null,
          refType: data.refType ?? null,
        })
        .returning(),
    );
  }
}
