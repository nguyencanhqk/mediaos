-- Migration 0573: S15-PAYROLL-DB-2 (🔴 RED) — SEED NOTI PAYROLL v2 track C (DB-13 §15.3 bước D · SPEC-11 §17.1):
--   4 event PAYROLL_ADVANCE_SUBMITTED / _APPROVED / _REJECTED / PAYROLL_PAYMENT_BATCH_COMPLETED
--   (NOTI-EVENT-024..027) + 4 template IN_APP/vi-VN. Khuôn 0566 — BỎ khối nới CHECK (xem (A)).
--   THUẦN DATA VIẾT TAY — KHÔNG `db:generate`.
--
-- BƯỚC 0 — ĐO 14/09/2026: dải NOTI-EVENT 024–027 đã ghi cho PAYROLL ở SPEC-01 §20.2 + SPEC-08 §15.0, không
--   module nào khác chiếm. 4 CHECK NOTI (notification_events × 2 + notifications × 2) đã có 'PAYROLL'/'Payroll'
--   từ 0566 ⇒ (A) ĐO rồi NO-OP có chủ đích, KHÔNG viết ALTER rỗng.
--
-- QUYẾT ĐỊNH (SPEC-11 §17.1 · plan §5):
--   • dedupe_strategy='DedupeKey', dedupe_window_seconds=NULL cả 4. Khoá do PRODUCER (BE-4) sinh:
--       024 '{advanceId}:{createdAtIso}' · 025/026 '{advanceId}:{decidedAtIso}' ·
--       027 '{periodId}' — MỘT KỲ báo đúng một lần (dùng batchId thì kỳ nhiều đợt đẻ nhiều «đã chi trả»).
--   • 027 CHỈ phát ở lượt hoàn tất làm kỳ CHUYỂN sang Paid (luật PHỦ SPEC-11 §13.1).
--   • priority: 024 Normal · 025/026 High (tiền của một cá nhân) · 027 Normal. is_system_event=false cả 4.
--   • ⚠️ Template TUYỆT ĐỐI KHÔNG biến số tiền — kể cả số tạm ứng, kể cả khi gửi cho chính người thụ hưởng
--     (NOTI đi nhiều kênh, không có tầng masking riêng). Nhân viên bấm vào xem số ở /me/payroll-advances.
--   • target_url: 024 TĨNH /payroll/advances (PAY-SCREEN-012 không có route chi tiết) · 025/026
--     /me/payroll-advances · 027 /payroll/periods/{payroll_period_id} (dedupe theo kỳ).
--   • is_enabled=true trước khi có nguồn phát (registrar ở BE-4) — không đỏ: boot-guard một chiều
--     (`registerSource()` chỉ đòi mã PHẢI có trong catalog).
--
-- BAND 0573 (lane S15-PAYROLL-DB-2). Journal: idx 240 (> 0572 idx 239).
--   Cùng commit: notification-event-catalog.const.ts (+4, đếm 79/65) · pin noti-seed-catalog-permissions ·
--   s5-noti-fix1-deeplink (65 template) · s13-payroll-db1-invariants E1 lọc 020..023.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── (A) ĐO rồi NO-OP: 4 CHECK NOTI đã có PAYROLL/Payroll từ 0566 ───────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE (conname IN ('chk_notification_events_module_code', 'chk_notifications_module_code')
          AND pg_get_constraintdef(oid) LIKE '%''PAYROLL''%')
      OR (conname IN ('chk_notification_events_type', 'chk_notifications_notification_type')
          AND pg_get_constraintdef(oid) LIKE '%''Payroll''%');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0573] DUNG: chi % / 4 CHECK NOTI co PAYROLL/Payroll — 0566 chua chay?', v_n;
  END IF;
  RAISE NOTICE '[0573] 4 CHECK NOTI da co PAYROLL/Payroll tu 0566 — NO-OP co chu dich, khong ALTER';
END;
$$;
--> statement-breakpoint

-- ─────────── (B) Catalog 4 event PAYROLL v2 (GLOBAL, company_id NULL) — NOTI-EVENT-024..027 ───────────
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority,
   default_channels, is_enabled, is_system_event, dedupe_strategy, dedupe_window_seconds)
