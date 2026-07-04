-- Migration 0472: S2-FND-DB-2 (🔴 RED, zone=red) — DB hygiene theo DB-09 §8.5–8.9 (audit_logs = crown-jewel).
-- Gate: FULL (database-reviewer [chạm audit_logs] + security-reviewer [append-only lớp-2] + silent-failure-hunter).
--
-- BAND 0472 (lane S2-FND-DB-2-A-mig). Journal: idx 152, when 1717500755000 (> head 0471 idx 151 / 1717500750000).
-- Nối tiếp ĐƠN ĐIỆU sau head 0471_s2_authdb3_user_roles_soft_delete.
--
-- MỤC TIÊU (DB-09 index/query-pattern hygiene + audit immutability lớp-2):
--   (1) 5 index canonical DB-09 §8.5/8.6/8.8/8.9 còn thiếu — phủ query-pattern thực (liệt kê theo trạng thái
--       upload · cleanup file đã xoá · audit theo entity+thời gian · audit file-access theo thời gian · quét
--       counter cần reset). GIỮ NGUYÊN index kế thừa (KHÔNG DROP): idx_audit_logs_entity (module_code-led,
--       0432) + file_access_logs_company_id_idx (0433) đều còn dùng.
--   (2) uq_file_links_entity_file_active — UNIQUE partial ĐÚNG 6 cột (company_id, module_code, entity_type,
--       entity_id, file_id, link_type) WHERE deleted_at IS NULL. Chặn LINK TRÙNG (cùng file gắn 2 lần vào
--       cùng entity với cùng link_type). TRƯỚC khi ép: DEDUPE nhóm ĐÚNG 6 cột, giữ 1 hàng theo
--       is_primary DESC, created_at ASC, id ASC; soft-delete (deleted_at=now) phần dư — nếu không, CREATE
--       UNIQUE sẽ VỠ trên dữ liệu trùng sẵn có. KHÔNG nhầm với uq_file_links_primary_per_entity_type (5 cột
--       is_primary, 0433 — GIỮ NGUYÊN, khác ngữ nghĩa: 1 file primary / entity+link_type).
--   (3) audit_logs append-only LỚP-2: function audit_logs_block_mutation() + TRIGGER BEFORE UPDATE OR DELETE.
--       Denylist current_user='mediaos_app' → RAISE (message chứa 'append-only'). Defense-in-depth ĐỘC LẬP với
--       REVOKE lớp-1 (0432): kể cả khi ai đó lỡ GRANT UPDATE/DELETE cho mediaos_app ở migration tương lai, lớp-2
--       vẫn chặn. GIỮ REVOKE lớp-1 (tái khẳng định). Denylist CHỈ mediaos_app → superuser/owner (retention/
--       archive/system job) KHÔNG bị brick.
--
-- BẤT BIẾN (CLAUDE.md §2/§3):
--   #1 company_id/RLS: KHÔNG tạo bảng mới, KHÔNG backfill company_id — chỉ thêm index/uq/trigger trên bảng
--      ĐÃ có RLS ENABLE/FORCE + policy tenant_isolation (files/file_links/file_access_logs mig 0433, audit_logs
--      mig 0003, sequence_counters mig 0434). KHÔNG đụng RLS/FORCE/policy (cô lập tenant giữ nguyên). Dedup
--      chạy bằng owner/migrator (bypass RLS) trên TOÀN bộ file_links (mọi tenant) — company_id nằm TRONG khoá
--      nhóm nên KHÔNG trộn link giữa 2 tenant.
--   #2 APPEND-ONLY audit_logs: REVOKE UPDATE,DELETE lớp-1 (0432) GIỮ NGUYÊN + thêm trigger lớp-2. KHÔNG nới quyền.
--      Soft-delete file_links (deleted_at) — KHÔNG hard-delete (dedup dùng UPDATE set deleted_at).
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008) — dedup dùng now() (UTC-at-rest).
--
-- HOT-FILE: KHÔNG rewrite CHECK object_type · KHÔNG đụng grant bảng khác · CREATE ... IF NOT EXISTS + CREATE OR
--   REPLACE + DROP TRIGGER IF EXISTS → idempotent/re-run an toàn.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (1) 5 index canonical DB-09. Partial predicate + PascalCase reset_policy khớp CHECK 0434.
-- ────────────────────────────────────────────────────────────────────────────────────────────────

-- §8.6 files — lọc file theo trạng thái upload (Pending/Uploaded/Failed/Deleted) mới→cũ, chỉ hàng sống.
CREATE INDEX IF NOT EXISTS idx_files_company_status
  ON files (company_id, upload_status, uploaded_at DESC)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

