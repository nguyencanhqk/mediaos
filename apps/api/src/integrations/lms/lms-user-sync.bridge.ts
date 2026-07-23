import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus, type EventContext } from "../../events/event-bus";
import { LmsHttpClient } from "./lms-http-client.service";
import { LMS_ACCOUNT_SYNC_EVENT, type LmsAccountSyncPayload } from "./lms-sync-producer.service";

const CONSUMER_NAME = `lms-sync:${LMS_ACCOUNT_SYNC_EVENT}`;

/**
 * S5-LMS-BE-1 — consumer EventBus đẩy đổi trạng thái tài khoản sang LMS. Đăng ký THẲNG lên EventBus
 * (KHÔNG qua OutboxNotificationBridge — cái đó boot-guard fail-loud theo NOTI catalog, LMS-sync không phải
 * notification). Outbox-worker gọi `handle` khi claim event; THROW → retry ×5 → dead-letter + alert.
 *
 * fail-soft ĐÚNG NGHĨA: tx HR/auth đã commit độc lập TRƯỚC (event nằm sẵn trong outbox); bridge chạy async.
 *   • Company gate (defense-in-depth): ctx.companyId ≠ LMS_COMPANY_ID → skip sạch (producer đã chặn tại
 *     nguồn; đây là lớp 2).
 *   • Thiếu env (auto-sync tắt) → skip KHÔNG throw (markProcessed done — tránh dead-letter oan khi CỐ Ý tắt);
 *     warn 1 lần.
 *   • LMS 5xx/timeout → LmsHttpClient THROW → bridge để lan (re-throw) ⇒ outbox-worker retry. CẤM catch rỗng.
 */
@Injectable()
export class LmsUserSyncBridge implements OnModuleInit {
  private readonly logger = new Logger(LmsUserSyncBridge.name);
  private readonly lmsCompanyId = process.env.LMS_COMPANY_ID ?? null;
  private warnedDisabled = false;

  constructor(
    private readonly bus: EventBus,
    private readonly http: LmsHttpClient,
  ) {}

  onModuleInit(): void {
    this.bus.register({
      consumerName: CONSUMER_NAME,
      eventType: LMS_ACCOUNT_SYNC_EVENT,
      handle: (ctx) => this.handle(ctx),
    });
  }

  private async handle(ctx: EventContext): Promise<void> {
    // Lớp 2 company-gate: producer đã chặn tại nguồn; nếu event chéo-tenant lọt tới đây thì bỏ qua sạch.
    if (!this.lmsCompanyId || ctx.companyId !== this.lmsCompanyId) return;

    if (!this.http.isEnabled()) {
      if (!this.warnedDisabled) {
        this.logger.warn(
          "LMS auto-sync đang TẮT (thiếu LMS_BASE_URL/LMS_SYNC_TOKEN) — bỏ qua event sync.",
        );
        this.warnedDisabled = true;
      }
      return; // KHÔNG throw ⇒ event đánh dấu done, không dead-letter oan (job đối soát là lưới)
    }

    const p = ctx.payload as LmsAccountSyncPayload;
    // THROW (từ syncUsers) lan ra ⇒ outbox-worker retry ×5 → dead-letter (fail-soft đúng nghĩa).
    await this.http.syncUsers([{ email: p.email, name: p.name, active: Boolean(p.active) }]);
  }
}
