-- Migration 0469: S2-FND-SEED-3 (🔴 RED, zone=red) — bootstrap dựng-từ-trống tự động.
--   (1) function ensure_default_company(slug,name,timezone,language,currency) SECURITY DEFINER
--   (2) cột users.must_change_password boolean NOT NULL DEFAULT false
-- Gate: FULL (security-reviewer + database-reviewer). Crown-jewel: bootstrap/auth + SECURITY DEFINER.
--
-- MỤC TIÊU (audit §4.2 — bỏ bước `psql` tay dựng company mặc định; DB-10 §17.2):
--   Boot với DB TRỐNG-sau-migrate (0 company) → BootstrapService (Lane B) gọi ensure_default_company từ env
--   BOOTSTRAP_COMPANY_* → tạo tenant-gốc IDEMPOTENT rồi SuperAdminBootstrap tạo super-admin. must_change_password
--   ép admin đổi mật khẩu lần đầu (DB-10 §17.2 điểm 5).
--
-- LỖ THỦNG RLS CÓ KIỂM SOÁT (mirror resolve_company_by_slug mig 0002, BẤT BIẾN #1):
--   companies đang FORCE ROW LEVEL SECURITY (mig 0002) ⇒ pre-auth/pre-tenant KHÔNG đọc/ghi được nếu thiếu
--   ngữ cảnh app.current_company_id. Bootstrap chạy TRƯỚC khi có tenant-context (chưa có company để mở
--   withTenant). Hàm SECURITY DEFINER owner=superuser (bypass RLS) tạo tenant-ROOT — hợp lệ & HẸP:
--     • SET search_path = pg_catalog + fully-qualify public.companies (chống search_path hijack — mirror mig 0002).
--     • N=1 guard: nếu ĐÃ CÓ bất kỳ company status='active' (chưa xoá mềm) → TRẢ VỀ công ty đó, KHÔNG tạo mới
--       (single-company; không đẻ tenant thứ 2 khi đã có active — owner-chốt #5).
--     • Tạo mới qua INSERT ... ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING (idempotent chống race
--       2 tiến trình bootstrap + tái dùng slug sau soft-delete). Trả id/status.
--   REVOKE ALL ON FUNCTION ... FROM PUBLIC TRƯỚC rồi GRANT EXECUTE cho mediaos_app (owner-chốt #1/#2) ⇒ role
--   DB ≠ mediaos_app EXECUTE → permission-denied (owner-chốt #3, deny-path Lane D).
--
-- MAPPING PARAM → CỘT (owner-chốt #4 — LỆCH DB-10 §17.1, code CHECK thắng):
--   p_language → companies.language: CHECK language IN ('vi','en') (mig 0015) ⇒ default env = 'vi' (KHÔNG 'vi-VN').
--   p_currency → companies.currency: CHECK currency IN ('VND','USD') (mig 0015) ⇒ default env = 'VND'.
--   p_timezone → companies.timezone (KHÔNG CHECK, mig 0015 default 'Asia/Ho_Chi_Minh').
--
-- HOT-FILE / BẤT BIẾN:
--   • THUẦN ADDITIVE. KHÔNG đụng RLS/FORCE/policy/grant bảng companies|users (đã có RLS+FORCE mig 0002 — GIỮ NGUYÊN).
--     KHÔNG backfill company_id (chỉ add cột default false + tạo tenant-root qua definer khi runtime).
--   • must_change_password NOT NULL DEFAULT false ⇒ user hiện có nhận false qua DEFAULT (KHÔNG câu UPDATE riêng).
--   • KHÔNG db:generate — function/grant KHÔNG biểu diễn được bằng drizzle schema → viết SQL tay (convention 04xx).
--     Drizzle users.ts CHỈ sync cột must_change_password (function SQL-only).
--   • Fail-LOUD (mẫu mig 0466/0467): RAISE nếu function không SECURITY DEFINER / thiếu search_path / PUBLIC vẫn có
--     EXECUTE / mediaos_app thiếu EXECUTE / cột vắng — tránh âm thầm trượt hardening.
--
-- BAND 0469 (lane SEED3-A-mig). Journal: idx 149, when 1717500740000 (> head 0468 idx 148 / 1717500735000).
--   Nối tiếp ĐƠN ĐIỆU sau 0468_s2_fndbe6_public_holiday_audit_object_type.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (1) ensure_default_company — tạo tenant-ROOT idempotent (SECURITY DEFINER, N=1 guard).
--     plpgsql (cần rẽ nhánh guard + fallback on-conflict). OUT id/status ⇒ RETURNING/SELECT dùng cột
--     ĐÃ-QUALIFY (companies.id / c.id) để KHÔNG bị plpgsql hiểu nhầm thành biến OUT (variable-shadow trap).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ensure_default_company(
  p_slug     citext,
  p_name     text,
  p_timezone text,
  p_language text,
  p_currency text
)
  RETURNS TABLE (id uuid, status text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  v_id     uuid;
  v_status text;
BEGIN
  -- N=1 guard: đã có company active (chưa xoá mềm) → trả về công ty đó, KHÔNG tạo tenant thứ 2.
  SELECT c.id, c.status
    INTO v_id, v_status
  FROM public.companies c
  WHERE c.status = 'active' AND c.deleted_at IS NULL
  ORDER BY c.created_at
  LIMIT 1;

  IF FOUND THEN
    id := v_id;
    status := v_status;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Chưa có company active → tạo tenant-root idempotent (chống race + tái dùng slug sau soft-delete).
  INSERT INTO public.companies (name, slug, status, timezone, language, currency)
  VALUES (p_name, p_slug, 'active', p_timezone, p_language, p_currency)
  ON CONFLICT (slug) WHERE deleted_at IS NULL
  DO NOTHING
  RETURNING companies.id, companies.status
    INTO v_id, v_status;

  IF NOT FOUND THEN
    -- Conflict (slug đã tồn tại ở hàng chưa xoá mềm) → trả về hàng hiện có theo slug.
    SELECT c.id, c.status
      INTO v_id, v_status
    FROM public.companies c
    WHERE c.slug = p_slug AND c.deleted_at IS NULL
    LIMIT 1;
  END IF;

  id := v_id;
  status := v_status;
  RETURN NEXT;
  RETURN;
END;
$$;
--> statement-breakpoint

-- REVOKE ALL FROM PUBLIC TRƯỚC (owner-chốt #1) — chặn mọi role trừ owner; xoá EXECUTE mặc-định-cấp-PUBLIC.
REVOKE ALL ON FUNCTION ensure_default_company(citext, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint

-- GRANT EXECUTE chỉ cho app-role (owner-chốt #2). role DB ≠ mediaos_app → permission-denied (deny-path).
GRANT EXECUTE ON FUNCTION ensure_default_company(citext, text, text, text, text) TO mediaos_app;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) users.must_change_password — ép đổi mật khẩu lần đầu (admin bootstrap set true ở Lane B upsert).
--     NOT NULL DEFAULT false ⇒ mọi user hiện có nhận false qua DEFAULT (KHÔNG backfill). KHÔNG đụng RLS.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- Fail-LOUD hardening assert (đo qua catalog — Đội 3/Lane D nghiệm thu cùng qua pg_proc):
--   prosecdef=true · proconfig chứa search_path=pg_catalog · proacl KHÔNG cấp EXECUTE cho PUBLIC ·
--   mediaos_app CÓ EXECUTE · cột must_change_password tồn tại. RAISE nếu bất kỳ điều kiện trượt.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_secdef      boolean;
  v_config      text[];
  v_acl         aclitem[];
  v_public_exec boolean;
BEGIN
  SELECT p.prosecdef, p.proconfig, p.proacl
    INTO v_secdef, v_config, v_acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ensure_default_company';

  IF NOT FOUND THEN
    RAISE EXCEPTION '[0469] function public.ensure_default_company không tồn tại sau migrate';
  END IF;

  IF v_secdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[0469] ensure_default_company KHÔNG SECURITY DEFINER (prosecdef != true)';
  END IF;

  IF v_config IS NULL OR NOT ('search_path=pg_catalog' = ANY (v_config)) THEN
    RAISE EXCEPTION '[0469] ensure_default_company thiếu SET search_path=pg_catalog (proconfig=%)', v_config;
  END IF;

  -- proacl NULL = ACL mặc định ⇒ PUBLIC vẫn có EXECUTE (REVOKE trượt). Sau REVOKE ALL FROM PUBLIC proacl
  -- phải non-null (chỉ liệt kê grant tường minh).
  IF v_acl IS NULL THEN
    RAISE EXCEPTION '[0469] ensure_default_company proacl NULL (mặc định) — REVOKE ALL FROM PUBLIC không áp; PUBLIC vẫn có EXECUTE';
  END IF;

  SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    INTO v_public_exec
  FROM aclexplode(v_acl) a;
  IF COALESCE(v_public_exec, false) THEN
    RAISE EXCEPTION '[0469] ensure_default_company VẪN cấp EXECUTE cho PUBLIC — REVOKE ALL FROM PUBLIC trượt (owner-chốt #1)';
  END IF;

  IF NOT has_function_privilege(
       'mediaos_app',
       'public.ensure_default_company(citext,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION '[0469] mediaos_app THIẾU EXECUTE trên ensure_default_company — GRANT trượt (owner-chốt #2)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'must_change_password'
  ) THEN
    RAISE EXCEPTION '[0469] cột users.must_change_password không tồn tại sau migrate';
  END IF;

  RAISE NOTICE '[0469] ensure_default_company (SECURITY DEFINER · search_path=pg_catalog · EXECUTE mediaos_app-only · REVOKE PUBLIC) + users.must_change_password OK';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
-- DROP FUNCTION IF EXISTS ensure_default_company(citext, text, text, text, text);
