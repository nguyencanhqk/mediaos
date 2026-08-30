-- Migration 0551: S11-ASSET-DB-1 (🔴 RED, zone=red) — SEED NOTI ASSET (DB-15 §9 bước C · SPEC-13 §17):
--   nới CHECK module_code += 'ASSET' và notification_type += 'Asset' trên CẢ HAI bảng notification_events VÀ
--   notifications + 3 event ASSET_ASSIGNED / ASSET_REVOKED / ASSET_MAINTENANCE_DUE + 3 template IN_APP/vi-VN.
--   THUẦN DATA/DDL-CHECK — KHÔNG db:generate. Mirror 0538 §(G) (bản đã vá lỗi 0507 quên vế `notifications`).
--
-- QUYẾT ĐỊNH CHỐT (plan §4):
--   • dedupe_strategy = 'DedupeKey', dedupe_window_seconds = NULL cho CẢ 3 (mặc định 0479 là 'None' ⇒ computeKey
--     trả NULL ⇒ partial unique uq_notifications_dedupe_active coi mọi NULL là distinct ⇒ tầng dedupe BIẾN MẤT,
--     job nhắc bảo trì nhân đôi mỗi ngày; sửa sau = migration thứ hai). Catalog thắng DEFAULT_DEDUPE ⇒ KHÔNG
--     thêm entry notification-dedupe.const.ts. Nhánh DedupeKey không dùng windowSeconds ⇒ once-ever đúng SPEC.
--   • recipient_rule_config NULL (bridge resolve người nhận bằng code — 012 theo user_roles của asset-manager /
--     company-admin, SPEC-13 §17).
--   • Payload/template CHỈ mã + tên tài sản + tên người + link nội bộ — KHÔNG giá mua/chi phí (bất biến #3 +
--     SPEC-13 §18: trường tài chính chỉ trả ở scope Company).
--   • ON CONFLICT nhắm PARTIAL unique (uq_notification_events_global_code_active / template_code) — bare ⇒ 42P10.
--   • CHECK NOTI dạng IN (…): guard LIKE + re-stamp superset TƯỜNG MINH (0538) — KHÔNG parser DO-block 0474.
--
-- BẤT BIẾN #1: 4 CHECK trên `notifications` GIỮ nhánh `IS NULL OR` (hàng legacy để NULL — 0479:249).
-- PHẢI xong TRƯỚC khi S11-ASSET-BE-1 đăng ký registrar outbox (registerSource() fail-loud lúc boot nếu eventCode
--   chưa có trong catalog isEnabled=true).
--
-- BAND 0551 (lane S11-ASSET-DB-1). Journal: idx 218, when 1717587340000 (> 0550 idx 217 / 1717587339000).
--   Cùng commit: notification-event-catalog.const.ts (NotiModuleCode += ASSET · NotiType += Asset · 3 entry ·
--   pin 64/50) · packages/contracts notification.ts notificationTypeEnumSchema += 'Asset' · schema/noti.ts parity ·
--   pin noti-seed-catalog-permissions (61/47 → 64/50) · s5-noti-fix1-deeplink (47 → 50 template).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (A) BASELINE GUARD: 4 CHECK phải là bản SAU 0538 (có CHAT/Chat) và KHÔNG chứa giá trị ngoài superset ─
DO $$
DECLARE
  r        record;
  v_super  text[];
  v_extra  text[];
  v_needle text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  FOR r IN
    SELECT c.conname, c.conrelid::regclass::text AS tbl, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.conname IN ('chk_notification_events_module_code', 'chk_notification_events_type',
                         'chk_notifications_module_code', 'chk_notifications_notification_type')
  LOOP
    v_super := CASE
      WHEN r.conname LIKE '%module_code%'
        THEN ARRAY['AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET']
      ELSE ARRAY['System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder',
                 'Warning','Error','Goal','Training','Chat','Asset']
    END;

    SELECT array_agg(m[1]) INTO v_extra
      FROM regexp_matches(r.def, '''([^'']+)''', 'g') AS m
     WHERE m[1] <> ALL (v_super);

    -- Chỉ ĐỎ khi re-stamp (B)/(C) THẬT SỰ sắp chạy (CHECK chưa có ASSET/Asset). Nếu ASSET đã có thì các khối dưới
    -- idempotent-skip, không DROP/ADD gì ⇒ giá trị của module SAU (ROOM 0555…) không bị đe doạ và file này vẫn
    -- replay được trên DB đã tiến xa hơn (ca H1 s11-asset-db1-invariants chạy lại nguyên file — vá 29/08/2026 khi
    -- S11-ROOM-DB-1 thêm ROOM/Room; trước đó guard RAISE vô điều kiện).
    -- (needle tính TRƯỚC IF: PL/pgSQL cắt điều kiện IF ở chữ THEN đầu tiên — CASE…THEN lồng trong IF bị cắt cụt.)
    v_needle := CASE WHEN r.conname LIKE '%module_code%' THEN '%''ASSET''%' ELSE '%''Asset''%' END;
    IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 AND r.def NOT LIKE v_needle THEN
      RAISE EXCEPTION '[0551] % (%) chua gia tri NGOAI superset cua 0551: % — superset viet tay se XOA chung. '
                      'Cap nhat danh sach trong 0551 roi chay lai.', r.conname, r.tbl, v_extra;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('chk_notification_events_module_code', 'chk_notification_events_type',
                         'chk_notifications_module_code', 'chk_notifications_notification_type')) <> 4 THEN
    RAISE EXCEPTION '[0551] baseline lech: khong du 4 CHECK NOTI (events x2 + notifications x2)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
       AND pg_get_constraintdef(oid) NOT LIKE '%''CHAT''%'
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
       AND pg_get_constraintdef(oid) NOT LIKE '%''Chat''%'
  ) THEN
    RAISE EXCEPTION '[0551] baseline lech: thieu CHAT/Chat — chuoi migration khong phai ban sau 0538';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────────── (B) notification_events — 2 CHECK ───────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname  = 'chk_notification_events_module_code'
       AND pg_get_constraintdef(oid) LIKE '%''ASSET''%'
  ) THEN
    RAISE NOTICE '[0551] ASSET da co trong chk_notification_events_module_code — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_module_code;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_module_code
      CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET'));
    RAISE NOTICE '[0551] da them ASSET vao chk_notification_events_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname  = 'chk_notification_events_type'
       AND pg_get_constraintdef(oid) LIKE '%''Asset''%'
  ) THEN
    RAISE NOTICE '[0551] Asset da co trong chk_notification_events_type — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_type;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_type
      CHECK (notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project',
                                   'Approval','Reminder','Warning','Error','Goal','Training','Chat','Asset'));
    RAISE NOTICE '[0551] da them Asset vao chk_notification_events_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────────── (C) notifications — 2 CHECK, GIỮ nhánh `IS NULL OR` (vế 0507 từng bỏ sót) ───────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname  = 'chk_notifications_module_code'
       AND pg_get_constraintdef(oid) LIKE '%''ASSET''%'
  ) THEN
    RAISE NOTICE '[0551] ASSET da co trong chk_notifications_module_code — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_module_code;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_module_code
      CHECK (module_code IS NULL OR module_code IN
             ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET'));
    RAISE NOTICE '[0551] da them ASSET vao chk_notifications_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname  = 'chk_notifications_notification_type'
       AND pg_get_constraintdef(oid) LIKE '%''Asset''%'
  ) THEN
    RAISE NOTICE '[0551] Asset da co trong chk_notifications_notification_type — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_notification_type;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_notification_type
      CHECK (notification_type IS NULL OR notification_type IN
             ('System','Account','HR','Attendance','Leave','Task','Project',
              'Approval','Reminder','Warning','Error','Goal','Training','Chat','Asset'));
    RAISE NOTICE '[0551] da them Asset vao chk_notifications_notification_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────────── (D) Catalog 3 event ASSET (GLOBAL, company_id NULL) — SPEC-13 §17 ───────────────
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority,
   default_channels, is_enabled, is_system_event, dedupe_strategy, dedupe_window_seconds)
