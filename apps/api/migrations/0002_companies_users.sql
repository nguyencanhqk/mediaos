-- G2-3 — bảng nền tenant: companies (gốc) + users. RLS USING + WITH CHECK + FORCE ngay lúc CREATE
-- (GX-4: bảng mới ⇒ policy+FORCE cùng lúc, không có cửa sổ rò). ADR-0001 · ERD §6 · plan G2-3.

-- ── companies (gốc tenant) ────────────────────────────────────────────────────────────────────
-- slug = định danh tenant unique TOÀN CỤC để login resolve (companySlug → company_id), xem §3b.
CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        citext NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT companies_status_chk CHECK (status IN ('active', 'suspended'))
);
--> statement-breakpoint

-- slug unique toàn cục — chỉ ràng buộc trên hàng chưa xoá mềm (tái dùng slug sau khi xoá là hợp lệ).
CREATE UNIQUE INDEX companies_slug_active_uq ON companies (slug) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Tenant isolation: chỉ thấy/ghi đúng company của ngữ cảnh. current_setting(...,true) = NULL khi chưa
-- set ⇒ id = NULL ⇒ KHÔNG hàng nào lọt (deny-by-default ngoài withTenant).
CREATE POLICY companies_tenant_isolation ON companies
  USING (id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON companies TO mediaos_app;
--> statement-breakpoint

-- ── users (company_id NOT NULL, RLS theo company_id) ──────────────────────────────────────────
-- DEFAULT company_id = ngữ cảnh hiện tại ⇒ app khỏi tự set; WITH CHECK chặn gán company_id tenant khác.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                   REFERENCES companies (id),
  email          citext NOT NULL,
  password_hash  text NOT NULL,
  full_name      text,
  status         text NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT users_status_chk CHECK (status IN ('active', 'invited', 'suspended'))
);
--> statement-breakpoint

-- Email unique theo TENANT (không unique toàn cục — nền cho quyết định login §3b), bỏ qua hàng xoá mềm.
CREATE UNIQUE INDEX users_company_email_active_uq ON users (company_id, email) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX users_company_id_idx ON users (company_id);
--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY users_tenant_isolation ON users
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON users TO mediaos_app;
--> statement-breakpoint

-- ── resolve_company_by_slug (LỖ THỦNG RLS DUY NHẤT, có kiểm soát — cho login pre-auth §3b) ──────
-- Login cần map companySlug → company_id TRƯỚC khi có ngữ cảnh tenant (chưa thể mở withTenant).
-- companies đang FORCE RLS ⇒ không đọc được nếu thiếu ngữ cảnh. Hàm SECURITY DEFINER owner=superuser
-- (bypass RLS) tra cứu HẸP: chỉ trả id + status của company active theo slug. Login luôn trả 401 đồng
-- nhất nên không lộ tenant tồn tại ở tầng API. KHÔNG trả thêm cột nhạy cảm.
CREATE OR REPLACE FUNCTION resolve_company_by_slug(p_slug citext)
  RETURNS TABLE (id uuid, status text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
  SELECT c.id, c.status
  FROM public.companies c
  WHERE c.slug = p_slug AND c.deleted_at IS NULL;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_company_by_slug(citext) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_company_by_slug(citext) TO mediaos_app;
