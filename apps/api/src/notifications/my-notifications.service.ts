import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  MarkAllNotificationsReadRequest,
  MyNotificationDetail,
  MyNotificationDropdownResponse,
  MyNotificationListItem,
  MyNotificationListQuery,
  MyNotificationMarkAllReadResponse,
  MyNotificationMarkReadResponse,
  MyNotificationStatus,
  MyNotificationUnreadCountResponse,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import {
  MyNotificationsRepository,
  type MyNotificationListFilter,
} from "./my-notifications.repository";
import { effectiveStatus, toDetail, toDropdownItem, toListItem } from "./my-notifications.mapper";
import { NOTI_ERR } from "./my-notifications.errors";

export interface MyNotificationPage {
  data: MyNotificationListItem[];
  total: number;
}

const notFound = () =>
  new NotFoundException({ code: NOTI_ERR.NOT_FOUND, message: "Không tìm thấy thông báo" });

/**
 * MyNotificationsService — My-Notification API (SPEC-08 §17.1/17.2). Own-scope TUYỆT ĐỐI: mọi method nhận
 * companyId+userId từ req.user (JWT), KHÔNG bao giờ đọc data-scope Team/Company — thông báo LUÔN là dữ liệu
 * cá nhân (SPEC-08 §16.5.1 "User chỉ được xem notification của chính mình").
 */
@Injectable()
export class MyNotificationsService {
  private readonly logger = new Logger(MyNotificationsService.name);

  constructor(
    private readonly repo: MyNotificationsRepository,
    private readonly db: DatabaseService,
    private readonly emitter: RealtimeEmitterService,
  ) {}

  async list(
    companyId: string,
    userId: string,
    query: MyNotificationListQuery,
  ): Promise<MyNotificationPage> {
    const filter = this.toListFilter(query);
    const offset = (query.page - 1) * query.per_page;
    return this.db.withTenant(companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.repo.findManyTx(tx, companyId, userId, filter, query.per_page, offset),
        this.repo.countTx(tx, companyId, userId, filter),
      ]);
      return { data: rows.map(toListItem), total };
    });
  }

  async dropdown(
    companyId: string,
    userId: string,
    limit: number,
    unreadOnly: boolean,
  ): Promise<MyNotificationDropdownResponse> {
    return this.db.withTenant(companyId, async (tx) => {
      const [rows, stats] = await Promise.all([
        this.repo.findDropdownTx(tx, companyId, userId, limit, unreadOnly),
        this.repo.unreadStatsTx(tx, companyId, userId),
      ]);
      return { unread_count: stats.unread, items: rows.map(toDropdownItem) };
    });
  }

  async unreadCount(companyId: string, userId: string): Promise<MyNotificationUnreadCountResponse> {
    return this.db.withTenant(companyId, async (tx) => {
      const [stats, lastAt] = await Promise.all([
        this.repo.unreadStatsTx(tx, companyId, userId),
        this.repo.lastNotificationAtTx(tx, companyId, userId),
      ]);
      return {
        unread_count: stats.unread,
        high_priority_unread_count: stats.highPriorityUnread,
        urgent_unread_count: stats.urgentUnread,
        last_notification_at: lastAt ? lastAt.toISOString() : null,
      };
    });
  }

  async detail(
    companyId: string,
    userId: string,
    id: string,
    autoMarkRead: boolean,
  ): Promise<MyNotificationDetail> {
    const detail = await this.db.withTenant(companyId, async (tx) => {
      const row = await this.repo.findOneTx(tx, companyId, userId, id);
      if (!row) throw notFound();

      if (autoMarkRead && effectiveStatus(row) === "Unread") {
        const updated = await this.repo.markReadTx(tx, companyId, userId, id);
        return toDetail(updated ?? row);
      }
      return toDetail(row);
    });
    if (autoMarkRead) await this.emitAfterReadChange(companyId, userId);
    return detail;
  }

  /** NOTI-API-101 — idempotent (không throw nếu đã Read); chỉ notification CỦA CHÍNH user hiện tại. */
  async markRead(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<MyNotificationMarkReadResponse> {
    const updated = await this.db.withTenant(companyId, (tx) =>
      this.repo.markReadTx(tx, companyId, userId, id),
    );
    if (!updated) throw notFound();
    await this.emitAfterReadChange(companyId, userId);
    return {
      notification_id: updated.id,
      status: (updated.status as MyNotificationStatus | null) ?? "Read",
      read_at: updated.readAt ? updated.readAt.toISOString() : null,
    };
  }

  async markAllRead(
    companyId: string,
    userId: string,
    body: MarkAllNotificationsReadRequest,
  ): Promise<MyNotificationMarkAllReadResponse> {
    const readAt = new Date();
    const updatedCount = await this.db.withTenant(companyId, (tx) =>
      this.repo.markAllReadTx(tx, companyId, userId, {
        sourceModule: body.source_module ?? undefined,
        notificationType: body.notification_type ?? undefined,
        createdBefore: body.created_before ?? undefined,
      }),
    );
    const stats = await this.db.withTenant(companyId, (tx) =>
      this.repo.unreadStatsTx(tx, companyId, userId),
    );
    await this.emitAfterReadChange(companyId, userId, stats.unread);
    return {
      updated_count: updatedCount,
      unread_count: stats.unread,
      read_at: readAt.toISOString(),
    };
  }

  /** NOTI-API-106 — soft-delete (BẤT BIẾN #2), chỉ notification CỦA CHÍNH user hiện tại. */
  async remove(companyId: string, userId: string, id: string): Promise<void> {
    const deleted = await this.db.withTenant(companyId, (tx) =>
      this.repo.softDeleteTx(tx, companyId, userId, id),
    );
    if (!deleted) throw notFound();
    await this.emitAfterReadChange(companyId, userId);
  }

  private toListFilter(query: MyNotificationListQuery): MyNotificationListFilter {
    return {
      status: query.status,
      notificationType: query.notification_type,
      sourceModule: query.source_module,
      eventCode: query.event_code,
      priority: query.priority,
      createdFrom: query.created_from,
      createdTo: query.created_to,
      includeArchived: query.include_archived ?? false,
      includeHidden: query.include_hidden ?? false,
    };
  }

  /**
   * Best-effort realtime `notification:read` (unread_count mới) sau mark-read/mark-all-read/xoá mềm — để
   * DASH/header badge invalidate (chuẩn bị INT, chưa consume ở lane này). KHÔNG throw — realtime hỏng
   * không ảnh hưởng giao dịch nghiệp vụ đã commit (mirror NotificationsService.create).
   */
  private async emitAfterReadChange(
    companyId: string,
    userId: string,
    knownUnread?: number,
  ): Promise<void> {
    try {
      const unread =
        knownUnread ??
        (
          await this.db.withTenant(companyId, (tx) =>
            this.repo.unreadStatsTx(tx, companyId, userId),
          )
        ).unread;
      this.emitter.emitNotificationRead(companyId, userId, unread);
    } catch (err) {
      this.logger.warn("emitNotificationRead failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
