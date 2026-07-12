import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { DatabaseService } from "../db/db.service";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import {
  AttApprovalAudienceReader,
  type RemoteRequestAudience,
} from "./att-approval-audience.reader";

const SOURCE_MODULE_ATT = "ATT";
const SOURCE_ENTITY_ADJUSTMENT = "attendance_adjustment_request";
const SOURCE_ENTITY_REMOTE = "remote_work_request";

const EMPTY_REMOTE_AUDIENCE: RemoteRequestAudience = {
  requestedBy: null,
  currentApproverUserId: null,
  watcherUserIds: [],
};

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function strArrayField(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
}

/**
 * S4-INT-4 — AttNotiBridgeRegistrar: đăng ký 7 mapping ATT (đơn điều chỉnh công + đơn remote-work) → NOTI
 * (SPEC-04 §15 luồng duyệt, §9.4 recipient) lên `OutboxNotificationBridge` (INT-1 GENERIC core — TÁI DÙNG,
 * KHÔNG bridge/consumer mới) TẠI BOOT (OnModuleInit, mirror `TaskNotiBridgeRegistrar`). Import CHỈ
 * `notifications/**` + `db/**` — KHÔNG import `AttendanceModule` (giữ acyclic; đọc thẳng bảng qua reader
 * raw-SQL, mirror INT-1 `TaskReminderJobHandler`).
 *
 * eventType → eventCode VERBATIM (notification-event-catalog.const.ts:72-79):
 *   attendance.adjustment_requested        → ATT_ADJUSTMENT_SUBMITTED
 *   attendance.adjustment_approved         → ATT_ADJUSTMENT_APPROVED
 *   attendance.adjustment_rejected         → ATT_ADJUSTMENT_REJECTED
 *   attendance.remote_request_submitted    → ATT_REMOTE_REQUEST_SUBMITTED
 *   attendance.remote_request_approved     → ATT_REMOTE_REQUEST_APPROVED
 *   attendance.remote_request_rejected     → ATT_REMOTE_REQUEST_REJECTED
 *   attendance.remote_request_cancelled    → ATT_REMOTE_REQUEST_CANCELLED
 *
 * Recipient (§9.4) — bridge KHÔNG loại actor (engine `NotificationRecipientResolverService` tự loại
 * `actorUserId` + filter active/same-company; KHÔNG lặp logic 2 nơi):
 *   ATT_ADJUSTMENT_SUBMITTED     = approver = direct manager của subject (reader.resolveAdjustment).
 *   ATT_ADJUSTMENT_APPROVED      = requester = payload.userId (subject).
 *   ATT_ADJUSTMENT_REJECTED      = requester = payload.userId (subject).
 *   ATT_REMOTE_REQUEST_SUBMITTED = currentApproverUserId ∪ watcherUserIds (payload — producer đã resolve).
 *   ATT_REMOTE_REQUEST_APPROVED  = requester = requestedBy (reader.resolveRemote).
 *   ATT_REMOTE_REQUEST_REJECTED  = requester = requestedBy (reader.resolveRemote).
 *   ATT_REMOTE_REQUEST_CANCELLED = approver ∪ watchers (reader.resolveRemote).
 *
 * dedupeKey mặc định = ctx.eventId (once-ever theo outbox event — notification-dedupe.const.ts strategy
 * 'DedupeKey'). Payload hỏng (thiếu requestId) ⇒ recipient rỗng, KHÔNG throw (fail-soft đọc; engine
 * Skipped). Handler bridge RE-THROW lỗi intake ⇒ OutboxWorker retry/dead-letter (KHÔNG nuốt lỗi).
 */
