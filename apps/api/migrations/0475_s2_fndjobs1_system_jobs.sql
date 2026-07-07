-- Migration 0475: S2-FND-JOBS-1 (🔴 RED, zone=red, crown — RLS/migration) — System Jobs khung tối thiểu.
-- Gate: FULL (security-reviewer [RLS worker-bypass + append/no-DELETE grant] + database-reviewer).
--
-- MỤC TIÊU (DB-08 §8.14/§8.15 + DB-09 §8.11/§8.12 + BACKEND-11 §18):
--   • system_job_runs  : nhật ký mỗi lần chạy system job nền (TEMP_FILE_CLEANUP, AUDIT_LOG_RETENTION...).
--                        company_id NULLABLE — NULL = job cấp system (global), có giá trị = job theo company.
--                        Ghi bởi WORKER (JobRunLogger qua mediaos_worker) — KHÔNG phải app. App CHỈ đọc
--                        (SELECT-only) run-row của tenant mình + run-row global (company_id IS NULL).
--   • system_job_locks : lock chống chạy trùng job giữa các instance (thay advisory-lock có-thể-quan-sát).
--                        KHÔNG company_id ⇒ hạ tầng WORKER (no-RLS, mẫu processed_events 0003). release
--                        lock = UPDATE locked_until về quá khứ, KHÔNG DELETE (TUYỆT ĐỐI không GRANT DELETE).
--
-- BẤT BIẾN (CLAUDE.md §2/§3) + DB-08 §5.3 (company_id nullable cho global/system):
--   #1 system_job_runs có company_id ⇒ RLS ENABLE + FORCE + policy TẠO TRƯỚC mọi INSERT/backfill (WO này
--      KHÔNG seed). Worker xử lý job của MỌI tenant ⇒ policy THEO ROLE (mẫu outbox 0003:60-69):
--        • system_job_runs_tenant_iso TO mediaos_app  USING (company_id = GUC OR company_id IS NULL)
--            → tenant (app read-only) thấy run-row CỦA MÌNH + run-row global; KHÔNG rò run-row tenant khác.
--            App SELECT-only (không INSERT/UPDATE grant) ⇒ chỉ cần USING (không WITH CHECK).
--        • system_job_runs_worker_all TO mediaos_worker USING(true) WITH CHECK(true)
--            → worker (hạ tầng nền, NOBYPASSRLS) thấy/ghi run-row mọi tenant + global. company_id ghi
--              TƯỜNG MINH mỗi run-row (không dựa DEFAULT current_setting — cột nullable, worker chạy
--              per-tenant trong platform-context). Tương thích set_config(...,true) PgBouncer txn-mode.
--   #2 KHÔNG hard-delete. system_job_runs = nhật ký chạy (append-mostly: INSERT lúc bắt đầu + UPDATE
--      Running→terminal 1 lần) ⇒ GRANT worker SELECT/INSERT/UPDATE, app SELECT — KHÔNG DELETE role nào.
--      system_job_locks: worker SELECT/INSERT/UPDATE (acquire/refresh/release-qua-UPDATE) — KHÔNG DELETE.
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008). company_id KHÔNG có DEFAULT current_setting (khác
--      audit_logs) — run-row cấp system ghi company_id NULL tường minh; run-row tenant ghi company_id A.
--
-- BAND 0475 (lane jobs_db). Journal: idx 155, when 1717500770000 (> head 0474 idx 154 / 1717500765000).
--   Nối tiếp ĐƠN ĐIỆU sau 0474_s2_fndbe8_module_audit_object_type. Drizzle schema system-jobs.ts PARITY
--   (KHÔNG db:generate — RLS/policy/grant thủ công, drizzle không biểu diễn được).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) system_job_runs — nhật ký chạy system job (DB-08 §8.14). company_id NULLABLE + KHÔNG DEFAULT.
--    RLS+FORCE + policy per-role (app tenant-iso / worker-all) TẠO TRƯỚC mọi INSERT (CLAUDE.md §3).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE system_job_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLABLE + KHÔNG DEFAULT: NULL = job cấp system (global); worker ghi company_id TƯỜNG MINH cho tenant.
  company_id            uuid REFERENCES companies(id) ON DELETE CASCADE,
  job_code              varchar(100) NOT NULL,
  status                varchar(50) NOT NULL,
  triggered_by          varchar(50) NOT NULL,
  triggered_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  duration_ms           bigint,
  total_items           integer,
  success_items         integer,
  failed_items          integer,
  error_message         text,
  metadata              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) — policy per-role mẫu outbox 0003 ──
