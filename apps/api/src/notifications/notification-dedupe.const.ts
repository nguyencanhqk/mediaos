/**
 * S4-NOTI-BE-2 (L2-engine) — DEFAULT_DEDUPE: override dedupe NỘI BỘ khi catalog `dedupe_strategy='None'`.
 *
 * Seed 0481 (`:47-104`) KHÔNG set `dedupe_strategy`/`dedupe_window_seconds` cho mọi event ⇒ nhận DEFAULT
 * `'None'`/NULL (schema `noti.ts:48-49`). Nhưng 2 event ồn ào `TASK_COMMENT_CREATED` / `TASK_STATUS_CHANGED`
 * cần chống spam out-of-box mà KHÔNG cần migration (plan §2.5 điểm 3). Const này áp CHỈ khi catalog='None';
 * nếu công ty override catalog (`dedupe_strategy != 'None'`) thì CATALOG THẮNG (xem NotificationDedupeService
 * .resolveStrategy). Event khác + catalog='None' ⇒ KHÔNG set dedupe_key ⇒ không dedupe (partial-unique
 * `uq_notifications_dedupe_active` coi NULL là distinct nên không áp — đúng chủ đích "None").
 */

export type DedupeStrategy = "None" | "DedupeKey" | "TimeWindow" | "EntityRecipient";

export interface DedupeDefaultConfig {
  readonly strategy: Exclude<DedupeStrategy, "None">;
  readonly windowSeconds: number | null;
}

/** Cửa sổ mặc định 300s (SPEC-08 §15 chống spam comment/status trong 5 phút). */
export const DEFAULT_DEDUPE_WINDOW_SECONDS = 300;

