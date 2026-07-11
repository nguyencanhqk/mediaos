-- Migration 0490: S4-NOTI-SEED-2 (🔴 RED, zone=red, crown) — VÁ catalog NOTI cho TASK BE-3.
--   THUẦN DATA — mirror 0481 (KHÔNG DDL, KHÔNG drizzle db:generate). Seed qua migrator owner-bypass.
--   Nguồn sự thật: registry apps/api/src/foundation/seed/notification-event-catalog.const.ts (đồng bộ 1-1)
--   + payload THẬT S4-TASK-BE-3 (apps/api/src/tasks/task-actions.service.ts commonPayload + từng use-case).
--   NỐI TIẾP head 0489 (idx 169, nhánh HR — reserve gap) → 0490 (idx 170). Hot-file APPEND, KHÔNG rewrite 0481.
--
-- VÌ SAO WO NÀY (lệch 0481 §9.5 vs registry §9.4 Producer BE-3):
--   • S4-TASK-BE-3 phát 5 mã canonical: TASK_ASSIGNED · TASK_STATUS_CHANGED (đã enabled 0481) +
--     TASK_ASSIGNEE_CHANGED · TASK_DUE_DATE_CHANGED · TASK_PRIORITY_CHANGED (0481 để disabled/thiếu) ⇒
--     3 mã sau bị engine skip 'event_disabled'/404 ⇒ notification câm. Vá = bật/thêm + template IN_APP/vi-VN.
--   • 0481 seed event_code 'TASK_DEADLINE_CHANGED' (SPEC-08 §15 tên cũ) NHƯNG BE-3 phát 'TASK_DUE_DATE_CHANGED'
--     (task-actions.service.ts:337/357 — action + eventType canonical). Đồng bộ tên = rename APPEND-SAFE.
--   • 0481 template TASK_ASSIGNED/TASK_STATUS_CHANGED dùng placeholder snake_case ({task_code}/{new_status})
--     KHÔNG khớp payload camelCase BE-3 ({taskCode}/{toStatus}) ⇒ render giữ nguyên {…} (biến câm). Vá render.
--
-- BỐI CẢNH (seed qua migrator owner, KHÔNG qua app role — mirror 0481:6-11):
--   notification_events / notification_templates (0479) company_id NULLABLE, RLS+FORCE bật, app role CHỈ
--   GRANT SELECT (write company-override → NOTI-BE-4). Row GLOBAL (company_id NULL) ghi được qua TABLE-OWNER:
--   migrator chạy DATABASE_DIRECT_URL = role owner mediaos (rolbypassrls) ⇒ INSERT/UPDATE company_id NULL
--   chạy TRỰC TIẾP, KHÔNG cần SET LOCAL/GUC. WITH CHECK(company_id=GUC) của 0479 chỉ chặn app role.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 RLS+FORCE + policy đã tạo Ở 0479 TRƯỚC seed — 0490 CHỈ INSERT/UPDATE DATA global, KHÔNG đụng cô lập
--      tenant, KHÔNG chạm permissions/role_permissions (WO không sửa grant). events/templates GLOBAL
--      (company_id NULL) = danh mục dùng-chung, ĐỌC-only qua app role; ghi = owner-bypass tại migrate-time.
--   #2 KHÔNG hard-delete: rename event_code IN-PLACE (giữ id ⇒ FK notifications.event_id nguyên vẹn) HOẶC
--      disable (is_enabled=false) khi đã có canonical/tham chiếu — TUYỆT ĐỐI KHÔNG DELETE. Append-safe.
--   #3 template body/nội dung KHÔNG chứa dữ liệu nhạy cảm — chỉ placeholder {taskCode}/{taskTitle}/… là các
--      biến non-sensitive của commonPayload BE-3 (masking ép ở tầng service, KHÔNG ở seed).
--   • Idempotent TOÀN migration: INSERT ON CONFLICT DO NOTHING · UPDATE theo khóa tự nhiên · DO-block rẽ
--      nhánh theo trạng thái thực ⇒ chạy lại KHÔNG nhân đôi, KHÔNG đổi count, KHÔNG ném exception.
--
-- BAND 0490 (lane notiSeed2Mig / S4-NOTI-SEED-2). Journal: idx 170, when 1717500845000 (> reserve idx 169 /
--   1717500840000 nhánh HR 0489). Nối tiếp ĐƠN ĐIỆU sau head.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (1) SEED event GLOBAL TASK_PRIORITY_CHANGED (mới — 0481 chưa có). ĐỦ MỌI CỘT NOT NULL mirror 0481 bước (1).
--     ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING (partial uq
--     uq_notification_events_global_code_active — 0479:84).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority, default_channels, is_enabled, is_system_event)
VALUES
  (NULL::uuid, 'TASK', 'TASK_PRIORITY_CHANGED', 'Đổi độ ưu tiên công việc', 'Task', 'Normal', '["IN_APP"]'::jsonb, true, false)
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) TASK_DEADLINE_CHANGED (0481, tên cũ) → TASK_DUE_DATE_CHANGED (canonical BE-3). APPEND-SAFE, KHÔNG DELETE.
--     Rẽ nhánh theo trạng thái THỰC (idempotent + an toàn khi có dữ liệu lịch sử):
--       (a) legacy tồn tại, canonical CHƯA có, KHÔNG notification tham chiếu event_id legacy → RENAME in-place
--           (UPDATE event_code + is_enabled=true; giữ id ⇒ FK nguyên vẹn). Nhánh fresh-migrate.
--       (b) else (canonical đã có HOẶC notifications tham chiếu legacy) → giữ canonical, ĐẢM BẢO canonical
--           enabled (INSERT ON CONFLICT DO NOTHING + UPDATE is_enabled=true), disable legacy nếu còn tồn tại.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_legacy_id   uuid;
  v_canon_id    uuid;
  v_legacy_refs bigint := 0;
