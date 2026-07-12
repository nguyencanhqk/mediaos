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
