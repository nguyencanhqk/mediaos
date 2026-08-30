-- Migration 0555: S11-ROOM-DB-1 (🔴 RED, zone=red) — SEED NOTI ROOM (DB-16 §9 bước C · SPEC-14 §17):
--   nới CHECK module_code += 'ROOM' và notification_type += 'Room' trên CẢ HAI bảng notification_events VÀ
--   notifications + 3 event ROOM_BOOKING_CONFIRMED / ROOM_BOOKING_CANCELLED / ROOM_BOOKING_REMINDER (NOTI-EVENT-013..015)
--   + 3 template IN_APP/vi-VN. THUẦN DATA/DDL-CHECK — KHÔNG db:generate. Mirror 0551 (bản đã vá lỗi 0507 quên vế
--   `notifications`).
--
-- QUYẾT ĐỊNH CHỐT (plan §5 · SPEC-14 §17):
--   • dedupe_strategy = 'DedupeKey', dedupe_window_seconds = NULL cho CẢ 3 (mặc định 0479 'None' ⇒ computeKey trả NULL
--     ⇒ tầng dedupe BIẾN MẤT ⇒ job nhắc 15′ phát lại mỗi nhịp 60s). Catalog thắng DEFAULT_DEDUPE ⇒ KHÔNG thêm entry
--     notification-dedupe.const.ts. dedupeKey do BE-1 sinh: room:confirmed:{bookingId} · room:cancelled:{bookingId} ·
--     room:reminder:{bookingId}:{startsAt}.
--   • is_system_event: 013/014 false (trừ actor — tự đặt thì organizer không nhận); 015 TRUE (job không có actor,
--     KHÔNG loại ai — notification-recipient-resolver.service.ts:50).
--   • recipient_rule_config NULL (bridge resolve người nhận theo id CÓ SẴN trong lượt — mode UserIds; SPEC-14 §17).
--   • Payload/template CHỈ tiêu đề · tên phòng · khung giờ · tên người tổ chức/thao tác · deep-link — KHÔNG danh sách
--     người tham dự, KHÔNG email/SĐT (SPEC-14 §17/§18). Deep-link /me/room-bookings?focus={booking_id}.
--   • ON CONFLICT nhắm PARTIAL unique (event_code / template_code WHERE company_id IS NULL AND deleted_at IS NULL) —
--     bare ⇒ 42P10.
--   • CHECK NOTI dạng IN (…): guard LIKE + re-stamp superset TƯỜNG MINH (0538/0551) — KHÔNG parser DO-block 0474.
--
-- BẤT BIẾN #1: 4 CHECK trên `notifications` GIỮ nhánh `IS NULL OR` (hàng legacy để NULL — 0479:249).
-- PHẢI xong TRƯỚC khi S11-ROOM-BE-1 đăng ký registrar outbox (registerSource() fail-loud lúc boot nếu eventCode chưa
--   có trong catalog isEnabled=true).
--
-- BAND 0555 (lane S11-ROOM-DB-1). Journal: idx 222, when 1717587344000 (> 0554 idx 221 / 1717587343000).
--   Cùng commit: notification-event-catalog.const.ts (NotiModuleCode += ROOM · NotiType += Room · 3 entry · pin 67/53)
--   · packages/contracts notification.ts notificationTypeEnumSchema += 'Room' · schema/noti.ts parity ·
--   pin noti-seed-catalog-permissions (64/50 → 67/53) · s5-noti-fix1-deeplink (50 → 53 template).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (A) BASELINE GUARD: 4 CHECK phải là bản SAU 0551 (có ASSET/Asset) và KHÔNG chứa giá trị ngoài superset ─
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
        THEN ARRAY['AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM']
      ELSE ARRAY['System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder',
                 'Warning','Error','Goal','Training','Chat','Asset','Room']
    END;

    SELECT array_agg(m[1]) INTO v_extra
      FROM regexp_matches(r.def, '''([^'']+)''', 'g') AS m
     WHERE m[1] <> ALL (v_super);

    -- Chỉ ĐỎ khi re-stamp (B)/(C) THẬT SỰ sắp chạy (CHECK chưa có ROOM/Room). Đã có ROOM ⇒ các khối dưới idempotent-
    -- skip, giá trị của module SAU không bị đe doạ và file replay được trên DB đã tiến xa hơn (ca H1). Cùng khuôn
    -- với 0551 đã vá — KHÔNG quay lại kiểu RAISE vô điều kiện (nó làm H1 của module trước đỏ ngay khi module sau seed).
    -- (needle tính TRƯỚC IF: PL/pgSQL cắt điều kiện IF ở chữ THEN đầu tiên — CASE…THEN lồng trong IF bị cắt cụt.)
    v_needle := CASE WHEN r.conname LIKE '%module_code%' THEN '%''ROOM''%' ELSE '%''Room''%' END;
    IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 AND r.def NOT LIKE v_needle THEN
      RAISE EXCEPTION '[0555] % (%) chua gia tri NGOAI superset cua 0555: % — superset viet tay se XOA chung. '
                      'Cap nhat danh sach trong 0555 roi chay lai.', r.conname, r.tbl, v_extra;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('chk_notification_events_module_code', 'chk_notification_events_type',
                         'chk_notifications_module_code', 'chk_notifications_notification_type')) <> 4 THEN
    RAISE EXCEPTION '[0555] baseline lech: khong du 4 CHECK NOTI (events x2 + notifications x2)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
       AND pg_get_constraintdef(oid) NOT LIKE '%''ASSET''%'
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
       AND pg_get_constraintdef(oid) NOT LIKE '%''Asset''%'
  ) THEN
    RAISE EXCEPTION '[0555] baseline lech: thieu ASSET/Asset — chuoi migration khong phai ban sau 0551';
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
       AND pg_get_constraintdef(oid) LIKE '%''ROOM''%'
  ) THEN
    RAISE NOTICE '[0555] ROOM da co trong chk_notification_events_module_code — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_module_code;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_module_code
      CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM'));
    RAISE NOTICE '[0555] da them ROOM vao chk_notification_events_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname  = 'chk_notification_events_type'
       AND pg_get_constraintdef(oid) LIKE '%''Room''%'
  ) THEN
    RAISE NOTICE '[0555] Room da co trong chk_notification_events_type — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_type;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_type
      CHECK (notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project',
                                   'Approval','Reminder','Warning','Error','Goal','Training','Chat','Asset','Room'));
    RAISE NOTICE '[0555] da them Room vao chk_notification_events_type';
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
       AND pg_get_constraintdef(oid) LIKE '%''ROOM''%'
  ) THEN
    RAISE NOTICE '[0555] ROOM da co trong chk_notifications_module_code — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_module_code;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_module_code
      CHECK (module_code IS NULL OR module_code IN
             ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM'));
    RAISE NOTICE '[0555] da them ROOM vao chk_notifications_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname  = 'chk_notifications_notification_type'
       AND pg_get_constraintdef(oid) LIKE '%''Room''%'
  ) THEN
    RAISE NOTICE '[0555] Room da co trong chk_notifications_notification_type — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_notification_type;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_notification_type
      CHECK (notification_type IS NULL OR notification_type IN
             ('System','Account','HR','Attendance','Leave','Task','Project',
              'Approval','Reminder','Warning','Error','Goal','Training','Chat','Asset','Room'));
    RAISE NOTICE '[0555] da them Room vao chk_notifications_notification_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────────── (D) Catalog 3 event ROOM (GLOBAL, company_id NULL) — SPEC-14 §17 · NOTI-EVENT-013..015 ───────────────
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority,
   default_channels, is_enabled, is_system_event, dedupe_strategy, dedupe_window_seconds)
