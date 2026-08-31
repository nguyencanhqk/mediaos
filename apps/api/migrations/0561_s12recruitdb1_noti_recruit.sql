-- Migration 0561: S12-RECRUIT-DB-1 (🔴 RED, zone=red) — SEED NOTI RECRUIT (DB-14 §9 bước C · SPEC-12 §17):
--   nới CHECK module_code += 'RECRUIT' và notification_type += 'Recruit' trên CẢ HAI bảng notification_events
--   VÀ notifications + 4 event RECRUIT_JOB_ASSIGNED / RECRUIT_INTERVIEW_SCHEDULED / RECRUIT_STAGE_CHANGED /
--   RECRUIT_CANDIDATE_HIRED (NOTI-EVENT-016..019) + 4 template IN_APP/vi-VN.
--   THUẦN DATA/DDL-CHECK — KHÔNG db:generate. Mirror 0551 (bản đã vá lỗi 0507 quên vế `notifications`).
--
-- QUYẾT ĐỊNH CHỐT (plan §4 · SPEC-12 §17):
--   • dedupe_strategy = 'DedupeKey', dedupe_window_seconds = NULL cho CẢ 4 (mặc định 0479 là 'None' ⇒
--     computeKey trả NULL ⇒ partial unique uq_notifications_dedupe_active coi mọi NULL là distinct ⇒ tầng
--     dedupe BIẾN MẤT; sửa sau = migration thứ hai — 0538:707). Catalog thắng DEFAULT_DEDUPE ⇒ KHÔNG thêm
--     entry notification-dedupe.const.ts. Nhánh DedupeKey không dùng windowSeconds ⇒ once-ever đúng SPEC.
--     Khoá dedupe (WO BE tính, ghi ở đây để không trôi):
--       016 'RECRUIT_JOB_ASSIGNED:{jobOpeningId}:{auditLogId}' — mỗi LẦN gán là một sự kiện. Khoá theo
--           {jobId}:{userId} là "once-ever": A→B→A thì A KHÔNG BAO GIỜ được báo lại (plan-review H2);
--           engine DedupeKey không có bucket thời gian nên `auditLogId` của chính lần PATCH là mốc phân biệt.
--       017 'RECRUIT_INTERVIEW_SCHEDULED:{interviewId}' — huỷ + tạo lượt mới là interviewId MỚI.
--       018 'RECRUIT_STAGE_CHANGED:{stageEventId}'      — mỗi hàng sổ append-only một lần.
--       019 'RECRUIT_CANDIDATE_HIRED:{candidateId}'     — convert đúng một lần (chốt cuối UNIQUE employee_id).
--   • priority: Normal (016/018/019) · High (017). isSystemEvent=false cả 4 — RECRUIT v1 KHÔNG có system job
--     (mọi event đều event-driven; nhắc lịch phỏng vấn là Phase sau).
--   • recipient_rule_config NULL (bridge resolve người nhận bằng code): 016 recruiter mới (trừ actor tự gán
--     mình) · 017 user của interview_participants (employee không có user thì BỎ QUA) · 018 recruiter_user_id
--     của vị trí (trừ actor) · 019 user giữ role **`hr`** (mode 'UserIds' theo user_roles còn hiệu lực, trừ
--     actor). **KHÔNG gửi `hr-manager`** (plan-review B6: role đó KHÔNG có grant RECRUIT ở v1 — nhận link là
--     đâm vào 403).
--   • Payload/template CHỈ tên ứng viên + tên vị trí + stage/giờ hẹn + liên kết — **KHÔNG email/phone/lương**
--     (bất biến #3 + SPEC-12 §18). `candidates.full_name` là projection DUY NHẤT được tuyên bố cho phép lộ.
--   • ON CONFLICT nhắm PARTIAL unique (uq_notification_events_global_code_active / template_code) — bare ⇒ 42P10.
--   • CHECK NOTI dạng IN (…): guard LIKE + re-stamp superset TƯỜNG MINH (khuôn 0538/0551/0555) — KHÔNG parser
--     DO-block 0474.
--
-- BẤT BIẾN #1: 4 CHECK trên `notifications` GIỮ nhánh `IS NULL OR` (hàng legacy để NULL — 0479:249).
-- PHẢI xong TRƯỚC khi S12-RECRUIT-BE-1 đăng ký registrar outbox (registerSource() fail-loud lúc boot nếu
--   eventCode chưa có trong catalog isEnabled=true).
--
-- BAND 0561 (lane S12-RECRUIT-DB-1). Journal: idx 228, when 1717587350000 (> 0560 idx 227 / 1717587349000).
--   Cùng commit: notification-event-catalog.const.ts (NotiModuleCode += RECRUIT · NotiType += Recruit · 4 entry ·
--   pin 67→71 / 53→57) · packages/contracts notification.ts notificationTypeEnumSchema += 'Recruit' ·
--   pin noti-seed-catalog-permissions (67/53 → 71/57) · s5-noti-fix1-deeplink (53 → 57 template global).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (A) BASELINE GUARD: 4 CHECK là bản SAU 0555 (có ROOM/Room), 0 giá trị ngoài superset ───────────────
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
        THEN ARRAY['AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM','RECRUIT']
      ELSE ARRAY['System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder',
                 'Warning','Error','Goal','Training','Chat','Asset','Room','Recruit']
    END;

    SELECT array_agg(m[1]) INTO v_extra
      FROM regexp_matches(r.def, '''([^'']+)''', 'g') AS m
     WHERE m[1] <> ALL (v_super);

    -- FORWARD-COMPATIBLE (noti-check-baseline-guard-must-be-forward-compatible): chỉ ĐỎ khi re-stamp (B)/(C)
    -- THẬT SỰ sắp chạy (CHECK chưa có RECRUIT/Recruit). Nếu đã có thì các khối dưới idempotent-skip, không
    -- DROP/ADD gì ⇒ giá trị của module SAU không bị đe doạ và file này vẫn replay được trên DB đã tiến xa hơn
    -- (ca H1 của s12-recruit-db1-invariants chạy lại NGUYÊN file).
    -- (needle tính TRƯỚC IF: PL/pgSQL cắt điều kiện IF ở chữ THEN đầu tiên — CASE…THEN lồng trong IF bị cắt cụt.)
    v_needle := CASE WHEN r.conname LIKE '%module_code%' THEN '%''RECRUIT''%' ELSE '%''Recruit''%' END;
    IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 AND r.def NOT LIKE v_needle THEN
      RAISE EXCEPTION '[0561] % (%) chua gia tri NGOAI superset cua 0561: % — superset viet tay se XOA chung. '
                      'Cap nhat danh sach trong 0561 roi chay lai.', r.conname, r.tbl, v_extra;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('chk_notification_events_module_code', 'chk_notification_events_type',
                         'chk_notifications_module_code', 'chk_notifications_notification_type')) <> 4 THEN
    RAISE EXCEPTION '[0561] baseline lech: khong du 4 CHECK NOTI (events x2 + notifications x2)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
       AND pg_get_constraintdef(oid) NOT LIKE '%''ROOM''%'
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
       AND pg_get_constraintdef(oid) NOT LIKE '%''Room''%'
  ) THEN
    RAISE EXCEPTION '[0561] baseline lech: thieu ROOM/Room — chuoi migration khong phai ban sau 0555';
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
       AND pg_get_constraintdef(oid) LIKE '%''RECRUIT''%'
  ) THEN
    RAISE NOTICE '[0561] RECRUIT da co trong chk_notification_events_module_code — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_module_code;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_module_code
      CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT',
                             'ASSET','ROOM','RECRUIT'));
    RAISE NOTICE '[0561] da them RECRUIT vao chk_notification_events_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname  = 'chk_notification_events_type'
       AND pg_get_constraintdef(oid) LIKE '%''Recruit''%'
  ) THEN
    RAISE NOTICE '[0561] Recruit da co trong chk_notification_events_type — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_type;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_type
      CHECK (notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project',
                                   'Approval','Reminder','Warning','Error','Goal','Training','Chat',
                                   'Asset','Room','Recruit'));
    RAISE NOTICE '[0561] da them Recruit vao chk_notification_events_type';
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
       AND pg_get_constraintdef(oid) LIKE '%''RECRUIT''%'
  ) THEN
    RAISE NOTICE '[0561] RECRUIT da co trong chk_notifications_module_code — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_module_code;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_module_code
      CHECK (module_code IS NULL OR module_code IN
             ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM','RECRUIT'));
    RAISE NOTICE '[0561] da them RECRUIT vao chk_notifications_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname  = 'chk_notifications_notification_type'
       AND pg_get_constraintdef(oid) LIKE '%''Recruit''%'
  ) THEN
    RAISE NOTICE '[0561] Recruit da co trong chk_notifications_notification_type — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_notification_type;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_notification_type
      CHECK (notification_type IS NULL OR notification_type IN
             ('System','Account','HR','Attendance','Leave','Task','Project',
              'Approval','Reminder','Warning','Error','Goal','Training','Chat','Asset','Room','Recruit'));
    RAISE NOTICE '[0561] da them Recruit vao chk_notifications_notification_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────────── (D) Catalog 4 event RECRUIT (GLOBAL, company_id NULL) — SPEC-12 §17 / NOTI-EVENT-016..019 ─────
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority,
   default_channels, is_enabled, is_system_event, dedupe_strategy, dedupe_window_seconds)
