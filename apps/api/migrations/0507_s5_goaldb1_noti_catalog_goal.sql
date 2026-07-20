-- Migration 0507: S5-GOAL-DB-1 (🔴 RED, zone=red, crown) — SEED NOTI catalog GOAL (2 event + template).
--   THUẦN DATA/DDL-CHECK — mirror 0481/0490. Seed qua migrator owner-bypass. NỐI TIẾP head 0506.
--   Nguồn: registry apps/api/src/foundation/seed/notification-event-catalog.const.ts (đồng bộ 1-1) + SPEC-10
--   §18 (payload chỉ goal name/mã + link, KHÔNG số liệu nhạy cảm). Bridge NOTI-BE-2 registerSource() fail-loud
--   NGAY LÚC BOOT nếu eventCode chưa có trong catalog ⇒ 0507 PHẢI xong TRƯỚC registrar.
--
-- BỐI CẢNH (seed global qua migrator owner — mirror 0481:6-11 / 0490:16-20):
--   notification_events/notification_templates (0479) company_id NULLABLE, RLS+FORCE bật, app role CHỈ GRANT
--   SELECT. Row GLOBAL (company_id NULL) ghi qua TABLE-OWNER (rolbypassrls). WITH CHECK(company_id=GUC) của
--   0479 chỉ chặn app role.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 RLS+FORCE + policy đã tạo Ở 0479 TRƯỚC seed — 0507 CHỈ INSERT DATA global + mở rộng CHECK, KHÔNG đụng
--      cô lập tenant. events/templates GLOBAL = danh mục dùng-chung, ĐỌC-only qua app role.
--   #2 CHECK module_code/type: UNION ADD-only 'GOAL'/'Goal' (idempotent, append-only nguyên vẹn — KHÔNG drop
--      giá trị cũ). ⚠️ KHÔNG dùng parser DO-block mẫu 0474 ở đây: 0474 giả định ANY-form dạng '{...}' (array
--      literal curly) — chỉ đúng cho audit_logs (đã re-stamp bởi 0474-clone). chk_notification_events_* là
--      dạng `= ANY(ARRAY['AUTH'::varchar,...]::text[])` (0479, IN gốc → normalize), substring '\{[^}]*\}' của
--      0474 trả NULL ⇒ 'GOAL' KHÔNG được thêm (silent skip). Ở đây guard `LIKE '%GOAL%'` + re-stamp SUPERSET
--      = tập 0479 + mới (đã verify: CHỈ 0479 định nghĩa 2 CHECK này, KHÔNG migration nào sau đó sửa) — append-only,
--      idempotent, KHÔNG mất giá trị.
--   #3 template body/nội dung KHÔNG chứa dữ liệu nhạy cảm (SPEC-10 §18) — chỉ placeholder {goal_code}/{goal_name}/
--      {assigner_name}/{period_label}/{final_progress}. target_url dùng {goalId} UUID (KHÔNG nhét mã hiển thị vào
--      route — bài học 0497).
--   • Catalog: INSERT ON CONFLICT (event_code / template_code) WHERE company_id IS NULL AND deleted_at IS NULL
--     DO NOTHING (partial-unique uq_notification_events_global_code_active 0479:84 / uq_notification_templates_
--     global_code_active 0479:143 — bare ON CONFLICT(event_code) nổ 42P10). NotiModuleCode/NotiType const +2
--     entry catalog CÙNG commit.
--
-- BAND 0507 (lane S5-GOAL-DB-1). Journal: idx 187, when 1717587309000 (> 0506 idx 186 / 1717587308000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) CHECK chk_notification_events_module_code += 'GOAL' (UNION ADD-only, guard+restamp) ──────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname = 'chk_notification_events_module_code'
       AND pg_get_constraintdef(oid) LIKE '%''GOAL''%'
  ) THEN
    RAISE NOTICE '[0507] GOAL da co trong chk_notification_events_module_code — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_module_code;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_module_code
      CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL'));
    RAISE NOTICE '[0507] da them GOAL vao chk_notification_events_module_code';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────────── (2) CHECK chk_notification_events_type += 'Goal' (UNION ADD-only, guard+restamp) ────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname = 'chk_notification_events_type'
       AND pg_get_constraintdef(oid) LIKE '%''Goal''%'
  ) THEN
    RAISE NOTICE '[0507] Goal da co trong chk_notification_events_type — idempotent skip';
  ELSE
    ALTER TABLE notification_events DROP CONSTRAINT chk_notification_events_type;
    ALTER TABLE notification_events ADD CONSTRAINT chk_notification_events_type
      CHECK (notification_type IN
        ('System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder','Warning','Error','Goal'));
    RAISE NOTICE '[0507] da them Goal vao chk_notification_events_type';
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────────── (3) SEED 2 event GOAL GLOBAL (company_id NULL, enabled). ON CONFLICT partial (0481/0490). ────
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority, default_channels, is_enabled, is_system_event)
VALUES
  (NULL::uuid, 'GOAL', 'GOAL_ASSIGNED',  'Được giao mục tiêu mới', 'Goal', 'Normal', '["IN_APP"]'::jsonb, true, false),
  (NULL::uuid, 'GOAL', 'GOAL_FINALIZED', 'Mục tiêu được chốt kỳ',  'Goal', 'Normal', '["IN_APP"]'::jsonb, true, false)
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────── (4) SEED 2 template GLOBAL IN_APP/vi-VN (mirror 0481:115 shape). ON CONFLICT partial. ────────
--     target_url dùng {goalId} UUID (KHÔNG nhét mã hiển thị — bài học 0497). variables_schema ⊇ placeholder body.
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template, short_body_template,
   target_url_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.target_url_template, t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('GOAL_ASSIGNED', 'GOAL_ASSIGNED__IN_APP__vi-VN',
     'Bạn được giao mục tiêu mới',
     'Bạn được giao mục tiêu {goal_code} — {goal_name} cho kỳ {period_label}. Người giao: {assigner_name}.',
     'Bạn được giao mục tiêu {goal_code}: {goal_name}.',
     '/goals/{goalId}',
     '{"goalId":"string","goal_code":"string","goal_name":"string","assigner_name":"string","period_label":"string"}'),
  ('GOAL_FINALIZED', 'GOAL_FINALIZED__IN_APP__vi-VN',
     'Mục tiêu đã được chốt kỳ',
     'Mục tiêu {goal_code} — {goal_name} đã được chốt kỳ với tiến độ {final_progress}.',
     'Mục tiêu {goal_code} đã được chốt kỳ.',
     '/goals/{goalId}',
     '{"goalId":"string","goal_code":"string","goal_name":"string","final_progress":"string"}')
) AS t(event_code, template_code, title_template, body_template, short_body_template, target_url_template, variables_schema)
JOIN notification_events e
  ON e.event_code = t.event_code
 AND e.company_id IS NULL
 AND e.deleted_at IS NULL
ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (5) VERIFY fail-LOUD: 2 event GOAL tồn tại + enabled + mỗi event có ≥1 template Active default vi-VN +
--     CHECK module_code ⊇ 'GOAL' + CHECK type ⊇ 'Goal'. Idempotent: chạy lại vẫn PASS.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  ev   text;
  v_n  int;