-- §8.6 files — cleanup file ĐÃ soft-delete (retention/gc quét theo deleted_at). Partial CHỈ hàng đã xoá
-- (index nhỏ, không phình theo bảng sống).
CREATE INDEX IF NOT EXISTS idx_files_cleanup_deleted
  ON files (deleted_at)
  WHERE deleted_at IS NOT NULL;
--> statement-breakpoint

-- §8.8 file_access_logs — audit ai xem/tải file theo company + thời gian (KHÔNG partial: log append-only,
-- không soft-delete). PIN tên canonical, KHÔNG trùng file_access_logs_company_id_idx (0433, chỉ company_id).
CREATE INDEX IF NOT EXISTS idx_file_access_logs_company_time
  ON file_access_logs (company_id, created_at DESC);
--> statement-breakpoint

-- §8.9 sequence_counters — quét counter cần reset (job reset đầu năm/tháng/ngày). Predicate PascalCase
-- 'Yearly'/'Monthly'/'Daily' KHỚP CHECK chk_sequence_counters_reset_policy (0434) + seed DB-10 (nếu dùng
-- UPPER sẽ KHÔNG match row → index vô dụng). Bỏ 'Never' khỏi predicate (counter không-reset không cần quét).
CREATE INDEX IF NOT EXISTS idx_sequence_counters_reset
  ON sequence_counters (reset_policy, last_reset_at)
  WHERE reset_policy IN ('Yearly', 'Monthly', 'Daily');
--> statement-breakpoint

-- §8.5 audit_logs — truy vết theo entity + thời gian, company_id-led (cô lập tenant + sort mới→cũ). GIỮ
-- idx_audit_logs_entity (module_code, entity_type, entity_id — 0432) KHÔNG DROP (query khác dùng).
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_entity
  ON audit_logs (company_id, entity_type, entity_id, created_at DESC);
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) DEDUPE TRƯỚC khi ép uq 6 cột. Nhóm ĐÚNG 6 cột (company_id, module_code, entity_type, entity_id,
--     file_id, link_type) — CHỈ trên hàng đang sống (deleted_at IS NULL). Giữ hàng THẮNG theo thứ tự
--     is_primary DESC (giữ bản primary), created_at ASC (giữ bản cũ nhất), id ASC (tie-break tất định) —
--     soft-delete phần dư (deleted_at=now). Link khác file_id trong cùng entity ⇒ khoá 6-cột KHÁC ⇒ KHÔNG
--     bị đụng. Chạy bằng owner (bypass RLS) trên MỌI tenant; company_id trong khoá nhóm ⇒ không trộn tenant.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, module_code, entity_type, entity_id, file_id, link_type
      ORDER BY is_primary DESC, created_at ASC, id ASC
    ) AS rn
  FROM file_links
  WHERE deleted_at IS NULL
)
UPDATE file_links AS f
   SET deleted_at = now()
  FROM ranked
 WHERE f.id = ranked.id
   AND ranked.rn > 1;
--> statement-breakpoint

-- Ép UNIQUE partial 6 cột SAU dedup (không còn nhóm trùng active ⇒ CREATE UNIQUE không vỡ).
CREATE UNIQUE INDEX IF NOT EXISTS uq_file_links_entity_file_active
  ON file_links (company_id, module_code, entity_type, entity_id, file_id, link_type)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (3) audit_logs append-only LỚP-2 (trigger). SECURITY INVOKER (mặc định) ⇒ current_user = vai đang chạy
--     câu lệnh; denylist đúng 'mediaos_app'. Statement-level (FOR EACH STATEMENT) ⇒ chặn NGAY mọi
--     UPDATE/DELETE của mediaos_app kể cả khi 0 row khớp (không phụ thuộc RLS lọc row). Message chứa
--     'append-only' để test/khách quan nhận diện. ERRCODE insufficient_privilege (42501) nhất quán ngữ nghĩa
--     "từ chối quyền".
-- ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_logs_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'mediaos_app' THEN
    RAISE EXCEPTION 'audit_logs is append-only: % by role mediaos_app is denied (BẤT BIẾN #2)', TG_OP
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'audit_logs = append-only ledger; app role has SELECT/INSERT only (layer-1 REVOKE + layer-2 trigger)';
  END IF;
  -- Vai KHÁC mediaos_app (superuser/owner/worker/system job): cho phép — KHÔNG brick retention/archive.
  RETURN NULL;  -- statement-level: giá trị trả bị bỏ qua.
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_audit_logs_block_mutation ON audit_logs;
--> statement-breakpoint

CREATE TRIGGER trg_audit_logs_block_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_logs_block_mutation();
--> statement-breakpoint

