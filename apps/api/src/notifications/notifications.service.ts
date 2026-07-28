import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  notificationSchema,
  type NotificationDto,
  type NotificationType,
} from "@mediaos/contracts";
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

  /**
   * Mark-read + audit trong MỘT transaction (S6-SEC-NOTITX-1 · KI-034).
   *
   * Lịch sử: bản đầu KHÔNG `await` promise audit (đua với `return`); vá 2026-07-27 thêm `await`
   * nhưng vẫn để audit ở transaction THỨ HAI với `.catch` → `warn`, nên update commit rồi mà audit
   * fail thì vết kiểm toán mất trong im lặng.
   *
   * QUYẾT ĐỊNH (done_when #5, lý do đầy đủ ở docs/plans/S6-SEC-NOTITX-1.md §5): **gộp tx**, KHÔNG
   * giữ best-effort. `mark_read` đang được audit ⇒ đã coi là hành động đáng ghi (SPEC-01 §16.3); đã
   * đáng ghi thì hoặc ghi được, hoặc thao tác không xảy ra — không có cửa "thành công nhưng mất vết".
   * Đối trọng "audit hỏng không nên làm hỏng thao tác người dùng" đúng với route đang chạy thật,
   * nhưng method này KHÔNG có caller production (4 route đọc/mark đã sang MyNotificationsController)
   * nên giá của lựa chọn chặt hơn = 0, còn giá của việc để lại một `.catch` nuốt audit trong chính
   * file vừa vá vì nuốt audit là KI-034 mở lại ở lần gate sau.
   *
   * ⚠️ MẶT TRÁI của việc gộp — đọc trước khi thêm audit vào đây: audit ghi TRONG tx này sẽ bị chính
   * exception mà nó ghi lại CUỐN THEO khi rollback. Nên audit của nhánh **THẤT BẠI / DENIED** (vd
   * `resultStatus:'Denied'` cho 0 hàng — dấu vết dò IDOR/chéo tenant) **KHÔNG được đặt trong tx
   * này**, phải ghi ở `withTenant` RIÊNG đã commit. Đây là bẫy có tiền lệ trong repo, không phải
   * giả định: `test/integration/me-personal-hub.int-spec.ts:476-482` (audit anomaly từng bị rollback
   * theo 409, phải tách tx riêng mới sống — defect `fix-me-be1-audit-persist`).
   */
  async markRead(
    companyId: string,
    notificationId: string,
    userId: string,
  ): Promise<NotificationDto> {
    return this.db.withTenant(companyId, async (tx) => {
      const rows = await this.repo.markRead(companyId, notificationId, userId, tx);
      if (rows.length === 0) throw new NotFoundException("Notification not found");

      await this.audit.record(tx, {
        action: "mark_read",
        objectType: "notification",
        objectId: notificationId,
        actorUserId: userId,
      });

      return toDto(rows[0]);
    });
  }

  async markAllRead(companyId: string, userId: string): Promise<void> {
    await this.repo.markAllRead(companyId, userId);
  }

  /**
   * Tạo notification (S6-SEC-NOTITX-1 · KI-034 — ĐÃ gộp transaction):
   *   1. Preference check — type bị tắt → trả `null` (không tạo). NGOÀI tx: đọc thuần, mở tx sớm chỉ
   *      giữ connection lâu hơn.
   *   2. MỘT `withTenant` bọc CẢ BA: insert notification → outbox.enqueue → audit.record.
   *      Bất kỳ bước nào ném ⇒ rollback cả ba ⇒ KHÔNG có hàng notification mồ côi (không vết kiểm
   *      toán, không sự kiện). Lỗi được NÉM RA cho caller, KHÔNG nuốt thành `warn`.
   *   3. Sau khi tx commit → emit WS best-effort qua DTO đã mask (ngoài tx, để không phát cho hàng
   *      có thể bị rollback — cùng khuôn với NotificationEngineService.intake).
   *
   * `null` CHỈ có MỘT nghĩa: **bị preference lọc**. Mọi hỏng hóc khác (insert không trả hàng, outbox
   * hoặc audit fail) đều ném — caller không cần đoán `null` nghĩa là "bình thường" hay "DB hỏng".
   *
   * ⚠️ KHÔNG gọi method này từ BÊN TRONG một transaction khác: `withTenant` mở connection +
   * transaction MỚI (không phải SAVEPOINT trên tx đang có) ⇒ hai tx tranh khoá trên cùng hàng =
   * deadlock, và với PgBouncer transaction-mode còn có thể cạn pool. Caller đã có `tx` thì dùng
   * `NotificationEngineService.intake()` (đường chuẩn của NOTI, đã atomic sẵn) hoặc
   * `NotificationsRepository.createFromEngine(tx, …)`.
   *
   * ⚠️ Cùng ràng buộc audit-nhánh-thất-bại như `markRead` ở trên: audit của nhánh THẤT BẠI/DENIED
   * phải ghi ở tx RIÊNG đã commit, KHÔNG đặt trong tx của hàm này (nó sẽ bị rollback cuốn đi).
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

    // 2. MỘT transaction cho insert + outbox + audit. Payload outbox PHẢI qua mask (không gửi raw
    //    row — CLAUDE.md §5).
    const dto = await this.db.withTenant(companyId, async (tx) => {
      const rows = await this.repo.create(companyId, data, tx);
      const row = rows[0];
      if (!row) {
        // `INSERT … RETURNING` không trả hàng = DB/RLS từ chối im lặng, KHÔNG phải trạng thái
        // nghiệp vụ hợp lệ. Trước đây nhánh này `logger.error` rồi trả `null` — trộn lẫn với nhánh
        // "bị preference lọc" ở trên, nên caller không phân biệt được hỏng hóc S1 với việc bình
        // thường. Ném để rollback và fail LOUD.
        throw new Error(
          `NotificationsRepository.create: INSERT không trả về hàng nào (company ${companyId}, ` +
            `user ${data.userId}, type ${data.type})`,
        );
      }

      const created = toDto(row);
      await this.outbox.enqueue(tx, {
        eventType: "notification.created",
        payload: {
          notificationId: created.id,
          companyId: created.companyId,
          userId: created.userId,
          type: created.type,
          body: created.body,
          refId: created.refId ?? null,
          refType: created.refType ?? null,
        },
      });
      await this.audit.record(tx, {
        action: "create",
        objectType: "notification",
        objectId: created.id,
        actorUserId: data.actorUserId ?? undefined,
        after: {
          userId: created.userId,
          type: created.type,
          body: created.body,
        },
      });
      return created;
    });

    // 3. WS emit best-effort SAU COMMIT (KHÔNG throw — realtime hỏng không ảnh hưởng business; và
    //    không bao giờ phát cho hàng đã rollback vì tx ở bước 2 đã commit xong tới đây).
    this.emitter.emitNotification(companyId, data.userId, dto);

    return dto;
  }
}
