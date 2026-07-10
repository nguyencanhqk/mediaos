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
};
