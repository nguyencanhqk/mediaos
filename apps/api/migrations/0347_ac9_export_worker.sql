-- Migration 0347: AC-9 WAVE 3 C2 (🔴 CROWN-JEWEL) — export-worker materialize (nối scaffold AC-9 P4).
-- Gate: FULL (security-reviewer + database-reviewer + silent-failure-hunter + santa). ADR-0020 §4 (gỡ DEFER worker).
--
-- BAND 0345-0349 (lane ac9). Journal: idx 105, when 1717500400000 (> high-water 390000 = 0346_ac9_all_tenant_readonly).
--
-- MỤC TIÊU: worker thực sự FULFIL job export (scaffold AC-9 chỉ enqueue 'queued'). Worker đọc rows target
--   tenant qua withTenant(target) (RLS ÉP, CHỈ cột allowlist — redact secret/PII), serialize CSV, PUT lên
--   object storage (key tenant-scoped, server-derived), cập nhật status + row_count + object_key, audit.
--   File ephemeral: download qua presigned GET TTL ngắn (S3_PRESIGN_TTL_SEC), KHÔNG persist plaintext nhạy cảm.
--
-- THÊM CỘT (db_export_jobs GLOBAL no-RLS — như AC-9 0345):
--   object_key text — vị trí file export trong bucket ({target}/db-exports/{jobId}, server-derived). KHÔNG secret.
--   error      text — lý do fail (non-sensitive, infra message). BẤT BIẾN #3: KHÔNG chứa row data tenant.

ALTER TABLE db_export_jobs
  ADD COLUMN object_key text,
  ADD COLUMN error      text;
--> statement-breakpoint
-- App (worker) finalize: cập nhật object_key + error (kèm status/row_count/completed_at đã cấp ở 0345).
-- REVOKE DELETE vẫn giữ (append-only history); chỉ MỞ RỘNG cột UPDATE cho 2 cột mới.
GRANT UPDATE (object_key, error) ON db_export_jobs TO mediaos_app;

-- -------- Down (manual) --------
-- REVOKE UPDATE (object_key, error) ON db_export_jobs FROM mediaos_app;
-- ALTER TABLE db_export_jobs DROP COLUMN error, DROP COLUMN object_key;
