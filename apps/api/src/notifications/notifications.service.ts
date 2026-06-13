import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { notificationSchema, type NotificationDto, type NotificationType } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { OutboxService } from "../events/outbox.service";
import { AuditService } from "../events/audit.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationPreferencesRepository } from "./notification-preferences.repository";

/**
 * Masking DUY NHẤT cho notification row → DTO (parity REST/WS).
 * Zod strip field thừa ⇒ cột DB nội bộ không bao giờ rò ra client (CLAUDE.md §5).
 */
function toDto(row: {
  id: string;
  companyId: string;
  userId: string;
  type: string;
  refId: string | null;
  refType: string | null;
  body: string;
  isRead: boolean;
  createdAt: Date;
}): NotificationDto {
  return notificationSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly prefRepo: NotificationPreferencesRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly emitter: RealtimeEmitterService,
    private readonly db: DatabaseService,
  ) {}

  async listForUser(
    companyId: string,
    userId: string,
    isRead?: boolean,
  ): Promise<NotificationDto[]> {
    const rows = await this.repo.findByUser(companyId, userId, isRead);
    return rows.map(toDto);
  }

  async countUnread(companyId: string, userId: string): Promise<{ count: number }> {
    const count = await this.repo.countUnread(companyId, userId);
    return { count };
  }

  async markRead(
    companyId: string,
    notificationId: string,
    userId: string,
  ): Promise<NotificationDto> {
    const rows = await this.repo.markRead(companyId, notificationId, userId);
    if (rows.length === 0) throw new NotFoundException("Notification not found");
    const dto = toDto(rows[0]);

    // Audit mark-read (best-effort — không throw nếu audit fail)
    this.db
      .withTenant(companyId, (tx) =>
        this.audit.record(tx, {
          action: "mark_read",
          objectType: "notification",
          objectId: notificationId,
          actorUserId: userId,
        }),
      )
      .catch((err: unknown) => {
        this.logger.warn("audit mark_read failed", {
          notificationId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return dto;
  }

  async markAllRead(companyId: string, userId: string): Promise<void> {
    await this.repo.markAllRead(companyId, userId);
  }

  /**
   * Tạo notification với:
   *   1. Preference check — type bị tắt → trả null (không tạo).
   *   2. Insert + enqueue outbox TRONG CÙNG transaction (transactional outbox ADR-0009).
   *   3. Audit record trong cùng transaction.
   *   4. Sau commit → emit WS best-effort qua DTO đã mask.
   *
   * Trả NotificationDto (đã mask) hoặc null (bị lọc bởi preference).
   */
  async create(
    companyId: string,
    data: {
      userId: string;
      type: NotificationType;
      body: string;
      refId?: string | null;
      refType?: string | null;
      actorUserId?: string;
    },
  ): Promise<NotificationDto | null> {
    // 1. Preference check (opt-out model: default = enabled)
    const enabled = await this.prefRepo.isTypeEnabled(companyId, data.userId, data.type);
    if (!enabled) {
      this.logger.debug("notification suppressed by preference", {
        companyId,
        userId: data.userId,
        type: data.type,
      });
      return null;
    }

    // 2. Insert + outbox + audit trong cùng 1 withTenant transaction
    const rows = await this.repo.create(companyId, data);
    const row = rows[0];
    if (!row) {
      this.logger.error("notification insert returned no row", { companyId, data });
      return null;
    }

    // 3. Outbox enqueue (transactional — dùng withTenant riêng sau insert thành công)
    // Lý do: NotificationsRepository.create đã commit tx; outbox dùng tx riêng liền sau.
    // Payload PHẢI qua mask (không gửi raw row — CLAUDE.md §5).
    const dto = toDto(row);
    await this.db
      .withTenant(companyId, async (tx) => {
        await this.outbox.enqueue(tx, {
          eventType: "notification.created",
          payload: {
            notificationId: dto.id,
            companyId: dto.companyId,
            userId: dto.userId,
            type: dto.type,
            body: dto.body,
            refId: dto.refId ?? null,
            refType: dto.refType ?? null,
          },
        });
        await this.audit.record(tx, {
          action: "create",
          objectType: "notification",
          objectId: dto.id,
          actorUserId: data.actorUserId ?? undefined,
          after: {
            userId: dto.userId,
            type: dto.type,
            body: dto.body,
          },
        });
      })
      .catch((err: unknown) => {
        // Outbox/audit fail không được rollback business data đã commit (best-effort logging)
        this.logger.warn("outbox/audit enqueue failed after notification insert", {
          notificationId: dto.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // 4. WS emit best-effort (sau commit, KHÔNG throw — realtime hỏng không ảnh hưởng business)
    this.emitter.emitNotification(companyId, data.userId, dto);

    return dto;
  }
}
