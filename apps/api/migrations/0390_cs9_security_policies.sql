-- Migration 0390: CS-9 (🔴 CROWN-JEWEL) — per-company security policy (Bảo mật nâng cao).
--
-- BAND 0390-0399 (lane cs9). idx/when set lúc LAND (> master max). Re-stamp mỗi rebase.
--
-- MỤC TIÊU (CONSOLE-SYSTEM-UPGRADE §6 CS-9): mỗi tenant tự đặt chính sách bảo mật, enforce THẬT ở
--   tầng auth (login/refresh — IP allowlist + khung giờ + 2FA fail-STRICTER) và lúc tạo tài khoản
--   (email-domain). 1 hàng/công ty (UNIQUE company_id). companyId LẤY TỪ JWT/withTenant (KHÔNG body/param).
--
-- BẤT BIẾN:
--   #1 company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK +
--      index company_id + UNIQUE(company_id). Mọi repo qua withTenant(actor.companyId).
--   #3 KHÔNG secret/PII trong bảng: chỉ cấu hình (cờ + allowlist CIDR/giờ/domain + danh sách user-id miễn).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- company_security_policies — 1 hàng/công ty. MUTABLE qua app (SELECT/INSERT/UPDATE; KHÔNG DELETE —
-- reset = set cờ false). Default mọi cờ false / null ⇒ KHÔNG enforce (an toàn: bảng vắng = không khoá ai).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE company_security_policies (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                        uuid NOT NULL
                                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                      REFERENCES companies(id) ON DELETE CASCADE,
  -- Tự động đăng xuất (idle) — null = tắt. >0 = số phút (web-core idle timer; backstop = access-token TTL).
  auto_logout_minutes               integer,
  -- IP allowlist (fail-OPEN khi rỗng: enabled+[] coi như TẮT — chưa cấu hình, không tự khoá).
  ip_restriction_enabled            boolean NOT NULL DEFAULT false,
  allowlist_cidrs                   jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- Khung giờ (fail-CLOSED khi rỗng: enabled+[] = chặn — không có cửa sổ hợp lệ).
  time_restriction_enabled          boolean NOT NULL DEFAULT false,
  time_windows                      jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- Phạm vi áp: 'all' | 'selected' (+ apply_app_keys). MVP enforce coi 'all'; 'selected' lưu cấu hình.
  apply_scope                       text    NOT NULL DEFAULT 'all',
  apply_app_keys                    jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- User miễn giới hạn IP/giờ (chống tự khoá admin). uuid[].
  exempt_user_ids                   jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- Email-domain allowlist khi tạo tài khoản (rỗng/tắt = cho qua).
  email_domain_restriction_enabled  boolean NOT NULL DEFAULT false,
  allowed_email_domains             jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- 2FA: null = theo sàn global; true = ép thêm cho công ty. KHÔNG hạ global (fail-STRICTER ở guard).
  two_factor_enforced               boolean,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_security_policies_company_uq UNIQUE (company_id),
  CONSTRAINT company_security_policies_apply_scope_check CHECK (apply_scope IN ('all', 'selected'))
);
--> statement-breakpoint
ALTER TABLE company_security_policies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_security_policies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON company_security_policies
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX company_security_policies_company_id_idx ON company_security_policies(company_id);
--> statement-breakpoint
-- MUTABLE (1 hàng/công ty, upsert): app SELECT/INSERT + UPDATE mọi cột cấu hình. KHÔNG DELETE (reset=cờ false).
GRANT SELECT, INSERT ON company_security_policies TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (
  auto_logout_minutes, ip_restriction_enabled, allowlist_cidrs,
  time_restriction_enabled, time_windows, apply_scope, apply_app_keys,
  exempt_user_ids, email_domain_restriction_enabled, allowed_email_domains,
  two_factor_enforced, updated_at
) ON company_security_policies TO mediaos_app;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- audit_logs CHECK +'security_policy' (HOT-FILE §5.3 UNION DO-block, verbatim 0320). ADD-only, đọc CẢ
-- HAI dạng (IN + = ANY('{...}')). Sync AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['security_policy'];
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Permission seed: configure-security-policy:company (sensitive) + grant system-admin role tường minh.
-- is_sensitive=TRUE khai ở CẢ seed lẫn decorator (chống *:* wildcard bypass cổng nhạy cảm). ON CONFLICT
-- DO NOTHING (hot-file). requiresReauth KHÔNG ở DB seed (chỉ ở decorator — reuse console step-up window).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('configure-security-policy', 'company', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) = ('configure-security-policy', 'company')
ON CONFLICT DO NOTHING;

-- -------- Down (manual) --------
-- DROP TABLE company_security_policies;
-- DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE action='configure-security-policy');
-- DELETE FROM permissions WHERE action = 'configure-security-policy' AND resource_type = 'company';
-- (audit object_type CHECK: re-stamp without 'security_policy' — chỉ khi không row dùng nó.)