-- GIỮ REVOKE lớp-1 (0432) — tái khẳng định (idempotent; KHÔNG nới quyền). App role: SELECT/INSERT only.
REVOKE UPDATE, DELETE ON audit_logs FROM mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs TO mediaos_app;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (4) Fail-LOUD (mẫu 0467/0471): 5 index + uq 6-cột + function + trigger tồn tại; lớp-1 REVOKE còn nguyên
--     (mediaos_app KHÔNG UPDATE/DELETE, VẪN SELECT/INSERT). Tránh âm thầm trượt DDL ở migration tương lai.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_idx text;
BEGIN
  -- 5 index canonical tồn tại (theo tên).
  FOREACH v_idx IN ARRAY ARRAY[
    'idx_files_company_status',
    'idx_files_cleanup_deleted',
    'idx_file_access_logs_company_time',
    'idx_sequence_counters_reset',
    'idx_audit_logs_company_entity'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = v_idx) THEN
      RAISE EXCEPTION '[0472] index canonical % KHÔNG tồn tại sau CREATE — bước (1) trượt.', v_idx;
    END IF;
  END LOOP;

  -- uq 6-cột: tồn tại + là UNIQUE + có đủ 6 cột khoá + WHERE deleted_at IS NULL.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'file_links' AND indexname = 'uq_file_links_entity_file_active'
       AND indexdef ILIKE '%UNIQUE%'
       AND indexdef ILIKE '%company_id%' AND indexdef ILIKE '%module_code%'
       AND indexdef ILIKE '%entity_type%' AND indexdef ILIKE '%entity_id%'
       AND indexdef ILIKE '%file_id%' AND indexdef ILIKE '%link_type%'
       AND indexdef ILIKE '%WHERE (deleted_at IS NULL)%'
  ) THEN
    RAISE EXCEPTION '[0472] uq_file_links_entity_file_active (UNIQUE partial 6 cột WHERE deleted_at IS NULL) KHÔNG đúng shape — bước (2) trượt.';
  END IF;

  -- GIỮ uq_file_links_primary_per_entity_type (0433) — KHÔNG bị DROP nhầm.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'file_links' AND indexname = 'uq_file_links_primary_per_entity_type'
  ) THEN
    RAISE EXCEPTION '[0472] uq_file_links_primary_per_entity_type (0433) BIẾN MẤT — dedup/DROP quá tay.';
  END IF;

  -- GIỮ idx_audit_logs_entity (0432, module_code-led) — KHÔNG DROP.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'audit_logs' AND indexname = 'idx_audit_logs_entity'
  ) THEN
    RAISE EXCEPTION '[0472] idx_audit_logs_entity (0432) BIẾN MẤT — không được DROP index kế thừa.';
  END IF;

  -- Function + trigger lớp-2 tồn tại.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_logs_block_mutation') THEN
    RAISE EXCEPTION '[0472] function audit_logs_block_mutation() KHÔNG tồn tại — bước (3) trượt.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_audit_logs_block_mutation'
       AND tgrelid = 'audit_logs'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '[0472] trigger trg_audit_logs_block_mutation trên audit_logs KHÔNG tồn tại — bước (3) trượt.';
  END IF;

  -- Lớp-1 REVOKE còn nguyên: mediaos_app KHÔNG UPDATE/DELETE, VẪN SELECT/INSERT (không over-revoke).
  IF has_table_privilege('mediaos_app', 'audit_logs', 'UPDATE')
     OR has_table_privilege('mediaos_app', 'audit_logs', 'DELETE') THEN
    RAISE EXCEPTION '[0472] mediaos_app VẪN có UPDATE/DELETE trên audit_logs — lớp-1 REVOKE vỡ (BẤT BIẾN #2).';
  END IF;
  IF NOT (has_table_privilege('mediaos_app', 'audit_logs', 'SELECT')
      AND has_table_privilege('mediaos_app', 'audit_logs', 'INSERT')) THEN
    RAISE EXCEPTION '[0472] mediaos_app THIẾU SELECT/INSERT trên audit_logs — REVOKE quá tay.';
  END IF;

  RAISE NOTICE '[0472] DB hygiene OK — 5 index canonical + uq_file_links_entity_file_active (dedup TRƯỚC) + audit_logs append-only lớp-2 (trigger denylist mediaos_app)';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy; BẤT BIẾN #2 KHÔNG gỡ append-only) --------
-- DROP TRIGGER IF EXISTS trg_audit_logs_block_mutation ON audit_logs;
-- DROP FUNCTION IF EXISTS audit_logs_block_mutation();
-- DROP INDEX IF EXISTS uq_file_links_entity_file_active;   -- (dedup soft-delete KHÔNG hoàn tác — deleted_at giữ)
-- DROP INDEX IF EXISTS idx_audit_logs_company_entity;
-- DROP INDEX IF EXISTS idx_sequence_counters_reset;
-- DROP INDEX IF EXISTS idx_file_access_logs_company_time;
-- DROP INDEX IF EXISTS idx_files_cleanup_deleted;
-- DROP INDEX IF EXISTS idx_files_company_status;