VALUES
  (NULL::uuid, 'ASSET', 'ASSET_ASSIGNED',        'Tài sản được cấp phát',        'Asset', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'ASSET', 'ASSET_REVOKED',         'Tài sản bị thu hồi',           'Asset', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'ASSET', 'ASSET_MAINTENANCE_DUE', 'Tài sản sắp đến hạn bảo trì',  'Asset', 'High',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL)
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (E) Template GLOBAL IN_APP/vi-VN (mirror 0538:733-752) — KHÔNG giá/chi phí ───────────────
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template,
   short_body_template, target_url_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.target_url_template,
  t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('ASSET_ASSIGNED', 'ASSET_ASSIGNED__IN_APP__vi-VN',
     'Bạn được cấp tài sản {asset_code}',
     '{actor_name} đã cấp phát {asset_name} ({asset_code}) cho bạn.',
     'Được cấp {asset_code}',
     '/me/assets',
     '{"actor_name":"string","asset_name":"string","asset_code":"string"}'),
  ('ASSET_REVOKED', 'ASSET_REVOKED__IN_APP__vi-VN',
     'Tài sản {asset_code} đã được thu hồi',
     '{actor_name} đã thu hồi {asset_name} ({asset_code}).',
     'Thu hồi {asset_code}',
     '/me/assets',
     '{"actor_name":"string","asset_name":"string","asset_code":"string"}'),
  ('ASSET_MAINTENANCE_DUE', 'ASSET_MAINTENANCE_DUE__IN_APP__vi-VN',
     '{asset_code} sắp đến hạn bảo trì',
     '{asset_name} ({asset_code}) đến hạn bảo trì ngày {due_date}.',
     'Bảo trì {asset_code} ngày {due_date}',
     '/assets/{asset_id}',
     '{"asset_name":"string","asset_code":"string","due_date":"string","asset_id":"uuid"}')
) AS t(event_code, template_code, title_template, body_template, short_body_template,
       target_url_template, variables_schema)