VALUES
  (NULL::uuid, 'RECRUIT', 'RECRUIT_JOB_ASSIGNED',        'Được giao phụ trách vị trí tuyển dụng', 'Recruit', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'RECRUIT', 'RECRUIT_INTERVIEW_SCHEDULED', 'Lịch phỏng vấn đã được xếp',            'Recruit', 'High',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'RECRUIT', 'RECRUIT_STAGE_CHANGED',       'Ứng viên đổi giai đoạn',                'Recruit', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'RECRUIT', 'RECRUIT_CANDIDATE_HIRED',     'Ứng viên đã trúng tuyển',               'Recruit', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL)
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (E) Template GLOBAL IN_APP/vi-VN (mirror 0551 (E)) — KHÔNG email/phone/lương ───────────────
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template,
   short_body_template, target_url_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.target_url_template,
  t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('RECRUIT_JOB_ASSIGNED', 'RECRUIT_JOB_ASSIGNED__IN_APP__vi-VN',
     'Bạn phụ trách tuyển vị trí {job_title}',
     '{actor_name} đã giao bạn phụ trách tuyển dụng vị trí {job_title}.',
     'Phụ trách {job_title}',
     '/recruit/job-openings/{job_opening_id}',
     '{"actor_name":"string","job_title":"string","job_opening_id":"uuid"}'),
  ('RECRUIT_INTERVIEW_SCHEDULED', 'RECRUIT_INTERVIEW_SCHEDULED__IN_APP__vi-VN',
     'Bạn có lịch phỏng vấn {candidate_name}',
     'Bạn được xếp phỏng vấn {candidate_name} (vòng {round}) lúc {starts_at}.',
     'Phỏng vấn {candidate_name} lúc {starts_at}',
     '/recruit/candidates/{candidate_id}',
     '{"candidate_name":"string","round":"number","starts_at":"string","candidate_id":"uuid"}'),
  ('RECRUIT_STAGE_CHANGED', 'RECRUIT_STAGE_CHANGED__IN_APP__vi-VN',
     'Ứng viên {candidate_name} chuyển sang {to_stage}',
     '{actor_name} đã chuyển {candidate_name} từ {from_stage} sang {to_stage}.',
     '{candidate_name}: {from_stage} → {to_stage}',
     '/recruit/candidates/{candidate_id}',
     '{"actor_name":"string","candidate_name":"string","from_stage":"string","to_stage":"string","candidate_id":"uuid"}'),
  ('RECRUIT_CANDIDATE_HIRED', 'RECRUIT_CANDIDATE_HIRED__IN_APP__vi-VN',
     'Ứng viên {candidate_name} đã trúng tuyển',
     '{actor_name} đã chuyển {candidate_name} thành nhân viên cho vị trí {job_title}.',
     'Trúng tuyển: {candidate_name}',
     '/recruit/candidates/{candidate_id}',
     '{"actor_name":"string","candidate_name":"string","job_title":"string","candidate_id":"uuid"}')
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
  -- 4 CHECK đích danh chứa giá trị mới (quên vế `notifications` = lỗi đã ship 0507)
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE (conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
          AND pg_get_constraintdef(oid) LIKE '%''RECRUIT''%')
      OR (conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
          AND pg_get_constraintdef(oid) LIKE '%''Recruit''%');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0561] verify: chi % / 4 CHECK NOTI chua RECRUIT/Recruit — ve notifications bi bo sot?', v_n;
  END IF;

  -- 4 event global, enabled, DedupeKey (window NULL), type Recruit, module RECRUIT, KHÔNG system event
  SELECT count(*) INTO v_n FROM notification_events
   WHERE company_id IS NULL AND deleted_at IS NULL
     AND event_code IN ('RECRUIT_JOB_ASSIGNED', 'RECRUIT_INTERVIEW_SCHEDULED',
                        'RECRUIT_STAGE_CHANGED', 'RECRUIT_CANDIDATE_HIRED')
     AND module_code = 'RECRUIT' AND notification_type = 'Recruit'
     AND is_enabled = true AND is_system_event = false
     AND dedupe_strategy = 'DedupeKey' AND dedupe_window_seconds IS NULL;
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0561] verify: % / 4 event RECRUIT global dung thuoc tinh (enabled · DedupeKey · Recruit)', v_n;
  END IF;

  -- priority: 016/018/019 Normal · 017 High
  SELECT count(*) INTO v_n FROM notification_events
   WHERE company_id IS NULL AND deleted_at IS NULL
     AND ((event_code IN ('RECRUIT_JOB_ASSIGNED', 'RECRUIT_STAGE_CHANGED', 'RECRUIT_CANDIDATE_HIRED')
           AND default_priority = 'Normal')
       OR (event_code = 'RECRUIT_INTERVIEW_SCHEDULED' AND default_priority = 'High'));
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0561] verify: % / 4 event RECRUIT dung priority (ky vong Normal/High/Normal/Normal)', v_n;
  END IF;

  -- 4 template global IN_APP/vi-VN Active default, có target_url + variables_schema (pin s5-noti-fix1-deeplink:
  -- 0 template global được phép còn target_url_template NULL)
  SELECT count(*) INTO v_n
    FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
   WHERE t.company_id IS NULL AND t.deleted_at IS NULL
     AND e.company_id IS NULL AND e.event_code IN ('RECRUIT_JOB_ASSIGNED', 'RECRUIT_INTERVIEW_SCHEDULED',
                                                   'RECRUIT_STAGE_CHANGED', 'RECRUIT_CANDIDATE_HIRED')
     AND t.channel = 'IN_APP' AND t.locale = 'vi-VN' AND t.status = 'Active' AND t.is_default = true
     AND t.target_url_template IS NOT NULL AND t.variables_schema IS NOT NULL
     AND length(t.body_template) > 0;
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0561] verify: % / 4 template RECRUIT IN_APP/vi-VN du thuoc tinh', v_n;
  END IF;

  -- BẤT BIẾN #3: template RECRUIT KHÔNG được mang placeholder PII/lương (email/phone/salary/luong).
  SELECT count(*) INTO v_n
    FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
   WHERE t.company_id IS NULL AND e.company_id IS NULL AND e.module_code = 'RECRUIT'
     AND (t.title_template || ' ' || t.body_template || ' ' || COALESCE(t.short_body_template, '')
          || ' ' || COALESCE(t.variables_schema::text, '')) ~* '(email|phone|salary|luong|lương|sdt)';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0561] verify: % template RECRUIT co placeholder PII/luong — vi pham bat bien #3 / SPEC-12 §18', v_n;
  END IF;

  RAISE NOTICE '[0561] verify PASS: 4 CHECK NOTI += RECRUIT/Recruit · 4 event DedupeKey · 4 template (0 PII)';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM notification_templates WHERE company_id IS NULL AND template_code IN (
--   'RECRUIT_JOB_ASSIGNED__IN_APP__vi-VN','RECRUIT_INTERVIEW_SCHEDULED__IN_APP__vi-VN',
--   'RECRUIT_STAGE_CHANGED__IN_APP__vi-VN','RECRUIT_CANDIDATE_HIRED__IN_APP__vi-VN');
-- DELETE FROM notification_events WHERE company_id IS NULL AND event_code IN (
--   'RECRUIT_JOB_ASSIGNED','RECRUIT_INTERVIEW_SCHEDULED','RECRUIT_STAGE_CHANGED','RECRUIT_CANDIDATE_HIRED');
-- -- 4 CHECK NOTI: KHÔNG thu hẹp (hàng notifications module_code='RECRUIT' đã ghi sẽ vỡ) — superset giữ nguyên.
