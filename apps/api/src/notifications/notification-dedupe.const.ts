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
};
