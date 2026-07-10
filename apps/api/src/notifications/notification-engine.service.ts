import { Injectable } from "@nestjs/common";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  intakeSummarySchema,
  notificationSchema,
  type InternalEventIntakeDto,
  type IntakeSummary,
  type NotificationDto,
  type NotificationPriority,
  type NotificationTypeEnum,
} from "@mediaos/contracts";
import { isUniqueViolation } from "../common/db-error";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { notificationEvents, type NotificationEvent } from "../db/schema/noti";
import { type Notification } from "../db/schema/communication";
import { AuditService } from "../events/audit.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationEventRepository } from "./notification-event.repository";
import { NotificationTemplateRepository } from "./notification-template.repository";
import { NotificationDeliveryLogRepository } from "./notification-delivery-log.repository";
import { NotificationRecipientResolverService } from "./notification-recipient-resolver.service";
import { NotificationRendererService } from "./notification-renderer.service";
import { NotificationDedupeService } from "./notification-dedupe.service";
import {
  assertInternalTargetUrl,
  assertPayloadSafe,
  EventNotFoundError,
} from "./notification-engine.errors";

const CHANNEL_IN_APP = "IN_APP";
const DEFAULT_LOCALE = "vi-VN";
const MODULE_CODE_NOTI = "NOTI";

/**
 * S4-NOTI-BE-2 (L2-engine) — NotificationEngineService.intake: biến 1 event nghiệp vụ đã chuẩn hoá thành
 * notifications IN_APP + notification_delivery_logs qua pipeline
 *   catalog → recipient resolver (actor-exclusion) → dedupe → template render (fallback) → persist.
 *
 * FIRE-AND-FORGET: event disabled / 0 recipient / dedupe hit KHÔNG ném lỗi — trả `200 + summary`
 * (skippedCount/dedupedCount). Chỉ 3 nhánh LOUD: eventCode không tồn tại (404), target_url ngoài (422),
 * payload nhạy cảm (400). Xem docs/plans/S4-NOTI-BE-2.md §6.
 *
 * company_id đến TỪ CALLER (controller lấy `req.user.companyId`, KHÔNG từ body — plan §3). Mọi query đi qua
 * `withTenant(companyId)` (BẤT BIẾN #1); RLS FORCE ẩn recipient cross-tenant = 0 row.
 */
