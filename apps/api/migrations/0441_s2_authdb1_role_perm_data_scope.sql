-- Migration 0441: S2-AUTH-DB-1 (🔴 RED) — thêm cột data_scope vào role_permissions.
--   Mô hình RBAC scope CANONICAL Own/Team/Department/Company/System (IMPLEMENTATION-05 §13 · BACKEND-03 · DB-02).
--   Gỡ nợ DEFERRED của S0-AUTH-DB-1 (engine 4-tier action/resource_type/effect chưa biểu diễn được scope).
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN ADDITIVE: chỉ ADD COLUMN + ADD CHECK. KHÔNG đụng RLS/FORCE/policy/grant của mig 0005 →
--     BẤT BIẾN #1 (tenant isolation) GIỮ NGUYÊN. KHÔNG DROP, KHÔNG seed scope (seed = S2-AUTH-SEED-1).
--   • Backfill an toàn: DEFAULT 'Company' (KHÔNG 'System' = rộng nhất) ⇒ không nới scope cho system role.
--     Row cũ (mig 0005) = 'Company'; scope hẹp đúng từng role được SEED lại ở S2-AUTH-SEED-1.
--   • App role KHÔNG có UPDATE trên role_permissions (mig 0005) ⇒ đổi scope = delete+insert (đồng nhất effect).
--   • Idempotent: guard qua information_schema; chạy lại = no-op.
--
-- BAND 0441 (lane S2-AUTH-DB-1). Journal: idx 124, when 1717500590000 (> head 0440 idx 123 / 1717500580000).
--   Nối tiếp ĐƠN ĐIỆU sau head 0440_file1_audit_object_type. KHÔNG db:generate (DO-block thủ công).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'role_permissions' AND column_name = 'data_scope'
  ) THEN
    RAISE NOTICE '[0441] role_permissions.data_scope đã tồn tại — idempotent skip';
    RETURN;
  END IF;

  ALTER TABLE role_permissions
    ADD COLUMN data_scope text NOT NULL DEFAULT 'Company';

  ALTER TABLE role_permissions
    ADD CONSTRAINT role_permissions_data_scope_chk
    CHECK (data_scope IN ('Own', 'Team', 'Department', 'Company', 'System'));

  RAISE NOTICE '[0441] đã thêm role_permissions.data_scope (NOT NULL DEFAULT ''Company'') + CHECK 5 giá trị';
END;
$$;

-- -------- Down (manual) --------
-- ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_data_scope_chk;
-- ALTER TABLE role_permissions DROP COLUMN IF EXISTS data_scope;