JOIN notification_events e
  ON e.event_code = t.event_code AND e.company_id IS NULL AND e.deleted_at IS NULL
ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (F) VERIFY fail-LOUD bằng catalog (migrator 1 tx — không "thử INSERT") ───────────────
DO $$
DECLARE v_n int;
BEGIN
  -- 4 CHECK đích danh chứa giá trị mới
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE (conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
          AND pg_get_constraintdef(oid) LIKE '%''ASSET''%')
      OR (conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
          AND pg_get_constraintdef(oid) LIKE '%''Asset''%');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0551] verify: chi % / 4 CHECK NOTI chua ASSET/Asset — vế notifications bi bo sot?', v_n;
  END IF;

  -- 3 event global, enabled, DedupeKey, type Asset, module ASSET
  SELECT count(*) INTO v_n FROM notification_events
   WHERE company_id IS NULL AND deleted_at IS NULL
     AND event_code IN ('ASSET_ASSIGNED', 'ASSET_REVOKED', 'ASSET_MAINTENANCE_DUE')
     AND module_code = 'ASSET' AND notification_type = 'Asset'
     AND is_enabled = true AND is_system_event = false
     AND dedupe_strategy = 'DedupeKey' AND dedupe_window_seconds IS NULL;
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0551] verify: % / 3 event ASSET global dung thuoc tinh (enabled · DedupeKey · Asset)', v_n;
  END IF;

  -- priority: 010/011 Normal · 012 High
  SELECT count(*) INTO v_n FROM notification_events
   WHERE company_id IS NULL AND deleted_at IS NULL
     AND ((event_code IN ('ASSET_ASSIGNED', 'ASSET_REVOKED') AND default_priority = 'Normal')
       OR (event_code = 'ASSET_MAINTENANCE_DUE' AND default_priority = 'High'));
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0551] verify: % / 3 event ASSET dung priority (ky vong Normal/Normal/High)', v_n;
  END IF;

  -- 3 template global IN_APP/vi-VN Active default, có target_url + variables_schema
  SELECT count(*) INTO v_n
    FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
   WHERE t.company_id IS NULL AND t.deleted_at IS NULL
     AND e.company_id IS NULL AND e.event_code IN ('ASSET_ASSIGNED', 'ASSET_REVOKED', 'ASSET_MAINTENANCE_DUE')
     AND t.channel = 'IN_APP' AND t.locale = 'vi-VN' AND t.status = 'Active' AND t.is_default = true
     AND t.target_url_template IS NOT NULL AND t.variables_schema IS NOT NULL
     AND length(t.body_template) > 0;
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0551] verify: % / 3 template ASSET IN_APP/vi-VN du thuoc tinh', v_n;
  END IF;

  RAISE NOTICE '[0551] verify PASS: 4 CHECK NOTI += ASSET/Asset · 3 event DedupeKey · 3 template';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM notification_templates WHERE company_id IS NULL
--   AND template_code IN ('ASSET_ASSIGNED__IN_APP__vi-VN','ASSET_REVOKED__IN_APP__vi-VN','ASSET_MAINTENANCE_DUE__IN_APP__vi-VN');
-- DELETE FROM notification_events WHERE company_id IS NULL
--   AND event_code IN ('ASSET_ASSIGNED','ASSET_REVOKED','ASSET_MAINTENANCE_DUE');
-- -- 4 CHECK NOTI: KHÔNG thu hẹp (hàng notifications module_code='ASSET' đã ghi sẽ vỡ) — superset giữ nguyên.
