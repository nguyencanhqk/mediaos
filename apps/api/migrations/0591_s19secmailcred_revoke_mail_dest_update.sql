-- Migration 0591: S19-SEC-MAILCREDEXFIL-1 (🔴 RED — secret) — đường UPDATE không còn ghi được cột ĐÍCH SMTP.
--   Kế hoạch: docs/plans/S19-SEC-MAILCREDEXFIL-1.md §3 (I2) · §4.7 · owner ký D5 ngày 02/10/2026.
--   THUẦN SQL VIẾT TAY — quyền không nằm trong schema drizzle, KHÔNG chạy `db:generate`.
--
-- VÌ SAO: mật khẩu SMTP (envelope, write-only) gắn với đích (host, port, username, secure) của CHÍNH hàng chứa
--   nó. Trước WO, nhánh "PUT vắng password" UPDATE cả 4 cột đích mà GIỮ envelope cũ ⇒ người giữ `configure-mail`
--   trỏ host về server của họ, lời mời kế tiếp AUTH mật khẩu công ty tới đó. Code đã sửa (nhánh giữ-envelope chỉ
--   ghi from_name/from_email, vị từ đích trong WHERE); file này thu hồi luôn QUYỀN để một hồi quy về sau không thể
--   đổi đích bằng UPDATE.
--
-- PHẠM VI (FULL gate security + database, 02/10): file này chặn ĐƯỜNG UPDATE. `mediaos_app` vẫn INSERT/DELETE cả
--   bảng (đường đổi mật khẩu = DELETE+INSERT), và AAD của envelope chỉ gắn companyId‖id — KHÔNG gắn đích ⇒ một
--   đường ghi mới kiểu `DELETE; INSERT {...hàng cũ, host mới}` (tái dùng id + chép envelope) KHÔNG bị file này
--   chặn. Code hiện tại không có đường đó (DELETE+INSERT luôn id mới + envelope mới); gắn đích vào AAD = WO
--   `S19-SEC-MAILAADBIND-1`.
--
-- ĐO THẬT 02/10/2026 (grant-in-old-migration-is-not-current-state), DB `mediaos` (PROD) và lane:
--   mediaos_app có UPDATE theo CỘT (from_email, from_name, host, port, secure, updated_at, username) và KHÔNG có
--   UPDATE cấp bảng (relacl `mediaos_app=ard`) ⇒ REVOKE theo cột có hiệu lực thật, không bị grant cấp bảng che.
--   company_mail_configs trên PROD = 0 hàng.
--
-- ROLLBACK: GIỮ file này. Code TRƯỚC WO trên DB đã áp 0591 chỉ hỏng PUT vắng password (42501 ⇒ 500, fail-closed);
--   PUT kèm password vẫn chạy (DELETE+INSERT). KHÔNG GRANT lại: drizzle đã ghi 0591 là đã áp nên roll-forward
--   KHÔNG chạy lại nó ⇒ mất hẳn lớp DB mà không tín hiệu. Bất đắc dĩ phải GRANT thì roll-forward phải chạy TAY lại
--   câu REVOKE + khối VERIFY dưới đây.

REVOKE UPDATE (host, port, username, secure) ON public.company_mail_configs FROM mediaos_app;
--> statement-breakpoint

-- VERIFY fail-loud (khuôn 0540 mục E): (1) không có UPDATE cấp bảng; (2) tập cột mediaos_app UPDATE được — duyệt
-- MỌI cột qua has_column_privilege (tính cả grant cấp bảng, PUBLIC, role kế thừa) — ĐÚNG BẰNG {from_email,
-- from_name, updated_at}. Khối này chỉ ép TẠI THỜI ĐIỂM ÁP (chạy một lần); một grant cột mới trong migration về
-- sau (id, scope, company_id, cột envelope…) do int-spec D5a (`mail-config-credexfil-http.int-spec.ts`) bắt.
-- REVOKE không có tác dụng (migrator không phải owner ⇒ chỉ WARNING) ⇒ (2) RAISE, chặn deploy.
DO $$
DECLARE
  updatable text[];
BEGIN
  IF has_table_privilege('mediaos_app', 'public.company_mail_configs', 'UPDATE') THEN
    RAISE EXCEPTION '[0591] mediaos_app still has table-level UPDATE on public.company_mail_configs';
  END IF;

  SELECT array_agg(a.attname::text ORDER BY a.attname::text)
    INTO updatable
    FROM pg_attribute a
   WHERE a.attrelid = 'public.company_mail_configs'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND has_column_privilege('mediaos_app', a.attrelid, a.attnum, 'UPDATE');

  IF updatable IS DISTINCT FROM ARRAY['from_email', 'from_name', 'updated_at']::text[] THEN
    RAISE EXCEPTION '[0591] mediaos_app UPDATE columns on public.company_mail_configs = %, expected {from_email,from_name,updated_at}',
      updatable;
  END IF;
END $$;