VALUES
  (NULL::uuid, 'PAYROLL', 'PAYROLL_ADVANCE_SUBMITTED',       'Đề nghị tạm ứng chờ duyệt',     'Payroll', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'PAYROLL', 'PAYROLL_ADVANCE_APPROVED',        'Tạm ứng được duyệt',            'Payroll', 'High',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'PAYROLL', 'PAYROLL_ADVANCE_REJECTED',        'Tạm ứng bị từ chối',            'Payroll', 'High',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL),
  (NULL::uuid, 'PAYROLL', 'PAYROLL_PAYMENT_BATCH_COMPLETED', 'Kỳ lương đã chi trả xong',      'Payroll', 'Normal',
   '["IN_APP"]'::jsonb, true, false, 'DedupeKey', NULL)
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────── (C) Template IN_APP vi-VN — ⚠️ KHÔNG BIẾN NÀO LÀ SỐ TIỀN ───────────
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template,
   short_body_template, target_url_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.target_url_template,
  t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('PAYROLL_ADVANCE_SUBMITTED', 'PAYROLL_ADVANCE_SUBMITTED__IN_APP__vi-VN',
     'Đề nghị tạm ứng chờ duyệt',
     '{actor_name} đã tạo đề nghị tạm ứng khấu trừ vào kỳ {deduct_period_month}. Mở để xem và duyệt.',
     'Tạm ứng chờ duyệt',
     '/payroll/advances',
     '{"actor_name":"string","deduct_period_month":"string","payroll_advance_id":"uuid"}'),
  ('PAYROLL_ADVANCE_APPROVED', 'PAYROLL_ADVANCE_APPROVED__IN_APP__vi-VN',
     'Tạm ứng kỳ {deduct_period_month} đã được duyệt',
     '{actor_name} đã duyệt đề nghị tạm ứng khấu trừ vào kỳ {deduct_period_month}.',
     'Tạm ứng đã được duyệt',
     '/me/payroll-advances',
     '{"actor_name":"string","deduct_period_month":"string","payroll_advance_id":"uuid"}'),
  ('PAYROLL_ADVANCE_REJECTED', 'PAYROLL_ADVANCE_REJECTED__IN_APP__vi-VN',
     'Tạm ứng kỳ {deduct_period_month} bị từ chối',
     '{actor_name} đã từ chối đề nghị tạm ứng khấu trừ vào kỳ {deduct_period_month}. Lý do: {reason}',
     'Tạm ứng bị từ chối',
     '/me/payroll-advances',
     '{"actor_name":"string","deduct_period_month":"string","reason":"string","payroll_advance_id":"uuid"}'),
  ('PAYROLL_PAYMENT_BATCH_COMPLETED', 'PAYROLL_PAYMENT_BATCH_COMPLETED__IN_APP__vi-VN',
     'Kỳ lương {period_month} đã chi trả xong',
     'Mọi phiếu lương kỳ {period_month} đã được chi trả. Kỳ chuyển sang «Đã chi trả».',
     'Kỳ lương {period_month} đã chi trả',
     '/payroll/periods/{payroll_period_id}',
     '{"period_month":"string","payroll_period_id":"uuid"}')
) AS t(event_code, template_code, title_template, body_template, short_body_template,
       target_url_template, variables_schema)
JOIN notification_events e
  ON e.event_code = t.event_code AND e.company_id IS NULL AND e.deleted_at IS NULL
ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (D) VERIFY FAIL-LOUD ───────────────
DO $$
DECLARE
  v_n   int;
  v_bad text;
