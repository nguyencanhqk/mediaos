import { Injectable } from "@nestjs/common";
import { and, count, desc, eq } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { notifications, type Notification } from "../db/schema/communication";
import type {
  NotificationType,
  NotificationPriority,
  NotificationTypeEnum,
} from "@mediaos/contracts";

/**
 * S4-NOTI-BE-2 (L1-repos) — input cho `createFromEngine`. `notificationType`/`priority` dùng enum
 * TitleCase MỚI (packages/contracts/src/notification.ts `notificationTypeEnumSchema`/
 * `notificationPrioritySchema`) — khớp `chk_notifications_notification_type`/`chk_notifications_priority`
 * (migration 0479), KHÔNG lẫn với `notificationTypeSchema` lowercase legacy (cột `type`).
 */
export interface CreateNotificationFromEngineInput {
  recipientUserId: string;
  eventId: string;
  eventCode: string;
  moduleCode: string;
  notificationType: NotificationTypeEnum;
  priority: NotificationPriority;
  title: string;
  /** Body đã render (dùng dual-write cho cả `body` legacy NOT NULL). */
  body: string;
  shortBody?: string | null;
  dedupeKey?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  sourceEntityCode?: string | null;
  targetModule?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetUrl?: string | null;
  payload?: Record<string, unknown>;
  createdBy?: string | null;
}

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

  /**
   * S4-NOTI-BE-2 (L1-repos) — ghi 1 notification cho 1 recipient TỪ ENGINE (`NotificationEngineService`,
   * L2). Nhận `tx: TenantTx` NGOÀI (KHÔNG tự mở `withTenant`) — caller kiểm soát transaction/SAVEPOINT
   * boundary (mỗi recipient bọc `SAVEPOINT sp_recipient` để bắt unique-violation dedupe mà KHÔNG rollback
   * cả luồng intake, xem dedupe.service).
   *
   * DUAL-WRITE bắt buộc — bỏ 1 trong 2 nhóm cột dưới đây làm hỏng dữ liệu ÂM THẦM (KHÔNG lỗi ở INSERT):
   *   • cột MỚI (DB-07 §7.3): recipient_user_id/event_id/event_code/notification_type/priority/
   *     status='Unread'/title/dedupe_key/source_entity_type|id|code/target_module|type|id|url/payload/
   *     module_code — THIẾU
   *     recipient_user_id/event_code/dedupe_key ⇒ partial-unique `uq_notifications_dedupe_active` coi
   *     NULL là DISTINCT (Postgres: NULL ≠ NULL trong unique index) ⇒ dedupe KHÔNG bao giờ conflict, lọt
   *     trùng lặp không tiếng động (silent-failure-hunter canh đúng lỗi này).
   *   • cột LEGACY NOT NULL (bảng `notifications` gốc, trước S4-NOTI-DB-1): user_id=recipient,
   *     body=rendered, type='general' (literal — cột `type` KHÔNG có DB CHECK nhưng giữ giá trị hợp lệ
   *     với `NotificationType` cũ), is_read=false — THIẾU 1 trong 4 cột này ⇒ INSERT FAIL (NOT NULL
   *     constraint, lỗi LOUD — an toàn hơn thiếu cột mới).
   */
  async createFromEngine(
    tx: TenantTx,
    companyId: string,
    data: CreateNotificationFromEngineInput,
  ): Promise<Notification> {
    const [row] = await tx
      .insert(notifications)
      .values({
        companyId,
        // ── legacy NOT NULL (consumer cũ chưa migrate đọc cột mới vẫn hoạt động) ──
        userId: data.recipientUserId,
        type: "general" as NotificationType,
        body: data.body,
        isRead: false,
        // ── cột MỚI (DB-07 §7.3, mig 0479) ──
        recipientUserId: data.recipientUserId,
        eventId: data.eventId,
        eventCode: data.eventCode,
        moduleCode: data.moduleCode,
        notificationType: data.notificationType,
        priority: data.priority,
        status: "Unread",
        title: data.title,
        shortBody: data.shortBody ?? null,
        dedupeKey: data.dedupeKey ?? null,
        sourceEntityType: data.sourceEntityType ?? null,
        sourceEntityId: data.sourceEntityId ?? null,
        sourceEntityCode: data.sourceEntityCode ?? null,
        targetModule: data.targetModule ?? null,
        targetType: data.targetType ?? null,
        targetId: data.targetId ?? null,
        targetUrl: data.targetUrl ?? null,
        payload: data.payload ?? {},
        createdBy: data.createdBy ?? null,
      })
      .returning();

    if (!row) {
      throw new Error("NotificationsRepository.createFromEngine: INSERT không trả về hàng nào");
    }
    return row;
  }
}
