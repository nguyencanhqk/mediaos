-- G2-1 — 3 DB role tách quyền (CLAUDE.md §2 bất biến #1/#2 · ADR-0001 · plan G2-1).
-- Idempotent + self-healing: DO-guard cho CREATE, ALTER ROLE ép lại thuộc tính nếu role đã tồn tại.
-- KHÔNG đặt mật khẩu ở đây (BẤT BIẾN #3 — không secret trong source). Mật khẩu gán bởi
-- scripts/setup-db-roles.mjs (đọc env) ở bước bootstrap/CI, TÁCH khỏi migration.
--
-- Vai trò:
--   mediaos_owner  — sở hữu bảng + chạy migration (DDL). NOBYPASSRLS để FORCE RLS có hiệu lực.
--   mediaos_app    — kết nối ứng dụng (qua PgBouncer). NOSUPERUSER + NOBYPASSRLS + KHÔNG owner.
--                    Quyền SELECT/INSERT/UPDATE/DELETE cấp theo từng bảng ở migration sau;
--                    bảng audit/outbox chỉ INSERT (append-only, bất biến #2).
--   mediaos_worker — outbox worker (kết nối direct). Chỉ UPDATE status outbox (cấp ở G2-4).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mediaos_owner') THEN
    CREATE ROLE mediaos_owner WITH LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mediaos_app') THEN
    CREATE ROLE mediaos_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mediaos_worker') THEN
    CREATE ROLE mediaos_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  -- pgbouncer_auth: role tra cứu hash cho auth_query của PgBouncer (pass-through user, xem cuối file).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgbouncer_auth') THEN
    CREATE ROLE pgbouncer_auth WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- Ép lại thuộc tính (self-heal nếu role pre-exist sai cấu hình). NOBYPASSRLS là dòng phòng thủ chí mạng.
ALTER ROLE mediaos_owner  WITH NOSUPERUSER CREATEDB NOCREATEROLE NOBYPASSRLS;
--> statement-breakpoint
ALTER ROLE mediaos_app    WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
--> statement-breakpoint
ALTER ROLE mediaos_worker WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
--> statement-breakpoint

-- Khóa schema public: gỡ CREATE khỏi PUBLIC (PG15+ đã bỏ mặc định, ép cho chắc),
-- cấp USAGE tường minh cho app/worker. App/worker KHÔNG được tạo bảng (chỉ owner tạo).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO mediaos_app, mediaos_worker;
--> statement-breakpoint
GRANT CREATE, USAGE ON SCHEMA public TO mediaos_owner;
--> statement-breakpoint

-- Quyền trên bảng cấp TƯỜNG MINH theo từng bảng ở migration sau (G2-3 companies/users full DML;
-- G2-4 audit/outbox chỉ INSERT cho app + UPDATE status cho worker) để giữ append-only — KHÔNG dùng
-- DEFAULT PRIVILEGES (dễ cấp dư quyền cho bảng append-only). Mặc định PG: bảng mới không cấp gì cho app/worker.
--
-- GHI CHÚ owner & RLS: dev/CI chạy migration bằng superuser bootstrap (`mediaos`) nên bảng do superuser
-- sở hữu — VẪN AN TOÀN vì app KHÔNG BAO GIỜ kết nối bằng superuser/owner, chỉ bằng mediaos_app
-- (NOSUPERUSER + NOBYPASSRLS + không owner) → RLS luôn được ép. Prod nên trỏ DATABASE_DIRECT_URL vào
-- mediaos_owner (chạy migration), giữ superuser chỉ cho bootstrap role một lần. FORCE RLS (G2-3) chặn cả owner.
SELECT 1;
--> statement-breakpoint

-- ── PgBouncer auth_query (ADR-0003 · CHÍ MẠNG cho RLS) ────────────────────────────────────────
-- VẤN ĐỀ: nếu PgBouncer kết nối Postgres bằng MỘT user cố định (vd superuser), MỌI query app chạy
-- dưới user đó → RLS bị BYPASS → rò chéo tenant. PHẢI để PgBouncer giữ user của client (mediaos_app)
-- suốt tới Postgres. Muốn vậy PgBouncer cần auth_query để lấy hash mật khẩu của user bất kỳ.
-- Hàm SECURITY DEFINER (owner = superuser chạy migration) đọc pg_authid; pgbouncer_auth chỉ EXECUTE.
-- LƯU Ý prod: 0001 PHẢI chạy bằng superuser (đọc pg_authid cần superuser) — xem ghi chú owner ở trên.
CREATE SCHEMA IF NOT EXISTS pgbouncer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pgbouncer.get_auth(p_username text)
  RETURNS TABLE (username text, password text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
  SELECT rolname::text, rolpassword::text
  FROM pg_authid
  WHERE rolname = p_username AND rolcanlogin;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION pgbouncer.get_auth(text) FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA pgbouncer TO pgbouncer_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pgbouncer.get_auth(text) TO pgbouncer_auth;

