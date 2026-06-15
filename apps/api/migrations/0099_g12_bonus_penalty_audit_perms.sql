-- Migration 0099: G12-3 — audit_logs CHECK +'bonus_penalty' (ADD-only DO-block) + seed permissions bonus/penalty.
--
-- BAND 0090-0099 (lane G12-bonus). idx 76, when>0098 (1717500138000). Chạy SAU 0098 (bảng + RLS tồn tại trước data).
-- HOT-FILE (TASKS §5.3): audit CHECK = UNION mọi lane. Dùng DO-block ADD-only (tiền lệ 0052/0053) — KHÔNG drop
--   re-stamp full-list ⇒ an toàn song song, KHÔNG bao giờ rớt type lane khác. Sync AUDIT_OBJECT_TYPES (audit.ts) cùng commit.
--
-- BẤT BIẾN #3 / ADR-0010 — bonus/penalty là SỐ TIỀN per-person (cùng lớp nhạy cảm salary/payslip):
--   manage/approve/view-bonus-penalty đều is_sensitive=TRUE ⇒ permission engine KHÔNG cho kế thừa qua wildcard *:*.
--   Grant TAY company-admin (…0001) + hr-manager (…0009). Self-approve chặn ở service (segregation of duties).

-- ── audit_logs CHECK: ADD-only idempotent DO-block (chỉ thêm 'bonus_penalty', an toàn song song). ──
-- ⚠️ Đọc CẢ HAI dạng constraint: `IN ('a','b')` (re-stamp full-list, vd 0093) VÀ `= ANY ('{a,b}'::text[])`
-- (output của DO-block trước, vd 0053). DO-block 0053 dùng regex '([^'])+' chỉ parse dạng IN — nếu áp lên
-- dạng ANY('{...}') nó tóm CẢ mảng '{a,b,..}' thành 1 phần tử ⇒ constraint hỏng (chỉ cho '{...}' + type mới,
-- CHẶN payslip/salary_profile...). 0099 chạy SAU 0053 (đọc dạng ANY) nên PHẢI parse mảng bằng cast text[].
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['bonus_penalty'];
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
  IF position('ANY' IN v_def) > 0 THEN
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

-- ── Seed permissions catalog cho bonus/penalty (tiền lệ 0097, ON CONFLICT DO NOTHING). ──
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('manage-bonus-penalty',  'bonus_penalty', true),
  ('approve-bonus-penalty', 'bonus_penalty', true),
  ('view-bonus-penalty',    'bonus_penalty', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- company-admin (00000001): toàn quyền bonus/penalty. Grant TAY (sensitive không kế thừa).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'bonus_penalty'
  AND p.action IN ('manage-bonus-penalty', 'approve-bonus-penalty', 'view-bonus-penalty')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- hr-manager (00000009): toàn quyền bonus/penalty. Grant TAY.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'bonus_penalty'
  AND p.action IN ('manage-bonus-penalty', 'approve-bonus-penalty', 'view-bonus-penalty')
ON CONFLICT DO NOTHING;