@Injectable()
export class NotificationEngineService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventRepo: NotificationEventRepository,
    private readonly templateRepo: NotificationTemplateRepository,
    private readonly deliveryLogRepo: NotificationDeliveryLogRepository,
    private readonly notificationsRepo: NotificationsRepository,
    private readonly resolver: NotificationRecipientResolverService,
    private readonly renderer: NotificationRendererService,
    private readonly dedupe: NotificationDedupeService,
    private readonly audit: AuditService,
    private readonly emitter: RealtimeEmitterService,
  ) {}

  async intake(companyId: string, event: InternalEventIntakeDto): Promise<IntakeSummary> {
    // (1) Guard input TRƯỚC khi mở tx (pure): payload nhạy cảm → 400 loud. target_url validate sau render.
    assertPayloadSafe(event.payload);

    const occurredAtMs = this.resolveOccurredAtMs(event.occurredAt);
    // WS emit gom trong tx, CHỈ phát SAU commit (ngoài withTenant) — tránh phát cho notification bị rollback.
    const emitQueue: Array<{ userId: string; dto: NotificationDto }> = [];

    const summary = await this.db.withTenant(companyId, async (tx) => {
      // (2) Catalog — enabled? tồn tại?
      const ev = await this.eventRepo.findEnabledEvent(tx, companyId, event.eventCode);
      if (!ev) {
        const exists = await this.probeEventExists(tx, companyId, event.eventCode);
        if (!exists) throw new EventNotFoundError(event.eventCode); // 404 loud
        // Disabled: skip toàn bộ, audit, KHÔNG delivery_log (FK notification_id NOT NULL) — plan §6.3.
        await this.recordSkip(tx, event, "event_disabled");
        return { createdCount: 0, skippedCount: 1, dedupedCount: 0 };
      }

      // (3) Recipients — active + cùng company (RLS ẩn cross-tenant) + actor-exclusion.
      const { recipients, droppedCount } = await this.resolver.resolve(tx, companyId, ev, event);
      if (recipients.length === 0) {
        await this.recordSkip(tx, event, "no_recipient");
        return { createdCount: 0, skippedCount: Math.max(droppedCount, 1), dedupedCount: 0 };
      }

      // (4) Template render MỘT LẦN (event-level — payload/template không đổi theo recipient). Thiếu → fallback.
      const template = await this.templateRepo.findActiveTemplate(
        tx,
        companyId,
        ev.id,
        CHANNEL_IN_APP,
        DEFAULT_LOCALE,
      );
      const rendered = this.renderer.render(ev, template, event.payload);
      if (rendered.targetUrl) assertInternalTargetUrl(rendered.targetUrl); // 422 loud (KHÔNG strip im lặng)

      const dedupeCfg = this.dedupe.resolveStrategy(ev);
      let createdCount = 0;
      let dedupedCount = 0;

      for (const recipientUserId of recipients) {
        const dedupeKey = this.dedupe.computeKey({
          strategy: dedupeCfg.strategy,
          windowSeconds: dedupeCfg.windowSeconds,
          eventCode: ev.eventCode,
          recipientUserId,
          sourceEntityId: event.sourceEntityId ?? null,
          dedupeKey: event.dedupeKey ?? null,
          occurredAtMs,
        });

        // Tầng 1 (app): trùng còn hiệu lực → deduped, không cần savepoint.
        if (
          dedupeKey &&
          (await this.dedupe.isDuplicate(tx, companyId, {
            recipientUserId,
            eventCode: ev.eventCode,
            dedupeKey,
          }))
        ) {
          dedupedCount++;
          continue;
        }

        // Tầng 2 (DB, chống race): SAVEPOINT mỗi recipient. 23505 → ROLLBACK TO → deduped, tx NGOÀI sống,
        // recipient còn lại VẪN được tạo, KHÔNG 500 (plan §6.2 — Postgres abort cả tx khi unique-violation).
        await tx.execute(sql`savepoint sp_recipient`);
        try {
          const notif = await this.persistRecipient(
            tx,
            companyId,
            ev,
            event,
            rendered,
            recipientUserId,
            dedupeKey,
          );
          await tx.execute(sql`release savepoint sp_recipient`);
          createdCount++;
          emitQueue.push({ userId: recipientUserId, dto: this.toLegacyDto(notif) });
        } catch (err) {
          await tx.execute(sql`rollback to savepoint sp_recipient`);
          await tx.execute(sql`release savepoint sp_recipient`);
          if (isUniqueViolation(err)) {
            dedupedCount++;
            continue;
          }
          throw err; // lỗi khác dedupe → abort intake (outer tx rollback), fail LOUD (không nuốt).
        }
      }

      return { createdCount, skippedCount: droppedCount, dedupedCount };
    });

    // (5) WS emit SAU COMMIT, ngoài withTenant, best-effort qua DTO đã mask (emitter NO-OP nếu server null).
    for (const item of emitQueue) {
      this.emitter.emitNotification(companyId, item.userId, item.dto);
    }

    return intakeSummarySchema.parse(summary);
  }

  /**
   * Ghi 1 notification + 1 delivery_log terminal 'Sent' + 1 audit cho 1 recipient. Chạy TRONG SAVEPOINT của
   * caller — INSERT createFromEngine có thể ném 23505 (backstop dedupe) để caller ROLLBACK TO.
   */
  private async persistRecipient(
    tx: TenantTx,
    companyId: string,
    ev: NotificationEvent,
    event: InternalEventIntakeDto,
    rendered: {
      title: string;
      body: string;
      shortBody: string | null;
      targetUrl: string | null;
      fallback: boolean;
    },
    recipientUserId: string,
    dedupeKey: string | null,
  ): Promise<Notification> {
    const priority = (event.priorityOverride ?? ev.defaultPriority) as NotificationPriority;

    const notif = await this.notificationsRepo.createFromEngine(tx, companyId, {
      recipientUserId,
      eventId: ev.id,
      eventCode: ev.eventCode,
      moduleCode: ev.moduleCode,
      notificationType: ev.notificationType as NotificationTypeEnum,
      priority,
      title: rendered.title,
      body: rendered.body,
      shortBody: rendered.shortBody,
      dedupeKey,
      sourceEntityType: event.sourceEntityType ?? null,
      sourceEntityId: event.sourceEntityId ?? null,
      targetUrl: rendered.targetUrl,
      payload: event.payload,
      createdBy: event.actorUserId ?? null,
    });

    // INSERT-terminal (append-only #2): 'Sent' attempt_no=1. Fallback → metadata.reason non-silent (loud).
    await this.deliveryLogRepo.insertLog(tx, companyId, {
      notificationId: notif.id,
      recipientUserId,
      channel: CHANNEL_IN_APP,
      deliveryStatus: "Sent",
      attemptNo: 1,
      metadata: rendered.fallback ? { reason: "template_fallback", eventCode: ev.eventCode } : null,
    });

    // Audit hành động quan trọng (SPEC-01 §16.3). after = metadata KHÔNG chứa body/PII (BẤT BIẾN #3).
    await this.audit.record(tx, {
      action: "notification_created",
      objectType: "notification",
      objectId: notif.id,
      actorUserId: event.actorUserId ?? undefined,
      moduleCode: MODULE_CODE_NOTI,
      after: {
        recipientUserId,
        eventCode: ev.eventCode,
        notificationType: ev.notificationType,
        priority,
        fallback: rendered.fallback,
      },
    });

    return notif;
  }

  /**
   * Audit skip mức-event (disabled / no_recipient) — objectType='notification', objectId UNDEFINED (skip
   * không gắn 1 notification cụ thể). AuditService.record chấp nhận `objectId?: string` undefined
   * (audit.service.ts:22) ⇒ không vỡ CHECK/NOT NULL. KHÔNG ghi delivery_log (FK notification_id NOT NULL).
   */
  private async recordSkip(
    tx: TenantTx,
    event: InternalEventIntakeDto,
    reason: string,
  ): Promise<void> {
    await this.audit.record(tx, {
      action: "notification_skipped",
      objectType: "notification",
      actorUserId: event.actorUserId ?? undefined,
      moduleCode: MODULE_CODE_NOTI,
      metadata: { reason, eventCode: event.eventCode, sourceModule: event.sourceModule },
    });
  }

  /**
   * Phân biệt "event KHÔNG tồn tại" (→404) với "event tồn tại nhưng disabled" (→skip 200). L1
   * `findEnabledEvent` gộp cả hai thành `undefined` (chỉ trả hàng khi is_enabled) nên khi undefined ta probe
   * sự tồn tại BẤT KỂ is_enabled — cùng visibility (company-override OR global, chưa xoá) + company_id tường
   * minh (defense-in-depth, BẤT BIẾN #1) + RLS trong tx.
   */
  private async probeEventExists(
    tx: TenantTx,
    companyId: string,
    eventCode: string,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.eventCode, eventCode),
          isNull(notificationEvents.deletedAt),
          or(eq(notificationEvents.companyId, companyId), isNull(notificationEvents.companyId)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private resolveOccurredAtMs(occurredAt: string | undefined): number {
    if (!occurredAt) return Date.now();
    const parsed = Date.parse(occurredAt);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

  /**
   * Map notification row → legacy NotificationDto để emit WS (parity REST). `notificationSchema.parse` strip
   * cột nội bộ (cột mới/PII không lọt qua kênh phụ) — CẤM emit raw row (BẤT BIẾN §5). createFromEngine dual-
   * write nên userId/type/body/isRead legacy luôn có.
   */
  private toLegacyDto(notif: Notification): NotificationDto {
    return notificationSchema.parse({
      id: notif.id,
      companyId: notif.companyId,
      userId: notif.userId,
      type: notif.type,
      refId: notif.refId,
      refType: notif.refType,
      body: notif.body,
      isRead: notif.isRead,
      createdAt: notif.createdAt.toISOString(),
    });
  }
}
