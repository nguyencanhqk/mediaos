import { Injectable, Logger } from "@nestjs/common";
import type { InternalEventIntakeDto, NotificationRecipientMode } from "@mediaos/contracts";
import { EventBus, type EventContext } from "../events/event-bus";
import { NOTI_EVENT_CATALOG } from "../foundation/seed/notification-event-catalog.const";
import { NotificationEngineService } from "./notification-engine.service";

const UserIdsMode: NotificationRecipientMode = "UserIds";

/** eventCode ĐANG BẬT (is_enabled=true) trong catalog — nguồn sự thật DUY NHẤT cho boot-guard (S1-FND-MODULE
 *  pair-drift lesson: KHÔNG tự suy diễn danh sách riêng, luôn đối chiếu registry thật). */
const ENABLED_EVENT_CODES = new Set(
  NOTI_EVENT_CATALOG.filter((e) => e.isEnabled).map((e) => e.eventCode),
);

/** 1 khai báo nguồn phát (module khác) → NOTI. `resolveRecipients` trả user_id THÔ (có thể trùng/null-lẫn) —
 *  bridge tự `dedupe + filter(Boolean)`; KHÔNG tự lọc actor (engine actor-exclusion lo, tránh lặp logic). */
export interface NotiEventMapping {
  /** outbox `event_type` (vd "task.assigned") — khớp `eventType` truyền cho `OutboxService.enqueue`. */
  eventType: string;
  /** `event_code` canonical trong NOTI_EVENT_CATALOG (vd "TASK_ASSIGNED"). */
  eventCode: string;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityIdOf: (ctx: EventContext) => string | undefined;
  resolveRecipients: (ctx: EventContext) => Promise<string[]>;
  /** Mặc định `ctx.eventId` (once-ever theo outbox event, strategy 'DedupeKey' — notification-dedupe.const.ts). */
  dedupeKeyOf?: (ctx: EventContext) => string | undefined;
  /**
   * S4-INT-5 (additive, optional) — biến đổi payload outbox TRƯỚC khi đưa vào `NotificationEngine.intake()`.
   * MẶC ĐỊNH = `ctx.payload` (không khai ⇒ hành vi CŨ KHÔNG đổi — backward-compat TASK/LEAVE/ATT).
   *
   * LÝ DO CROWN: payload durable của producer có thể mang trường nhạy cảm mà `assertPayloadSafe` KHÔNG bắt
   * (SENSITIVE_PAYLOAD_KEYS so-khớp-CHÍNH-XÁC theo tên khóa) — vd `auth.password_reset_requested` mang
   * `resetTokenEnc` (envelope reset token). Nếu forward NGUYÊN payload thì token-envelope lọt vào
   * `notifications.payload` + body gửi cho recipient (vi phạm BẤT BIẾN #3). `payloadOf` cho phép mapping
   * WHITELIST đúng các khóa an toàn (strip mọi khóa còn lại) TRƯỚC khi chạm engine.
   */
  payloadOf?: (ctx: EventContext) => Record<string, unknown>;
}

