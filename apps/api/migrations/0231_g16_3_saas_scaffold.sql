-- Migration 0231: G16-3 SaaS prep — subscription / feature-flag / usage-limit SCAFFOLD (KIẾN TRÚC).
-- Gate: FULL (database-reviewer [RLS/grant] + security-reviewer + silent-failure-hunter).
--
-- BAND 0230-0239 (lane g16 SaaS prep). Journal idx 92, when 1717500270000 khi land (RECONCILE master max).
--
-- KHÔNG billing thật. Mô hình: CATALOG TOÀN CỤC (plans + entitlements, immutable runtime trong scaffold)
-- + PER-COMPANY (subscription/feature-flag/usage-limit/usage-counter, RLS company_id). Enforcement seam
-- (@RequireFeature / @EnforceUsageLimit) ở tầng app (saas module). BẤT BIẾN #1: mọi bảng per-company RLS.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- CATALOG TOÀN CỤC — KHÔNG company_id, KHÔNG RLS (mirror `permissions` 0005). App role SELECT-only.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE subscription_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT subscription_plans_code_uq UNIQUE (code)
);
--> statement-breakpoint
GRANT SELECT ON subscription_plans TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON subscription_plans TO mediaos_worker;
--> statement-breakpoint

CREATE TABLE plan_entitlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES subscription_plans (id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,
  kind            text NOT NULL,
  bool_value      boolean,
  limit_value     bigint,
  CONSTRAINT plan_entitlements_kind_chk CHECK (kind IN ('feature', 'limit')),
  -- feature ⇒ bool_value NOT NULL; limit ⇒ limit_value NOT NULL (>=0) — fail-loud nếu seed sai loại.
  CONSTRAINT plan_entitlements_value_chk CHECK (
    (kind = 'feature' AND bool_value IS NOT NULL AND limit_value IS NULL)
    OR (kind = 'limit' AND limit_value IS NOT NULL AND limit_value >= 0 AND bool_value IS NULL)
  ),
  CONSTRAINT plan_entitlements_plan_key_uq UNIQUE (plan_id, entitlement_key)
);
--> statement-breakpoint
GRANT SELECT ON plan_entitlements TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON plan_entitlements TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PER-COMPANY — company_id NOT NULL + ENABLE/FORCE RLS + policy tenant_isolation (BẤT BIẾN #1).
-- Config mutable (status/flag/limit/counter) ⇒ app role có UPDATE; KHÔNG DELETE (soft-delete deleted_at).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ── company_subscriptions (1 active/công ty) ────────────────────────────────────────────────────
CREATE TABLE company_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL
                        DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies (id) ON DELETE CASCADE,
  plan_id             uuid NOT NULL REFERENCES subscription_plans (id),
  status              text NOT NULL DEFAULT 'active',
  current_period_end  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT company_subscriptions_status_chk
    CHECK (status IN ('active', 'trialing', 'past_due', 'canceled'))
);
--> statement-breakpoint
-- 1 subscription active/công ty (partial unique trên non-deleted).
CREATE UNIQUE INDEX company_subscriptions_company_active_uq
  ON company_subscriptions (company_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX company_subscriptions_company_idx ON company_subscriptions (company_id);
--> statement-breakpoint
ALTER TABLE company_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON company_subscriptions
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON company_subscriptions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON company_subscriptions TO mediaos_worker;
--> statement-breakpoint

-- ── company_feature_flags (override bật/tắt per-company) ─────────────────────────────────────────
CREATE TABLE company_feature_flags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies (id) ON DELETE CASCADE,
  feature_key  text NOT NULL,
  enabled      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_feature_flags_company_key_uq UNIQUE (company_id, feature_key)
);
--> statement-breakpoint
ALTER TABLE company_feature_flags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_feature_flags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON company_feature_flags
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON company_feature_flags TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON company_feature_flags TO mediaos_worker;
--> statement-breakpoint

-- ── company_usage_limits (override hạn mức per-company) ──────────────────────────────────────────
CREATE TABLE company_usage_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies (id) ON DELETE CASCADE,
  metric_key   text NOT NULL,
  limit_value  bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_usage_limits_value_chk CHECK (limit_value >= 0),
  CONSTRAINT company_usage_limits_company_metric_uq UNIQUE (company_id, metric_key)
);
--> statement-breakpoint
ALTER TABLE company_usage_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_usage_limits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON company_usage_limits
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON company_usage_limits TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON company_usage_limits TO mediaos_worker;
--> statement-breakpoint

