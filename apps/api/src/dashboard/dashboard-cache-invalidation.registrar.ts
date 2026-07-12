import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { EventBus, type EventContext } from "../events/event-bus";
import { DashboardCacheInvalidationService } from "./dashboard-cache-invalidation.service";

/** Đọc field string non-empty từ payload outbox (payload là JSON tự do, KHÔNG trust type). */
function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Gom nhiều field userId ứng viên → mảng DUY NHẤT (dedupe, bỏ rỗng/undefined). */
function pickUserIds(payload: Record<string, unknown>, ...keys: string[]): string[] {
  const out = new Set<string>();
  for (const key of keys) {
    const v = strField(payload, key);
    if (v) out.add(v);
  }
  return [...out];
}

interface CacheInvalidationMapping {
  /** outbox `event_type` THẬT (task-actions.service.ts / leave-*.service.ts — xác nhận grep 2026-07-12). */
  eventType: string;
  /** eventCode DASH_CACHE_INVALIDATION_MAP tương ứng — HARDCODE tĩnh, KHÔNG đọc `payload.eventCode` (defense-
   *  in-depth: payload là dữ liệu module khác ghi, không trust để chọn nhánh invalidate). */
  eventCode: string;
  /** userId(s) bị ảnh hưởng, đọc THẲNG từ payload (mọi producer TASK/LEAVE đã có field này sẵn — KHÔNG cần
   *  audience-reader/raw-query thêm, xem doc-block dưới). */
  userIdsOf: (payload: Record<string, unknown>) => string[];
}

/**
 * S4-INT-2-FIX-1/FIX-ATT — 10 mapping outbox eventType → DASH cache invalidate, CHỈ gồm eventType THẬT SỰ đi
 * qua `OutboxService.enqueue` (xác nhận bằng grep từng service, xem dashboard-cache-invalidation.const.ts
 * doc-block "Đối chiếu real-producer" + "S4-INT-2-FIX-ATT"). LOẠI TASK_DUE_SOON/TASK_OVERDUE
 * (task-reminder.job-handler.ts gọi NotificationEngineService.intake() TRỰC TIẾP, KHÔNG qua outbox ⇒ KHÔNG có
 * eventType nào phát lên EventBus để nghe — xem doc-block const), NOTIFICATION_CREATED/READ (mồ côi/0-producer
 * — xem cùng doc-block), và 10/11 mã ATT_* còn lại (không ghi attendance_records, hoặc có ghi nhưng payload
 * thiếu userId — xem doc-block "S4-INT-2-FIX-ATT" từng mã).
 *
 * userIds lấy THẲNG từ payload producer (task-actions.service.ts: `assigneeUserId`/`creatorUserId`;
 * leave-*.service.ts: `userId`; attendance-adjustment.apply.ts `emitAdjustmentApproved`: `userId`) — KHÔNG
 * cần audience-reader query lại DB như `TaskNotiBridgeRegistrar`, vì payload TASK/LEAVE/ATT ở đây đã có sẵn
 * userId cần (mirror payload thật, đối chiếu source 2026-07-12).
 *
 * GIỚI HẠN ĐÃ BIẾT (ghi rõ, KHÔNG che giấu): PENDING_LEAVE/LEAVE_CALENDAR cache theo VIEWER (người duyệt/xem
 * lịch team — `shareScope:'user'`, `scopeReferenceId = ctx.user.id` của người XEM, KHÔNG phải người XIN nghỉ).
 * `userId` trong payload LEAVE_* là người XIN nghỉ (request.userId), KHÔNG phải approver — nên với 2 widget
 * này, lời gọi invalidate ở đây THƯỜNG 0 rows (harmless — RAIL DASH_PER_USER_ONLY_WIDGET_CODES cũng chặn nếu
 * rỗng) và cache của approver thật sẽ tự làm mới theo TTL. Độ chính xác đầy đủ (audience = mọi approver/HR/CA
 * có quyền xem) cần thêm resolver ngoài phạm vi lane này — VIỆC CÒN NỢ cho lane sau.
 */
