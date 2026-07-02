-- Migration 0457: S2-HR-BE-7 — Employee-code config admin API foundation.
--   (a) UNION ADD-only 'employee_code_config' vào CHECK object_type của audit_logs.
--       Lý do: HR admin PATCH /hr/employee-code-config (EmployeeCodeConfigService.update — API-03 §10.10
--       HR-API-902) ghi audit CONFIG_UPDATE object_type='employee_code_config' audit-in-tx app-tenant
--       (old/new = snapshot cấu hình: prefix/pattern/number_length/allow_manual_override/status —
--       KHÔNG current_value/counter/secret/PII vào before/after, BẤT BIẾN #3). AUDIT_OBJECT_TYPES
--       (schema/audit.ts) sync giá trị này CÙNG commit; migration này thêm vào CHECK DB để INSERT audit
--       KHÔNG vỡ ràng buộc audit_logs_object_type_chk (23514) trên Postgres thật.
--   (b) Seed permission catalog cặp (view,employee-code-config)+(update,employee-code-config)
--       ON CONFLICT DO NOTHING + grant role_permissions cho hr + company-admin, data_scope=Company
--       (API-03 §10.10 HR-API-901/902 — gate HR.EMPLOYEE_CODE_CONFIG.VIEW/UPDATE, KHÔNG dùng
--       manage:master-data). preview:employee-code (gate HR-API-903) ĐÃ seed mig 0445 — KHÔNG lặp.
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • (a) DO-block UNION ADD-only (clone 0456 mẫu 0446/0440/0439/0437/0420) — idempotent, KHÔNG rewrite
--     cứng, KHÔNG đụng RLS/grant/policy/FORCE. BẤT BIẾN #2 (audit append-only) GIỮ NGUYÊN: chỉ MỞ RỘNG
--     tập giá trị object_type hợp lệ; KHÔNG cấp UPDATE/DELETE cho app role.
--   • (b) THUẦN ADDITIVE: chỉ INSERT data (permissions / role_permissions). KHÔNG DDL trên
--     employee_code_configs (schema đã tạo ở migration cũ — KHÔNG mở rộng cột; padding/reset_policy nằm
--     ở sequence_counters S1-FND-SEQ-1). KHÔNG đụng RLS/FORCE/policy. KHÔNG db:generate (DO-block thủ
--     công mirror 0445/0456 — không biểu diễn được bằng Drizzle schema).
--   • Catalog: INSERT ON CONFLICT(action,resource_type) DO NOTHING — cặp mới, chạy lại no-op.
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ ON CONFLICT KHÔNG
--     sửa scope. Per-pair: DELETE đúng (role_id,permission_id,'ALLOW') có scope SAI + INSERT lại target
--     (mirror 0445). ⛔ KHÔNG blanket DELETE theo role_id. App role KHÔNG có UPDATE trên role_permissions
--     (mig 0005) — đổi scope phải qua DELETE+INSERT (BẤT BIẾN #2).
--   • Idempotent đo BỘ BA (role_id, permission_id, data_scope): chạy lại = no-op.
--   • is_sensitive=false (admin config CRUD thường, mirror 0445 manage:master-data).
--
-- BAND 0457 (lane S2-HR-BE-7 / hrbe7-mig / db-migration). Journal: idx 137, when 1717500680000
--   (> head 0456 idx 136 / 1717500675000). NỐI TIẾP ĐƠN ĐIỆU forward-only/no-gap sau head thực tế
--   0456_s2_fndbe3_retention_audit_object_type. Drizzle migrator áp theo THỨ TỰ mảng journal (resolve
--   file theo `tag`). KHÔNG db:generate cho file này.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) UNION ADD-only 'employee_code_config' vào CHECK object_type của audit_logs (clone 0456).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['employee_code_config'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0457] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0457] employee_code_config da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0457] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) Catalog permission gaps. ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION).
--     (view,employee-code-config) + (update,employee-code-config) = CẶP MỚI (is_sensitive=false).
--     preview:employee-code ĐÃ seed 0445 — KHÔNG lặp.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view',   'employee-code-config', false),
  ('update', 'employee-code-config', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (c) Seed role_permissions THEO TỪNG CẶP (role, action, resource_type) = data_scope (mirror 0445).
--   API-03 §10.10: EMPLOYEE_CODE_CONFIG.VIEW/UPDATE = SA · CA · HR(✓). SA = runtime System (KHÔNG ở
--   đây). HR + CA → Company. manager/employee KHÔNG. Per-pair DELETE-wrong-scope + INSERT idempotent.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  grants CONSTANT text[][] := ARRAY[
    -- HR.EMPLOYEE_CODE_CONFIG.VIEW
    ['hr',            'view',   'employee-code-config', 'Company'],
    ['company-admin', 'view',   'employee-code-config', 'Company'],
    -- HR.EMPLOYEE_CODE_CONFIG.UPDATE
    ['hr',            'update', 'employee-code-config', 'Company'],
    ['company-admin', 'update', 'employee-code-config', 'Company']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    -- resolve role (system role canonical: company_id NULL, không xoá mềm)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0457] role canonical % không tồn tại — seed 0444/0005 phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog gap (b) phải đã chạy)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0457] permission (%:%) không có trong catalog — seed (b) phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id, permission_id, 'ALLOW') có scope SAI (per-pair, KHÔNG blanket).
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    -- INSERT lại scope target. ON CONFLICT(role_id,permission_id,effect) DO NOTHING → idempotent.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0457] EMPLOYEE_CODE_CONFIG perms seed: % cặp INSERT mới, % cặp re-scope (DELETE wrong-scope+INSERT)',
    v_seeded, v_rescoped;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('hr','company-admin') AND r.company_id IS NULL
--     AND (p.action,p.resource_type) IN (
--       ('view','employee-code-config'),('update','employee-code-config'));
-- DELETE FROM permissions WHERE (action,resource_type) IN
--   (('view','employee-code-config'),('update','employee-code-config'));
-- Re-stamp CHECK bỏ 'employee_code_config' (CHỈ khi không còn row audit_logs nào dùng nó).
