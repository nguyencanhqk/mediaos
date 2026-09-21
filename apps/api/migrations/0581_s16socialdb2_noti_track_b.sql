-- Migration 0581: S16-SOCIAL-DB-2 (🔴 RED, zone=red, crown) — NOTI cho SOCIAL (SPEC-16 §17 ·
--   plan docs/plans/S16-SOCIAL-DB-2.md §5): NỚI 4 CHECK NOTI (+'SOCIAL'/+'Social') + seed 9 event
--   NOTI-EVENT-028..036 (global, company_id NULL) + 9 template IN_APP/vi-VN.
--   Khuôn: 0566 khối (A)/(B)/(C) cho phần nới CHECK · 0573 khối (B)/(C)/(D) cho seed + verify.
--   THUẦN DATA + DDL-CHECK VIẾT TAY — KHÔNG `db:generate`.
--
-- ⚠️ KHÁC 0573: 0573 chỉ NO-OP đo lại vì PAYROLL đã có CHECK từ 0566. SOCIAL thì CHƯA CÓ ⇒ file này
--   phải NỚI THẬT cả 4 CHECK (đo M3 của plan §1). Chép nhầm khối (A) NO-OP của 0573 = 23514 ở (D).
--
-- ĐO M14 (giá trị hiện có, chép nguyên văn từ pg_get_constraintdef trên lane DB — KHÔNG gõ lại từ
--   trí nhớ, bẫy audit-check-union-parse-anchor-trap): module_code 15 giá trị (… 'RECRUIT','PAYROLL'),
--   notification_type 18 giá trị (… 'Recruit','Payroll'). Sau file này: 16 / 19.
--   Khối (A) là lưới: nếu lane khác đã thêm giá trị NGOÀI superset viết tay dưới đây thì DROP+ADD sẽ
--   XOÁ chúng ⇒ (A) RAISE trước (forward-compatible: chỉ đỏ khi (B)/(C) THẬT SỰ sắp chạy).
--
-- QUYẾT ĐỊNH (SPEC-16 §17.1/§17.2 · plan §5.2/§5.3):
--   • default_channels '["IN_APP"]' cả 9 — SOCIAL chỉ thông báo trong-app (SPEC-16 §17.2).
--   • dedupe: 8/9 dùng 'DedupeKey' (window NULL); khoá do PRODUCER (BE-2) sinh, content-derived theo
--     ĐỐI TƯỢNG — KHÔNG nhét user_id vào chuỗi: NotificationDedupeService chống trùng theo tuple
--     (company_id, recipient_user_id, event_code, dedupe_key) và recipient_user_id ĐÃ là cột riêng
--     (notification-dedupe.service.ts:71-113) ⇒ mỗi người nhận đã tách sẵn.
--       028 '{target_type}:{target_id}' · 029/030 '{comment_id}' · 031 '{post_id}'
--       032 '{idea_id}:{status}' (accepted/rejected TERMINAL ⇒ mỗi status phát tối đa 1 lần)
--       033 '{kudos_id}' · 035 '{poll_id}' · 036 '{report_id}'
--   • 🔴 034 SOCIAL_GROUP_JOIN_DECIDED dùng 'None', KHÔNG DedupeKey: `feed_group_members` KHÔNG có
--     `decided_at`, và nhánh TỪ CHỐI xoá cứng hàng (DB-17 §4.9) ⇒ không nguồn bền vững nào phủ được
--     cả hai nhánh; producer chỉ còn cách lấy now() ⇒ vi phạm idempotency-key-must-be-content-derived.
--     Cân hai hướng hỏng: khoá sai ⇒ NUỐT MẤT quyết định thứ hai hợp lệ (xin → từ chối → xin lại →
--     duyệt); 'None' ⇒ TRÙNG một thông báo khi outbox retry. Mất tệ hơn trùng ⇒ chọn 'None'.
--     (Nợ §10: nâng lên DedupeKey nếu BE-2 thêm bảng nhật ký yêu cầu vào nhóm có decided_at.)
--   • 035 is_system_event=true — do JOB đóng bình chọn theo hạn phát ra, không phải người
--     (khuôn ROOM_BOOKING_REMINDER, notification-event-catalog.const.ts:158). 8 mã còn lại false.
--   • priority: 031/036 High (tin công ty · kiểm duyệt) · 035 Low · còn lại Normal.
--   • is_enabled=true cả 9 TRƯỚC khi có nguồn phát (registrar ở BE-2) — không đỏ: boot-guard một
--     chiều (`registerSource()` chỉ đòi mã PHẢI có trong catalog).
--   • ⚠️ Template TUYỆT ĐỐI KHÔNG biến tiền/PII; KHÔNG lộ user_id bỏ phiếu ẩn danh; KHÔNG nhúng
--     `review_note` (chữ tự do của người duyệt) — chỉ `status_label`. NOTI đi nhiều kênh và KHÔNG có
--     tầng masking riêng ⇒ ràng buộc mạnh hơn REST.
--
-- BAND 0581 (lane S16-SOCIAL-DB-2). Journal: idx 248, when 1717587370000 (> 0580 idx 247).
--   Cùng commit: foundation/seed/notification-event-catalog.const.ts (+9 dòng SOCIAL, đếm 79→88 /
--   65→74, + 'SOCIAL' vào NotiModuleCode và 'Social' vào NotiType).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── (A) BASELINE GUARD: 4 CHECK NOTI không chứa giá trị NGOÀI superset của file này ───────────
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
        THEN ARRAY['AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET',
                   'ROOM','RECRUIT','PAYROLL','SOCIAL']
      ELSE ARRAY['System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder',
                 'Warning','Error','Goal','Training','Chat','Asset','Room','Recruit','Payroll','Social']
    END;

    SELECT array_agg(m[1]) INTO v_extra
      FROM regexp_matches(r.def, '''([^'']+)''', 'g') AS m
     WHERE m[1] <> ALL (v_super);

    -- Chỉ ĐỎ khi (B)/(C) THẬT SỰ sắp chạy (CHECK chưa có SOCIAL/Social). Đã có ⇒ idempotent-skip và
    -- giá trị của module SAU không bị đe doạ (noti-check-baseline-guard-must-be-forward-compatible).
    -- needle tính TRƯỚC IF: PL/pgSQL cắt điều kiện IF ở chữ THEN đầu tiên
    -- (plpgsql-if-condition-cut-at-first-then).
    v_needle := CASE WHEN r.conname LIKE '%module_code%' THEN '%''SOCIAL''%' ELSE '%''Social''%' END;
    IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 AND r.def NOT LIKE v_needle THEN
      RAISE EXCEPTION '[0581] % (%) chua gia tri NGOAI superset cua 0581: % — superset viet tay se XOA chung. '
                      'Cap nhat danh sach trong 0581 roi chay lai.', r.conname, r.tbl, v_extra;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('chk_notification_events_module_code', 'chk_notification_events_type',
                         'chk_notifications_module_code', 'chk_notifications_notification_type')) <> 4 THEN
    RAISE EXCEPTION '[0581] baseline lech: khong du 4 CHECK NOTI (events x2 + notifications x2)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
       AND pg_get_constraintdef(oid) NOT LIKE '%''PAYROLL''%'
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
       AND pg_get_constraintdef(oid) NOT LIKE '%''Payroll''%'
  ) THEN
    RAISE EXCEPTION '[0581] baseline lech: thieu PAYROLL/Payroll — chuoi migration khong phai ban sau 0566';
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
       AND pg_get_constraintdef(oid) LIKE '%''SOCIAL''%'
  ) THEN
    RAISE NOTICE '[0581] SOCIAL da co trong chk_notification_events_module_code — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_module_code;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_module_code
      CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT',
                             'ASSET','ROOM','RECRUIT','PAYROLL','SOCIAL'));
    RAISE NOTICE '[0581] da them SOCIAL vao chk_notification_events_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname  = 'chk_notification_events_type'
       AND pg_get_constraintdef(oid) LIKE '%''Social''%'
  ) THEN
    RAISE NOTICE '[0581] Social da co trong chk_notification_events_type — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_type;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_type
      CHECK (notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project',
                                   'Approval','Reminder','Warning','Error','Goal','Training','Chat',
                                   'Asset','Room','Recruit','Payroll','Social'));
    RAISE NOTICE '[0581] da them Social vao chk_notification_events_type';
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
       AND pg_get_constraintdef(oid) LIKE '%''SOCIAL''%'
  ) THEN
    RAISE NOTICE '[0581] SOCIAL da co trong chk_notifications_module_code — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_module_code;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_module_code
      CHECK (module_code IS NULL OR module_code IN
             ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM',
              'RECRUIT','PAYROLL','SOCIAL'));
    RAISE NOTICE '[0581] da them SOCIAL vao chk_notifications_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname  = 'chk_notifications_notification_type'
       AND pg_get_constraintdef(oid) LIKE '%''Social''%'
  ) THEN
    RAISE NOTICE '[0581] Social da co trong chk_notifications_notification_type — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_notification_type;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_notification_type
      CHECK (notification_type IS NULL OR notification_type IN
             ('System','Account','HR','Attendance','Leave','Task','Project',
              'Approval','Reminder','Warning','Error','Goal','Training','Chat','Asset','Room','Recruit',
              'Payroll','Social'));
    RAISE NOTICE '[0581] da them Social vao chk_notifications_notification_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────── (D) Catalog 9 event SOCIAL (GLOBAL, company_id NULL) — NOTI-EVENT-028..036 ───────────
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority,
   default_channels, is_enabled, is_system_event, dedupe_strategy, dedupe_window_seconds)
