-- Migration 0473: S2-FND-SEED-3 (🔴 RED, zone=red) — chốt CỨNG "một-company-active" ở tầng DB + ensure_default_company an-toàn-race.
--   (a) UNIQUE INDEX partial uq_companies_single_active — DB tự chặn CỨNG >1 company status='active' (chưa xoá mềm),
--       bất kể đường code nào (bootstrap song song, INSERT tay, seed lỗi). Hàng rào ĐỘC LẬP với N=1 guard trong function.
--   (b) CREATE OR REPLACE ensure_default_company — GIỮ NGUYÊN hardening 0469 (SECURITY DEFINER · SET search_path=
--       pg_catalog · REVOKE PUBLIC / GRANT mediaos_app) + THÊM khối EXCEPTION WHEN unique_violation (23505) quanh
--       INSERT: khi company KHÁC thắng race trên uq_companies_single_active → re-SELECT winner (ORDER BY created_at
--       ASC, id ASC) → RETURN (KHÔNG ném ra ngoài) ⇒ giữ ngữ nghĩa IDEMPOTENT dưới race THẬT.
-- Gate: FULL (security-reviewer + database-reviewer). Crown-jewel: bootstrap/auth + SECURITY DEFINER + tenant-single-active.
--
-- BAND 0473 (lane SEED3-A-mig). Journal: idx 153, when 1717500760000 (> head 0472 idx 152 / 1717500755000).
--   Nối tiếp ĐƠN ĐIỆU sau head 0472_s2_fnddb2_index_uq_audit_trigger.
--   ⛔ KHÔNG sửa 0469 (idx 149 — ĐÃ commit, bị 0470–0472 vượt qua): DB đã migrate sẽ KHÔNG re-apply ⇒ rewrite = drift.
--      Thay đổi function đi qua CREATE OR REPLACE Ở ĐÂY (idx 153) để mọi DB — sạch lẫn đã-migrate — hội tụ 1 định nghĩa.
--
-- MỤC TIÊU (audit QA-06 security/race — vá lỗ "2 bootstrap khác slug cùng lúc" → 2 company active):
--   0469 chặn TRÙNG SLUG (ON CONFLICT slug) + N=1 guard (SELECT trước INSERT). Nhưng 2 bootstrap KHÁC SLUG chạy
--   song song trên companies rỗng: cả hai qua N=1 guard (0 active), cả hai INSERT (slug khác ⇒ ON CONFLICT slug
--   KHÔNG bắt) ⇒ 2 company active. Vá 2 lớp, phòng-thủ-theo-chiều-sâu:
--     Lớp DB (a): uq_companies_single_active ⇒ INSERT thứ 2 (dù khác slug) đụng 23505 — DB chặn CỨNG, không thể có 2.
--     Lớp function (b): bắt 23505 → coi "company khác thắng race" → trả winner idempotent (không sập bootstrap).
--   Tie-break TẤT ĐỊNH created_at ASC, id ASC ⇒ winner đơn trị, khử flake ~3.7% (DB10-TC-003 deterministic).
--
-- BẤT BIẾN (CLAUDE.md §2/§3):
--   #1 company_id/RLS: KHÔNG tạo bảng mới, KHÔNG backfill company_id. companies GIỮ NGUYÊN RLS ENABLE/FORCE +
--      policy (mig 0002) — migration này CHỈ thêm 1 index partial + CREATE OR REPLACE 1 function (SECURITY DEFINER
--      owner=superuser, lỗ-thủng-RLS-có-kiểm-soát đã hợp thức hoá ở 0469). THUẦN ADDITIVE.
--   #2 không hard-delete: index partial CHỈ tính hàng deleted_at IS NULL ⇒ tôn trọng soft-delete (tenant xoá mềm
--      không chiếm slot active; có thể dựng tenant mới sau khi tenant cũ soft-delete). KHÔNG rewrite CHECK/grant bảng khác.
--   #3 không secret: function chỉ nhận tham số slug/name/tz/lang/currency (từ env BOOTSTRAP_COMPANY_* ở Lane B) —
--      KHÔNG log, KHÔNG chứa secret.
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008) — tie-break dùng created_at (timestamptz) + id (uuid).
--
-- HOT-FILE / an-toàn re-run: CREATE UNIQUE INDEX IF NOT EXISTS + CREATE OR REPLACE FUNCTION + REVOKE/GRANT idempotent.
--   Index partial-expression ((true)) KHÔNG biểu diễn được bằng drizzle schema (constant-expression) ⇒ SQL-only,
--   KHÔNG mirror vào src/db/schema/companies.ts (giữ convention 04xx hand-written cho function/grant/expr-index).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) uq_companies_single_active — UNIQUE partial trên biểu thức HẰNG ((true)) ⇒ mọi hàng thoả predicate có CÙNG
--     giá trị index (true) ⇒ tối đa 1 hàng. Predicate status='active' AND deleted_at IS NULL: chỉ tính tenant
--     ĐANG SỐNG + đang active (soft-deleted / inactive KHÔNG chiếm slot). DB ép CỨNG "một-company-active" —
--     độc lập với mọi đường code. Trên DB sạch (companies rỗng) hoặc N=1 (đúng 1 active) CREATE áp SẠCH.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_single_active
  ON companies ((true))
  WHERE status = 'active' AND deleted_at IS NULL;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) CREATE OR REPLACE ensure_default_company — GIỮ NGUYÊN chữ ký (citext,text,text,text,text) ⇒ ACL (REVOKE/
--     GRANT 0469) được bảo toàn qua replace; ta vẫn RE-APPLY REVOKE/GRANT bên dưới cho tự-chứa & idempotent.
--     THÊM: khối BEGIN…EXCEPTION WHEN unique_violation quanh INSERT (subtransaction) → khi hàng khác thắng race
--     trên uq_companies_single_active, INSERT ném 23505; ta NUỐT tại chỗ, re-SELECT winner (created_at ASC, id ASC)
--     → trả về (ngữ nghĩa idempotent dưới race THẬT, KHÔNG throw ra ngoài làm sập bootstrap).
--     OUT id/status ⇒ tham chiếu cột ĐÃ-QUALIFY (companies.id / c.id) tránh plpgsql shadow biến OUT.
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
  -- N=1 guard (TẤT ĐỊNH created_at ASC, id ASC): đã có company active (chưa xoá mềm) → trả về winner, KHÔNG tạo mới.
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

  -- Chưa có company active → tạo tenant-root idempotent. Subtransaction để bắt 23505 từ uq_companies_single_active
  -- (race: company KHÁC SLUG vừa thắng) — ON CONFLICT (slug) KHÔNG suy ra được index partial-expression đó nên
  -- 23505 sẽ ném ⇒ phải EXCEPTION-nuốt để giữ idempotent.
  BEGIN
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
  EXCEPTION
    WHEN unique_violation THEN
      -- 23505 trên uq_companies_single_active: company KHÁC (khác slug) thắng race → re-SELECT winner TẤT ĐỊNH.
      -- Subtransaction rollback INSERT hỏng; SELECT mới (READ COMMITTED snapshot mới) thấy winner đã commit.
      SELECT c.id, c.status
        INTO v_id, v_status
      FROM public.companies c
      WHERE c.status = 'active' AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT 1;
  END;

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
-- Fail-LOUD hardening assert (đo qua catalog — Đội 3/Lane D nghiệm thu cùng qua pg_proc/pg_indexes):
--   • uq_companies_single_active tồn tại + là UNIQUE + partial WHERE (status='active' AND deleted_at IS NULL).
--   • ensure_default_company: prosecdef=true · proconfig chứa search_path=pg_catalog · PUBLIC KHÔNG EXECUTE ·
--     mediaos_app CÓ EXECUTE. RAISE nếu bất kỳ điều kiện trượt (tránh âm thầm mất hardening qua replace).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_secdef      boolean;
  v_config      text[];
  v_acl         aclitem[];
  v_public_exec boolean;
BEGIN
  -- (a) index single-active: tồn tại + UNIQUE + partial predicate đúng.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'companies' AND indexname = 'uq_companies_single_active'
       AND indexdef ILIKE '%UNIQUE%'
       AND indexdef ILIKE '%WHERE%'
       AND indexdef ILIKE '%status%'
       AND indexdef ILIKE '%deleted_at IS NULL%'
  ) THEN
    RAISE EXCEPTION '[0473] uq_companies_single_active (UNIQUE partial WHERE status=active AND deleted_at IS NULL) KHÔNG đúng shape — bước (a) trượt.';
  END IF;

  -- (b) function hardening còn nguyên sau CREATE OR REPLACE.
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

  RAISE NOTICE '[0473] uq_companies_single_active (UNIQUE partial) + ensure_default_company (SECURITY DEFINER · search_path=pg_catalog · EXECUTE mediaos_app-only · EXCEPTION 23505→winner idempotent) OK';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DROP INDEX IF EXISTS uq_companies_single_active;
-- (ensure_default_company: khôi phục định nghĩa 0469 qua CREATE OR REPLACE nếu cần rollback logic EXCEPTION)
