-- Migration 0140: G3 mutation-path — audit_logs CHECK +'user_role','object_permission' (ADD-only DO-block)
--   + seed permission catalog `assign-role:user` (sensitive) cho endpoint gán/thu role runtime.
--
-- BAND 0140-0149 (lane g3 mutation-path — runtime permission mgmt). idx 80, when 1717500150000 (>0132).
-- HOT-FILE (TASKS §5.3): audit CHECK = UNION mọi lane. DO-block ADD-only (tiền lệ 0099/0132) — KHÔNG drop
--   re-stamp full-list ⇒ an toàn song song, KHÔNG bao giờ rớt type lane khác. Sync AUDIT_OBJECT_TYPES
--   (schema/audit.ts) cùng commit.
--
-- Permission (BẤT BIẾN #3 / ADR-0010 — quản lý phân quyền runtime):
--   - assign-role:user  → NHẠY CẢM (gán/thu role = leo thang đặc quyền) → grant TAY company-admin (…0001),
--     KHÔNG kế thừa wildcard `*:*` (kể cả super-admin). Khớp matrix-spec §5 (permission-management = sensitive).
--   - object-permission (PUT/DELETE /permissions/object) đã có catalog `grant-object-permission:permission`
--     (sensitive) seed ở 0037 + grant …0001 → KHÔNG seed lại ở đây.

-- ── audit_logs CHECK: ADD-only idempotent DO-block (chỉ thêm 'user_role','object_permission'). ──
-- ⚠️ Đọc CẢ HAI dạng constraint: `IN ('a','b')` VÀ `= ANY ('{a,b}'::text[])` (output DO-block 0099/0132).
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['user_role', 'object_permission'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    -- Dạng `= ANY ('{a,b,c}'::text[])` → cast literal mảng về text[] (đúng từng phần tử).
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    -- Dạng `IN ('a','b','c')` → tóm từng giá trị trong nháy đơn.
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
END;
$$;
--> statement-breakpoint

-- ── Seed permission catalog: assign-role:user (sensitive). (tiền lệ 0037/0132, ON CONFLICT DO NOTHING). ──
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('assign-role', 'user', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- company-admin (…0001): gán/thu role cho user. Grant TAY (sensitive ⇒ KHÔNG tự cấp qua snapshot wildcard);
-- ALLOW tường minh non-wildcard nên qua được sensitive-gate của can().
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.action = 'assign-role' AND p.resource_type = 'user'
ON CONFLICT DO NOTHING;