-- ── company_usage_counters (bộ đếm mutable theo metric+period) ───────────────────────────────────
CREATE TABLE company_usage_counters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies (id) ON DELETE CASCADE,
  metric_key   text NOT NULL,
  period       text NOT NULL DEFAULT 'lifetime',
  used_count   bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_usage_counters_value_chk CHECK (used_count >= 0),
  CONSTRAINT company_usage_counters_company_metric_period_uq UNIQUE (company_id, metric_key, period)
);
--> statement-breakpoint
ALTER TABLE company_usage_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_usage_counters FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON company_usage_counters
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON company_usage_counters TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON company_usage_counters TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SEED: plan catalog (free/pro/enterprise) + entitlements. UUID cố định để test/clone tham chiếu.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO subscription_plans (id, code, name, description, sort_order) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'free',       'Free',       'Gói miễn phí — giới hạn cơ bản', 0),
  ('00000000-0000-0000-0000-0000000000a2', 'pro',        'Pro',        'Gói chuyên nghiệp', 1),
  ('00000000-0000-0000-0000-0000000000a3', 'enterprise', 'Enterprise', 'Gói doanh nghiệp — hạn mức cao', 2)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO plan_entitlements (plan_id, entitlement_key, kind, bool_value, limit_value) VALUES
  -- free
  ('00000000-0000-0000-0000-0000000000a1', 'advanced_analytics', 'feature', false, NULL),
  ('00000000-0000-0000-0000-0000000000a1', 'custom_workflows',   'feature', false, NULL),
  ('00000000-0000-0000-0000-0000000000a1', 'max_users',          'limit',   NULL,  10),
  ('00000000-0000-0000-0000-0000000000a1', 'max_channels',       'limit',   NULL,  5),
  ('00000000-0000-0000-0000-0000000000a1', 'storage_gb',         'limit',   NULL,  5),
  -- pro
  ('00000000-0000-0000-0000-0000000000a2', 'advanced_analytics', 'feature', true,  NULL),
  ('00000000-0000-0000-0000-0000000000a2', 'custom_workflows',   'feature', true,  NULL),
  ('00000000-0000-0000-0000-0000000000a2', 'max_users',          'limit',   NULL,  100),
  ('00000000-0000-0000-0000-0000000000a2', 'max_channels',       'limit',   NULL,  100),
  ('00000000-0000-0000-0000-0000000000a2', 'storage_gb',         'limit',   NULL,  500),
  -- enterprise
  ('00000000-0000-0000-0000-0000000000a3', 'advanced_analytics', 'feature', true,  NULL),
  ('00000000-0000-0000-0000-0000000000a3', 'custom_workflows',   'feature', true,  NULL),
  ('00000000-0000-0000-0000-0000000000a3', 'max_users',          'limit',   NULL,  100000),
  ('00000000-0000-0000-0000-0000000000a3', 'max_channels',       'limit',   NULL,  100000),
  ('00000000-0000-0000-0000-0000000000a3', 'storage_gb',         'limit',   NULL,  100000)
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SEED: permissions self-service (company-admin xem/sửa subscription CỦA MÌNH — non-sensitive).
-- New perm KHÔNG tự vào company-admin (0005 chỉ grant perm tồn tại lúc đó) ⇒ GRANT tường minh.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view',   'subscription', false),
  ('manage', 'subscription', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (('view', 'subscription'), ('manage', 'subscription'))
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ── audit_logs CHECK +'company_subscription','feature_flag','usage_limit' (HOT-FILE §5.3 UNION DO-block) ──
-- Tiền lệ 0099/0132/0150/0190: ADD-only, đọc cả IN+ANY form, KHÔNG drop full-list ⇒ an toàn song song.
-- Sync AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit.
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['company_subscription', 'feature_flag', 'usage_limit'];
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

-- -------- Down (manual) --------
-- DROP TABLE company_usage_counters, company_usage_limits, company_feature_flags, company_subscriptions;
-- DROP TABLE plan_entitlements, subscription_plans;
-- DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE resource_type='subscription');
-- DELETE FROM permissions WHERE resource_type = 'subscription';
-- (audit CHECK: re-stamp without the 3 types — chỉ khi không audit_logs row dùng chúng.)
