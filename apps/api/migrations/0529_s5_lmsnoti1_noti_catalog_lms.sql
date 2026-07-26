-- Migration 0529: S5-LMS-NOTI-1 (🔴 RED, zone=red, crown) — SEED NOTI catalog LMS (4 event + 4 template)
--   + VÁ 2 CHECK trên bảng `notifications` mà 0507 (GOAL) BỎ SÓT.
--   THUẦN DATA/DDL-CHECK — mirror 0507/0481/0490. Seed qua migrator owner-bypass. NỐI TIẾP head 0528.
--   Nguồn: registry apps/api/src/foundation/seed/notification-event-catalog.const.ts (đồng bộ 1-1) +
--   docs/plans/S5-LMS-NOTI-1.md §3. Owner chốt 2026-07-26: đủ 4 mã LMS_*.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ LỖI ĐÃ SHIP ĐƯỢC VÁ Ở ĐÂY (docs/plans/S5-LMS-NOTI-1.md §0.1)
--   0507 nới CHECK trên `notification_events` (module_code += 'GOAL', notification_type += 'Goal') nhưng
--   KHÔNG nới 2 CHECK CÙNG NGHĨA trên bảng `notifications` (0479:252-257). Engine ghi
--   notifications.module_code = ev.module_code và notifications.notification_type = ev.notification_type
--   (notifications.repository.ts:170-171) ⇒ MỌI GOAL_ASSIGNED/GOAL_FINALIZED VỠ CHECK KHI INSERT.
--   Đo trên DB PROD 2026-07-26: chk_notifications_module_code KHÔNG có 'GOAL'; 0 hàng notifications GOAL.
--   Bước (3)+(4) dưới đây nới cho CẢ 'GOAL'/'Goal' (vá) LẪN 'LMS'/'Training' (mới) — vì tay đang đặt đúng
--   trên 2 constraint đó, bỏ qua GOAL là cố ý để lỗi lại. Hồi quy: test/integration/
--   lms-noti-service-intake.int-spec.ts ca (j).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- BỐI CẢNH (seed global qua migrator owner — mirror 0507:7-11):
--   notification_events/notification_templates (0479) company_id NULLABLE, RLS+FORCE bật, app role CHỈ GRANT
--   SELECT. Row GLOBAL (company_id NULL) ghi qua TABLE-OWNER (rolbypassrls).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 RLS+FORCE + policy đã tạo Ở 0479 TRƯỚC seed — 0529 CHỈ INSERT DATA global + nới CHECK, KHÔNG đụng
--      cô lập tenant.
--   #2 CHECK: UNION ADD-only (idempotent, append-only). ⚠️ KHÔNG dùng parser DO-block mẫu 0474 (giả định
--      array-literal '{...}' — trả NULL cho dạng `= ANY(ARRAY[...]::text[])` ⇒ silent skip). Dùng đúng cách
--      0507: guard LIKE + RE-STAMP SUPERSET tường minh. Đã verify bằng grep toàn apps/api/migrations: CHỈ
--      0479 (tạo) và 0507 (nới GOAL) từng định nghĩa 4 constraint này ⇒ superset viết tay KHÔNG mất giá trị.
--      2 CHECK trên `notifications` PHẢI GIỮ nhánh `IS NULL OR` (hàng legacy để cột mới NULL — 0479:249).
--   #3 template KHÔNG chứa dữ liệu nhạy cảm (không điểm thi, không nội dung bài) — chỉ tên khoá/bài thi +
--      link. target_url = '/me/training' (route nội bộ; assertInternalTargetUrl chặn URL ngoài → 422).
--   • Catalog: ON CONFLICT partial-unique (uq_notification_events_global_code_active 0479:84 /
--     uq_notification_templates_global_code_active 0479:143) — bare ON CONFLICT(event_code) nổ 42P10.
--
-- BAND 0529 (lane S5-LMS-NOTI-1). Journal: idx 196, when 1717587318000 (> 0528 idx 195 / 1717587317000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── (1) chk_notification_events_module_code += 'LMS' (UNION ADD-only, guard + re-stamp) ──────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname = 'chk_notification_events_module_code'
       AND pg_get_constraintdef(oid) LIKE '%''LMS''%'
  ) THEN
    RAISE NOTICE '[0529] LMS da co trong chk_notification_events_module_code — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_module_code;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_module_code
      CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS'));
    RAISE NOTICE '[0529] da them LMS vao chk_notification_events_module_code';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────── (2) chk_notification_events_type += 'Training' (UNION ADD-only, guard + re-stamp) ────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname = 'chk_notification_events_type'
       AND pg_get_constraintdef(oid) LIKE '%''Training''%'
  ) THEN
    RAISE NOTICE '[0529] Training da co trong chk_notification_events_type — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_type;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_type
      CHECK (notification_type IN
        ('System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder','Warning',
         'Error','Goal','Training'));
    RAISE NOTICE '[0529] da them Training vao chk_notification_events_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────── (3) VÁ chk_notifications_module_code += 'GOAL' (sót từ 0507) + 'LMS' ────────────────────────