VALUES
  (NULL::uuid, 'SOCIAL', 'SOCIAL_MENTIONED',            'Có người nhắc tên bạn',         'Social', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'SOCIAL', 'SOCIAL_POST_COMMENTED',       'Bài của bạn có bình luận mới',  'Social', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'SOCIAL', 'SOCIAL_COMMENT_REPLIED',      'Bình luận của bạn có trả lời',  'Social', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'SOCIAL', 'SOCIAL_NEWS_PUBLISHED',       'Tin tức công ty mới',           'Social', 'High',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'SOCIAL', 'SOCIAL_IDEA_STATUS_CHANGED',  'Sáng kiến đổi trạng thái',      'Social', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'SOCIAL', 'SOCIAL_KUDOS_RECEIVED',       'Bạn được vinh danh',            'Social', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  -- 🔴 034: 'None' có chủ ý — xem header (không nguồn decided_at bền vững cho cả hai nhánh).
  (NULL::uuid, 'SOCIAL', 'SOCIAL_GROUP_JOIN_DECIDED',   'Kết quả yêu cầu vào nhóm',      'Social', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'None', NULL),
  -- 035: job phát ⇒ is_system_event = true.
  (NULL::uuid, 'SOCIAL', 'SOCIAL_POLL_CLOSED',          'Bình chọn đã đóng',             'Social', 'Low',
   '["IN_APP"]'::jsonb, true, true,  'DedupeKey', NULL),
  (NULL::uuid, 'SOCIAL', 'SOCIAL_POST_REPORTED',        'Có bài bị báo cáo',             'Social', 'High',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL)
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────── (E) Template IN_APP vi-VN — ⚠️ KHÔNG BIẾN TIỀN/PII, KHÔNG review_note, KHÔNG user_id ───────────
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template,
   short_body_template, target_url_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.target_url_template,
  t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('SOCIAL_MENTIONED', 'SOCIAL_MENTIONED__IN_APP__vi-VN',
     '{actor_name} đã nhắc tên bạn',
     '{actor_name} đã nhắc tên bạn trong một {target_type_label}. Mở để xem.',
     'Bạn được nhắc tên',
     '/social/posts/{post_id}',
     '{"actor_name":"string","target_type_label":"string","post_id":"uuid"}'),
  ('SOCIAL_POST_COMMENTED', 'SOCIAL_POST_COMMENTED__IN_APP__vi-VN',
     'Bài của bạn có bình luận mới',
     '{actor_name} đã bình luận vào bài viết của bạn.',
     'Có bình luận mới',
     '/social/posts/{post_id}',
     '{"actor_name":"string","post_id":"uuid"}'),
  ('SOCIAL_COMMENT_REPLIED', 'SOCIAL_COMMENT_REPLIED__IN_APP__vi-VN',
     'Bình luận của bạn có trả lời',
     '{actor_name} đã trả lời bình luận của bạn.',
     'Có trả lời mới',
     '/social/posts/{post_id}',
     '{"actor_name":"string","post_id":"uuid"}'),
  ('SOCIAL_NEWS_PUBLISHED', 'SOCIAL_NEWS_PUBLISHED__IN_APP__vi-VN',
     'Tin tức mới: {post_title}',
     '{actor_name} đã đăng một tin tức công ty. Mở để đọc.',
     'Tin tức công ty mới',
     '/social/posts/{post_id}',
     '{"actor_name":"string","post_title":"string","post_id":"uuid"}'),
  -- ⚠️ CHỈ status_label — KHÔNG nhúng review_note (chữ tự do của người duyệt).
  ('SOCIAL_IDEA_STATUS_CHANGED', 'SOCIAL_IDEA_STATUS_CHANGED__IN_APP__vi-VN',
     'Sáng kiến của bạn: {status_label}',
     'Sáng kiến của bạn đã chuyển sang trạng thái «{status_label}».',
     'Sáng kiến {status_label}',
     '/social/posts/{post_id}',
     '{"status_label":"string","post_id":"uuid"}'),
  ('SOCIAL_KUDOS_RECEIVED', 'SOCIAL_KUDOS_RECEIVED__IN_APP__vi-VN',
     'Bạn được vinh danh',
     '{actor_name} đã gửi lời vinh danh tới bạn.',
     'Bạn được vinh danh',
     '/social/posts/{post_id}',
     '{"actor_name":"string","post_id":"uuid"}'),
  ('SOCIAL_GROUP_JOIN_DECIDED', 'SOCIAL_GROUP_JOIN_DECIDED__IN_APP__vi-VN',
     'Yêu cầu vào nhóm {group_name}: {decision_label}',
     'Yêu cầu tham gia nhóm «{group_name}» của bạn đã được {decision_label}.',
     'Yêu cầu vào nhóm {decision_label}',
     '/social/groups/{group_id}',
     '{"group_name":"string","decision_label":"string","group_id":"uuid"}'),
  -- ⚠️ KHÔNG biến nào lộ người bỏ phiếu (poll có thể ẩn danh — SOC-DEC-009).
  ('SOCIAL_POLL_CLOSED', 'SOCIAL_POLL_CLOSED__IN_APP__vi-VN',
     'Bình chọn của bạn đã đóng',
     'Bình chọn «{poll_question}» đã đóng. Mở để xem kết quả.',
     'Bình chọn đã đóng',
     '/social/posts/{post_id}',
     '{"poll_question":"string","post_id":"uuid"}'),
  ('SOCIAL_POST_REPORTED', 'SOCIAL_POST_REPORTED__IN_APP__vi-VN',
     'Có nội dung bị báo cáo',
     'Một {target_type_label} vừa bị báo cáo với lý do «{reason_label}». Mở hàng đợi kiểm duyệt.',
     'Có nội dung bị báo cáo',
     '/social/reports',
     '{"target_type_label":"string","reason_label":"string"}')
) AS t(event_code, template_code, title_template, body_template, short_body_template,
       target_url_template, variables_schema)