BEGIN
  FOREACH ev IN ARRAY ARRAY['GOAL_ASSIGNED', 'GOAL_FINALIZED'] LOOP
    SELECT COUNT(*) INTO v_n
      FROM notification_events
     WHERE event_code = ev AND company_id IS NULL AND deleted_at IS NULL
       AND is_enabled = true AND module_code = 'GOAL' AND notification_type = 'Goal';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0507] verify: event % (GOAL/Goal/enabled) không đúng 1 hàng (có %)', ev, v_n;
    END IF;

    SELECT COUNT(*) INTO v_n
      FROM notification_templates t
      JOIN notification_events e ON e.id = t.event_id
     WHERE e.event_code = ev AND e.company_id IS NULL
       AND t.company_id IS NULL AND t.deleted_at IS NULL
       AND t.channel = 'IN_APP' AND t.locale = 'vi-VN' AND t.status = 'Active' AND t.is_default = true;
    IF v_n < 1 THEN
      RAISE EXCEPTION '[0507] verify: event % thiếu template Active default IN_APP/vi-VN', ev;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname = 'chk_notification_events_module_code'
       AND pg_get_constraintdef(oid) LIKE '%''GOAL''%'
  ) THEN
    RAISE EXCEPTION '[0507] verify: CHECK module_code CHƯA chứa ''GOAL'' — bước (1) trượt';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'notification_events'::regclass
       AND conname = 'chk_notification_events_type'
       AND pg_get_constraintdef(oid) LIKE '%''Goal''%'
  ) THEN
    RAISE EXCEPTION '[0507] verify: CHECK type CHƯA chứa ''Goal'' — bước (2) trượt';
  END IF;

  RAISE NOTICE '[0507] verify PASS: 2 event GOAL enabled + template default vi-VN + CHECK module/type mở rộng';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM notification_templates WHERE company_id IS NULL AND template_code IN
--   ('GOAL_ASSIGNED__IN_APP__vi-VN','GOAL_FINALIZED__IN_APP__vi-VN');
-- DELETE FROM notification_events WHERE company_id IS NULL AND event_code IN ('GOAL_ASSIGNED','GOAL_FINALIZED');
-- -- CHECK module_code/type union KHÔNG thu hẹp (append-only #2 — ADD-only vô hại).
