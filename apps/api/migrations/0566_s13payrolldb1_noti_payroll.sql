-- Migration 0566: S13-PAYROLL-DB-1 (🔴 RED, zone=red) — SEED NOTI PAYROLL (DB-13 §10 bước C · SPEC-11 §17):
--   nới CHECK module_code += 'PAYROLL' và notification_type += 'Payroll' trên CẢ HAI bảng notification_events
--   VÀ notifications + 4 event PAYROLL_PERIOD_SUBMITTED / _APPROVED / _REJECTED / PAYSLIP_PUBLISHED
--   (NOTI-EVENT-020..023) + 4 template IN_APP/vi-VN. THUẦN DATA/DDL-CHECK VIẾT TAY — **KHÔNG `db:generate`**.
--   Mirror 0561 (bản đã vá lỗi 0507 quên vế `notifications` + baseline guard forward-compatible).
--
-- BƯỚC 0 — ĐO THẬT 2026-09-01: 4 CHECK NOTI dừng ở 'RECRUIT'/'Recruit' (14 module_code · 17 notification_type)
--   ⇒ khớp superset DB-13 §10.1. notification_events global = 71 hàng. Dải NOTI-EVENT dừng ở 019 ⇒ nhận 020–023.
--
-- QUYẾT ĐỊNH CHỐT (plan §4 · SPEC-11 §17):
--   • dedupe_strategy = 'DedupeKey', dedupe_window_seconds = NULL cho CẢ 4 (mặc định 'None' ⇒ computeKey trả
--     NULL ⇒ tầng dedupe BIẾN MẤT — bài học 0479/0507/0538). dedupeKey do BE-2 sinh:
--       020 PAYROLL_PERIOD_SUBMITTED:{periodId}:{auditLogId} — MỖI LẦN GỬI là một sự kiện (reject → sửa →
--           gửi lại phải báo lại; engine DedupeKey là once-ever, không có bucket thời gian);
--       021 PAYROLL_PERIOD_APPROVED:{periodId}:{auditLogId};
--       022 PAYROLL_PERIOD_REJECTED:{periodId}:{auditLogId};
--       023 PAYSLIP_PUBLISHED:{payslipId} (một phiếu báo đúng một lần).
--   • priority: 020 Normal · 021 Normal · 022 High · 023 High; is_system_event = FALSE cả 4
--     (PAYROLL v1 KHÔNG có system job — mọi event event-driven, trừ actor).
--   • Người nhận (BE-2, mode UserIds): 020 = **người duyệt hợp lệ theo `PayrollApproverReader`** — CÙNG bộ giải
--     với PAYROLL-ERR-017 (SPEC-11 §13.1), KHÔNG tự tra role company-admin riêng (hai bộ giải lệch nhau đẻ
--     đúng thất bại mà 017 sinh ra để chặn); 021/022 = submitted_by; 023 = từng nhân sự có phiếu trong kỳ.
--   • ⚠️ Payload/template **TUYỆT ĐỐI KHÔNG chứa số tiền** — chỉ periodMonth · tên kỳ · lý do từ chối (022) ·
--     deep-link. Ràng buộc mạnh hơn module khác: NOTI đi qua nhiều kênh và KHÔNG có tầng masking riêng
--     (SPEC-11 §17, §18).
--   • ON CONFLICT nhắm PARTIAL unique (event_code / template_code WHERE company_id IS NULL AND deleted_at IS
--     NULL) — bare ⇒ 42P10.
--   • CHECK NOTI dạng IN (…): guard LIKE + re-stamp superset TƯỜNG MINH (khuôn 0538/0551/0555/0561)
--     — KHÔNG parser.
--
-- BẤT BIẾN #1: 2 CHECK trên `notifications` GIỮ nhánh `IS NULL OR` (hàng legacy để NULL — 0479:249).
-- PHẢI xong TRƯỚC khi S13-PAYROLL-BE-2 đăng ký registrar outbox (registerSource() fail-loud lúc boot nếu
--   eventCode chưa có trong catalog isEnabled=true).
--
-- BAND 0566 (lane S13-PAYROLL-DB-1). Journal: idx 233, when 1717587355000 (> 0565 idx 232 / 1717587354000).
--   Cùng commit: notification-event-catalog.const.ts (NotiModuleCode += PAYROLL · NotiType += Payroll · 4 entry
--   · pin đếm) · packages/contracts notification.ts notificationTypeEnumSchema += 'Payroll' (+ spec pin) ·
--   schema/noti.ts CHECK parity. Số pin là số ĐO TAY — sau mig chạy full lane suite, sửa MỌI pin đỏ.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── (A) BASELINE GUARD: 4 CHECK phải là bản SAU 0561 (có RECRUIT/Recruit), không chứa giá trị lạ ───────────
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
        THEN ARRAY['AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM','RECRUIT','PAYROLL']
      ELSE ARRAY['System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder',
                 'Warning','Error','Goal','Training','Chat','Asset','Room','Recruit','Payroll']
    END;

    SELECT array_agg(m[1]) INTO v_extra
      FROM regexp_matches(r.def, '''([^'']+)''', 'g') AS m
     WHERE m[1] <> ALL (v_super);

    -- Chỉ ĐỎ khi re-stamp (B)/(C) THẬT SỰ sắp chạy (CHECK chưa có PAYROLL/Payroll). Đã có ⇒ các khối dưới
    -- idempotent-skip, giá trị của module SAU không bị đe doạ và file replay được trên DB đã tiến xa hơn.
    -- (noti-check-baseline-guard-must-be-forward-compatible — KHÔNG quay lại kiểu RAISE vô điều kiện.)
    -- needle tính TRƯỚC IF: PL/pgSQL cắt điều kiện IF ở chữ THEN đầu tiên (plpgsql-if-condition-cut-at-first-then).
    v_needle := CASE WHEN r.conname LIKE '%module_code%' THEN '%''PAYROLL''%' ELSE '%''Payroll''%' END;
    IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 AND r.def NOT LIKE v_needle THEN
      RAISE EXCEPTION '[0566] % (%) chua gia tri NGOAI superset cua 0566: % — superset viet tay se XOA chung. '
                      'Cap nhat danh sach trong 0566 roi chay lai.', r.conname, r.tbl, v_extra;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('chk_notification_events_module_code', 'chk_notification_events_type',
                         'chk_notifications_module_code', 'chk_notifications_notification_type')) <> 4 THEN
    RAISE EXCEPTION '[0566] baseline lech: khong du 4 CHECK NOTI (events x2 + notifications x2)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
       AND pg_get_constraintdef(oid) NOT LIKE '%''RECRUIT''%'
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
       AND pg_get_constraintdef(oid) NOT LIKE '%''Recruit''%'
  ) THEN
    RAISE EXCEPTION '[0566] baseline lech: thieu RECRUIT/Recruit — chuoi migration khong phai ban sau 0561';
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
       AND pg_get_constraintdef(oid) LIKE '%''PAYROLL''%'
  ) THEN
    RAISE NOTICE '[0566] PAYROLL da co trong chk_notification_events_module_code — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_module_code;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_module_code
      CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT',
                             'ASSET','ROOM','RECRUIT','PAYROLL'));
    RAISE NOTICE '[0566] da them PAYROLL vao chk_notification_events_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname  = 'chk_notification_events_type'
       AND pg_get_constraintdef(oid) LIKE '%''Payroll''%'
  ) THEN
    RAISE NOTICE '[0566] Payroll da co trong chk_notification_events_type — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_type;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_type
      CHECK (notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project',
                                   'Approval','Reminder','Warning','Error','Goal','Training','Chat',
                                   'Asset','Room','Recruit','Payroll'));
    RAISE NOTICE '[0566] da them Payroll vao chk_notification_events_type';
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
       AND pg_get_constraintdef(oid) LIKE '%''PAYROLL''%'
  ) THEN
    RAISE NOTICE '[0566] PAYROLL da co trong chk_notifications_module_code — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_module_code;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_module_code
      CHECK (module_code IS NULL OR module_code IN
             ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM',
              'RECRUIT','PAYROLL'));
    RAISE NOTICE '[0566] da them PAYROLL vao chk_notifications_module_code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass
       AND conname  = 'chk_notifications_notification_type'
       AND pg_get_constraintdef(oid) LIKE '%''Payroll''%'
  ) THEN
    RAISE NOTICE '[0566] Payroll da co trong chk_notifications_notification_type — idempotent skip';
  ELSE
    ALTER TABLE notifications DROP CONSTRAINT chk_notifications_notification_type;
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_notification_type
      CHECK (notification_type IS NULL OR notification_type IN
             ('System','Account','HR','Attendance','Leave','Task','Project',
              'Approval','Reminder','Warning','Error','Goal','Training','Chat','Asset','Room','Recruit','Payroll'));
    RAISE NOTICE '[0566] da them Payroll vao chk_notifications_notification_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────── (D) Catalog 4 event PAYROLL (GLOBAL, company_id NULL) — SPEC-11 §17 · NOTI-EVENT-020..023 ───────────
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority,
   default_channels, is_enabled, is_system_event, dedupe_strategy, dedupe_window_seconds)