--     GIỮ nhánh `IS NULL OR` (0479:253-254) — hàng legacy có module_code NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname = 'chk_notifications_module_code'
       AND pg_get_constraintdef(oid) LIKE '%''LMS''%'
       AND pg_get_constraintdef(oid) LIKE '%''GOAL''%'
  ) THEN
    RAISE NOTICE '[0529] GOAL+LMS da co trong chk_notifications_module_code — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_module_code;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_module_code
      CHECK (module_code IS NULL OR module_code IN
        ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS'));
    RAISE NOTICE '[0529] da them GOAL+LMS vao chk_notifications_module_code (va loi 0507 bo sot)';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────── (4) VÁ chk_notifications_notification_type += 'Goal' (sót từ 0507) + 'Training' ─────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname = 'chk_notifications_notification_type'
       AND pg_get_constraintdef(oid) LIKE '%''Training''%'
       AND pg_get_constraintdef(oid) LIKE '%''Goal''%'
  ) THEN
    RAISE NOTICE '[0529] Goal+Training da co trong chk_notifications_notification_type — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_notification_type;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_notification_type
      CHECK (notification_type IS NULL OR notification_type IN
        ('System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder','Warning',
         'Error','Goal','Training'));
    RAISE NOTICE '[0529] da them Goal+Training vao chk_notifications_notification_type (va loi 0507 bo sot)';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────── (5) SEED 4 event LMS GLOBAL (company_id NULL, enabled). ON CONFLICT partial (0507:80). ──────
--     LMS_COURSE_DEADLINE_NEAR dùng type 'Reminder' theo quy ước sẵn có (TASK_DUE_SOON,
--     HR_CONTRACT_EXPIRING) — KHÔNG đẻ type mới cho việc nhắc hạn.
--
--     ⚠️ dedupe_strategy = 'DedupeKey' (KHÁC mặc định 'None' của 0479:50) — CÓ CHỦ ĐÍCH. Caller là MÁY ở
--     ngoài tiến trình: mạng chập, retry, double-submit là chuyện thường ngày, và 'None' nghĩa là mỗi lần
--     gọi lại đẻ thêm 1 thông báo. 'DedupeKey' trao quyền quyết định idempotency cho caller qua khoá ổn định
--     (LmsNotificationsController BẮT BUỘC gửi `dedupeKey` — 400 nếu thiếu, nên không có ca "quên gửi ⇒ im
--     lặng mất dedupe"). KHÔNG chọn 'EntityRecipient' (once-ever theo entity) vì nó sẽ khiến
--     LMS_COURSE_DEADLINE_NEAR chỉ nhắc được ĐÚNG MỘT LẦN cho mỗi khoá/người, vĩnh viễn.
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority, default_channels, is_enabled, is_system_event, dedupe_strategy)
VALUES
  (NULL::uuid, 'LMS', 'LMS_ENROLLMENT_APPROVED',  'Ghi danh khoá học được duyệt', 'Training', 'Normal', '["IN_APP"]'::jsonb, true, false, 'DedupeKey'),
  (NULL::uuid, 'LMS', 'LMS_COURSE_ASSIGNED',      'Được gán khoá học mới',        'Training', 'Normal', '["IN_APP"]'::jsonb, true, false, 'DedupeKey'),
  (NULL::uuid, 'LMS', 'LMS_EXAM_GRADED',          'Bài thi đã được chấm',         'Training', 'Normal', '["IN_APP"]'::jsonb, true, false, 'DedupeKey'),
  (NULL::uuid, 'LMS', 'LMS_COURSE_DEADLINE_NEAR', 'Khoá học sắp tới hạn',         'Reminder', 'High',   '["IN_APP"]'::jsonb, true, false, 'DedupeKey')
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────── (6) SEED 4 template GLOBAL IN_APP/vi-VN (mirror 0507:85). ON CONFLICT partial. ─────────────
--     target_url = '/me/training' cho CẢ 4: assertInternalTargetUrl chỉ nhận route NỘI BỘ, không deep-link
--     được sang LMS. Renderer GIỮ NGUYÊN placeholder khi thiếu biến ⇒ chỉ dùng biến LMS luôn gửi được.
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template, short_body_template,
   target_url_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.target_url_template, t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('LMS_ENROLLMENT_APPROVED', 'LMS_ENROLLMENT_APPROVED__IN_APP__vi-VN',
     'Ghi danh khoá học đã được duyệt',
     'Ghi danh khoá học {course_name} của bạn đã được duyệt. Bạn có thể bắt đầu học ngay.',
     'Ghi danh {course_name} đã được duyệt.',
     '/me/training',
     '{"course_name":"string"}'),
  ('LMS_COURSE_ASSIGNED', 'LMS_COURSE_ASSIGNED__IN_APP__vi-VN',
     'Bạn được gán khoá học mới',
     'Bạn được gán khoá học {course_name}. Xem chi tiết trong mục Đào tạo.',
     'Khoá học mới: {course_name}.',
     '/me/training',
     '{"course_name":"string"}'),
  ('LMS_EXAM_GRADED', 'LMS_EXAM_GRADED__IN_APP__vi-VN',
     'Bài thi đã có kết quả',
     'Bài thi {exam_name} của bạn đã được chấm. Xem kết quả trong mục Đào tạo.',
     'Bài thi {exam_name} đã được chấm.',
     '/me/training',
     '{"exam_name":"string"}'),
  ('LMS_COURSE_DEADLINE_NEAR', 'LMS_COURSE_DEADLINE_NEAR__IN_APP__vi-VN',
     'Khoá học sắp tới hạn',
     'Khoá học {course_name} sắp tới hạn hoàn thành ({deadline_label}). Hãy hoàn tất sớm.',
     '{course_name} sắp tới hạn ({deadline_label}).',
     '/me/training',
     '{"course_name":"string","deadline_label":"string"}')
) AS t(event_code, template_code, title_template, body_template, short_body_template, target_url_template, variables_schema)
JOIN notification_events e
  ON e.event_code = t.event_code
 AND e.company_id IS NULL
 AND e.deleted_at IS NULL
ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (7) VERIFY fail-LOUD: 4 event LMS tồn tại + enabled + mỗi event có ≥1 template Active default vi-VN +
--     CẢ 4 CHECK chứa giá trị mới (kể cả 2 CHECK vá cho GOAL). Idempotent: chạy lại vẫn PASS.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  ev        text;
  v_n       int;
  v_missing text;
