-- Migration 0473: S2-FND-SEED-3 (🔴 RED, zone=red) — ensure_default_company an-toàn-race qua ADVISORY LOCK.
--   CREATE OR REPLACE ensure_default_company — GIỮ NGUYÊN hardening 0469 (SECURITY DEFINER · SET search_path=
--   pg_catalog · REVOKE PUBLIC / GRANT mediaos_app) + THÊM `pg_advisory_xact_lock` là câu ĐẦU TIÊN của thân
--   hàm ⇒ SERIALIZE mọi lần GỌI ĐỒNG THỜI của chính bootstrap này: chỉ 1 caller chạy critical-section
--   (guard-SELECT N=1 → INSERT) tại một thời điểm; caller còn lại CHỜ khoá tới khi tx của caller trước kết thúc,
--   rồi guard-SELECT (snapshot TƯƠI, READ COMMITTED · hàm VOLATILE) thấy winner đã commit → trả winner idempotent.
-- Gate: FULL (security-reviewer + database-reviewer). Crown-jewel: bootstrap/auth + SECURITY DEFINER.
--
-- BAND 0473 (lane SEED3-A-mig). Journal: idx 153, when 1717500760000 (> head 0472 idx 152 / 1717500755000).
--   Nối tiếp ĐƠN ĐIỆU sau head 0472_s2_fnddb2_index_uq_audit_trigger.
--   ⛔ KHÔNG sửa 0469 (idx 149 — ĐÃ commit, bị 0470–0472 vượt qua): DB đã migrate sẽ KHÔNG re-apply ⇒ rewrite = drift.
--      Thay đổi function đi qua CREATE OR REPLACE Ở ĐÂY (idx 153) để mọi DB — sạch lẫn đã-migrate — hội tụ 1 định nghĩa.
--
-- MỤC TIÊU (audit QA-06 security/race — vá lỗ "2 bootstrap khác slug cùng lúc" → 2 company active):
--   0469 chặn TRÙNG SLUG (ON CONFLICT slug) + N=1 guard (SELECT trước INSERT). Nhưng 2 bootstrap KHÁC SLUG chạy
--   song song trên companies rỗng: cả hai qua N=1 guard (0 active), cả hai INSERT (slug khác ⇒ ON CONFLICT slug
--   KHÔNG bắt) ⇒ 2 company active. Vá bằng ADVISORY LOCK trong CHÍNH hàm:
--     pg_advisory_xact_lock(hashtext('ensure_default_company')) — khoá tư vấn tầm-transaction, KEY toàn cục cố
--     định RIÊNG cho hàm này. Caller thứ 2 CHỜ tại câu đầu tiên tới khi tx của caller thứ 1 commit/rollback ⇒
--     guard-SELECT của caller thứ 2 (câu SQL RIÊNG, hàm VOLATILE ⇒ snapshot TƯƠI dưới READ COMMITTED) thấy company
--     mà caller thứ 1 vừa tạo → guard HIT → trả winner, KHÔNG đẻ tenant thứ 2. Không thể có 2 active từ race gọi-hàm.
--   Khoá tự nhả khi tx của caller kết thúc (xact-scoped) — service gọi 1 câu SELECT auto-commit ⇒ nhả NGAY sau call.
--   ensure_default_company chỉ chạy lúc COLD-BOOT (hiếm, tần suất thấp) ⇒ 1 KEY khoá toàn cục HẸP cho riêng hàm là
--   an toàn, gần như KHÔNG có tranh chấp thực tế (chỉ tuần-tự-hoá đúng những lần bootstrap đua nhau).
--   Tie-break TẤT ĐỊNH created_at ASC, id ASC ⇒ winner đơn trị, khử flake ~3.7% (DB10-TC-003 deterministic).
--
-- VÌ SAO KHÔNG dùng UNIQUE INDEX partial "một-active-toàn-DB" (bản trước của migration NÀY, đã BỎ):
--   Cách cũ `CREATE UNIQUE INDEX uq_companies_single_active ON companies ((true)) WHERE status='active' AND
--   deleted_at IS NULL` chặn CỨNG >1 hàng active TOÀN DB. Nhưng nó QUÁ RỘNG: phá bất biến kiến-trúc "đa-công-ty
--   sẵn-sàng-mở-rộng" (CLAUDE.md §2 #1 — N=1 hôm nay, KHÔNG tháo hạ tầng đa-tenant), và làm ĐỎ db-rls.int-spec.ts
--   + ~141 file test dùng fixture seedCompany() dựng 2 company active (tenant A + B) để CHỨNG minh cô lập tenant.
--   Race chỉ xảy ra ở đường bootstrap-gọi-hàm ⇒ sửa ĐÚNG chỗ đó bằng advisory-lock; KHÔNG đặt ràng buộc lên bảng
--   companies (không đụng cô lập tenant, không phá khả năng dựng N công ty active — đó là hành vi ĐÚNG, không phải bug).
--
-- BẤT BIẾN (CLAUDE.md §2/§3):
--   #1 company_id/RLS: KHÔNG tạo bảng mới, KHÔNG backfill company_id, KHÔNG thêm ràng buộc lên companies.
--      companies GIỮ NGUYÊN RLS ENABLE/FORCE + policy (mig 0002). Migration này CHỈ CREATE OR REPLACE 1 function
--      (SECURITY DEFINER owner=superuser, lỗ-thủng-RLS-có-kiểm-soát đã hợp thức hoá ở 0469). THUẦN ADDITIVE.
--   #2 không hard-delete: N=1 guard chỉ tính hàng deleted_at IS NULL ⇒ tôn trọng soft-delete. KHÔNG rewrite
--      CHECK/grant bảng khác.
--   #3 không secret: function chỉ nhận tham số slug/name/tz/lang/currency (từ env BOOTSTRAP_COMPANY_* ở Lane B) —
--      KHÔNG log, KHÔNG chứa secret.
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008) — tie-break dùng created_at (timestamptz) + id (uuid).
--
-- HOT-FILE / an-toàn re-run: CREATE OR REPLACE FUNCTION + REVOKE/GRANT idempotent. Function/grant/advisory-lock
--   KHÔNG biểu diễn được bằng drizzle schema ⇒ SQL-only (giữ convention 04xx hand-written cho function/grant).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- HỘI TỤ PHÒNG VỆ (security-reviewer round SEED-3 fix): DROP index bản-cũ-đã-bỏ nếu có. Journal 'when' của
--   migration NÀY không đổi so với bản trung gian (commit 14e0785, chỉ tồn tại trên nhánh làm việc — CHƯA
--   lên master) từng tạo uq_companies_single_active — nếu 1 DB dev/LANE nào đã lỡ áp bản trung gian đó TRƯỚC
--   khi rewrite này ra đời, drizzle sẽ KHÔNG re-apply (đã ghi journal cùng idx/when) ⇒ index cũ có thể còn sót,
--   tái phá 2-tenant test + chặn nhầm company thứ 2. DROP IF EXISTS ở đây đảm bảo MỌI DB (sạch lẫn đã lỡ áp bản
--   cũ) đều hội tụ về cùng 1 trạng thái cuối — vô hại trên DB sạch (chưa từng có index này).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.uq_companies_single_active;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE ensure_default_company — GIỮ NGUYÊN chữ ký (citext,text,text,text,text) ⇒ ACL (REVOKE/
--   GRANT 0469) được bảo toàn qua replace; ta vẫn RE-APPLY REVOKE/GRANT bên dưới cho tự-chứa & idempotent.
--   THÊM: pg_advisory_xact_lock(hashtext('ensure_default_company')) là câu ĐẦU TIÊN — tuần-tự-hoá mọi lần gọi
--   ĐỒNG THỜI (chỉ 1 caller vào critical-section guard→INSERT; caller khác CHỜ tới khi tx trước kết thúc rồi
--   guard HIT trên winner đã commit ⇒ KHÔNG đẻ tenant thứ 2, KHÔNG cần bắt 23505 vì đua đã bị tuần-tự-hoá).
--   OUT id/status ⇒ tham chiếu cột ĐÃ-QUALIFY (companies.id / c.id) tránh plpgsql shadow biến OUT.
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
  -- Tuần-tự-hoá mọi lần GỌI ĐỒNG THỜI của bootstrap này: khoá tư vấn tầm-transaction, KEY toàn cục cố định
  -- (hashtext của tên hàm). Chỉ 1 caller giữ khoá tại một thời điểm ⇒ critical-section guard-SELECT + INSERT
  -- chạy tuần tự; caller khác CHỜ tới khi tx của caller trước kết thúc. Khoá tự nhả khi tx kết thúc (xact-scoped).
  PERFORM pg_advisory_xact_lock(hashtext('ensure_default_company'));

  -- N=1 guard (TẤT ĐỊNH created_at ASC, id ASC): đã có company active (chưa xoá mềm) → trả về winner, KHÔNG tạo mới.
  -- Hàm VOLATILE ⇒ dưới READ COMMITTED câu SELECT này lấy snapshot TƯƠI SAU khi giành khoá ⇒ thấy company mà
  -- caller đua trước vừa commit ngay trước khi nhả khoá (idempotent dưới race THẬT, không cần bắt unique_violation).
  SELECT c.id, c.status
    INTO v_id, v_status
  FROM public.companies c
  WHERE c.status = 'active' AND c.deleted_at IS NULL
  ORDER BY c.created_at ASC, c.id ASC
  LIMIT 1;

  IF FOUND THEN
    id := v_id;
    status := v_status;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Chưa có company active → tạo tenant-root idempotent. ON CONFLICT (slug) DO NOTHING xử lý case "cùng slug
  -- gọi 2 lần" (idempotent theo slug, ĐỘC LẬP với advisory-lock: khoá tuần-tự-hoá caller đua KHÁC slug; on-conflict
  -- xử lý tái dùng slug sau soft-delete / gọi lặp cùng slug). KHÔNG còn đường đua KHÁC slug tạo ra 2 active nên
  -- KHÔNG cần khối EXCEPTION bắt 23505 (đã bị advisory-lock tuần-tự-hoá).
  INSERT INTO public.companies (name, slug, status, timezone, language, currency)
  VALUES (p_name, p_slug, 'active', p_timezone, p_language, p_currency)
  ON CONFLICT (slug) WHERE deleted_at IS NULL
  DO NOTHING
  RETURNING companies.id, companies.status
    INTO v_id, v_status;

  IF NOT FOUND THEN
    -- Conflict SLUG (hàng chưa xoá mềm cùng slug) → trả về hàng hiện có theo slug (tái dùng slug sau soft-delete).
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

