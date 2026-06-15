-- Migration 0132: G12-4 — audit_logs CHECK +'payslip_acknowledgement' (ADD-only DO-block) + seed permissions duyệt/phát hành/khiếu nại.
--
-- BAND 0130-0139 (lane G12-approval). idx 79, when 1717500142000 (>0131). Chạy SAU 0131 (bảng tồn tại trước data).
-- HOT-FILE (TASKS §5.3): audit CHECK = UNION mọi lane. DO-block ADD-only (tiền lệ 0099) — KHÔNG drop re-stamp
--   full-list ⇒ an toàn song song, KHÔNG bao giờ rớt type lane khác. Sync AUDIT_OBJECT_TYPES (audit.ts) cùng commit.
--
-- Permission (BẤT BIẾN #3 / ADR-0010 — vòng duyệt lương):
--   - approve/publish-payroll-period: KHÔNG nhạy cảm (quản trị kỳ, không lộ tiền) → admin + hr-manager.
--   - resolve-payslip-dispute: NHẠY CẢM (xử lý khiếu nại = chạm dữ liệu lương) → grant TAY admin + hr, KHÔNG kế thừa wildcard.
--   - acknowledge-own-payslip: KHÔNG nhạy cảm (xác nhận/khiếu nại phiếu CỦA MÌNH, không lộ tiền người khác);
--     ownership ('payslip của chính mình' + kỳ published) ép ở SERVICE. Grant employee + admin + hr.

-- ── audit_logs CHECK: ADD-only idempotent DO-block (chỉ thêm 'payslip_acknowledgement'). ──
-- ⚠️ Đọc CẢ HAI dạng constraint: `IN ('a','b')` VÀ `= ANY ('{a,b}'::text[])` (output DO-block 0099/0053).
-- 0132 chạy SAU 0099 (đã emit dạng ANY) nên PHẢI parse mảng bằng cast text[] (KHÔNG dùng regex IN-only của 0053).
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['payslip_acknowledgement'];
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

-- ── Seed permissions catalog cho vòng duyệt lương (tiền lệ 0099, ON CONFLICT DO NOTHING). ──
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('approve-payroll-period',  'payroll_period', false),
  ('publish-payroll-period',  'payroll_period', false),
  ('resolve-payslip-dispute', 'payslip',        true),
  ('acknowledge-own-payslip', 'payslip',        false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- company-admin (…0001) + hr-manager (…0009): duyệt/phát hành kỳ + xử lý khiếu nại (resolve nhạy cảm grant TAY).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.role_id, p.id, 'ALLOW'
FROM (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-000000000009'::uuid)
) AS r(role_id)
CROSS JOIN permissions p
WHERE (p.resource_type = 'payroll_period'
        AND p.action IN ('approve-payroll-period', 'publish-payroll-period'))
   OR (p.resource_type = 'payslip'
        AND p.action IN ('resolve-payslip-dispute', 'acknowledge-own-payslip'))
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- employee (…0008): chỉ xác nhận/khiếu nại phiếu CỦA MÌNH (ownership ép ở service). KHÔNG resolve/approve/publish.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000008', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'payslip' AND p.action = 'acknowledge-own-payslip'
ON CONFLICT DO NOTHING;