ALTER TABLE system_job_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE system_job_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- App (tenant, SELECT-only): thấy run-row CỦA MÌNH + run-row global (company_id IS NULL). KHÔNG WITH CHECK
-- (app không có INSERT/UPDATE grant — read-only view của nhật ký job liên quan tenant mình).
CREATE POLICY system_job_runs_tenant_iso ON system_job_runs
  TO mediaos_app
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  );
--> statement-breakpoint
-- Worker (hạ tầng nền, NOBYPASSRLS): thấy/ghi run-row mọi tenant + global để chạy job per-tenant.
CREATE POLICY system_job_runs_worker_all ON system_job_runs
  TO mediaos_worker
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE system_job_runs
  ADD CONSTRAINT chk_system_job_runs_status
  CHECK (status IN ('Running', 'Success', 'Failed', 'Partial', 'Skipped'));
--> statement-breakpoint
ALTER TABLE system_job_runs
  ADD CONSTRAINT chk_system_job_runs_triggered_by
  CHECK (triggered_by IN ('Scheduler', 'User', 'System'));
--> statement-breakpoint
-- Index DB-09 §8.11: lần chạy gần nhất theo job_code.
CREATE INDEX idx_system_job_runs_job_time
  ON system_job_runs (job_code, started_at DESC);
--> statement-breakpoint
-- Index DB-09 §8.11: lọc run theo company + job.
CREATE INDEX idx_system_job_runs_company_job_time
  ON system_job_runs (company_id, job_code, started_at DESC);
--> statement-breakpoint
-- Index DB-09 §8.11 (partial): tìm run LỖI để alert/điều tra — chỉ index status Failed/Partial (nhỏ, nóng).
CREATE INDEX idx_system_job_runs_status_time
  ON system_job_runs (status, started_at DESC)
  WHERE status IN ('Failed', 'Partial');
--> statement-breakpoint
-- Nhật ký chạy: app SELECT-only (đọc run-row tenant mình + global). KHÔNG INSERT/UPDATE/DELETE cho app.
GRANT SELECT ON system_job_runs TO mediaos_app;
--> statement-breakpoint
-- Worker ghi nhật ký: SELECT/INSERT (tạo run-row lúc bắt đầu) + UPDATE (Running→terminal). KHÔNG DELETE.
GRANT SELECT, INSERT, UPDATE ON system_job_runs TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) system_job_locks — lock chống chạy trùng job (DB-08 §8.15). KHÔNG company_id ⇒ hạ tầng WORKER,
--    KHÔNG RLS (mẫu processed_events 0003). job_code là PK; acquire = INSERT ... ON CONFLICT (job_code).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE system_job_locks (
  job_code       varchar(100) PRIMARY KEY,
  locked_by      varchar(255) NOT NULL,
  locked_until   timestamptz  NOT NULL,
  acquired_at    timestamptz  NOT NULL DEFAULT now(),
  metadata       jsonb
);
--> statement-breakpoint
-- Index DB-09 §8.12: dọn/kiểm lock hết hạn theo locked_until.
CREATE INDEX idx_system_job_locks_locked_until
  ON system_job_locks (locked_until);
--> statement-breakpoint
-- Worker acquire/refresh/release lock. Release = UPDATE locked_until về quá khứ (KHÔNG DELETE — BẤT BIẾN #2).
-- KHÔNG cấp DELETE. App KHÔNG chạm bảng lock (hạ tầng worker thuần — mẫu processed_events, không GRANT app).
GRANT SELECT, INSERT, UPDATE ON system_job_locks TO mediaos_worker;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DROP TABLE IF EXISTS system_job_locks;
-- DROP TABLE IF EXISTS system_job_runs;
