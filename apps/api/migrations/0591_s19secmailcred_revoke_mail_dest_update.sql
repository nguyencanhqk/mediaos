-- Migration 0591: S19-SEC-MAILCREDEXFIL-1 (🔴 RED — secret) — cột ĐÍCH SMTP chỉ được ghi CÙNG envelope MỚI.
--   Kế hoạch: docs/plans/S19-SEC-MAILCREDEXFIL-1.md §4.3 (bất biến I2) · owner ký D5 ngày 02/10/2026.
--   THUẦN SQL VIẾT TAY — quyền không nằm trong schema drizzle, KHÔNG chạy `db:generate`.
--
-- VÌ SAO: mật khẩu SMTP (envelope, write-only) gắn với đích (host, port, username, secure) của CHÍNH hàng chứa
--   nó. Trước WO, nhánh "PUT vắng password" UPDATE cả 4 cột đích mà GIỮ envelope cũ ⇒ người giữ `configure-mail`
--   trỏ host về server của họ, lời mời kế tiếp AUTH mật khẩu công ty tới đó. Code đã sửa (nhánh giữ-envelope chỉ
--   ghi from_name/from_email, vị từ đích trong WHERE); file này thu hồi luôn QUYỀN, để một hồi quy về sau (hay một
--   đường ghi mới) không thể đổi đích mà không đi qua DELETE+INSERT — tức là không kèm envelope mới.
--
-- ĐO THẬT 02/10/2026 (grant-in-old-migration-is-not-current-state), DB `mediaos` (PROD) và lane:
--   mediaos_app có UPDATE theo CỘT (from_email, from_name, host, port, secure, updated_at, username) và KHÔNG có
--   UPDATE cấp bảng (relacl `mediaos_app=ard`) ⇒ REVOKE theo cột có hiệu lực thật, không bị grant cấp bảng che.
--   company_mail_configs trên PROD = 0 hàng.
--
-- ROLLBACK: code TRƯỚC WO ghi cả 4 cột đích ở MỌI PUT vắng password ⇒ chạy code cũ trên DB đã áp file này thì PUT
--   vắng password lỗi 42501 (PUT kèm password vẫn chạy — đường DELETE+INSERT). Lùi code thì lùi luôn quyền:
--   GRANT UPDATE (host, port, username, secure) ON company_mail_configs TO mediaos_app;

REVOKE UPDATE (host, port, username, secure) ON company_mail_configs FROM mediaos_app;
--> statement-breakpoint

-- VERIFY fail-loud: has_column_privilege tính cả grant cấp bảng, PUBLIC và role kế thừa — còn đường nào cấp lại
-- quyền thì DỪNG ở đây, không để bất biến "có vẻ" được ép. Đồng thời đảm bảo nhánh giữ-envelope vẫn ghi được.
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['host', 'port', 'username', 'secure'] LOOP
    IF has_column_privilege('mediaos_app', 'company_mail_configs', col, 'UPDATE') THEN
      RAISE EXCEPTION '0591: mediaos_app VẪN UPDATE được company_mail_configs.% (grant cấp bảng / PUBLIC / role kế thừa?)', col;
    END IF;
  END LOOP;
  FOREACH col IN ARRAY ARRAY['from_name', 'from_email', 'updated_at'] LOOP
    IF NOT has_column_privilege('mediaos_app', 'company_mail_configs', col, 'UPDATE') THEN
      RAISE EXCEPTION '0591: mediaos_app MẤT quyền UPDATE company_mail_configs.% — nhánh giữ-envelope sẽ 42501', col;
    END IF;
  END LOOP;
END $$;
