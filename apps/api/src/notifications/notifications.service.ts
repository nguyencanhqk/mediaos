import { Injectable, NotFoundException } from "@nestjs/common";
import type { NotificationType } from "@mediaos/contracts";
import { NotificationsRepository } from "./notifications.repository";

@Injectable()
export class NotificationsService {
  constructor(private readonly repo: NotificationsRepository) {}

  listForUser(companyId: string, userId: string, isRead?: boolean) {
    return this.repo.findByUser(companyId, userId, isRead);
  }

  async countUnread(companyId: string, userId: string) {
    const count = await this.repo.countUnread(companyId, userId);
    return { count };
  }

  async markRead(companyId: string, notificationId: string, userId: string) {
    const rows = await this.repo.markRead(companyId, notificationId, userId);
    if (rows.length === 0) throw new NotFoundException("Notification not found");
    return rows[0];
  }

  async markAllRead(companyId: string, userId: string) {
    await this.repo.markAllRead(companyId, userId);
  }

  async create(
    companyId: string,
    data: {
      userId: string;
      type: NotificationType;
      body: string;
      refId?: string | null;
      refType?: string | null;
    },
  ) {
    const rows = await this.repo.create(companyId, data);
    return rows[0];
  }
}
