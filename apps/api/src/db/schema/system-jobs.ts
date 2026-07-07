import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

/**
 * S2-FND-JOBS-1 — system_job_runs + system_job_locks (DB-08 §8.14/§8.15 · DB-09 §8.11/§8.12).
 * DDL/RLS/policy/grant ở migration 0475. Inference dưới đây PARITY với migration (drizzle KHÔNG mô tả
 * RLS/policy/partial-index — migration là nguồn sự thật). KHÔNG db:generate.
 */

/**
 * `system_job_runs` — nhật ký mỗi lần chạy system job nền (DB-08 §8.14). company_id NULLABLE (NULL = job
 * cấp system/global; NOT NULL = job theo company) + KHÔNG DEFAULT current_setting (worker ghi company_id
 * TƯỜNG MINH per-tenant). RLS ENABLE/FORCE + policy per-role (mig 0475):
 *   • system_job_runs_tenant_iso  TO mediaos_app  USING (company_id = GUC OR company_id IS NULL) — app
 *     SELECT-only (đọc run-row tenant mình + global).
 *   • system_job_runs_worker_all  TO mediaos_worker USING(true) WITH CHECK(true) — worker ghi mọi tenant.
 * Nhật ký (append-mostly): worker SELECT/INSERT/UPDATE (Running→terminal 1 lần), app SELECT — KHÔNG DELETE.
 * status ∈ Running/Success/Failed/Partial/Skipped · triggered_by ∈ Scheduler/User/System (CHECK ở migration).
 */
export const systemJobRuns = pgTable(
  "system_job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULLABLE + KHÔNG DEFAULT: NULL = job cấp system; worker ghi company_id tường minh cho tenant.
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    jobCode: varchar("job_code", { length: 100 }).notNull(),
    status: varchar("status", { length: 50 }).notNull(),
    triggeredBy: varchar("triggered_by", { length: 50 }).notNull(),
    triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: bigint("duration_ms", { mode: "number" }),
    totalItems: integer("total_items"),
    successItems: integer("success_items"),
    failedItems: integer("failed_items"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_system_job_runs_job_time").on(t.jobCode, t.startedAt.desc()),
    index("idx_system_job_runs_company_job_time").on(t.companyId, t.jobCode, t.startedAt.desc()),
    // Partial-index (WHERE status IN ('Failed','Partial')) chỉ ở migration SQL — drizzle parity index thường.
    index("idx_system_job_runs_status_time").on(t.status, t.startedAt.desc()),
  ],
);

export type SystemJobRun = typeof systemJobRuns.$inferSelect;
export type NewSystemJobRun = typeof systemJobRuns.$inferInsert;

export const SYSTEM_JOB_RUN_STATUSES = [
  "Running",
  "Success",
  "Failed",
  "Partial",
  "Skipped",
] as const;
export type SystemJobRunStatus = (typeof SYSTEM_JOB_RUN_STATUSES)[number];

export const SYSTEM_JOB_TRIGGERED_BY = ["Scheduler", "User", "System"] as const;
export type SystemJobTriggeredBy = (typeof SYSTEM_JOB_TRIGGERED_BY)[number];

/**
 * `system_job_locks` — lock chống chạy trùng job giữa các instance (DB-08 §8.15). KHÔNG company_id ⇒ hạ
 * tầng WORKER, KHÔNG RLS (mẫu processed_events 0003). job_code là PK; acquire = INSERT ... ON CONFLICT
 * (job_code). Release = UPDATE locked_until về quá khứ (KHÔNG DELETE — BẤT BIẾN #2). Worker
 * SELECT/INSERT/UPDATE; app KHÔNG chạm bảng lock (không GRANT app).
 */
export const systemJobLocks = pgTable(
  "system_job_locks",
  {
    jobCode: varchar("job_code", { length: 100 }).primaryKey(),
    lockedBy: varchar("locked_by", { length: 255 }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata"),
  },
  (t) => [index("idx_system_job_locks_locked_until").on(t.lockedUntil)],
);

export type SystemJobLock = typeof systemJobLocks.$inferSelect;
export type NewSystemJobLock = typeof systemJobLocks.$inferInsert;
