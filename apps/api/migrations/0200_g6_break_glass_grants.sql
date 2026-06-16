-- Migration 0200: G6-2 PR-B (🔴 CROWN-JEWEL) — break-glass emergency access: grant + SoD 2-người approval.
--
-- BAND 0200-0209 (lane b5 — KMS break-glass). idx 88, when 1717500230000 (> max applied 1717500220000).
--   Branch `feat/b5-kms-breakglass` KHÔNG khớp regex g(\d+) → guard-migration-band fail-open (giống b1/b4).
--
-- MỤC TIÊU (ROUND 1): vòng đời quyền truy cập khẩn cấp 1 platform_account secret — request → approve (SoD
--   2-người KHÁC NHAU) → active → revoke, có TTL. KHÔNG đụng reveal-path (ROUND 2 tái dùng revealSecret).
--
-- SoD (segregation of duties) ÉP Ở DB (KHÔNG chỉ ở service — defense-in-depth):
--   • UNIQUE (company_id, grant_id, approver_user_id)  → 1 người duyệt 1 lần / grant (chống duyệt-trùng).
--   • CHECK (approver_user_id <> requester_user_id)     → chống tự-duyệt (requester denormalized lên hàng approval).
--   • required_approvals >= 2                            → 1/0 người duyệt KHÔNG bao giờ kích hoạt được (tập rỗng).
--   • Service flip 'active' chỉ khi COUNT(DISTINCT approver) >= required_approvals (logic ở break-glass-grant.service).
--
-- BẤT BIẾN: company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK (#1).
--   break_glass_approvals = APPEND-ONLY (app SELECT/INSERT, KHÔNG UPDATE/DELETE — #2). break_glass_grants =
--   MUTABLE status FSM nhưng column-grant: app UPDATE CHỈ cột vòng đời (status/activated_at/revoked_*) — KHÔNG
--   sửa được account/requester/reason/expires_at/required_approvals (frozen sau khi request).
--   KHÔNG secret plaintext ở đây (#3): break_glass_grants chỉ trỏ platform_account_id; secret ở ROUND 2 reveal.

-- ===== break_glass_grants: yêu cầu break-glass (MUTABLE status FSM, column-grant) =====
CREATE TABLE break_glass_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL
                        DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies(id) ON DELETE CASCADE,
  platform_account_id uuid NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  requester_user_id   uuid NOT NULL REFERENCES users(id),
  reason              text NOT NULL,
  required_approvals  int  NOT NULL DEFAULT 2,
  status              text NOT NULL DEFAULT 'pending',
  activated_at        timestamptz,
  revoked_at          timestamptz,
  revoked_by          uuid REFERENCES users(id),
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE break_glass_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE break_glass_grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON break_glass_grants
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- company_id index (BẮT BUỘC cho RLS scan).
CREATE INDEX break_glass_grants_company_id_idx ON break_glass_grants(company_id);
--> statement-breakpoint
CREATE INDEX break_glass_grants_company_account_idx
  ON break_glass_grants(company_id, platform_account_id);
--> statement-breakpoint
-- Tra cứu nhanh grant 'active' của 1 requester trên 1 account (ROUND 2 reveal gate đọc qua đây).
CREATE INDEX break_glass_grants_active_idx
  ON break_glass_grants(company_id, platform_account_id, requester_user_id)
  WHERE status = 'active';
--> statement-breakpoint
ALTER TABLE break_glass_grants
  ADD CONSTRAINT break_glass_grants_status_check CHECK (status IN ('pending','active','revoked')),
  -- SoD: ngưỡng tối thiểu 2 người duyệt khác nhau (1/0 KHÔNG đủ → tập rỗng/đơn lẻ không kích hoạt được).
  ADD CONSTRAINT break_glass_grants_required_approvals_check CHECK (required_approvals >= 2),
  -- TTL hợp lệ: hết hạn phải sau lúc tạo (chống grant đã-chết-từ-đầu qua app).
  ADD CONSTRAINT break_glass_grants_ttl_check CHECK (expires_at > created_at),
  -- active ⇒ có vết kích hoạt. OR-form NULL-safe (status NOT NULL).
  ADD CONSTRAINT break_glass_grants_active_pair_check
    CHECK (status <> 'active' OR activated_at IS NOT NULL),
  -- revoked ⇒ có vết thu hồi đầy đủ (ai + khi nào).
  ADD CONSTRAINT break_glass_grants_revoked_pair_check
    CHECK (status <> 'revoked' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL));
--> statement-breakpoint
-- App: SELECT/INSERT + UPDATE CHỈ cột vòng đời (status FSM). KHÔNG cấp UPDATE cột bất biến
-- (platform_account_id/requester_user_id/reason/required_approvals/expires_at) → frozen sau request.
GRANT SELECT, INSERT ON break_glass_grants TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (status, activated_at, revoked_at, revoked_by, updated_at)
  ON break_glass_grants TO mediaos_app;
--> statement-breakpoint

-- ===== break_glass_approvals: phiếu duyệt (APPEND-ONLY) — SoD ép Ở DB =====
CREATE TABLE break_glass_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  grant_id          uuid NOT NULL REFERENCES break_glass_grants(id) ON DELETE CASCADE,
  approver_user_id  uuid NOT NULL REFERENCES users(id),
  -- requester denormalized lên hàng approval → CHECK self-approve ép được Ở DB (FK không có ngữ cảnh actor).
  requester_user_id uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE break_glass_approvals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE break_glass_approvals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON break_glass_approvals
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX break_glass_approvals_company_id_idx ON break_glass_approvals(company_id);
--> statement-breakpoint
CREATE INDEX break_glass_approvals_grant_idx ON break_glass_approvals(company_id, grant_id);
--> statement-breakpoint
-- Anti duyệt-trùng: 1 người duyệt tối đa 1 lần / grant (company_id dẫn đầu — NULL-safe, RLS-aligned).
CREATE UNIQUE INDEX break_glass_approvals_grant_approver_uq
  ON break_glass_approvals(company_id, grant_id, approver_user_id);
--> statement-breakpoint
-- Anti tự-duyệt (SoD) ÉP Ở DB: người duyệt KHÁC người yêu cầu.
ALTER TABLE break_glass_approvals
  ADD CONSTRAINT break_glass_approvals_sod_check CHECK (approver_user_id <> requester_user_id);
--> statement-breakpoint
-- APPEND-ONLY (BẤT BIẾN #2): app SELECT/INSERT, KHÔNG UPDATE/DELETE. KHÔNG grant worker (break-glass là app-tenant).
GRANT SELECT, INSERT ON break_glass_approvals TO mediaos_app;
--> statement-breakpoint

-- ===== Trigger HẸP FSM break_glass_grants (mirror payroll_periods 0130 status guard) =====
-- Mở rộng BẤT BIẾN §2: sau khi grant rời 'pending', CẤM lùi/đổi sai trạng thái. Chuyển HỢP LỆ:
--   pending→active (đủ duyệt) · pending→revoked (huỷ trước duyệt) · active→revoked (thu hồi sau kích hoạt).
-- Chặn MỌI chuyển khác (active→pending, revoked→*, …). Chỉ kiểm OLD.status vs NEW.status (đổi field khác
-- trong cùng UPDATE flip status — vd set activated_at — KHÔNG bị ảnh hưởng). Thông điệp chỉ id+status.
CREATE FUNCTION enforce_break_glass_grant_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> NEW.status THEN
    IF NOT ((OLD.status = 'pending' AND NEW.status IN ('active','revoked'))
         OR (OLD.status = 'active'  AND NEW.status = 'revoked')) THEN
      RAISE EXCEPTION
        'break_glass_grant_status: chuyển trạng thái không hợp lệ % → % (grant=%)',
        OLD.status, NEW.status, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER break_glass_grant_status_guard
  BEFORE UPDATE ON break_glass_grants
  FOR EACH ROW
  EXECUTE FUNCTION enforce_break_glass_grant_status();
--> statement-breakpoint

-- ===== audit_logs CHECK +'break_glass_access' (DO-block ADD-only, tiền lệ 0099/0132/0140/0150) =====
-- HOT-FILE (TASKS §5.3): audit CHECK = UNION mọi lane. Đọc CẢ HAI dạng constraint (`IN (...)` VÀ
--   `= ANY ('{...}'::text[])` — output các DO-block trước). Chỉ thêm 'break_glass_access'. Sync
--   AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit. KHÔNG drop+full-rewrite (an toàn song song, không rớt
--   type lane khác). 'break_glass_access' = object_type cho audit request/approve/activate/revoke break-glass
--   (BreakGlassGrantService ghi cùng tx app-tenant — KHÔNG secret/key material vào before/after, BẤT BIẾN #3).
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['break_glass_access'];
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

-- ===== Permission seed: request/approve break-glass (sensitive, NO system role — anti-escalation mirror 0027) =====
-- ADR-0010 anti-escalation: hành động break-glass nhạy cảm KHÔNG gán cho bất kỳ system role nào mặc định.
--   Mỗi tenant tự cấp tường minh cho role được uỷ quyền (vd security-officer). Wildcard *:* KHÔNG thoả gate
--   nhạy cảm (permission.service: chỉ exact non-wildcard ALLOW). ON CONFLICT DO NOTHING (idempotent, hot-file).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('request-break-glass', 'break-glass', true),
  ('approve-break-glass', 'break-glass', true),
  ('revoke-break-glass',  'break-glass', true)
ON CONFLICT (action, resource_type) DO NOTHING;
