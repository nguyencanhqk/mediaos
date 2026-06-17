-- Migration 0310: AC-5 (🔴 CROWN-JEWEL) — API key / Personal Access Token (PAT) per-tenant.
--
-- BAND 0310-0319 (lane ac5). idx/when set lúc LAND (> master max). Re-stamp mỗi rebase.
--
-- MỤC TIÊU (PRD §4 N5a): PAT cho MỌI route apps/api. Auth-pipeline TOÀN CỤC: ApiKeyAuthGuard chạy TRƯỚC
--   PermissionGuard, verify hash + expiry + revoke → set req.user{viaApiKey, scopePermissionIds}; request
--   chạy withTenant(company_id của KEY). Hiệu lực = scope ∩ grant THỰC user (fail-closed, KHÔNG vượt quyền).
--
-- BẤT BIẾN:
--   #1 company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK (cả 2 bảng).
--   #2 api_key_usages = APPEND-ONLY (app SELECT/INSERT, KHÔNG UPDATE/DELETE). api_keys MUTABLE column-grant:
--      app UPDATE CHỈ last_used_at (debounced touch) + revoked_at (thu hồi) — KHÔNG sửa token_hash/scope/
--      expires_at/user_id (frozen sau khi tạo).
--   #3 KHÔNG secret plaintext: chỉ token_hash (sha256 hex) + token_prefix. Plaintext mok_<...> trả 1 lần lúc
--      tạo (KHÔNG lưu/log/DTO/audit-detail). scope_permission_ids trỏ permissions catalog (uuid[]).

-- ===== api_keys: PAT (MUTABLE column-grant) =====
CREATE TABLE api_keys (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                         REFERENCES companies(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id),
  name                 text NOT NULL,
  token_prefix         text NOT NULL,
  token_hash           text NOT NULL,
  scope_permission_ids uuid[] NOT NULL,
  expires_at           timestamptz,
  revoked_at           timestamptz,
  last_used_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON api_keys
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- company_id index (BẮT BUỘC cho RLS scan).
CREATE INDEX api_keys_company_id_idx ON api_keys(company_id);
--> statement-breakpoint
CREATE INDEX api_keys_company_prefix_idx ON api_keys(company_id, token_prefix);
--> statement-breakpoint
-- Auth-path (ApiKeyAuthGuard → resolve_api_key_by_hash) tra theo token_hash ở MỌI request. UNIQUE index:
-- (1) đỡ seq-scan hot-path, (2) ÉP bất biến collision-free mà SECURITY DEFINER lookup dựa vào (1 hash ⇒ ≤1 key).
CREATE UNIQUE INDEX api_keys_token_hash_key ON api_keys(token_hash);
--> statement-breakpoint
-- App: SELECT/INSERT + UPDATE CHỈ last_used_at (debounced) + revoked_at (thu hồi). KHÔNG UPDATE token_hash/
-- scope/expires_at/user_id (frozen sau request) → chống đổi quyền/gia hạn key qua app.
GRANT SELECT, INSERT ON api_keys TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (last_used_at, revoked_at) ON api_keys TO mediaos_app;
--> statement-breakpoint

-- ===== api_key_usages: log dùng PAT (APPEND-ONLY) =====
CREATE TABLE api_key_usages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  api_key_id  uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  used_at     timestamptz NOT NULL DEFAULT now(),
  route       text,
  ip          text
);
--> statement-breakpoint
ALTER TABLE api_key_usages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_key_usages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON api_key_usages
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX api_key_usages_company_id_idx ON api_key_usages(company_id);
--> statement-breakpoint
CREATE INDEX api_key_usages_key_idx ON api_key_usages(company_id, api_key_id);
--> statement-breakpoint
-- APPEND-ONLY (BẤT BIẾN #2): app SELECT/INSERT, KHÔNG UPDATE/DELETE.
GRANT SELECT, INSERT ON api_key_usages TO mediaos_app;
--> statement-breakpoint

-- ===== resolve_api_key_by_hash: SECURITY DEFINER lookup cho auth-path (cross-tenant, HẸP) =====
-- Auth-path KHÔNG biết company_id trước khi tra key (token chỉ mang secret, KHÔNG company_id — tránh lộ
-- tenant trong token). api_keys là FORCE-RLS ⇒ query thường (mediaos_app) thấy 0 row khi chưa set
-- app.current_company_id. Giải bằng 1 function SECURITY DEFINER HẸP: resolve theo TOKEN_HASH (sha256 hex,
-- DUY NHẤT — KHÔNG dựa prefix có thể trùng giữa tenant), trả ĐÚNG cột cần để verify expiry/revoke + dựng
-- req.user. token_hash là HASH (không phải secret khôi phục được). KHÔNG mở SELECT bảng. Sau khi verify, MỌI
-- data-access của PAT chạy withTenant(company_id của key) → RLS scope đúng tenant (defense-in-depth:
-- resolution chéo tenant nhưng request bị khoá tenant của key). Owner = migration role (superuser) → bypass
-- RLS CHỈ trong function này. So khớp token_hash đầy đủ = đã chứng minh sở hữu token (equiv password check).
CREATE FUNCTION resolve_api_key_by_hash(p_token_hash text)
RETURNS TABLE (
  id                   uuid,
  company_id           uuid,
  user_id              uuid,
  token_hash           text,
  scope_permission_ids uuid[],
  expires_at           timestamptz,
  revoked_at           timestamptz,
  last_used_at         timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT k.id, k.company_id, k.user_id, k.token_hash, k.scope_permission_ids,
         k.expires_at, k.revoked_at, k.last_used_at
  FROM api_keys k
  WHERE k.token_hash = p_token_hash;
$$;
--> statement-breakpoint
-- Chặn PUBLIC execute (chỉ app role gọi auth-path). REVOKE FROM PUBLIC + GRANT mediaos_app.
REVOKE ALL ON FUNCTION resolve_api_key_by_hash(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_api_key_by_hash(text) TO mediaos_app;
--> statement-breakpoint

-- ===== audit_logs CHECK +'api_key' (DO-block ADD-only, tiền lệ 0099/0132/0140/0150/0200/0231) =====
-- HOT-FILE (TASKS §5.3): audit CHECK = UNION mọi lane. Đọc CẢ HAI dạng (`IN (...)` VÀ `= ANY ('{...}'::text[])`).
--   Chỉ thêm 'api_key'. Sync AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit. KHÔNG drop+full-rewrite.
--   'api_key' = object_type cho audit create/revoke PAT (ApiKeysService ghi cùng tx; KHÔNG token material).
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['api_key'];
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

-- ===== Permission seed: manage:api-key (sensitive) + grant company-admin tường minh =====
-- PRD §5.y: manage:api-key is_sensitive=TRUE (khai ở CẢ seed lẫn decorator — chống *:* wildcard bypass cổng
--   nhạy cảm). Grant TƯỜNG MINH company-admin (00000001). ON CONFLICT DO NOTHING (idempotent, hot-file).
--   Sensitive KHÔNG tự lan qua wildcard/role generic (permission.service: chỉ exact non-wildcard ALLOW).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('manage', 'api-key', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.action = 'manage' AND p.resource_type = 'api-key'
ON CONFLICT DO NOTHING;