@Injectable()
export class AttNotiBridgeRegistrar implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly reader: AttApprovalAudienceReader,
    private readonly bridge: OutboxNotificationBridge,
  ) {}

  onModuleInit(): void {
    this.registerAdjustmentSubmitted();
    this.registerAdjustmentApproved();
    this.registerAdjustmentRejected();
    this.registerRemoteSubmitted();
    this.registerRemoteApproved();
    this.registerRemoteRejected();
    this.registerRemoteCancelled();
  }

  /** Audience đơn remote-work HIỆN TẠI (payload `requestId`) — mở tx đọc RIÊNG. Thiếu requestId ⇒ rỗng. */
  private async remoteAudienceOf(ctx: EventContext): Promise<RemoteRequestAudience> {
    const requestId = strField(ctx.payload, "requestId");
    if (!requestId) return EMPTY_REMOTE_AUDIENCE;
    return this.db.withTenant(ctx.companyId, (tx) =>
      this.reader.resolveRemote(tx, ctx.companyId, requestId),
    );
  }

  // ─── Adjustment (đơn điều chỉnh công) ────────────────────────────────────────────

  private registerAdjustmentSubmitted(): void {
    this.bridge.registerSource({
      eventType: "attendance.adjustment_requested",
      eventCode: "ATT_ADJUSTMENT_SUBMITTED",
      sourceModule: SOURCE_MODULE_ATT,
      sourceEntityType: SOURCE_ENTITY_ADJUSTMENT,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: async (ctx) => {
        const requestId = strField(ctx.payload, "requestId");
        if (!requestId) return [];
        const managerUserId = await this.db.withTenant(ctx.companyId, (tx) =>
          this.reader.resolveAdjustment(tx, ctx.companyId, requestId),
        );
        return managerUserId ? [managerUserId] : [];
      },
    });
  }

  private registerAdjustmentApproved(): void {
    this.bridge.registerSource({
      eventType: "attendance.adjustment_approved",
      eventCode: "ATT_ADJUSTMENT_APPROVED",
      sourceModule: SOURCE_MODULE_ATT,
      sourceEntityType: SOURCE_ENTITY_ADJUSTMENT,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: (ctx) => {
        const userId = strField(ctx.payload, "userId");
        return Promise.resolve(userId ? [userId] : []);
      },
    });
  }

  private registerAdjustmentRejected(): void {
    this.bridge.registerSource({
      eventType: "attendance.adjustment_rejected",
      eventCode: "ATT_ADJUSTMENT_REJECTED",
      sourceModule: SOURCE_MODULE_ATT,
      sourceEntityType: SOURCE_ENTITY_ADJUSTMENT,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: (ctx) => {
        const userId = strField(ctx.payload, "userId");
        return Promise.resolve(userId ? [userId] : []);
      },
    });
  }

  // ─── Remote-work request ─────────────────────────────────────────────────────────

  private registerRemoteSubmitted(): void {
    this.bridge.registerSource({
      eventType: "attendance.remote_request_submitted",
      eventCode: "ATT_REMOTE_REQUEST_SUBMITTED",
      sourceModule: SOURCE_MODULE_ATT,
      sourceEntityType: SOURCE_ENTITY_REMOTE,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: (ctx) => {
        const approver = strField(ctx.payload, "currentApproverUserId");
        const watchers = strArrayField(ctx.payload, "watcherUserIds");
        return Promise.resolve([approver, ...watchers].filter((x): x is string => Boolean(x)));
      },
    });
  }

  private registerRemoteApproved(): void {
    this.bridge.registerSource({
      eventType: "attendance.remote_request_approved",
      eventCode: "ATT_REMOTE_REQUEST_APPROVED",
      sourceModule: SOURCE_MODULE_ATT,
      sourceEntityType: SOURCE_ENTITY_REMOTE,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: async (ctx) => {
        const a = await this.remoteAudienceOf(ctx);
        return a.requestedBy ? [a.requestedBy] : [];
      },
    });
  }

  private registerRemoteRejected(): void {
    this.bridge.registerSource({
      eventType: "attendance.remote_request_rejected",
      eventCode: "ATT_REMOTE_REQUEST_REJECTED",
      sourceModule: SOURCE_MODULE_ATT,
      sourceEntityType: SOURCE_ENTITY_REMOTE,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: async (ctx) => {
        const a = await this.remoteAudienceOf(ctx);
        return a.requestedBy ? [a.requestedBy] : [];
      },
    });
  }

  private registerRemoteCancelled(): void {
    this.bridge.registerSource({
      eventType: "attendance.remote_request_cancelled",
      eventCode: "ATT_REMOTE_REQUEST_CANCELLED",
      sourceModule: SOURCE_MODULE_ATT,
      sourceEntityType: SOURCE_ENTITY_REMOTE,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: async (ctx) => {
        const a = await this.remoteAudienceOf(ctx);
        return [a.currentApproverUserId, ...a.watcherUserIds].filter((x): x is string =>
          Boolean(x),
        );
      },
    });
  }
}
