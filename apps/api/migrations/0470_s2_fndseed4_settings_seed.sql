-- Migration 0470: S2-FND-SEED-4 (🟡 seed4-mig) — bổ sung 10 system_settings key CANONICAL còn thiếu
--   (DB-10 §11.1 + DB-08 §8.3). Đưa system_settings §11.1 lên ĐỦ 14/14 key Active (4 sẵn từ 0435 + 10 mới).
-- Gate: FULL (database-reviewer — diff chạm migration) + quality-gate.
--
-- BAND 0470 (lane seed4-mig). Journal: idx 150, when 1717500745000 (> head 0469 idx 149 / 1717500740000).
--   Nối tiếp ĐƠN ĐIỆU sau head 0469_s2_fndseed3_ensure_default_company. (Head re-xác nhận lúc land:
--   SEED-3 = 0469 đã ở journal; lane cùng checkpoint có thể bump → nếu head dịch, đổi số file + when tương ứng.)
--
-- MỤC TIÊU (audit §4.2 — system_settings 5/14 → 14/14; DB-10 §11.1):
--   INSERT 10 key canonical còn thiếu vào system_settings (setting_value jsonb, value_type/category/
--   module_code/is_public theo DB-10 §11.1 + owner-note(3)). Idempotent: ON CONFLICT (setting_key)
--   WHERE status='Active' DO NOTHING (mẫu 0435 §5b) ⇒ áp 2 lần KHÔNG nhân đôi (partial-unique
--   uq_system_settings_key_active tự chặn Active trùng). KHÔNG đổi DDL (system_settings đã tạo mig 0431).
--
--   10 key mới (đối chiếu DB-10 §11.1 — Module | Category | Public | Sensitive):
--     system.default_currency               SYSTEM     | General      | true  | false | String  "VND"
--     security.password_min_length          AUTH       | Security     | false | false | Number  8
--     security.password_require_uppercase   AUTH       | Security     | false | false | Boolean true
--     security.password_require_number      AUTH       | Security     | false | false | Boolean true
--     security.session_ttl_minutes          AUTH       | Security     | false | false | Number  1440
--     security.refresh_token_ttl_days       AUTH       | Security     | false | false | Number  30
--     file.default_visibility               FOUNDATION | File         | false | false | String  "Private"
--     notification.in_app_enabled           NOTI       | Notification | true  | false | Boolean true
--     notification.email_enabled            NOTI       | Notification | false | false | Boolean false
--     dashboard.cache_default_ttl_seconds   DASH       | Dashboard    | false | false | Number  300
--
--   module_code là varchar(50) FREE-TEXT (KHÔNG FK) → nhãn theo owner-note(3): security.*=AUTH,
--   file.default_visibility=FOUNDATION, notification.*=NOTI, dashboard.*=DASH, system.default_currency=
--   SYSTEM (KHÔNG blanket SYSTEM — mỗi key nhận module chủ quản). value_type ∈ CHECK DB-08 §8.3
--   (String/Number/Boolean/JSON/Array/SecretRef) — chỉ dùng String/Number/Boolean ở đây.
--
-- 2 GIÁ TRỊ LỆCH — PIN CODE-THẮNG (owner-chốt, KHÔNG đổi giá trị đang chạy, DB-10 §11.1):
--   • file.max_upload_size_mb = 25 (KHÔNG 20 doc) — đã seed 0435 + SETTING_DEFAULTS đang chạy 25MB.
--   • system.default_locale   = 'vi' (KHÔNG 'vi-VN' doc) — companies.language CHECK IN ('vi','en')
--     (mig 0015) chỉ nhận mã 2 ký tự; react-i18next dùng 'vi'. 'vi-VN' vi phạm CHECK khi đồng bộ.
--   ⇒ WO này KHÔNG re-seed 2 key đó (không nằm trong 10 key mới) → giá trị Active hiện hữu KHÔNG bị đụng.
--     (Kể cả nếu re-INSERT, ON CONFLICT DO NOTHING cũng bỏ qua — nhưng ta chủ ý KHÔNG liệt kê chúng.)
--   CHỐT ghi ở docs/DB/DB-10 §11.1 + docs/_review/FOUNDATION-SYSTEM-AUDIT-2026-07-02.md §4.2.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   • system_settings KHÔNG company_id ⇒ no-RLS (global catalog, mirror permissions/modules). KHÔNG bật
--     RLS/FORCE ở WO này (đúng thiết kế DB-08 §5.3 — không có cột tenant, không rò chéo).
--   • KHÔNG hard-delete: chỉ INSERT thêm. file.allowed_mime_types (DÔI, seed 0435 — KHÔNG có trong §11.1
--     14-key) KHÔNG bị xoá. audit.default_retention_days giữ nguyên hình dạng 0435 (is_public theo 0435).
--   • THUẦN SEED (append) — KHÔNG rewrite migration đã land, KHÔNG đổi CHECK/grant/policy.
--   • KHÔNG db:generate: chỉ INSERT dữ liệu (không đổi schema) → viết SQL tay, nối tiếp convention 04xx.
--
-- Fail-LOUD (mẫu 0469): sau seed, DO-block RAISE nếu (a) thiếu bất kỳ key nào trong 14 canonical Active,
--   (b) 10 key mới lệch value_type/module_code/is_public so với §11.1, (c) file.allowed_mime_types (DÔI)
--   bị mất. Tránh âm thầm trượt seed / lệch metadata.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- SEED 10 key canonical còn thiếu (DB-08 §8.3). setting_value = jsonb đúng kiểu (chuỗi ép '"..."'::jsonb,
-- số ép 'N'::jsonb, boolean ép 'true'/'false'::jsonb). ON CONFLICT (setting_key) WHERE status='Active'
-- DO NOTHING — idempotent (partial-unique index uq_system_settings_key_active có predicate WHERE
-- status='Active' ⇒ ON CONFLICT phải chỉ đúng predicate đó).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO system_settings
  (setting_key, setting_value, value_type, category, module_code, description, is_public, is_sensitive, status)