VALUES
  (NULL::uuid, 'PAYROLL', 'PAYROLL_PERIOD_SUBMITTED', 'Bảng lương gửi duyệt',              'Payroll', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'PAYROLL', 'PAYROLL_PERIOD_APPROVED',  'Bảng lương được duyệt',             'Payroll', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'PAYROLL', 'PAYROLL_PERIOD_REJECTED',  'Bảng lương bị từ chối',             'Payroll', 'High',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'PAYROLL', 'PAYSLIP_PUBLISHED',        'Phiếu lương đã phát hành',          'Payroll', 'High',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL)
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (E) Template IN_APP vi-VN — ⚠️ KHÔNG BIẾN NÀO LÀ SỐ TIỀN (SPEC-11 §17/§18) ───────────────
-- NOTI đi qua nhiều kênh và KHÔNG có tầng masking riêng ⇒ ràng buộc mạnh hơn mọi module khác.
-- variables_schema là danh sách ĐÓNG: chỉ periodMonth · tên người thao tác · lý do từ chối · id để deep-link.
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template,
   short_body_template, target_url_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.target_url_template,
  t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('PAYROLL_PERIOD_SUBMITTED', 'PAYROLL_PERIOD_SUBMITTED__IN_APP__vi-VN',
     'Bảng lương {period_month} chờ duyệt',
     '{actor_name} đã gửi duyệt bảng lương kỳ {period_month}. Mở để xem và duyệt.',
     'Bảng lương {period_month} chờ duyệt',
     '/payroll/periods/{payroll_period_id}',
     '{"actor_name":"string","period_month":"string","payroll_period_id":"uuid"}'),
  ('PAYROLL_PERIOD_APPROVED', 'PAYROLL_PERIOD_APPROVED__IN_APP__vi-VN',
     'Bảng lương {period_month} đã được duyệt',
     '{actor_name} đã duyệt bảng lương kỳ {period_month}.',
     'Bảng lương {period_month} đã duyệt',
     '/payroll/periods/{payroll_period_id}',
     '{"actor_name":"string","period_month":"string","payroll_period_id":"uuid"}'),
  ('PAYROLL_PERIOD_REJECTED', 'PAYROLL_PERIOD_REJECTED__IN_APP__vi-VN',
     'Bảng lương {period_month} bị từ chối',
     '{actor_name} đã từ chối bảng lương kỳ {period_month}. Lý do: {reason}',
     'Bảng lương {period_month} bị từ chối',
     '/payroll/periods/{payroll_period_id}',
     '{"actor_name":"string","period_month":"string","reason":"string","payroll_period_id":"uuid"}'),
  ('PAYSLIP_PUBLISHED', 'PAYSLIP_PUBLISHED__IN_APP__vi-VN',
     'Phiếu lương kỳ {period_month} đã có',
     'Phiếu lương kỳ {period_month} của bạn đã được phát hành. Mở để xem và xác nhận.',
     'Phiếu lương {period_month} đã có',
     '/me/payslips',
     '{"period_month":"string"}')
) AS t(event_code, template_code, title_template, body_template, short_body_template,
       target_url_template, variables_schema)