VALUES
  (NULL::uuid, 'ROOM', 'ROOM_BOOKING_CONFIRMED', 'Đặt phòng họp được xác nhận', 'Room', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'ROOM', 'ROOM_BOOKING_CANCELLED', 'Lịch phòng họp bị huỷ',        'Room', 'High',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'ROOM', 'ROOM_BOOKING_REMINDER',  'Nhắc lịch họp trước 15 phút',  'Room', 'High',
   '["IN_APP"]'::jsonb, true, true,  'DedupeKey', NULL)
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (E) Template GLOBAL IN_APP/vi-VN (mirror 0551 (E)) — KHÔNG danh sách người tham dự / email ───────────────
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template,
   short_body_template, target_url_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.target_url_template,
  t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('ROOM_BOOKING_CONFIRMED', 'ROOM_BOOKING_CONFIRMED__IN_APP__vi-VN',
     'Đặt phòng {room_name} · {time_range}',
     '{organizer_name} đã đặt phòng {room_name} cho «{title}» ({time_range}).',
     'Đặt phòng {room_name} {time_range}',
     '/me/room-bookings?focus={booking_id}',
     '{"organizer_name":"string","room_name":"string","title":"string","time_range":"string","booking_id":"uuid"}'),
  ('ROOM_BOOKING_CANCELLED', 'ROOM_BOOKING_CANCELLED__IN_APP__vi-VN',
     'Huỷ lịch phòng {room_name} · {time_range}',
     '{actor_name} đã huỷ lượt «{title}» tại {room_name} ({time_range}).',
     'Huỷ {room_name} {time_range}',
     '/me/room-bookings?focus={booking_id}',
     '{"actor_name":"string","room_name":"string","title":"string","time_range":"string","booking_id":"uuid"}'),
  ('ROOM_BOOKING_REMINDER', 'ROOM_BOOKING_REMINDER__IN_APP__vi-VN',
     'Sắp họp: {title} tại {room_name}',
     'Lượt «{title}» tại {room_name} bắt đầu lúc {starts_at_local} (15 phút nữa).',
     '15′ nữa: {title} · {room_name}',
     '/me/room-bookings?focus={booking_id}',
     '{"title":"string","room_name":"string","starts_at_local":"string","booking_id":"uuid"}')
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
          AND pg_get_constraintdef(oid) LIKE '%''ROOM''%')
      OR (conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
          AND pg_get_constraintdef(oid) LIKE '%''Room''%');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0555] verify: chi % / 4 CHECK NOTI chua ROOM/Room — vế notifications bi bo sot?', v_n;
  END IF;

  -- 3 event global, enabled, DedupeKey, type Room, module ROOM
  SELECT count(*) INTO v_n FROM notification_events
   WHERE company_id IS NULL AND deleted_at IS NULL
     AND event_code IN ('ROOM_BOOKING_CONFIRMED', 'ROOM_BOOKING_CANCELLED', 'ROOM_BOOKING_REMINDER')
     AND module_code = 'ROOM' AND notification_type = 'Room'
     AND is_enabled = true
     AND dedupe_strategy = 'DedupeKey' AND dedupe_window_seconds IS NULL;
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0555] verify: % / 3 event ROOM global dung thuoc tinh (enabled · DedupeKey · Room)', v_n;
  END IF;

  -- priority + is_system_event: 013 Normal/false · 014 High/false · 015 High/TRUE
  SELECT count(*) INTO v_n FROM notification_events
   WHERE company_id IS NULL AND deleted_at IS NULL
     AND ((event_code = 'ROOM_BOOKING_CONFIRMED' AND default_priority = 'Normal' AND is_system_event = false)
       OR (event_code = 'ROOM_BOOKING_CANCELLED' AND default_priority = 'High'   AND is_system_event = false)
       OR (event_code = 'ROOM_BOOKING_REMINDER'  AND default_priority = 'High'   AND is_system_event = true));
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0555] verify: % / 3 event ROOM dung priority/is_system_event (ky vong Normal/f · High/f · High/t)', v_n;
  END IF;

  -- 3 template global IN_APP/vi-VN Active default, có target_url + variables_schema
  SELECT count(*) INTO v_n
    FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
   WHERE t.company_id IS NULL AND t.deleted_at IS NULL
     AND e.company_id IS NULL AND e.event_code IN ('ROOM_BOOKING_CONFIRMED', 'ROOM_BOOKING_CANCELLED', 'ROOM_BOOKING_REMINDER')
     AND t.channel = 'IN_APP' AND t.locale = 'vi-VN' AND t.status = 'Active' AND t.is_default = true
     AND t.target_url_template IS NOT NULL AND t.variables_schema IS NOT NULL
     AND length(t.body_template) > 0;
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0555] verify: % / 3 template ROOM IN_APP/vi-VN du thuoc tinh', v_n;
  END IF;

  RAISE NOTICE '[0555] verify PASS: 4 CHECK NOTI += ROOM/Room · 3 event DedupeKey · 3 template';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM notification_templates WHERE company_id IS NULL
--   AND template_code IN ('ROOM_BOOKING_CONFIRMED__IN_APP__vi-VN','ROOM_BOOKING_CANCELLED__IN_APP__vi-VN','ROOM_BOOKING_REMINDER__IN_APP__vi-VN');
-- DELETE FROM notification_events WHERE company_id IS NULL
--   AND event_code IN ('ROOM_BOOKING_CONFIRMED','ROOM_BOOKING_CANCELLED','ROOM_BOOKING_REMINDER');
-- -- 4 CHECK NOTI: KHÔNG thu hẹp (hàng notifications module_code='ROOM' đã ghi sẽ vỡ) — superset giữ nguyên.