VALUES
  ('system.default_currency',             '"VND"'::jsonb,
     'String',  'General',      'SYSTEM',     'Tiền tệ mặc định toàn hệ thống',                     true,  false, 'Active'),
  ('security.password_min_length',        '8'::jsonb,
     'Number',  'Security',     'AUTH',       'Độ dài mật khẩu tối thiểu',                          false, false, 'Active'),
  ('security.password_require_uppercase', 'true'::jsonb,
     'Boolean', 'Security',     'AUTH',       'Mật khẩu bắt buộc có chữ hoa',                       false, false, 'Active'),
  ('security.password_require_number',    'true'::jsonb,
     'Boolean', 'Security',     'AUTH',       'Mật khẩu bắt buộc có chữ số',                        false, false, 'Active'),
  ('security.session_ttl_minutes',        '1440'::jsonb,
     'Number',  'Security',     'AUTH',       'Thời hạn session (phút) trước khi hết hạn',          false, false, 'Active'),
  ('security.refresh_token_ttl_days',     '30'::jsonb,
     'Number',  'Security',     'AUTH',       'Thời hạn refresh token (ngày)',                      false, false, 'Active'),
  ('file.default_visibility',             '"Private"'::jsonb,
     'String',  'File',         'FOUNDATION', 'Visibility mặc định khi upload file',                false, false, 'Active'),
  ('notification.in_app_enabled',         'true'::jsonb,
     'Boolean', 'Notification', 'NOTI',       'Bật thông báo in-app mặc định',                      true,  false, 'Active'),
  ('notification.email_enabled',          'false'::jsonb,
     'Boolean', 'Notification', 'NOTI',       'Bật thông báo email mặc định',                       false, false, 'Active'),
  ('dashboard.cache_default_ttl_seconds', '300'::jsonb,
     'Number',  'Dashboard',    'DASH',       'TTL cache dashboard mặc định (giây)',                false, false, 'Active')