BEGIN
  -- 8 event PAYROLL global = SET-EQUALITY theo MÃ (v1 020..023 + v2 024..027).
  SELECT string_agg(x.d, '; ') INTO v_bad FROM (
    SELECT 'THIEU ' || c AS d
      FROM unnest(ARRAY['PAYROLL_PERIOD_SUBMITTED', 'PAYROLL_PERIOD_APPROVED', 'PAYROLL_PERIOD_REJECTED',
                        'PAYSLIP_PUBLISHED', 'PAYROLL_ADVANCE_SUBMITTED', 'PAYROLL_ADVANCE_APPROVED',
                        'PAYROLL_ADVANCE_REJECTED', 'PAYROLL_PAYMENT_BATCH_COMPLETED']) AS c
     WHERE NOT EXISTS (SELECT 1 FROM notification_events e
                        WHERE e.event_code = c AND e.company_id IS NULL AND e.deleted_at IS NULL
                          AND e.module_code = 'PAYROLL')
    UNION ALL
    SELECT 'THUA ' || e.event_code
      FROM notification_events e
     WHERE e.company_id IS NULL AND e.deleted_at IS NULL AND e.module_code = 'PAYROLL'
       AND e.event_code NOT IN ('PAYROLL_PERIOD_SUBMITTED', 'PAYROLL_PERIOD_APPROVED', 'PAYROLL_PERIOD_REJECTED',
                                'PAYSLIP_PUBLISHED', 'PAYROLL_ADVANCE_SUBMITTED', 'PAYROLL_ADVANCE_APPROVED',
                                'PAYROLL_ADVANCE_REJECTED', 'PAYROLL_PAYMENT_BATCH_COMPLETED')) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0573] verify: tap event PAYROLL global lech: %', v_bad;
  END IF;

  -- 4 event mới: dedupe + enabled + system + type + priority đúng từng mã.
  SELECT string_agg(e.event_code, ', ') INTO v_bad
    FROM notification_events e
    JOIN (VALUES ('PAYROLL_ADVANCE_SUBMITTED', 'Normal'), ('PAYROLL_ADVANCE_APPROVED', 'High'),
                 ('PAYROLL_ADVANCE_REJECTED', 'High'), ('PAYROLL_PAYMENT_BATCH_COMPLETED', 'Normal')) AS x(code, prio)
      ON x.code = e.event_code
   WHERE e.company_id IS NULL AND e.deleted_at IS NULL
     AND (e.dedupe_strategy IS DISTINCT FROM 'DedupeKey' OR e.dedupe_window_seconds IS NOT NULL
          OR NOT e.is_enabled OR e.is_system_event OR e.notification_type <> 'Payroll'
          OR e.default_priority IS DISTINCT FROM x.prio);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0573] verify: event sai dedupe/enabled/system/type/priority: %', v_bad;
  END IF;

  -- 8 template PAYROLL global.
  SELECT count(*) INTO v_n FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
   WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.module_code = 'PAYROLL';
  IF v_n <> 8 THEN
    RAISE EXCEPTION '[0573] verify: co % template PAYROLL, ky vong dung 8', v_n;
  END IF;

  -- 0 biến tiền trong variables_schema của 4 template mới.
  SELECT string_agg(t.template_code || '.' || k, ', ') INTO v_bad
    FROM notification_templates t
    JOIN notification_events e ON e.id = t.event_id
    CROSS JOIN LATERAL jsonb_object_keys(t.variables_schema) AS k
   WHERE t.company_id IS NULL AND t.deleted_at IS NULL
     AND e.event_code IN ('PAYROLL_ADVANCE_SUBMITTED', 'PAYROLL_ADVANCE_APPROVED',
                          'PAYROLL_ADVANCE_REJECTED', 'PAYROLL_PAYMENT_BATCH_COMPLETED')
     AND k ~* '(amount|salary|gross|net|total|tien)';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0573] verify: template mang BIEN SO TIEN: %', v_bad;
  END IF;

  -- `notifications` GIỮ nhánh IS NULL OR (hàng legacy để NULL — 0479:249).
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname IN ('chk_notifications_module_code', 'chk_notifications_notification_type')
                AND pg_get_constraintdef(oid) NOT LIKE '%IS NULL%') THEN
    RAISE EXCEPTION '[0573] verify: CHECK tren notifications MAT nhanh `IS NULL OR`';
  END IF;

  RAISE NOTICE '[0573] verify OK: 8 event PAYROLL (4 moi DedupeKey), 8 template, 0 bien tien';
END;
$$;
