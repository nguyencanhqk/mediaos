-- Migration 0460: S2-AUTH-BE-6 — Role write API (create/update role) + assign/revoke permission cho role.
--
-- (a) Catalog: seed cặp MỚI `assign:permission` (is_sensitive = TRUE — quản lý phân quyền là hành động
--     nhạy cảm, KHÔNG kế thừa qua wildcard `*:*` kể cả super-admin, phải có ALLOW tường minh — mirror
--     `grant-object-permission:permission` mig 0037). `create:role`/`update:role` ĐÃ có sẵn trong catalog
--     (mig 0005, is_sensitive=false) + ĐÃ grant company-admin (blanket non-sensitive seed 0005) — KHÔNG
--     cần thêm ở đây.
--     ANTI-ESCALATION (CHỐT 2026-07-02, done_when S2-AUTH-BE-6): pin (assign,permission) CHỈ company-admin
--     (role …0001) — N=1 chưa có non-admin giữ assign:permission, để dành phòng xa lúc thực sự cấp
--     per-user. Convention action='assign' resource_type='permission' (khớp @RequirePermission ở
--     role-admin.controller.ts).
--
-- (b) CHECK object_type audit_logs UNION-ADD 'role' + 'role_permission' (clone mẫu 0456/0457/0459).
--     Lý do: RoleAdminService.createRole/updateRole ghi audit RoleCreated/RoleUpdated objectType='role'
--     objectId=role.id; assignPermissionToRole/revokePermissionFromRole ghi audit
--     PermissionAssigned/PermissionRevoked objectType='role_permission' objectId=role.id (role_permissions
--     KHÔNG có uuid PK riêng — key hợp thành role_id/permission_id/effect, dùng role.id làm objectId để
--     truy vết được, KHÔNG NULL). before/after chỉ chứa {action,resourceType,effect,dataScope} đã mask
--     (BẤT BIẾN #3 — KHÔNG salary/secret). AUDIT_OBJECT_TYPES (schema/audit.ts) sync 2 giá trị này CÙNG
--     commit; migration này thêm vào CHECK DB để INSERT audit KHÔNG vỡ ràng buộc audit_logs_object_type_chk
--     (23514) trên Postgres thật.
--
-- HOT-FILE §9.3: DO-block UNION ADD-only cho (b) (idempotent, KHÔNG rewrite cứng, KHÔNG đụng RLS/grant/
--   policy/FORCE của mig 0005/0037). (a) dùng ON CONFLICT DO NOTHING (catalog gap + grant idempotent).
--   BẤT BIẾN #2 (audit append-only) GIỮ NGUYÊN: chỉ MỞ RỘNG tập giá trị object_type hợp lệ; KHÔNG cấp
--   UPDATE/DELETE cho app role. Không DROP TABLE, không backfill.
--
-- BAND 0460 (lane S2-AUTH-BE-6). Journal: idx 139, when 1717500690000 (head thực tế 0459
--   idx 139 khi soạn — xem apps/api/migrations/meta/_journal.json). NỐI TIẾP ĐƠN ĐIỆU sau head thực tế
--   0459_s2_hrbe7_employee_code_config. KHÔNG db:generate cho file này (DO-block/INSERT thủ công không
--   biểu diễn được bằng Drizzle schema thuần).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog: assign:permission (sensitive) + grant company-admin (…0001) — mirror 0037.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('assign', 'permission', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW', 'Company'
FROM permissions p
WHERE p.action = 'assign'
  AND p.resource_type = 'permission'
ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) CHECK object_type audit_logs UNION-ADD 'role' + 'role_permission'.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['role', 'role_permission'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0460] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RAISE NOTICE '[0460] role/role_permission da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0460] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- -------- Down (manual) --------
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id=p.id AND rp.role_id='00000000-0000-0000-0000-000000000001'
--     AND p.action='assign' AND p.resource_type='permission';
-- DELETE FROM permissions WHERE action='assign' AND resource_type='permission';
-- Re-stamp CHECK bỏ 'role'/'role_permission' (CHỈ khi không còn row audit_logs nào dùng chúng).
