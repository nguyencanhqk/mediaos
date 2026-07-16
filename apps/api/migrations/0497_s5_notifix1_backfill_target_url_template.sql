-- Migration 0497: S5-NOTI-FIX-1 (🔴 RED, zone=red, crown) — BACKFILL target_url_template cho 39 template
--   notification GLOBAL (company_id IS NULL). QA2-CRIT-001 (docs/plans/S4-QA-2.md): 0481 seed 36 + 0490 seed 3
--   template global NHƯNG KHÔNG đưa cột target_url_template vào INSERT ⇒ 0/39 có deep-link ⇒ engine render
--   notifications.target_url = NULL toàn hệ thống (SPEC-08 §15/§18 mẫu target_url:"/tasks/task-id" chết).
--   THUẦN DATA — mirror 0490/0481 (KHÔNG DDL, KHÔNG drizzle db:generate). Seed qua migrator owner-bypass.
--   NỐI TIẾP head 0496 (idx 176) → 0497 (idx 177). Hot-file APPEND, KHÔNG rewrite 0481/0490.
--
-- BỐI CẢNH (seed qua migrator owner, KHÔNG qua app role — mirror 0490:16-20):
--   notification_templates (0479) company_id NULLABLE, RLS+FORCE bật, app role CHỈ GRANT SELECT (write
--   company-override → NOTI-BE-4). Row GLOBAL (company_id NULL) ghi được qua TABLE-OWNER: migrator chạy
--   DATABASE_DIRECT_URL = role owner mediaos (rolbypassrls) ⇒ UPDATE company_id NULL chạy TRỰC TIẾP, KHÔNG cần
--   SET LOCAL/GUC. WITH CHECK(company_id=GUC) của 0479 chỉ chặn app role.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 RLS+FORCE + policy đã tạo Ở 0479 TRƯỚC seed — 0497 CHỈ UPDATE DATA global, KHÔNG đụng cô lập tenant,
--      KHÔNG chạm permissions/role_permissions/policy (WO không sửa grant/RLS). target_url_template chỉ là
--      chuỗi route FE non-sensitive (không phải dữ liệu tenant) — ĐỌC-only qua app role, ghi = owner-bypass.
--   #2 KHÔNG hard-delete: chỉ UPDATE in-place cột target_url_template (giữ id/row ⇒ FK notifications nguyên vẹn).
--   #3 target_url_template KHÔNG chứa dữ liệu nhạy cảm — chỉ route FE + placeholder id non-sensitive
--      ({taskId}/{projectId}/{requestId} = id thực thể, không secret/PII). masking ép ở tầng service.
--   • IDEMPOTENT + KHÔNG-ĐÈ (crown-safe): WHERE company_id IS NULL (KHÔNG đè company-override) AND
--      target_url_template IS NULL (KHÔNG đè giá trị đã có) ⇒ chạy lại = 0 hàng đổi, KHÔNG ném exception.
--
-- BẪY KỸ THUẬT (đã xác minh — vì sao 20 route TĨNH, 19 placeholder):
--   renderer.interpolate() GIỮ NGUYÊN `{key}` khi payload thiếu key (non-fatal). Engine sau render gọi
--   assertInternalTargetUrl (regex ^/(?!/)[\w\-./?=&%#]*$) — `{` `}` NGOÀI char-class ⇒ 422 loud, notification
--   KHÔNG được tạo. ⇒ CHỈ dùng placeholder khi MỌI producer THẬT của event luôn có key trong payload:
--     {taskId}   = task-actions.commonPayload / task-comments.commentPayload (7 TASK event thao tác)
--     {projectId}= projects.addMember payload (PROJECT_MEMBER_ADDED)
--     {requestId}= leave-request/-approval/-revoke + attendance-adjustment/remote-work-request (4 LEAVE + 7 ATT)
--   Event có payload KHÔNG chắc chắn có id (TASK_DUE_SOON/OVERDUE job payload chỉ {task_title,due_at};
--   detection ATT; LEAVE balance/sync; HR/AUTH/SYSTEM) → route TĨNH (không placeholder) — LUÔN hợp lệ.
--   Route TĨNH & param đối chiếu apps/app/src/router.tsx (chỉ trỏ route TỒN TẠI). Chi tiết: docs/plans/S5-NOTI-FIX-1.md §4.
--
-- BAND 0497 (lane notifix1 / S5-NOTI-FIX-1). Journal: idx 177, when 1717500880000 (> head 0496 idx 176 /
--   1717500875000). Nối tiếp ĐƠN ĐIỆU sau 0496_s5_hr_import_be1_import_employee_sensitive.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (1) BACKFILL target_url_template GLOBAL. UPDATE ... FROM (VALUES 39 dòng) match theo template_code
--     (khóa tự nhiên global 0481/0490: '<EVENT_CODE>__IN_APP__vi-VN'). CHỈ company_id IS NULL (không đè
--     override) + target_url_template IS NULL (không đè giá trị đã có + idempotent). deleted_at IS NULL.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE notification_templates AS nt
   SET target_url_template = t.url,
       updated_at          = now()
FROM (VALUES
  -- AUTH (3) — account-directed, tĩnh (payload chỉ userId/employeeId, không route theo id)
  ('AUTH_USER_CREATED__IN_APP__vi-VN',              '/account/change-password'),
  ('AUTH_USER_LOCKED__IN_APP__vi-VN',               '/account/sessions'),
  ('AUTH_PASSWORD_RESET_REQUESTED__IN_APP__vi-VN',  '/account/change-password'),
  -- HR (5) — chưa wire producer / payload không có id → route TĨNH danh sách phù hợp
  ('HR_EMPLOYEE_CREATED__IN_APP__vi-VN',            '/hr/employees'),
  ('HR_PROFILE_CHANGE_SUBMITTED__IN_APP__vi-VN',    '/hr/profile-change-requests'),
  ('HR_PROFILE_CHANGE_APPROVED__IN_APP__vi-VN',     '/hr/me/change-request'),
  ('HR_PROFILE_CHANGE_REJECTED__IN_APP__vi-VN',     '/hr/me/change-request'),
  ('HR_CONTRACT_EXPIRING__IN_APP__vi-VN',           '/hr/contracts'),
  -- ATT detection (4) — payload work_date, không id → route TĨNH
  ('ATT_MISSING_CHECKOUT__IN_APP__vi-VN',           '/attendance/today'),
  ('ATT_LATE_DETECTED__IN_APP__vi-VN',              '/attendance/today'),
  ('ATT_ABSENT_DETECTED__IN_APP__vi-VN',            '/attendance/today'),
  ('ATT_AUTO_ATTENDANCE_CREATED__IN_APP__vi-VN',    '/attendance/today'),
  -- ATT adjustment (3) — producer payload {requestId} (attendance-adjustment.service.ts), route scope-aware
  ('ATT_ADJUSTMENT_SUBMITTED__IN_APP__vi-VN',       '/attendance/adjustment-requests/{requestId}'),
  ('ATT_ADJUSTMENT_APPROVED__IN_APP__vi-VN',        '/attendance/adjustment-requests/{requestId}'),
  ('ATT_ADJUSTMENT_REJECTED__IN_APP__vi-VN',        '/attendance/adjustment-requests/{requestId}'),
  -- ATT remote-work (4) — producer payload {requestId} (remote-work-request.service.ts), route scope-aware
  ('ATT_REMOTE_REQUEST_SUBMITTED__IN_APP__vi-VN',   '/attendance/remote-work-requests/{requestId}'),
  ('ATT_REMOTE_REQUEST_APPROVED__IN_APP__vi-VN',    '/attendance/remote-work-requests/{requestId}'),
  ('ATT_REMOTE_REQUEST_REJECTED__IN_APP__vi-VN',    '/attendance/remote-work-requests/{requestId}'),
  ('ATT_REMOTE_REQUEST_CANCELLED__IN_APP__vi-VN',   '/attendance/remote-work-requests/{requestId}'),
  -- LEAVE request (5) — producer payload {requestId}. SUBMITTED recipient=manager (detail /me own-scoped 403)
  --   → /leave/approvals (inbox). APPROVED/REJECTED/CANCELLED/REVOKED requester-centric → /leave/me/requests/{id}
  ('LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN',        '/leave/approvals'),
  ('LEAVE_REQUEST_APPROVED__IN_APP__vi-VN',         '/leave/me/requests/{requestId}'),
  ('LEAVE_REQUEST_REJECTED__IN_APP__vi-VN',         '/leave/me/requests/{requestId}'),
  ('LEAVE_REQUEST_CANCELLED__IN_APP__vi-VN',        '/leave/me/requests/{requestId}'),
  ('LEAVE_REQUEST_REVOKED__IN_APP__vi-VN',          '/leave/me/requests/{requestId}'),
  -- LEAVE balance/sync (3) — payload leave_type/balance/leave_request_code, không id route → route TĨNH
  ('LEAVE_BALANCE_ADJUSTED__IN_APP__vi-VN',         '/leave/me/balances'),
  ('LEAVE_BALANCE_LOW__IN_APP__vi-VN',              '/leave/me/balances'),
  ('LEAVE_SYNC_TO_ATT_FAILED__IN_APP__vi-VN',       '/leave'),
  -- TASK thao tác (7) — producer payload {taskId} (commonPayload/commentPayload) → /tasks/{taskId}
  ('TASK_ASSIGNED__IN_APP__vi-VN',                  '/tasks/{taskId}'),
  ('TASK_STATUS_CHANGED__IN_APP__vi-VN',            '/tasks/{taskId}'),
  ('TASK_COMMENT_CREATED__IN_APP__vi-VN',           '/tasks/{taskId}'),
  ('TASK_MENTIONED__IN_APP__vi-VN',                 '/tasks/{taskId}'),
  ('TASK_PRIORITY_CHANGED__IN_APP__vi-VN',          '/tasks/{taskId}'),
  ('TASK_DUE_DATE_CHANGED__IN_APP__vi-VN',          '/tasks/{taskId}'),
  ('TASK_ASSIGNEE_CHANGED__IN_APP__vi-VN',          '/tasks/{taskId}'),
  -- TASK reminder (2) — job payload {task_title,due_at} KHÔNG có taskId → route TĨNH (tránh bẫy 422)
  ('TASK_DUE_SOON__IN_APP__vi-VN',                  '/tasks/my-tasks'),
  ('TASK_OVERDUE__IN_APP__vi-VN',                   '/tasks/my-tasks'),
  -- PROJECT (1) — producer payload {projectId} (projects.addMember)
  ('PROJECT_MEMBER_ADDED__IN_APP__vi-VN',           '/tasks/projects/{projectId}'),
  -- SYSTEM (2) — cảnh báo/lỗi hệ thống → trang tổng quan hệ thống
  ('SYSTEM_CONFIG_WARNING__IN_APP__vi-VN',          '/system'),
  ('SYSTEM_ERROR_DETECTED__IN_APP__vi-VN',          '/system')
) AS t(template_code, url)
WHERE nt.template_code = t.template_code
  AND nt.company_id IS NULL
  AND nt.deleted_at IS NULL
  AND nt.target_url_template IS NULL;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) VERIFY fail-LOUD: KHÔNG template global nào còn target_url_template NULL (bất biến QA2-CRIT-001 fixed).
--     RAISE EXCEPTION kèm danh sách template_code còn thiếu → migration ĐỎ, chặn deploy nửa vời. Idempotent:
--     lần chạy 2 vẫn 0 NULL (không đổi count) — verify PASS lặng.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text[];
  v_n       int;
BEGIN
  SELECT array_agg(template_code ORDER BY template_code), count(*)
    INTO v_missing, v_n
    FROM notification_templates
   WHERE company_id IS NULL
     AND deleted_at IS NULL
     AND target_url_template IS NULL;

  IF v_n > 0 THEN
    RAISE EXCEPTION '[0497] % template GLOBAL còn target_url_template NULL (QA2-CRIT-001 chưa fix hết): %',
      v_n, v_missing;
  END IF;

  RAISE NOTICE '[0497] backfill target_url_template GLOBAL OK — 0 template còn NULL.';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy). Revert = set lại NULL cho ĐÚNG 39 template global
-- --   (KHÔNG đụng company-override company_id NOT NULL). CHỈ chạy nếu cần rollback deep-link toàn hệ thống.
-- UPDATE notification_templates SET target_url_template = NULL, updated_at = now()
--  WHERE company_id IS NULL AND deleted_at IS NULL
--    AND template_code LIKE '%\_\_IN\_APP\_\_vi-VN';
