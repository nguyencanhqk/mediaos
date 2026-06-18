-- Migration 0410: CS-10 (🔴 CROWN-JEWEL) — Mời / Duyệt / Kích hoạt user (user_invites).
--
-- BAND 0410-0419 (lane cs10). né 0400 (đã chiếm bởi fs1 refresh_token_family). idx/when set lúc LAND
-- (> master max idx 110 / when 1717500450000). Re-stamp mỗi rebase.
--
-- MỤC TIÊU (CONSOLE-SYSTEM-UPGRADE §6 CS-10): admin mời user qua email (token) → người được mời accept
--   (đặt mật khẩu, sessionless) → admin duyệt → tài khoản `users` ACTIVE được tạo. Hai hàng đợi:
--   "Yêu cầu kích hoạt" (pending) + "Chờ duyệt" (accepted).
--
-- BẤT BIẾN:
--   #1 company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK +
--      index company_id. Mọi repo qua withTenant(companyId). accept sessionless vẫn withTenant(slug→id).
--   #3 KHÔNG secret thật trong DB: token CHỈ qua email → lưu `token_hash` (sha256 hex). `password_hash`
--      argon2 (KHÔNG plaintext) — đặt ở accept, dời sang users.password_hash khi approve. KHÔNG vào DTO.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- user_invites — vòng đời lời mời. status: pending → accepted → approved | rejected.
--   MUTABLE: app SELECT/INSERT + UPDATE (status/password_hash/accepted_at/created_user_id/updated_at).
--   KHÔNG DELETE (terminal = status; lịch sử lời mời giữ lại). users row chỉ sinh ở APPROVE.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE user_invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  email              text NOT NULL,
  full_name          text NOT NULL,
  -- sha256 hex của token ngẫu nhiên (token THẬT chỉ đi qua email). Lookup accept = băm token rồi so khớp.
  token_hash         text NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  -- argon2 hash mật khẩu người dùng đặt lúc accept (NULL trước accept). KHÔNG plaintext. KHÔNG vào DTO.
  password_hash      text,
  expires_at         timestamptz NOT NULL,
  accepted_at        timestamptz,
  -- users.id được tạo khi admin duyệt (NULL trước approve). FK mềm (không ép — users cùng tenant qua RLS).
  created_user_id    uuid,
  invited_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invites_status_check
    CHECK (status IN ('pending', 'accepted', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_invites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON user_invites
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX user_invites_company_id_idx ON user_invites(company_id);
--> statement-breakpoint
-- Lookup token tại accept (theo tenant). Index trên (company_id, token_hash) — token_hash high-entropy.
CREATE INDEX user_invites_token_lookup_idx ON user_invites(company_id, token_hash);
--> statement-breakpoint
-- Chống mời trùng: tối đa 1 lời mời `pending` / email / công ty (case-insensitive). Terminal/accepted KHÔNG chặn.
CREATE UNIQUE INDEX user_invites_pending_email_uq
  ON user_invites(company_id, lower(email))
  WHERE status = 'pending';
--> statement-breakpoint
-- MUTABLE column-grant: app SELECT/INSERT + UPDATE các cột vòng đời. KHÔNG DELETE (terminal=status).
GRANT SELECT, INSERT ON user_invites TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (status, password_hash, accepted_at, created_user_id, full_name, token_hash, expires_at, updated_at)
  ON user_invites TO mediaos_app;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- audit_logs CHECK +'user_invite' (HOT-FILE UNION DO-block, verbatim 0390). ADD-only, đọc CẢ HAI dạng
-- (IN + = ANY('{...}')). Sync AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['user_invite'];
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
-- Permission seed: invite:user + approve:user (sensitive) + grant system-admin role tường minh.
-- is_sensitive=TRUE khai ở CẢ seed lẫn decorator (chống *:* wildcard bypass cổng nhạy cảm).
-- ON CONFLICT DO NOTHING (hot-file).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('invite', 'user', true),
  ('approve', 'user', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (('invite', 'user'), ('approve', 'user'))
ON CONFLICT DO NOTHING;

-- -------- Down (manual) --------
-- DROP TABLE user_invites;
-- DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE resource_type='user' AND action IN ('invite','approve'));
-- DELETE FROM permissions WHERE resource_type = 'user' AND action IN ('invite', 'approve');
-- (audit object_type CHECK: re-stamp without 'user_invite' — chỉ khi không row dùng nó.)