/**
 * S4-INT-1 — OutboxNotificationBridge: lõi GENERIC nối 1 outbox event (TASK/PROJECT hôm nay, module khác về
 * sau — KHÔNG hard-code TASK ở lớp này) → `NotificationEngineService.intake()` IN-PROCESS, KHÔNG HTTP (mirror
 * comment `notifications.module.ts` "Export engine cho S4-INT-1 outbox consumer gọi intake() in-process" —
 * caller THỨ BA sau reminder job S4-NOTI-BE-3 + LEAVE→ATT sync S3-INT-1 cùng pattern OnModuleInit).
 *
 * FAIL-LOUD TẠI BOOT (`registerSource`): eventCode KHÔNG có trong `NOTI_EVENT_CATALOG` (is_enabled=true) →
 * NÉM NGAY khi module khởi động — chặn wire nhầm mã treo (vd `PROJECT_MEMBER_REMOVED`/`PROJECT_CLOSED`,
 * is_enabled=false) TRƯỚC KHI service chạy, KHÔNG chờ tới dead-letter runtime (chứng minh ở boot-guard test).
 *
 * Handler KHÔNG NUỐT LỖI: log rồi RE-THROW (mirror `attendance.module.ts` LeaveApprovedSyncRegistrar:70) —
 * OutboxWorker tự retry/dead-letter theo MAX_ATTEMPTS, không silent-fail.
 *
 * S10-QA-LOGNOISE-1 (2026-08-13) — TRUY GỐC nhiễu log "intake THẤT BẠI" khi chạy test (KI-015), ĐO chứ
 * không đoán: chạy 29 file `*noti*` int-spec (488 test, LANE_DB cô lập) + 1 lượt broader — nguồn DUY NHẤT
 * hôm nay là `test/integration/chat-noti-e2e.int-spec.ts` ca 14 (S7-CHAT-BE-6). Spec đó CỐ Ý gieo payload
 * `chat.message.direct_sent` thiếu `recipientUserId` để chứng minh bridge KHÔNG được im lặng nuốt hợp
 * đồng lệch (nếu im lặng thì một đổi tên khoá tương lai sẽ tắt TOÀN BỘ noti CHAT mà CI vẫn xanh, log vẫn
 * sạch — đúng nguyên văn comment của ca đó). 5 dòng ERROR quan sát được = `OutboxWorker.MAX_ATTEMPTS` (5)
 * lần retry của CÙNG MỘT event dồn vào <1s (test/helpers/outbox-drain.ts kéo `available_at` về `now()` để
 * không đợi backoff 30s thật) — KHÔNG PHẢI 5 lỗi khác nhau. Test đó ĐÃ tự khẳng định bằng assert
 * (dead_letter_events có 1 dòng + outbox_events.status != 'done') ⇒ đây là hành vi ĐÚNG-nhưng-ồn, KHÔNG
 * PHẢI lỗi — KHÔNG có gì để "vá" ở nhánh này ngoài việc ghi lại bằng chứng.
 *
 * Giả thuyết CŨ trong KI-015 (nhánh `no_recipient` → `recordSkip` → vỡ FK `audit_logs_actor_user_id_fkey`
 * vì outbox drain chạy SAU khi spec đã dọn user của mình) ĐÚNG tại thời điểm viết (2026-07-26) nhưng do
 * MỘT NGUYÊN NHÂN KHÁC, đã đóng: `outbox_events` là bảng CHUNG, `OutboxWorker.claim()` không lọc tenant,
 * 11 int-spec cùng lái worker trên 1 lane DB ⇒ worker của spec A có thể claim+xử lý event của spec B SAU
 * KHI B đã teardown (KI-059 / S7-QA-OUTBOXPROBE-1). Khoá tư vấn toàn cục
 * `test/helpers/outbox-worker-lock.ts` (2026-08-03) đã đóng đường đó — mọi spec lái worker giờ xếp hàng,
 * không còn xử lý CHÉO. Xác minh lại 2026-08-13: `outbox-worker-lock.unit-spec.ts` (điểm danh MỌI spec
 * gọi `processBatch`/`drainOutboxUntilSettled` phải giữ khoá) 2/2 PASS ⇒ không còn spec nào bỏ sót khoá,
 * đường FK-vỡ-chéo-spec không còn tái lập được hôm nay.
 *
 * KHÔNG hạ log level / bọc `catch {}` ở đây: bridge hỏng THẬT trên PROD phải kêu to giống hệt. Xem
 * `outbox-notification-bridge.service.spec.ts` cho ca chống-hồi-quy (mock `intake()` ném lỗi thật → vẫn
 * log + re-throw). Dập noise triệt để ở `chat-noti-e2e.int-spec.ts` ca 14 (spy `Logger.prototype.error`
 * TRONG chính ca đó để biến print thành assert) là việc CÒN NỢ — file đó ngoài phạm vi đường dẫn của WO
 * này. Theo dõi: `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` KI-015.
 */
@Injectable()
export class OutboxNotificationBridge {
  private readonly logger = new Logger(OutboxNotificationBridge.name);

  constructor(
    private readonly bus: EventBus,
    private readonly engine: NotificationEngineService,
  ) {}

  registerSource(mapping: NotiEventMapping): void {
    if (!ENABLED_EVENT_CODES.has(mapping.eventCode)) {
      throw new Error(
        `OutboxNotificationBridge.registerSource: eventCode '${mapping.eventCode}' KHÔNG có trong ` +
          `NOTI_EVENT_CATALOG (is_enabled=true) — chặn đăng ký TẠI BOOT (fail-loud, KHÔNG dead-letter runtime).`,
      );
    }
    this.bus.register({
      consumerName: `noti-bridge:${mapping.eventType}`,
      eventType: mapping.eventType,
      handle: (ctx) => this.handle(mapping, ctx),
    });
  }

  private async handle(mapping: NotiEventMapping, ctx: EventContext): Promise<void> {
    try {
      const payload = ctx.payload;
      const actorUserId = typeof payload.actorUserId === "string" ? payload.actorUserId : undefined;

      const rawRecipients = await mapping.resolveRecipients(ctx);
      const userIds = [...new Set(rawRecipients.filter((id): id is string => Boolean(id)))];

      // S4-INT-5: payload đưa vào engine = whitelist của mapping (nếu khai), else nguyên `ctx.payload`
      // (backward-compat). Strip khóa nhạy cảm KHÔNG-set-exact (vd resetTokenEnc) NGAY TẠI ĐÂY, TRƯỚC intake.
      const outPayload = mapping.payloadOf?.(ctx) ?? payload;

      const dto: InternalEventIntakeDto = {
        eventCode: mapping.eventCode,
        actorUserId,
        sourceModule: mapping.sourceModule,
        sourceEntityType: mapping.sourceEntityType,
        sourceEntityId: mapping.sourceEntityIdOf(ctx),
        dedupeKey: mapping.dedupeKeyOf?.(ctx) ?? ctx.eventId,
        recipient: { mode: UserIdsMode, userIds, employeeIds: [] },
        payload: outPayload,
      };

      await this.engine.intake(ctx.companyId, dto);
    } catch (err) {
      this.logger.error(
        `OutboxNotificationBridge[${mapping.eventType}] intake THẤT BẠI (event ${ctx.eventId}, ` +
          `company ${ctx.companyId}): ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err; // KHÔNG nuốt — OutboxWorker retry/dead-letter.
    }
  }
}