ON CONFLICT (setting_key) WHERE status = 'Active' DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- Fail-LOUD hardening assert — Đội 3 nghiệm thu cùng qua các điều kiện này:
--   (1) 14 key canonical §11.1 đều Active (4 sẵn 0435 + 10 mới).
--   (2) 10 key mới khớp value_type/module_code/is_public theo §11.1 + owner-note(3).
--   (3) file.allowed_mime_types (DÔI) vẫn còn (không bị xoá bởi WO này).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text;
  v_bad     text;
BEGIN
  -- (1) 14 canonical §11.1 keys đều Active.
  SELECT string_agg(k, ', ')
    INTO v_missing
  FROM (
    VALUES
      ('system.default_timezone'), ('system.default_locale'), ('system.default_currency'),
      ('security.password_min_length'), ('security.password_require_uppercase'),
      ('security.password_require_number'), ('security.session_ttl_minutes'),
      ('security.refresh_token_ttl_days'), ('file.max_upload_size_mb'),
      ('file.default_visibility'), ('audit.default_retention_days'),
      ('notification.in_app_enabled'), ('notification.email_enabled'),
      ('dashboard.cache_default_ttl_seconds')
  ) AS canon(k)
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings s
     WHERE s.setting_key = canon.k AND s.status = 'Active'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '[0470] thiếu system_settings canonical Active §11.1: %', v_missing;
  END IF;

  -- (2) 10 key mới khớp metadata mong đợi (value_type · module_code · is_public).
  SELECT string_agg(format('%s(vt=%s,mod=%s,pub=%s)', e.k, s.value_type, s.module_code, s.is_public), '; ')
    INTO v_bad
  FROM (
    VALUES
      ('system.default_currency',             'String',  'SYSTEM',     true),
      ('security.password_min_length',        'Number',  'AUTH',       false),
      ('security.password_require_uppercase', 'Boolean', 'AUTH',       false),
      ('security.password_require_number',    'Boolean', 'AUTH',       false),
      ('security.session_ttl_minutes',        'Number',  'AUTH',       false),
      ('security.refresh_token_ttl_days',     'Number',  'AUTH',       false),
      ('file.default_visibility',             'String',  'FOUNDATION', false),
      ('notification.in_app_enabled',         'Boolean', 'NOTI',       true),
      ('notification.email_enabled',          'Boolean', 'NOTI',       false),
      ('dashboard.cache_default_ttl_seconds', 'Number',  'DASH',       false)
  ) AS e(k, vt, mod, pub)
  JOIN system_settings s ON s.setting_key = e.k AND s.status = 'Active'
  WHERE s.value_type IS DISTINCT FROM e.vt
     OR s.module_code IS DISTINCT FROM e.mod
     OR s.is_public IS DISTINCT FROM e.pub;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0470] 10 key mới lệch metadata §11.1: %', v_bad;
  END IF;

  -- (3) file.allowed_mime_types (DÔI, seed 0435) KHÔNG bị mất — WO này không hard-delete.
  IF NOT EXISTS (
    SELECT 1 FROM system_settings s
     WHERE s.setting_key = 'file.allowed_mime_types' AND s.status = 'Active'
  ) THEN
    RAISE EXCEPTION '[0470] file.allowed_mime_types (DÔI) không còn Active — WO này KHÔNG được xoá key sẵn có';
  END IF;

  RAISE NOTICE '[0470] system_settings §11.1 = 14/14 canonical Active (10 key mới đúng metadata) + file.allowed_mime_types (DÔI) giữ nguyên OK';
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM system_settings WHERE setting_key IN
--   ('system.default_currency','security.password_min_length','security.password_require_uppercase',
--    'security.password_require_number','security.session_ttl_minutes','security.refresh_token_ttl_days',
--    'file.default_visibility','notification.in_app_enabled','notification.email_enabled',
--    'dashboard.cache_default_ttl_seconds');
