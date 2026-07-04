-- Migration 0471: S2-AUTH-DB-3 (🔴 RED, zone=red) — user_roles soft-delete (audit gap #4).
-- Gate: FULL (database-reviewer + security-reviewer). user_roles = crown-jewel (gán/gỡ quyền per-user).
--
-- MỤC TIÊU (BẤT BIẾN #2 — không hard-delete; DB-02 §4.9): gỡ role KHÔNG còn XOÁ CỨNG. Trước WO này
--   deleteUserRole chạy `.delete(user_roles)` (mig 0005:142 cấp DELETE cho mediaos_app) → mất dấu vết ai
--   từng giữ role gì (forensic). WO này chuyển user_roles sang SOFT-DELETE:
--     (1) + deleted_at timestamptz NULL (tombstone) + deleted_by uuid FK users(id) ON DELETE SET NULL.
--     (2) DROP CONSTRAINT user_roles_uq (full unique) → UNIQUE index PARTIAL (user_id,role_id,company_id)
--         WHERE deleted_at IS NULL — cho phép re-grant sau soft-delete mà không vỡ unique (tombstone cũ
--         không tính vào ràng buộc); vẫn chặn 2 grant ACTIVE trùng.
--     (3) GRANT UPDATE (MỚI — 0005:142 chỉ SELECT,INSERT,DELETE) + REVOKE DELETE khỏi mediaos_app →
--         gỡ role = UPDATE set deleted_at (KHÔNG hard-delete). GIỮ SELECT/INSERT. mediaos_worker giữ SELECT.
--     (4) DO-block fail-loud: has_table_privilege(mediaos_app,user_roles,UPDATE)=true VÀ DELETE=false, giữ
--         SELECT/INSERT; index partial tồn tại + constraint full đã DROP + 2 cột đã thêm.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 company_id/RLS: user_roles ĐÃ ENABLE + FORCE ROW LEVEL SECURITY + policy user_roles_tenant_isolation
--      từ mig 0005 — WO này KHÔNG đụng RLS/FORCE/policy (GIỮ NGUYÊN cô lập tenant). KHÔNG backfill company_id
--      (cột đã đầy đủ; deleted_at thêm mới = NULL cho mọi hàng hiện có = ACTIVE, đúng ngữ nghĩa) → KHÔNG có
--      bước "đặt-RLS-trước-backfill" để phải sắp.
--   #2 REVOKE DELETE tường minh → app-role DELETE user_roles PHẢI FAIL (42501). Gỡ role đi qua UPDATE
--      set deleted_at + deleted_by (append-only theo nghĩa không mất dấu). Idempotent: REVOKE quyền chưa-có
--      = no-op; GRANT SELECT,INSERT,UPDATE tái khẳng định phạm vi mong muốn (KHÔNG cấp lại DELETE).
--   • ON CONFLICT của app writer (bootstrap :167 / assignRole) phải chuyển sang inference qua index PARTIAL
--     (thêm predicate WHERE deleted_at IS NULL) — đó là việc lane backend (Lane B), NGOÀI paths lane migration
--     này. Migration chỉ tạo index partial để lane B nương theo.
--   • KHÔNG db:generate cho migration này — grant/REVOKE + partial unique index KHÔNG biểu diễn được bằng
--     drizzle schema → viết SQL tay (convention 04xx). Schema drizzle chỉ thêm 2 CỘT deleted_at/deleted_by
--     (permissions.ts) để khớp $inferSelect; partial unique index CHỈ ở SQL tay (comment ở schema).
--
-- BAND 0471 (lane S2-AUTH-DB-3). Journal: idx 151, when 1717500750000 (> head 0470 idx 150 /
--   1717500745000). Nối tiếp ĐƠN ĐIỆU sau 0470_s2_fndseed4_settings_seed.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (1) Cột soft-delete. deleted_at NULL = ACTIVE (mặc định mọi hàng hiện có). deleted_by = actor đã gỡ,
--     FK users(id) ON DELETE SET NULL (giữ tombstone kể cả khi tài khoản actor bị soft-delete/xoá). KHÔNG
--     backfill (NULL đúng ngữ nghĩa cho hàng active). KHÔNG đụng RLS/FORCE/policy (BẤT BIẾN #1).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
--> statement-breakpoint
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) Full unique → PARTIAL unique. Bỏ user_roles_uq (chặn MỌI hàng trùng, kể cả tombstone) để re-grant
--     sau soft-delete không vỡ; thay bằng index partial chỉ ràng buộc hàng ACTIVE (deleted_at IS NULL).
--     Mọi hàng hiện có deleted_at=NULL nên tính duy nhất giữ nguyên → CREATE INDEX không xung đột.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_active_uq
  ON user_roles (user_id, role_id, company_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (3) Grant: gỡ role = UPDATE (soft-delete), KHÔNG DELETE (hard-delete). REVOKE DELETE + GRANT UPDATE mới.
--     GIỮ SELECT/INSERT (tái khẳng định, KHÔNG nới rộng). mediaos_worker giữ SELECT. Idempotent.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE DELETE ON user_roles FROM mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON user_roles TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON user_roles TO mediaos_worker;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (4) Fail-LOUD (mẫu mig 0467): sau migration mediaos_app CÓ UPDATE + KHÔNG còn DELETE (BẤT BIẾN #2), VẪN
--     giữ SELECT/INSERT (không over-revoke); index partial tồn tại + constraint full đã DROP + 2 cột đã
--     thêm. Tránh âm thầm trượt grant/DDL ở migration tương lai.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Grant: UPDATE mới cấp, DELETE đã revoke.
  IF NOT has_table_privilege('mediaos_app', 'user_roles', 'UPDATE') THEN
    RAISE EXCEPTION '[0471] mediaos_app THIẾU UPDATE trên user_roles — soft-delete (gỡ role) sẽ FAIL.';
  END IF;
  IF has_table_privilege('mediaos_app', 'user_roles', 'DELETE') THEN
    RAISE EXCEPTION '[0471] mediaos_app VẪN còn DELETE trên user_roles sau REVOKE — BẤT BIẾN #2 vỡ (hard-delete role).';
  END IF;
  IF NOT (has_table_privilege('mediaos_app', 'user_roles', 'SELECT')
      AND has_table_privilege('mediaos_app', 'user_roles', 'INSERT')) THEN
    RAISE EXCEPTION '[0471] mediaos_app THIẾU SELECT/INSERT trên user_roles — REVOKE quá tay.';
  END IF;
  IF NOT has_table_privilege('mediaos_worker', 'user_roles', 'SELECT') THEN
    RAISE EXCEPTION '[0471] mediaos_worker THIẾU SELECT trên user_roles — grant reader trượt.';
  END IF;

  -- Cột soft-delete tồn tại.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'user_roles' AND column_name = 'deleted_at'
  ) THEN
    RAISE EXCEPTION '[0471] user_roles.deleted_at KHÔNG tồn tại sau ALTER — bước (1) trượt.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'user_roles' AND column_name = 'deleted_by'
  ) THEN
    RAISE EXCEPTION '[0471] user_roles.deleted_by KHÔNG tồn tại sau ALTER — bước (1) trượt.';
  END IF;

  -- Full unique constraint đã DROP.
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_uq' AND conrelid = 'user_roles'::regclass
  ) THEN
    RAISE EXCEPTION '[0471] CONSTRAINT user_roles_uq (full unique) VẪN tồn tại — bước (2) DROP trượt.';
  END IF;

  -- Partial unique index tồn tại + đúng predicate deleted_at IS NULL.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'user_roles' AND indexname = 'user_roles_active_uq'
       AND indexdef ILIKE '%WHERE (deleted_at IS NULL)%'
  ) THEN
    RAISE EXCEPTION '[0471] UNIQUE index partial user_roles_active_uq (WHERE deleted_at IS NULL) KHÔNG tồn tại — bước (2) trượt.';
  END IF;

  RAISE NOTICE '[0471] user_roles soft-delete OK — UPDATE cấp, DELETE revoke, partial-unique active-only (append-only role grant)';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy; BẤT BIẾN #2 KHÔNG khôi phục hard-delete) --------
-- REVOKE UPDATE ON user_roles FROM mediaos_app;  GRANT DELETE ON user_roles TO mediaos_app;  -- (KHÔNG nên)
-- DROP INDEX IF EXISTS user_roles_active_uq;
-- ALTER TABLE user_roles ADD CONSTRAINT user_roles_uq UNIQUE (user_id, role_id, company_id);
-- ALTER TABLE user_roles DROP COLUMN IF EXISTS deleted_by;  ALTER TABLE user_roles DROP COLUMN IF EXISTS deleted_at;