BEGIN
  FOREACH ev IN ARRAY ARRAY['LMS_ENROLLMENT_APPROVED','LMS_COURSE_ASSIGNED','LMS_EXAM_GRADED','LMS_COURSE_DEADLINE_NEAR'] LOOP
    SELECT COUNT(*) INTO v_n
      FROM notification_events
     WHERE event_code = ev AND company_id IS NULL AND deleted_at IS NULL
       AND is_enabled = true AND module_code = 'LMS' AND dedupe_strategy = 'DedupeKey';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0529] verify: event % (LMS/enabled/DedupeKey) không đúng 1 hàng (có %)', ev, v_n;
    END IF;

    SELECT COUNT(*) INTO v_n
      FROM notification_templates t
      JOIN notification_events e ON e.id = t.event_id
     WHERE e.event_code = ev AND e.company_id IS NULL
       AND t.company_id IS NULL AND t.deleted_at IS NULL
       AND t.channel = 'IN_APP' AND t.locale = 'vi-VN' AND t.status = 'Active' AND t.is_default = true;
    IF v_n < 1 THEN
      RAISE EXCEPTION '[0529] verify: event % thiếu template Active default IN_APP/vi-VN', ev;
    END IF;
  END LOOP;

  -- 4 CHECK × giá trị bắt buộc. Kiểm TỪNG cặp (constraint, giá trị) — không gộp, để thông báo chỉ đúng chỗ hỏng.
  SELECT string_agg(x.conname || ':' || x.val, ', ')
    INTO v_missing
    FROM (VALUES
      ('notification_events'::regclass, 'chk_notification_events_module_code',  'LMS'),
      ('notification_events'::regclass, 'chk_notification_events_type',         'Training'),
      ('notifications'::regclass,       'chk_notifications_module_code',        'GOAL'),
      ('notifications'::regclass,       'chk_notifications_module_code',        'LMS'),
      ('notifications'::regclass,       'chk_notifications_notification_type',  'Goal'),
      ('notifications'::regclass,       'chk_notifications_notification_type',  'Training')
    ) AS x(rel, conname, val)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = x.rel AND c.conname = x.conname
        AND pg_get_constraintdef(c.oid) LIKE '%''' || x.val || '''%'
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '[0529] verify: CHECK thiếu giá trị — %', v_missing;
  END IF;

  RAISE NOTICE '[0529] verify PASS: 4 event LMS enabled + template vi-VN + 4 CHECK mo rong (ke ca va GOAL)';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM notification_templates WHERE company_id IS NULL AND template_code IN
--   ('LMS_ENROLLMENT_APPROVED__IN_APP__vi-VN','LMS_COURSE_ASSIGNED__IN_APP__vi-VN',
--    'LMS_EXAM_GRADED__IN_APP__vi-VN','LMS_COURSE_DEADLINE_NEAR__IN_APP__vi-VN');
-- DELETE FROM notification_events WHERE company_id IS NULL AND event_code LIKE 'LMS\_%';
-- -- CHECK union KHÔNG thu hẹp (append-only #2 — ADD-only vô hại; thu hẹp lại sẽ TÁI TẠO lỗi §0.1).