-- RE-APPLY hardening (idempotent; CREATE OR REPLACE giữ ACL nhưng tái khẳng định cho tự-chứa) — mirror 0469.
REVOKE ALL ON FUNCTION ensure_default_company(citext, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ensure_default_company(citext, text, text, text, text) TO mediaos_app;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- Fail-LOUD hardening assert (đo qua catalog — Đội 3/Lane D nghiệm thu cùng qua pg_proc):
--   ensure_default_company: prosecdef=true · proconfig chứa search_path=pg_catalog · PUBLIC KHÔNG EXECUTE ·
--   mediaos_app CÓ EXECUTE. RAISE nếu bất kỳ điều kiện trượt (tránh âm thầm mất hardening qua replace).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_secdef      boolean;
  v_config      text[];
  v_acl         aclitem[];
  v_public_exec boolean;
BEGIN
  -- function hardening còn nguyên sau CREATE OR REPLACE.
  SELECT p.prosecdef, p.proconfig, p.proacl
    INTO v_secdef, v_config, v_acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ensure_default_company';

  IF NOT FOUND THEN
    RAISE EXCEPTION '[0473] function public.ensure_default_company không tồn tại sau replace';
  END IF;

  IF v_secdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[0473] ensure_default_company KHÔNG SECURITY DEFINER (prosecdef != true) sau replace';
  END IF;

  IF v_config IS NULL OR NOT ('search_path=pg_catalog' = ANY (v_config)) THEN
    RAISE EXCEPTION '[0473] ensure_default_company thiếu SET search_path=pg_catalog sau replace (proconfig=%)', v_config;
  END IF;

  -- proacl NULL = ACL mặc định ⇒ PUBLIC vẫn có EXECUTE (REVOKE trượt).
  IF v_acl IS NULL THEN
    RAISE EXCEPTION '[0473] ensure_default_company proacl NULL — REVOKE ALL FROM PUBLIC không áp; PUBLIC vẫn có EXECUTE';
  END IF;

  SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    INTO v_public_exec
  FROM aclexplode(v_acl) a;
  IF COALESCE(v_public_exec, false) THEN
    RAISE EXCEPTION '[0473] ensure_default_company VẪN cấp EXECUTE cho PUBLIC — REVOKE ALL FROM PUBLIC trượt';
  END IF;

  IF NOT has_function_privilege(
       'mediaos_app',
       'public.ensure_default_company(citext,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION '[0473] mediaos_app THIẾU EXECUTE trên ensure_default_company — GRANT trượt';
  END IF;

  RAISE NOTICE '[0473] ensure_default_company (SECURITY DEFINER · search_path=pg_catalog · EXECUTE mediaos_app-only · pg_advisory_xact_lock serialize concurrent bootstrap) OK';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- (ensure_default_company: khôi phục định nghĩa 0469 qua CREATE OR REPLACE nếu cần rollback advisory-lock)
