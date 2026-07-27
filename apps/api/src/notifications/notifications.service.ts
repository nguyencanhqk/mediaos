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

    // Audit mark-read (best-effort — không throw nếu audit fail).
    // S6-SEC-1 · KI-034: trước đây promise này KHÔNG được await ⇒ `return dto` ở cuối hàm CHẠY ĐUA với
    // nó. Nếu request kết thúc/process xoay vòng trước khi promise settle thì audit mất mà không ai
    // biết — kể cả dòng warn trong .catch cũng có thể không kịp chạy. Await để thất bại (nếu có) LUÔN
    // được ghi lại. Vẫn KHÔNG throw: mark-read hỏng audit không được làm hỏng thao tác của người dùng.
    await this.db
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
   *   2. Insert notification (repository tự mở + COMMIT transaction của nó).
   *   3. Outbox + audit trong MỘT transaction RIÊNG, chạy ngay sau — thất bại chỉ log warn.
   *   4. Sau commit → emit WS best-effort qua DTO đã mask.
   *
   * ⚠️ NỢ ĐÃ BIẾT (S6-SEC-1 · KI-034) — docstring này TRƯỚC ĐÂY ghi "insert + outbox TRONG CÙNG
   * transaction" và "audit record trong cùng transaction". **Cả hai đều SAI** so với code bên dưới:
   * `repo.create()` commit tx của chính nó rồi mới mở tx thứ hai cho outbox + audit, và tx thứ hai bị
   * `.catch()` nuốt. Hệ quả: notification tồn tại nhưng **audit + sự kiện outbox có thể biến mất chỉ
   * với một dòng warn** — tức mất cả vết kiểm toán lẫn thông báo, im lặng với người dùng.
   * Sửa đúng = cho `repo.create()` nhận `tx` để gộp cả ba vào một transaction. Đó là refactor chạm
   * đường nóng mà MỌI module đều gọi ⇒ tách WO riêng có RED test, KHÔNG vá kèm ở đây.
   * Đổi docstring cho khớp sự thật trước, để người đọc sau không tin nhầm là đã atomic.
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

    // 2. Insert notification — repository tự mở và COMMIT transaction của nó (xem NỢ ở docstring:
    //    đây KHÔNG cùng transaction với outbox/audit ở bước 3, dù comment cũ ở đây từng nói vậy).
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