export const DEFAULT_DEDUPE: Readonly<Record<string, DedupeDefaultConfig>> = {
  TASK_COMMENT_CREATED: { strategy: "TimeWindow", windowSeconds: DEFAULT_DEDUPE_WINDOW_SECONDS },
  TASK_STATUS_CHANGED: { strategy: "TimeWindow", windowSeconds: DEFAULT_DEDUPE_WINDOW_SECONDS },
  // S4-NOTI-BE-3 — reminder job (task-reminder.job-handler.ts) tự tính `dedupeKey = "<taskId>:<YYYY-MM-DD
  // theo UTC>"` rồi truyền qua InternalEventIntakeDto.dedupeKey. Cần strategy 'DedupeKey' (KHÔNG 'None')
  // để NotificationDedupeService.computeKey THỰC SỰ set dedupe_key (ngược lại catalog='None' ⇒ key=null ⇒
  // partial-unique coi NULL distinct ⇒ chạy job 2 lần/ngày sẽ gửi trùng — done_when "không gửi trùng trong
  // ngày"). 'DedupeKey' (KHÔNG 'TimeWindow'): job tự chốt biên ngày lịch (UTC) thay vì bucket theo epoch/N
  // giây (TimeWindow không align đúng "trong ngày" khi window=86400 và giờ chạy job lệch múi biên ngày).
  TASK_DUE_SOON: { strategy: "DedupeKey", windowSeconds: null },
  TASK_OVERDUE: { strategy: "DedupeKey", windowSeconds: null },
  // S4-INT-1 — OutboxNotificationBridge (task-noti-bridge.registrar.ts): mỗi mapping mặc định
  // `dedupeKey = ctx.eventId` (outbox event id — ổn định qua mọi lần re-consume/retry của CÙNG event) ⇒
  // strategy 'DedupeKey' (KHÔNG 'None') để NotificationDedupeService.computeKey THỰC SỰ set dedupe_key.
  // Bảo vệ 2 TẦNG cùng OutboxWorker.processed_events (tầng 1, theo consumer_name+event_id): nếu event bị
  // re-claim (reaper timeout) MÀ processed_events đã mất dấu (crash giữa insert↔markProcessed) thì tầng
  // NÀY (theo company+recipient+event_code+dedupe_key, partial-unique `uq_notifications_dedupe_active`)
  // vẫn chặn tạo notification trùng. 6 mã MỚI (TASK_STATUS_CHANGED/TASK_COMMENT_CREATED GIỮ NGUYÊN
  // 'TimeWindow' 300s ở trên — 2 event ồn ào, chống spam trong-cửa-sổ, KHÔNG đổi strategy).
  TASK_ASSIGNED: { strategy: "DedupeKey", windowSeconds: null },
  TASK_ASSIGNEE_CHANGED: { strategy: "DedupeKey", windowSeconds: null },
  TASK_PRIORITY_CHANGED: { strategy: "DedupeKey", windowSeconds: null },
  TASK_DUE_DATE_CHANGED: { strategy: "DedupeKey", windowSeconds: null },
  TASK_MENTIONED: { strategy: "DedupeKey", windowSeconds: null },
  PROJECT_MEMBER_ADDED: { strategy: "DedupeKey", windowSeconds: null },
  // S4-INT-5 (additive) — AuthHrNotiBridgeRegistrar: 3 event AUTH đi qua CÙNG OutboxNotificationBridge, mỗi
  // mapping mặc định `dedupeKey = ctx.eventId` (outbox event id — ổn định qua re-consume/retry). Catalog seed
  // 0481/0490 để 3 mã này ở dedupe_strategy='None' ⇒ cần 'DedupeKey' fallback (KHÔNG 'None') để computeKey
  // THỰC SỰ set dedupe_key ⇒ partial-unique `uq_notifications_dedupe_active` chặn tầng-2 khi OutboxWorker
  // .processed_events (tầng-1) mất dấu (crash giữa insert↔markProcessed). Zero-migration (const nội bộ).
  AUTH_USER_CREATED: { strategy: "DedupeKey", windowSeconds: null },
  AUTH_PASSWORD_RESET_REQUESTED: { strategy: "DedupeKey", windowSeconds: null },
  AUTH_USER_LOCKED: { strategy: "DedupeKey", windowSeconds: null },
  // S4-INT-4 (additive) — AttNotiBridgeRegistrar (att-noti-bridge.registrar.ts): 7 mapping ATT (đơn điều
  // chỉnh công + đơn remote-work) qua CÙNG OutboxNotificationBridge INT-1, mỗi mapping mặc định
  // `dedupeKey = ctx.eventId` (outbox event id, ổn định qua mọi lần re-consume/retry của CÙNG event) ⇒
  // strategy 'DedupeKey' (KHÔNG 'None') để NotificationDedupeService.computeKey THỰC SỰ set dedupe_key.
  // Bảo vệ 2 TẦNG cùng OutboxWorker.processed_events (tầng 1, consumer_name+event_id): re-claim (reaper
  // timeout) MÀ processed_events mất dấu (crash giữa insert↔markProcessed) thì tầng NÀY (partial-unique
  // `uq_notifications_dedupe_active` theo company+recipient+event_code+dedupe_key=eventId) vẫn chặn tạo
  // trùng ⇒ đúng 1 notification/recipient/event. windowSeconds:null (once-ever theo outbox event, KHÔNG
  // cửa sổ thời gian).
  ATT_ADJUSTMENT_SUBMITTED: { strategy: "DedupeKey", windowSeconds: null },
  ATT_ADJUSTMENT_APPROVED: { strategy: "DedupeKey", windowSeconds: null },
  ATT_ADJUSTMENT_REJECTED: { strategy: "DedupeKey", windowSeconds: null },
  ATT_REMOTE_REQUEST_SUBMITTED: { strategy: "DedupeKey", windowSeconds: null },
  ATT_REMOTE_REQUEST_APPROVED: { strategy: "DedupeKey", windowSeconds: null },
  ATT_REMOTE_REQUEST_REJECTED: { strategy: "DedupeKey", windowSeconds: null },
  ATT_REMOTE_REQUEST_CANCELLED: { strategy: "DedupeKey", windowSeconds: null },
  // S4-INT-3 (additive) — LeaveNotiBridgeRegistrar (leave-noti-bridge.registrar.ts): 5 mapping LEAVE (đơn
  // nghỉ phép — submit/approve/reject/cancel/revoke) qua CÙNG OutboxNotificationBridge INT-1 (TÁI DÙNG core
  // generic — KHÔNG bridge/consumer mới), mỗi mapping mặc định `dedupeKey = ctx.eventId` (outbox event id,
  // ổn định qua mọi lần re-consume/retry của CÙNG event) ⇒ strategy 'DedupeKey' (KHÔNG 'None') để
  // NotificationDedupeService.computeKey THỰC SỰ set dedupe_key. Bảo vệ 2 TẦNG cùng
  // OutboxWorker.processed_events (tầng 1, consumer_name+event_id): re-claim (reaper timeout) MÀ
  // processed_events mất dấu (crash giữa insert↔markProcessed) thì tầng NÀY (partial-unique
  // `uq_notifications_dedupe_active` theo company+recipient+event_code+dedupe_key=eventId) vẫn chặn tạo
  // trùng ⇒ đúng 1 notification/recipient/event. windowSeconds:null (once-ever theo outbox event, KHÔNG
  // cửa sổ thời gian).
  LEAVE_REQUEST_SUBMITTED: { strategy: "DedupeKey", windowSeconds: null },
  LEAVE_REQUEST_APPROVED: { strategy: "DedupeKey", windowSeconds: null },
  LEAVE_REQUEST_REJECTED: { strategy: "DedupeKey", windowSeconds: null },
  LEAVE_REQUEST_CANCELLED: { strategy: "DedupeKey", windowSeconds: null },
  LEAVE_REQUEST_REVOKED: { strategy: "DedupeKey", windowSeconds: null },
  // S7-CHAT-BE-6 (additive) — ChatNotiBridgeRegistrar. CHỈ `CHAT_MENTIONED` cần entry ở đây.
  //
  // `CHAT_DIRECT_MESSAGE` KHÔNG có mặt là CỐ Ý: catalog DB đã seed `dedupe_strategy='DedupeKey'`
  // (`0538:719`) và `resolveStrategy` cho CATALOG THẮNG — thêm vào đây là dựng nguồn sự thật thứ hai cho
  // cùng một giá trị, hai bản sẽ trôi khỏi nhau lần đầu ai đó đổi seed.
  //
  // `CHAT_MENTIONED` seed `'None'` (`0538:717`) đúng nghĩa "gửi ngay, KHÔNG gộp theo cửa sổ thời gian" —
  // nhưng 'None' ⇒ `computeKey` trả null ⇒ `dedupe_key` NULL ⇒ partial-unique
  // `uq_notifications_dedupe_active` coi mọi NULL là distinct ⇒ **tầng 2 biến mất hoàn toàn**. Khi outbox
  // event bị re-claim mà `processed_events` (tầng 1) đã mất dấu vì crash giữa insert↔markProcessed, người
  // được nhắc tên nhận thông báo trùng. Đừng nhầm "không gộp lô" với "không cần idempotent" — hai chuyện
  // khác nhau, và chỉ chuyện thứ hai được quyết ở đây.
  CHAT_MENTIONED: { strategy: "DedupeKey", windowSeconds: null },
};