BEGIN
  SELECT id INTO v_legacy_id FROM notification_events
   WHERE event_code = 'TASK_DEADLINE_CHANGED' AND company_id IS NULL AND deleted_at IS NULL;
  SELECT id INTO v_canon_id FROM notification_events
   WHERE event_code = 'TASK_DUE_DATE_CHANGED' AND company_id IS NULL AND deleted_at IS NULL;

  IF v_legacy_id IS NOT NULL THEN
    SELECT count(*) INTO v_legacy_refs FROM notifications WHERE event_id = v_legacy_id;
  END IF;

  IF v_legacy_id IS NOT NULL AND v_canon_id IS NULL AND v_legacy_refs = 0 THEN
    -- (a) RENAME in-place — append-safe (KHÔNG DELETE, id giữ nguyên).
    UPDATE notification_events
       SET event_code = 'TASK_DUE_DATE_CHANGED',
           event_name = 'Đổi hạn chót công việc',
           is_enabled = true,
           updated_at = now()
     WHERE id = v_legacy_id;
    RAISE NOTICE '[0490] (2a) TASK_DEADLINE_CHANGED renamed in-place -> TASK_DUE_DATE_CHANGED (enabled)';
  ELSE
    -- (b) canonical đã có HOẶC legacy có tham chiếu lịch sử → KHÔNG rename. Đảm bảo canonical enabled.
    INSERT INTO notification_events
      (company_id, module_code, event_code, event_name, notification_type, default_priority, default_channels, is_enabled, is_system_event)
    VALUES
      (NULL::uuid, 'TASK', 'TASK_DUE_DATE_CHANGED', 'Đổi hạn chót công việc', 'Task', 'Normal', '["IN_APP"]'::jsonb, true, false)
    ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;

    UPDATE notification_events
       SET is_enabled = true, updated_at = now()
     WHERE event_code = 'TASK_DUE_DATE_CHANGED' AND company_id IS NULL AND deleted_at IS NULL;

    IF v_legacy_id IS NOT NULL THEN
      UPDATE notification_events
         SET is_enabled = false, updated_at = now()
       WHERE id = v_legacy_id;
      RAISE NOTICE '[0490] (2b) canonical TASK_DUE_DATE_CHANGED giữ; legacy TASK_DEADLINE_CHANGED disabled (refs=%)', v_legacy_refs;
    ELSE
      RAISE NOTICE '[0490] (2b) canonical TASK_DUE_DATE_CHANGED đảm bảo enabled (không có legacy row)';
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (3) Bật TASK_ASSIGNEE_CHANGED (0481 seed disabled). Global-only, idempotent (UPDATE theo event_code).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE notification_events
   SET is_enabled = true, updated_at = now()
 WHERE company_id IS NULL AND deleted_at IS NULL AND event_code = 'TASK_ASSIGNEE_CHANGED';
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (4) SEED 3 template GLOBAL IN_APP/vi-VN cho 3 mã BE-3 mới-bật (PRIORITY/DUE_DATE/ASSIGNEE_CHANGED).
--     event_id resolve qua JOIN notification_events (event_code, company_id IS NULL, deleted_at IS NULL) —
--     canonical đã sẵn sau bước (1)+(2)+(3). variables_schema = ĐÚNG bộ key camelCase payload BE-3
--     (commonPayload + field từng use-case, task-actions.service.ts). Placeholder {key} trong body/short ⊆
--     variables_schema. status='Active', is_default=true, body_template NOT NULL. ON CONFLICT (template_code)
--     WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING (partial uq — 0479:143).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template, short_body_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('TASK_PRIORITY_CHANGED', 'TASK_PRIORITY_CHANGED__IN_APP__vi-VN',
     'Độ ưu tiên công việc đã thay đổi',
     'Độ ưu tiên công việc {taskCode} — {taskTitle} đã đổi từ {oldPriority} sang {newPriority}.',
     'Công việc {taskCode} đổi độ ưu tiên sang {newPriority}.',
     '{"taskId":"string","taskTitle":"string","taskCode":"string","projectId":"string","actorUserId":"string","actorEmployeeId":"string","oldPriority":"string","newPriority":"string","assigneeUserId":"string"}'),
  ('TASK_DUE_DATE_CHANGED', 'TASK_DUE_DATE_CHANGED__IN_APP__vi-VN',
     'Hạn chót công việc đã thay đổi',
     'Hạn chót công việc {taskCode} — {taskTitle} đã đổi thành {newDueAt}.',
     'Công việc {taskCode} đổi hạn chót thành {newDueAt}.',
     '{"taskId":"string","taskTitle":"string","taskCode":"string","projectId":"string","actorUserId":"string","actorEmployeeId":"string","oldDueAt":"string","newDueAt":"string","assigneeUserId":"string"}'),
  ('TASK_ASSIGNEE_CHANGED', 'TASK_ASSIGNEE_CHANGED__IN_APP__vi-VN',
     'Người phụ trách công việc đã thay đổi',
     'Công việc {taskCode} — {taskTitle} đã được chuyển sang người phụ trách mới.',
     'Công việc {taskCode} đổi người phụ trách.',
     '{"taskId":"string","taskTitle":"string","taskCode":"string","projectId":"string","actorUserId":"string","actorEmployeeId":"string","oldAssigneeEmployeeId":"string","assigneeEmployeeId":"string","assigneeUserId":"string"}')
) AS t(event_code, template_code, title_template, body_template, short_body_template, variables_schema)
JOIN notification_events e
  ON e.event_code = t.event_code
 AND e.company_id IS NULL
 AND e.deleted_at IS NULL
ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (5) VÁ RENDER 0481 (owner chốt IN-SCOPE): 2 template TASK_ASSIGNED + TASK_STATUS_CHANGED sang camelCase
--     khớp payload THẬT BE-3 (task-actions.service.ts:227-232 STATUS_CHANGED dùng toStatus KHÔNG newStatus;
--     149-157 ASSIGNED commonPayload taskCode/taskTitle). Idempotent (UPDATE theo template_code global).
--     variables_schema thu hẹp về đúng key body dùng (⊆ payload) — least-content, tránh biến câm.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE notification_templates
   SET body_template       = 'Bạn được giao task {taskCode}: {taskTitle}.',
       short_body_template = 'Bạn được giao task {taskCode}: {taskTitle}.',
       variables_schema    = '{"taskCode":"string","taskTitle":"string"}'::jsonb,
       updated_at          = now()
 WHERE company_id IS NULL AND deleted_at IS NULL
   AND template_code = 'TASK_ASSIGNED__IN_APP__vi-VN';
--> statement-breakpoint

UPDATE notification_templates
   SET body_template       = 'Trạng thái task {taskCode} đã đổi thành {toStatus}.',
       short_body_template = 'Task {taskCode} chuyển sang {toStatus}.',
       variables_schema    = '{"taskCode":"string","toStatus":"string"}'::jsonb,
       updated_at          = now()
 WHERE company_id IS NULL AND deleted_at IS NULL
   AND template_code = 'TASK_STATUS_CHANGED__IN_APP__vi-VN';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM notification_templates WHERE company_id IS NULL AND template_code IN
--   ('TASK_PRIORITY_CHANGED__IN_APP__vi-VN','TASK_DUE_DATE_CHANGED__IN_APP__vi-VN','TASK_ASSIGNEE_CHANGED__IN_APP__vi-VN');
-- UPDATE notification_events SET is_enabled=false WHERE company_id IS NULL AND event_code IN
--   ('TASK_PRIORITY_CHANGED','TASK_ASSIGNEE_CHANGED');  -- rename (2a) KHÔNG revert tự động (append-safe)