JOIN notification_events e
  ON e.event_code = t.event_code AND e.company_id IS NULL AND e.deleted_at IS NULL
ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (F) VERIFY FAIL-LOUD ───────────────
DO $$
DECLARE
  v_n int;
  v_bad text;
BEGIN
  -- 4 CHECK đã có PAYROLL/Payroll (cả hai bảng — vế `notifications` là chỗ 0507 từng bỏ sót)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
       AND pg_get_constraintdef(oid) NOT LIKE '%''PAYROLL''%'
  ) THEN
    RAISE EXCEPTION '[0566] verify: con CHECK module_code THIEU PAYROLL — notification PAYROLL se vo khi INSERT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
       AND pg_get_constraintdef(oid) NOT LIKE '%''Payroll''%'
  ) THEN
    RAISE EXCEPTION '[0566] verify: con CHECK notification_type THIEU Payroll';
  END IF;

  -- `notifications` GIỮ nhánh IS NULL OR (hàng legacy để NULL — 0479:249)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('chk_notifications_module_code', 'chk_notifications_notification_type')
       AND pg_get_constraintdef(oid) NOT LIKE '%IS NULL%'
  ) THEN
    RAISE EXCEPTION '[0566] verify: CHECK tren notifications MAT nhanh `IS NULL OR` — hang legacy se vo';
  END IF;

  -- 4 event tồn tại, đúng cấu hình dedupe (mặc định 'None' biến dedupeKey thành chuỗi trang trí)
  SELECT count(*) INTO v_n FROM notification_events
   WHERE company_id IS NULL AND deleted_at IS NULL AND module_code = 'PAYROLL';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0566] verify: co % event PAYROLL global, ky vong dung 4 (NOTI-EVENT-020..023)', v_n;
  END IF;

  SELECT string_agg(event_code || '=' || COALESCE(dedupe_strategy, 'NULL'), ', ') INTO v_bad
    FROM notification_events
   WHERE company_id IS NULL AND deleted_at IS NULL AND module_code = 'PAYROLL'
     AND (dedupe_strategy IS DISTINCT FROM 'DedupeKey' OR dedupe_window_seconds IS NOT NULL);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0566] verify: event PAYROLL sai dedupe (phai DedupeKey + window NULL): %', v_bad;
  END IF;

  SELECT count(*) INTO v_n FROM notification_events
   WHERE company_id IS NULL AND deleted_at IS NULL AND module_code = 'PAYROLL'
     AND (NOT is_enabled OR is_system_event OR notification_type <> 'Payroll');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0566] verify: % event PAYROLL sai is_enabled/is_system_event/notification_type', v_n;
  END IF;

  -- 4 template khớp 4 event
  SELECT count(*) INTO v_n FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
   WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.module_code = 'PAYROLL';
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0566] verify: co % template PAYROLL, ky vong dung 4', v_n;
  END IF;

  RAISE NOTICE '[0566] verify OK: 4 CHECK noi rong ca hai bang, 4 event DedupeKey, 4 template IN_APP/vi-VN';
END;
$$;
