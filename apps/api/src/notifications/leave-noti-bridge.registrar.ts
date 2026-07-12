import { Injectable, OnModuleInit } from "@nestjs/common";
import type { EventContext } from "../events/event-bus";
import { DatabaseService } from "../db/db.service";
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import { LeaveApproverReader } from "./leave-approver.reader";

const SOURCE_MODULE_LEAVE = "LEAVE";
const SOURCE_ENTITY_LEAVE_REQUEST = "leave_request";

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * S4-INT-3 — LeaveNotiBridgeRegistrar: đăng ký 5 mapping LEAVE (đơn nghỉ phép — submit/approve/reject/
 * cancel/revoke) → NOTI (SPEC-05 §19.1 recipient, §14.19 roll-up) lên `OutboxNotificationBridge` (INT-1
 * GENERIC core — TÁI DÙNG, KHÔNG bridge/consumer mới) TẠI BOOT (OnModuleInit, mirror
 * `AttNotiBridgeRegistrar`). Import CHỈ `notifications/**` + `db/**` — KHÔNG import `LeaveModule` (giữ
 * acyclic; đọc thẳng bảng `employee_profiles` qua reader raw-SQL, mirror INT-4 `AttApprovalAudienceReader`).
 *
 * eventType → eventCode VERBATIM (notification-event-catalog.const.ts:80-84):
 *   leave.request.submitted → LEAVE_REQUEST_SUBMITTED
 *   leave.request.approved  → LEAVE_REQUEST_APPROVED
 *   leave.request.rejected  → LEAVE_REQUEST_REJECTED
 *   leave.request.cancelled → LEAVE_REQUEST_CANCELLED
 *   leave.request.revoked   → LEAVE_REQUEST_REVOKED
 *
 * Recipient (SPEC-05 §19.1/§14.19) — bridge KHÔNG loại actor (engine `NotificationRecipientResolverService`
 * tự loại `actorUserId` (payload set bởi producer — leave-request/-approval/-revoke.service.ts) + filter
 * active/same-company; KHÔNG lặp logic 2 nơi):
 *   LEAVE_REQUEST_SUBMITTED = direct manager của subject (reader.resolveManager).
 *   LEAVE_REQUEST_APPROVED  = requester = payload.userId.
 *   LEAVE_REQUEST_REJECTED  = requester = payload.userId.
 *   LEAVE_REQUEST_CANCELLED = RẼ NHÁNH theo `payload.fromStatus` — CÙNG eventType nhưng 2 PRODUCER khác
 *     nhau (1 consumer, branch trong resolveRecipients — KHÔNG 2 mapping):
 *       - fromStatus='Approved' (leave-revoke.service.ts `cancelApproved`, hủy đơn ĐÃ DUYỆT) →
 *         [payload.userId, manager] — cả requester lẫn manager cần biết đơn đã duyệt bị hủy.
 *       - fromStatus='Pending'|'Draft' (leave-request.service.ts `cancel`, hủy đơn CHƯA DUYỆT) →
 *         [manager] — chỉ manager cần biết (đơn chưa từng thông báo cho ai ngoài chính requester).
 *   LEAVE_REQUEST_REVOKED   = [payload.userId, manager] (HR/admin thu hồi đơn đã duyệt — cả 2 cần biết).
 *
 * dedupeKey mặc định = ctx.eventId (once-ever theo outbox event — notification-dedupe.const.ts strategy
 * 'DedupeKey'). Payload hỏng (thiếu requestId/userId) ⇒ recipient rỗng, KHÔNG throw (fail-soft đọc; engine
 * Skipped). Handler bridge RE-THROW lỗi intake ⇒ OutboxWorker retry/dead-letter (KHÔNG nuốt lỗi).
 */
@Injectable()
export class LeaveNotiBridgeRegistrar implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly reader: LeaveApproverReader,
    private readonly bridge: OutboxNotificationBridge,
  ) {}

  onModuleInit(): void {
    this.registerSubmitted();
    this.registerApproved();
    this.registerRejected();
    this.registerCancelled();
    this.registerRevoked();
  }

  /** direct_manager_id (user_id) HIỆN TẠI của subject — ưu tiên payload.employeeId, fallback payload.userId. */
  private async managerOf(ctx: EventContext): Promise<string | null> {
    const employeeId = strField(ctx.payload, "employeeId");
    const userId = strField(ctx.payload, "userId");
    if (!employeeId && !userId) return null;
    return this.db.withTenant(ctx.companyId, (tx) =>
      this.reader.resolveManager(tx, ctx.companyId, employeeId, userId),
    );
  }

  private registerSubmitted(): void {
    this.bridge.registerSource({
      eventType: "leave.request.submitted",
      eventCode: "LEAVE_REQUEST_SUBMITTED",
      sourceModule: SOURCE_MODULE_LEAVE,
      sourceEntityType: SOURCE_ENTITY_LEAVE_REQUEST,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: async (ctx) => {
        const managerId = await this.managerOf(ctx);
        return managerId ? [managerId] : [];
      },
    });
  }

  private registerApproved(): void {
    this.bridge.registerSource({
      eventType: "leave.request.approved",
      eventCode: "LEAVE_REQUEST_APPROVED",
      sourceModule: SOURCE_MODULE_LEAVE,
      sourceEntityType: SOURCE_ENTITY_LEAVE_REQUEST,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: (ctx) => {
        const userId = strField(ctx.payload, "userId");
        return Promise.resolve(userId ? [userId] : []);
      },
    });
  }

  private registerRejected(): void {
    this.bridge.registerSource({
      eventType: "leave.request.rejected",
      eventCode: "LEAVE_REQUEST_REJECTED",
      sourceModule: SOURCE_MODULE_LEAVE,
      sourceEntityType: SOURCE_ENTITY_LEAVE_REQUEST,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: (ctx) => {
        const userId = strField(ctx.payload, "userId");
        return Promise.resolve(userId ? [userId] : []);
      },
    });
  }

  private registerCancelled(): void {
    this.bridge.registerSource({
      eventType: "leave.request.cancelled",
      eventCode: "LEAVE_REQUEST_CANCELLED",
      sourceModule: SOURCE_MODULE_LEAVE,
      sourceEntityType: SOURCE_ENTITY_LEAVE_REQUEST,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: async (ctx) => {
        const fromStatus = strField(ctx.payload, "fromStatus");
        const managerId = await this.managerOf(ctx);
        if (fromStatus === "Approved") {
          const userId = strField(ctx.payload, "userId");
          return [userId, managerId].filter((x): x is string => Boolean(x));
        }
        return managerId ? [managerId] : [];
      },
    });
  }

  private registerRevoked(): void {
    this.bridge.registerSource({
      eventType: "leave.request.revoked",
      eventCode: "LEAVE_REQUEST_REVOKED",
      sourceModule: SOURCE_MODULE_LEAVE,
      sourceEntityType: SOURCE_ENTITY_LEAVE_REQUEST,
      sourceEntityIdOf: (ctx) => strField(ctx.payload, "requestId"),
      resolveRecipients: async (ctx) => {
        const userId = strField(ctx.payload, "userId");
        const managerId = await this.managerOf(ctx);
        return [userId, managerId].filter((x): x is string => Boolean(x));
      },
    });
  }
}