const CACHE_INVALIDATION_MAPPINGS: readonly CacheInvalidationMapping[] = [
  // ── TASK (task-actions.service.ts) ──────────────────────────────────────────────────────────────────
  {
    eventType: "task.assigned",
    eventCode: "TASK_ASSIGNED",
    userIdsOf: (p) => pickUserIds(p, "assigneeUserId"),
  },
  {
    eventType: "task.assignee_changed",
    eventCode: "TASK_ASSIGNEE_CHANGED",
    userIdsOf: (p) => pickUserIds(p, "assigneeUserId"),
  },
  {
    eventType: "task.status_changed",
    eventCode: "TASK_STATUS_CHANGED",
    userIdsOf: (p) => pickUserIds(p, "assigneeUserId", "creatorUserId"),
  },
  {
    eventType: "task.due_date_changed",
    eventCode: "TASK_DUE_DATE_CHANGED",
    userIdsOf: (p) => pickUserIds(p, "assigneeUserId"),
  },
  // ── LEAVE (leave-request/leave-approval/leave-revoke.service.ts) ───────────────────────────────────
  {
    eventType: "leave.request.submitted",
    eventCode: "LEAVE_REQUEST_SUBMITTED",
    userIdsOf: (p) => pickUserIds(p, "userId"),
  },
  {
    eventType: "leave.request.approved",
    eventCode: "LEAVE_REQUEST_APPROVED",
    userIdsOf: (p) => pickUserIds(p, "userId"),
  },
  {
    eventType: "leave.request.rejected",
    eventCode: "LEAVE_REQUEST_REJECTED",
    userIdsOf: (p) => pickUserIds(p, "userId"),
  },
  {
    eventType: "leave.request.cancelled",
    eventCode: "LEAVE_REQUEST_CANCELLED",
    userIdsOf: (p) => pickUserIds(p, "userId"),
  },
  {
    eventType: "leave.request.revoked",
    eventCode: "LEAVE_REQUEST_REVOKED",
    userIdsOf: (p) => pickUserIds(p, "userId"),
  },
  // ── ATT (attendance-adjustment.apply.ts emitAdjustmentApproved — xem dashboard-cache-invalidation.const.ts
  //    doc-block "S4-INT-2-FIX-ATT" cho đối chiếu đầy đủ 11 mã ATT_* isEnabled + lý do loại từng mã khác) ───
  {
    eventType: "attendance.adjustment_approved",
    eventCode: "ATT_ADJUSTMENT_APPROVED",
    userIdsOf: (p) => pickUserIds(p, "userId"),
  },
];

/**
 * S4-INT-2-FIX-1 — DashboardCacheInvalidationRegistrar: đăng ký (OnModuleInit) 10 consumer lên `EventBus`
 * (mirror `TaskNotiBridgeRegistrar`/`OutboxNotificationBridge`, S4-INT-1) để cache DASH tự invalidate khi
 * outbox event TASK/LEAVE THẬT được `OutboxWorker.processBatch()` claim — KHÔNG cần ai gọi tay
 * `POST /internal/v1/dashboard/cache/invalidate` nữa (Đội 3 finding #1/#2: trước lane này endpoint tồn tại
 * NHƯNG mồ côi, 0 caller thật).
 *
 * consumerName riêng (`dash-cache-invalidate:<eventType>`) — KHÔNG đụng consumer NOTI đã đăng ký cùng
 * eventType (`noti-bridge:<eventType>`); `EventBus`/`OutboxWorker.processEvent` hỗ trợ NHIỀU consumer độc lập
 * trên 1 eventType (mỗi consumer idempotency riêng theo `processed_events(consumer_name, event_id)`, lỗi của
 * consumer này KHÔNG chặn consumer khác — xem outbox-worker.ts `processEvent`).
 *
 * Boot-guard fail-loud: eventCode KHÔNG có trong DASH_CACHE_INVALIDATION_MAP (qua
 * `DashboardCacheInvalidationService.isKnownEvent`) → ném NGAY lúc khởi động (mirror OutboxNotificationBridge
 * `registerSource`) — chặn wire nhầm mã TRƯỚC KHI service chạy, KHÔNG chờ dead-letter runtime.
 *
 * Handler KHÔNG NUỐT LỖI: log rồi RE-THROW — OutboxWorker tự retry/dead-letter theo MAX_ATTEMPTS. Invalidate
 * tự nó idempotent (UPDATE deleted_at=now() — retry an toàn, KHÔNG double-effect).
 */
@Injectable()
export class DashboardCacheInvalidationRegistrar implements OnModuleInit {
  private readonly logger = new Logger(DashboardCacheInvalidationRegistrar.name);

  constructor(
    private readonly bus: EventBus,
    private readonly invalidation: DashboardCacheInvalidationService,
  ) {}

  onModuleInit(): void {
    for (const mapping of CACHE_INVALIDATION_MAPPINGS) {
      if (!this.invalidation.isKnownEvent(mapping.eventCode)) {
        throw new Error(
          `DashboardCacheInvalidationRegistrar: eventCode '${mapping.eventCode}' KHÔNG có trong ` +
            `DASH_CACHE_INVALIDATION_MAP — chặn đăng ký TẠI BOOT (fail-loud, KHÔNG dead-letter runtime).`,
        );
      }
      this.bus.register({
        consumerName: `dash-cache-invalidate:${mapping.eventType}`,
        eventType: mapping.eventType,
        handle: (ctx) => this.handle(mapping, ctx),
      });
    }
  }

  private async handle(mapping: CacheInvalidationMapping, ctx: EventContext): Promise<void> {
    try {
      const userIds = mapping.userIdsOf(ctx.payload);
      await this.invalidation.invalidate(ctx.companyId, mapping.eventCode, userIds);
    } catch (err) {
      this.logger.error(
        `DashboardCacheInvalidationRegistrar[${mapping.eventType}] invalidate THẤT BẠI ` +
          `(event ${ctx.eventId}, company ${ctx.companyId}): ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err; // KHÔNG nuốt — OutboxWorker retry/dead-letter (mirror OutboxNotificationBridge).
    }
  }
}