JOIN notification_events e
  ON e.event_code = t.event_code AND e.company_id IS NULL AND e.deleted_at IS NULL
ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (F) VERIFY FAIL-LOUD (khuôn 0573 khối D) ───────────────
DO $$
DECLARE
  v_n   int;
  v_bad text;
BEGIN
  -- (1) 4 CHECK NOTI đã có SOCIAL/Social — assert DƯƠNG, không tin (B)/(C) đã chạy.
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE (conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
          AND pg_get_constraintdef(oid) LIKE '%''SOCIAL''%')
      OR (conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
          AND pg_get_constraintdef(oid) LIKE '%''Social''%');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0581] verify: chi % / 4 CHECK NOTI co SOCIAL/Social', v_n;
  END IF;

  -- (2) `notifications` GIỮ nhánh IS NULL OR (hàng legacy để NULL — 0479:249).
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname IN ('chk_notifications_module_code', 'chk_notifications_notification_type')
                AND pg_get_constraintdef(oid) NOT LIKE '%IS NULL%') THEN
    RAISE EXCEPTION '[0581] verify: CHECK tren notifications MAT nhanh `IS NULL OR`';
  END IF;

  -- (3) 9 event SOCIAL global = SET-EQUALITY theo MÃ (THIẾU/THỪA).
  SELECT string_agg(x.d, '; ') INTO v_bad FROM (
    SELECT 'THIEU ' || c AS d
      FROM unnest(ARRAY['SOCIAL_MENTIONED', 'SOCIAL_POST_COMMENTED', 'SOCIAL_COMMENT_REPLIED',
                        'SOCIAL_NEWS_PUBLISHED', 'SOCIAL_IDEA_STATUS_CHANGED', 'SOCIAL_KUDOS_RECEIVED',
                        'SOCIAL_GROUP_JOIN_DECIDED', 'SOCIAL_POLL_CLOSED', 'SOCIAL_POST_REPORTED']) AS c
     WHERE NOT EXISTS (SELECT 1 FROM notification_events e
                        WHERE e.event_code = c AND e.company_id IS NULL AND e.deleted_at IS NULL
                          AND e.module_code = 'SOCIAL')
    UNION ALL
    SELECT 'THUA ' || e.event_code
      FROM notification_events e
     WHERE e.company_id IS NULL AND e.deleted_at IS NULL AND e.module_code = 'SOCIAL'
       AND e.event_code NOT IN ('SOCIAL_MENTIONED', 'SOCIAL_POST_COMMENTED', 'SOCIAL_COMMENT_REPLIED',
                                'SOCIAL_NEWS_PUBLISHED', 'SOCIAL_IDEA_STATUS_CHANGED', 'SOCIAL_KUDOS_RECEIVED',
                                'SOCIAL_GROUP_JOIN_DECIDED', 'SOCIAL_POLL_CLOSED', 'SOCIAL_POST_REPORTED')) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0581] verify: tap event SOCIAL global lech: %', v_bad;
  END IF;

  -- (4) Từng mã đúng dedupe/window/enabled/system/type/priority theo bảng plan §5.3.
  SELECT string_agg(e.event_code, ', ') INTO v_bad
    FROM notification_events e
    JOIN (VALUES
      ('SOCIAL_MENTIONED',           'Normal', 'DedupeKey', false),
      ('SOCIAL_POST_COMMENTED',      'Normal', 'DedupeKey', false),
      ('SOCIAL_COMMENT_REPLIED',     'Normal', 'DedupeKey', false),
      ('SOCIAL_NEWS_PUBLISHED',      'High',   'DedupeKey', false),
      ('SOCIAL_IDEA_STATUS_CHANGED', 'Normal', 'DedupeKey', false),
      ('SOCIAL_KUDOS_RECEIVED',      'Normal', 'DedupeKey', false),
      ('SOCIAL_GROUP_JOIN_DECIDED',  'Normal', 'None',      false),
      ('SOCIAL_POLL_CLOSED',         'Low',    'DedupeKey', true),
      ('SOCIAL_POST_REPORTED',       'High',   'DedupeKey', false)
    ) AS x(code, prio, dedupe, sysev) ON x.code = e.event_code
   WHERE e.company_id IS NULL AND e.deleted_at IS NULL
     AND (e.dedupe_strategy IS DISTINCT FROM x.dedupe OR e.dedupe_window_seconds IS NOT NULL
          OR NOT e.is_enabled OR e.is_system_event IS DISTINCT FROM x.sysev
          OR e.notification_type <> 'Social' OR e.default_priority IS DISTINCT FROM x.prio
          OR e.default_channels IS DISTINCT FROM '["IN_APP"]'::jsonb);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0581] verify: event sai dedupe/window/enabled/system/type/priority/channels: %', v_bad;
  END IF;

  -- (5) Đúng 9 template SOCIAL global (mỗi event enabled PHẢI có đúng 1 template IN_APP/vi-VN).
  SELECT count(*) INTO v_n FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
   WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.module_code = 'SOCIAL';
  IF v_n <> 9 THEN
    RAISE EXCEPTION '[0581] verify: co % template SOCIAL, ky vong dung 9', v_n;
  END IF;

  -- (6) 0 biến tiền trong variables_schema của 9 template mới (khuôn 0573).
  SELECT string_agg(t.template_code || '.' || k, ', ') INTO v_bad
    FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
    CROSS JOIN LATERAL jsonb_object_keys(t.variables_schema) AS k
   WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.module_code = 'SOCIAL'
     AND k ~* '(amount|salary|gross|net|total|tien)';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0581] verify: template mang BIEN SO TIEN: %', v_bad;
  END IF;

  -- (6a) 0 biến lộ danh tính người bỏ phiếu / chữ tự do của người duyệt (SOC-DEC-009 · SPEC-16 §17).
  SELECT string_agg(t.template_code || '.' || k, ', ') INTO v_bad
    FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
    CROSS JOIN LATERAL jsonb_object_keys(t.variables_schema) AS k
   WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.module_code = 'SOCIAL'
     AND k ~* '(user_id|voter|review_note|email|phone)';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0581] verify: template mang BIEN LO DANH TINH/CHU TU DO: %', v_bad;
  END IF;

  RAISE NOTICE '[0581] verify OK: 4 CHECK NOTI co SOCIAL/Social (notifications giu IS NULL OR), '
               '9 event SOCIAL (8 DedupeKey + 1 None, 1 system), 9 template IN_APP/vi-VN, 0 bien tien/PII';
END;
$$;
