-- Migration 0481: S4-NOTI-SEED-1 (🔴 RED, zone=red, crown) — SEED danh mục NOTI (event + template) +
--   catalog quyền config + grant. THUẦN ADDITIVE DATA — mirror 0480 (KHÔNG DDL, KHÔNG db:generate).
--   Nguồn sự thật: DB-07 §14.1 (seed events MVP) + §14.2 (template vi) ∪ SPEC-08 §15.1–15.6 (danh mục
--   event đầy đủ) + DB-02 §9.7 (cặp quyền NOTI config). NỐI TIẾP 0480 (S4-TASK-RECON-1) — hot-file APPEND.
--
-- BỐI CẢNH (seed qua migrator owner, KHÔNG qua app role):
--   notification_events / notification_templates (0479) có company_id NULLABLE, RLS+FORCE bật, và app role
--   CHỈ có GRANT SELECT (write company-override → NOTI-BE-3). Row GLOBAL (company_id NULL) chỉ ghi được qua
--   TABLE-OWNER: migrator chạy DATABASE_DIRECT_URL = role owner mediaos (rolbypassrls=true, mẫu 0435
--   "admin System qua table-owner (bypass FORCE)") ⇒ INSERT company_id NULL chạy TRỰC TIẾP, KHÔNG cần
--   SET LOCAL/GUC. WITH CHECK(company_id=GUC) của 0479 chỉ chặn app role, KHÔNG chặn owner-bypass.
--
-- RECONCILE DRIFT DB-07 §14.1 vs SPEC-08 §15.6 (SYSTEM_*):
--   • DB-07 §14.1 (tập seed CHUẨN — docs/DB thắng khi mâu thuẫn, CLAUDE.md §1): SYSTEM_CONFIG_WARNING +
--     SYSTEM_ERROR_DETECTED → is_enabled=true (thuộc MVP set).
--   • SPEC-08 §15.6 (danh mục mở rộng): DASH_WIDGET_ERROR, SYSTEM_CONFIG_CHANGED, SYSTEM_MAINTENANCE_NOTICE,
--     SYSTEM_IMPORT_FAILED, SYSTEM_JOB_FAILED → GIỮ trong catalog nhưng is_enabled=false.
--   ⇒ UNION cả hai bộ, KHÔNG bỏ mã nào. Tập enabled = DB-07 §14.1 (36 mã). Phần dư SPEC-08 §15 = 16 mã
--     is_enabled=false (giữ catalog để NOTI-BE/company bật sau, KHÔNG cần migration mới).
--   event_code VERBATIM theo spec: TASK_MENTIONED + TASK_COMMENT_CREATED (KHÔNG TASK_COMMENT_MENTIONED).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 RLS+FORCE + policy đã tạo Ở 0479 TRƯỚC seed — 0481 CHỈ INSERT data, KHÔNG đụng cô lập tenant.
--      events/templates GLOBAL (company_id NULL) = danh mục dùng-chung, ĐỌC-only qua app role (SELECT +
--      policy `company_id IS NULL`); ghi = owner-bypass tại migrate-time. KHÔNG rò dữ liệu tenant khác.
--   #2 events/templates = DANH MỤC (config master-data) — KHÔNG append-only; nhưng seed qua owner, app role
--      không INSERT/UPDATE được global. role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm
--      data_scope ⇒ đổi scope = DELETE đúng (role_id,permission_id,'ALLOW') scope SAI (per-pair, KHÔNG
--      blanket) + INSERT lại scope §13 ON CONFLICT DO NOTHING (mirror 0480/0444). App role KHÔNG có
--      UPDATE/DELETE role_permissions ở runtime — migrator role privileged di quyền tại migrate-time.
--   #3 template body/nội dung KHÔNG chứa dữ liệu nhạy cảm (DB-07 §4.6 / §16.1.9) — chỉ biến placeholder
--      {task_code}/{employee_name}/… ; masking/nội dung nhạy cảm ép ở tầng service (NOTI-BE), KHÔNG ở seed.
--   • Catalog: INSERT ON CONFLICT (event_code / template_code / (action,resource_type)) DO NOTHING — hot-file
--     UNION, chạy lại KHÔNG nhân đôi. Idempotent BỘ-BA (role_id, permission_id, data_scope) cho grant.
--   • super-admin KHÔNG enumerate ở DO-block: role company-scoped, seed RUNTIME qua SuperAdminBootstrap
--     (phủ toàn catalog mỗi boot). roles company_id IS NULL không có 'super-admin' ⇒ enumerate = RAISE vỡ.
--
-- BAND 0481 (lane notiSeedMig / S4-NOTI-SEED-1). Journal: idx 161, when 1717500800000 (> head 0480 idx 160 /
--   1717500795000). Nối tiếp ĐƠN ĐIỆU sau 0480_s4_taskrecon1_task_pair_drift_grants.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (1) SEED notification_events GLOBAL (company_id NULL). UNION DB-07 §14.1 (enabled) ∪ SPEC-08 §15 (dư,
--     disabled). ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING
--     (khớp partial uq_notification_events_global_code_active). is_system_event=true cho SYSTEM/DASH-widget.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO notification_events
  (company_id, module_code, event_code, event_name, notification_type, default_priority, default_channels, is_enabled, is_system_event)
VALUES
  -- ===== MVP set (DB-07 §14.1) — is_enabled = true =====
  (NULL::uuid, 'AUTH', 'AUTH_USER_CREATED',              'Tài khoản được tạo',                 'Account',    'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'AUTH', 'AUTH_USER_LOCKED',               'Tài khoản bị khóa',                  'Account',    'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'AUTH', 'AUTH_PASSWORD_RESET_REQUESTED',  'Yêu cầu reset mật khẩu',             'Account',    'High',     '["IN_APP","EMAIL"]'::jsonb,  true,  false),
  (NULL::uuid, 'HR',   'HR_EMPLOYEE_CREATED',            'Tạo nhân viên mới',                  'HR',         'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'HR',   'HR_PROFILE_CHANGE_SUBMITTED',    'Gửi yêu cầu sửa hồ sơ',              'Approval',   'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'HR',   'HR_PROFILE_CHANGE_APPROVED',     'Yêu cầu sửa hồ sơ được duyệt',       'HR',         'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'HR',   'HR_PROFILE_CHANGE_REJECTED',     'Yêu cầu sửa hồ sơ bị từ chối',       'HR',         'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'HR',   'HR_CONTRACT_EXPIRING',           'Hợp đồng sắp hết hạn',               'Reminder',   'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_MISSING_CHECKOUT',           'Thiếu check-out',                    'Attendance', 'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_LATE_DETECTED',              'Đi muộn',                            'Attendance', 'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_ABSENT_DETECTED',            'Vắng mặt',                           'Warning',    'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_ADJUSTMENT_SUBMITTED',       'Gửi yêu cầu điều chỉnh công',        'Approval',   'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_ADJUSTMENT_APPROVED',        'Điều chỉnh công được duyệt',         'Attendance', 'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_ADJUSTMENT_REJECTED',        'Điều chỉnh công bị từ chối',         'Attendance', 'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_AUTO_ATTENDANCE_CREATED',    'Tự động chấm công',                  'Attendance', 'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_REMOTE_REQUEST_SUBMITTED',   'Gửi yêu cầu remote/công tác',        'Approval',   'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_REMOTE_REQUEST_APPROVED',    'Yêu cầu remote được duyệt',          'Attendance', 'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_REMOTE_REQUEST_REJECTED',    'Yêu cầu remote bị từ chối',          'Attendance', 'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'ATT',  'ATT_REMOTE_REQUEST_CANCELLED',   'Yêu cầu remote bị hủy',              'Attendance', 'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'LEAVE','LEAVE_REQUEST_SUBMITTED',        'Gửi đơn nghỉ',                       'Approval',   'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'LEAVE','LEAVE_REQUEST_APPROVED',         'Đơn nghỉ được duyệt',                'Leave',      'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'LEAVE','LEAVE_REQUEST_REJECTED',         'Đơn nghỉ bị từ chối',                'Leave',      'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'LEAVE','LEAVE_REQUEST_CANCELLED',        'Đơn nghỉ bị hủy',                    'Leave',      'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'LEAVE','LEAVE_REQUEST_REVOKED',          'Đơn nghỉ bị thu hồi',                'Leave',      'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'LEAVE','LEAVE_BALANCE_ADJUSTED',         'Số dư phép được điều chỉnh',         'Leave',      'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'LEAVE','LEAVE_BALANCE_LOW',              'Số ngày phép thấp',                  'Warning',    'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'LEAVE','LEAVE_SYNC_TO_ATT_FAILED',       'Đồng bộ nghỉ phép sang chấm công lỗi','Error',     'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'TASK', 'TASK_ASSIGNED',                  'User được giao task',                'Task',       'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'TASK', 'TASK_STATUS_CHANGED',            'Đổi trạng thái task',                'Task',       'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'TASK', 'TASK_COMMENT_CREATED',           'Có comment mới',                     'Task',       'Low',      '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'TASK', 'TASK_MENTIONED',                 'User được mention',                  'Task',       'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'TASK', 'TASK_DUE_SOON',                  'Task sắp đến hạn',                   'Reminder',   'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'TASK', 'TASK_OVERDUE',                   'Task quá hạn',                       'Warning',    'High',     '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'TASK', 'PROJECT_MEMBER_ADDED',           'User được thêm vào dự án',           'Project',    'Normal',   '["IN_APP"]'::jsonb,          true,  false),
  (NULL::uuid, 'SYSTEM','SYSTEM_CONFIG_WARNING',         'Cảnh báo cấu hình',                  'Warning',    'High',     '["IN_APP"]'::jsonb,          true,  true),
  (NULL::uuid, 'SYSTEM','SYSTEM_ERROR_DETECTED',         'Phát hiện lỗi hệ thống',             'Error',      'Critical', '["IN_APP"]'::jsonb,          true,  true),
  -- ===== Phần dư SPEC-08 §15 (ngoài MVP) — is_enabled = false (GIỮ trong catalog) =====
  (NULL::uuid, 'AUTH', 'AUTH_PASSWORD_CHANGED',          'Đổi mật khẩu thành công',            'Account',    'Normal',   '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'AUTH', 'AUTH_USER_UNLOCKED',             'Tài khoản được mở khóa',             'Account',    'Normal',   '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'HR',   'HR_PROBATION_ENDING',            'Nhân viên sắp hết thử việc',         'Reminder',   'High',     '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'HR',   'HR_EMPLOYEE_STATUS_CHANGED',     'Trạng thái nhân viên thay đổi',      'HR',         'Normal',   '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'ATT',  'ATT_CHECKIN_REMINDER',           'Nhắc check-in đầu ngày',             'Reminder',   'Normal',   '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'ATT',  'ATT_CHECKOUT_REMINDER',          'Nhắc check-out cuối ngày',           'Reminder',   'Normal',   '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'LEAVE','LEAVE_START_REMINDER',           'Sắp tới ngày nghỉ',                  'Reminder',   'Normal',   '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'TASK', 'TASK_UPDATED',                   'Task được cập nhật',                 'Task',       'Low',      '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'TASK', 'TASK_ASSIGNEE_CHANGED',          'Đổi người phụ trách',                'Task',       'Normal',   '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'TASK', 'TASK_DEADLINE_CHANGED',          'Đổi deadline',                       'Task',       'Normal',   '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'TASK', 'PROJECT_CLOSED',                 'Project đóng',                       'Project',    'Normal',   '["IN_APP"]'::jsonb,          false, false),
  (NULL::uuid, 'DASH', 'DASH_WIDGET_ERROR',              'Widget lỗi nhiều lần',               'Error',      'High',     '["IN_APP"]'::jsonb,          false, true),
  (NULL::uuid, 'SYSTEM','SYSTEM_CONFIG_CHANGED',         'Cấu hình hệ thống thay đổi',         'System',     'Normal',   '["IN_APP"]'::jsonb,          false, true),
  (NULL::uuid, 'SYSTEM','SYSTEM_MAINTENANCE_NOTICE',     'Thông báo bảo trì',                  'System',     'Normal',   '["IN_APP"]'::jsonb,          false, true),
  (NULL::uuid, 'SYSTEM','SYSTEM_IMPORT_FAILED',          'Import dữ liệu lỗi',                 'Error',      'High',     '["IN_APP"]'::jsonb,          false, true),
  (NULL::uuid, 'SYSTEM','SYSTEM_JOB_FAILED',             'Job hệ thống lỗi',                   'Error',      'High',     '["IN_APP"]'::jsonb,          false, true)
ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) SEED notification_templates GLOBAL (company_id NULL) IN_APP / vi-VN cho MỌI event is_enabled=true
--     (36 template). event_id resolve qua JOIN notification_events (event_code, company_id IS NULL). Nội dung
--     DB-07 §14.2 + cột "Nội dung gợi ý" SPEC-08 §15. body_template NOT NULL set tường minh; status='Active';
--     is_default=true; variables_schema jsonb. ON CONFLICT (template_code) WHERE company_id IS NULL AND
--     deleted_at IS NULL DO NOTHING (khớp partial uq_notification_templates_global_code_active).
--     ⚠ CHỈ liệt kê event enabled ⇒ event disabled KHÔNG có template (least-content, deny-path template).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO notification_templates
  (company_id, event_id, template_code, channel, locale, title_template, body_template, short_body_template, variables_schema, status, is_default)
SELECT
  NULL::uuid, e.id, t.template_code, 'IN_APP', 'vi-VN',
  t.title_template, t.body_template, t.short_body_template, t.variables_schema::jsonb, 'Active', true
FROM (VALUES
  ('AUTH_USER_CREATED',            'AUTH_USER_CREATED__IN_APP__vi-VN',
     'Tài khoản của bạn đã được tạo',
     'Tài khoản {username} của bạn đã được tạo trên hệ thống. Vui lòng đăng nhập và đổi mật khẩu lần đầu.',
     'Tài khoản {username} đã được khởi tạo.',                                  '{"username":"string","employee_name":"string"}'),
  ('AUTH_USER_LOCKED',             'AUTH_USER_LOCKED__IN_APP__vi-VN',
     'Tài khoản của bạn đã bị khóa',
     'Tài khoản {username} đã bị khóa. Vui lòng liên hệ quản trị viên nếu cần hỗ trợ.',
     'Tài khoản {username} đã bị khóa.',                                        '{"username":"string","reason":"string"}'),
  ('AUTH_PASSWORD_RESET_REQUESTED','AUTH_PASSWORD_RESET_REQUESTED__IN_APP__vi-VN',
     'Yêu cầu đặt lại mật khẩu',
     'Đã ghi nhận yêu cầu đặt lại mật khẩu cho tài khoản {username}. Nếu không phải bạn, hãy liên hệ quản trị viên ngay.',
     'Bạn đã yêu cầu đặt lại mật khẩu.',                                        '{"username":"string"}'),
  ('HR_EMPLOYEE_CREATED',          'HR_EMPLOYEE_CREATED__IN_APP__vi-VN',
     'Hồ sơ nhân viên mới đã được tạo',
     'Hồ sơ nhân viên {employee_name} ({employee_code}) đã được tạo trong hệ thống.',
     'Hồ sơ nhân viên {employee_name} đã được tạo.',                            '{"employee_name":"string","employee_code":"string"}'),
  ('HR_PROFILE_CHANGE_SUBMITTED',  'HR_PROFILE_CHANGE_SUBMITTED__IN_APP__vi-VN',
     'Có yêu cầu cập nhật hồ sơ cần duyệt',
     '{employee_name} đã gửi yêu cầu cập nhật hồ sơ {change_request_code} và đang chờ duyệt.',
     '{employee_name} đã gửi yêu cầu cập nhật hồ sơ.',                          '{"employee_name":"string","change_request_code":"string"}'),
  ('HR_PROFILE_CHANGE_APPROVED',   'HR_PROFILE_CHANGE_APPROVED__IN_APP__vi-VN',
     'Yêu cầu cập nhật hồ sơ đã được duyệt',
     'Yêu cầu cập nhật hồ sơ {change_request_code} của bạn đã được duyệt.',
     'Yêu cầu cập nhật hồ sơ {change_request_code} đã được duyệt.',            '{"change_request_code":"string"}'),
  ('HR_PROFILE_CHANGE_REJECTED',   'HR_PROFILE_CHANGE_REJECTED__IN_APP__vi-VN',
     'Yêu cầu cập nhật hồ sơ đã bị từ chối',
     'Yêu cầu cập nhật hồ sơ {change_request_code} của bạn đã bị từ chối. Lý do: {reason}.',
     'Yêu cầu cập nhật hồ sơ {change_request_code} đã bị từ chối.',            '{"change_request_code":"string","reason":"string"}'),
  ('HR_CONTRACT_EXPIRING',         'HR_CONTRACT_EXPIRING__IN_APP__vi-VN',
     'Hợp đồng sắp hết hạn',
     'Hợp đồng của {employee_name} sẽ hết hạn vào {expiry_date}. Vui lòng xử lý gia hạn.',
     'Hợp đồng của {employee_name} sắp hết hạn.',                               '{"employee_name":"string","expiry_date":"string"}'),
  ('ATT_MISSING_CHECKOUT',         'ATT_MISSING_CHECKOUT__IN_APP__vi-VN',
     'Bạn chưa check-out',
     'Hệ thống ghi nhận bạn chưa check-out cho ngày {work_date}. Vui lòng bổ sung hoặc gửi yêu cầu điều chỉnh công.',
     'Bạn chưa check-out ngày {work_date}.',                                    '{"work_date":"string","employee_name":"string"}'),
  ('ATT_LATE_DETECTED',            'ATT_LATE_DETECTED__IN_APP__vi-VN',
     'Ghi nhận đi muộn',
     'Hệ thống ghi nhận bạn đi muộn ngày {work_date}.',
     'Có bản ghi đi muộn ngày {work_date}.',                                    '{"work_date":"string"}'),
  ('ATT_ABSENT_DETECTED',          'ATT_ABSENT_DETECTED__IN_APP__vi-VN',
     'Ghi nhận vắng mặt',
     'Hệ thống ghi nhận vắng mặt ngày {work_date} cần được kiểm tra.',
     'Có bản ghi vắng mặt ngày {work_date}.',                                   '{"work_date":"string","employee_name":"string"}'),
  ('ATT_ADJUSTMENT_SUBMITTED',     'ATT_ADJUSTMENT_SUBMITTED__IN_APP__vi-VN',
     'Có yêu cầu điều chỉnh công cần duyệt',
     '{employee_name} đã gửi yêu cầu điều chỉnh công {adjustment_code} cần được xử lý.',
     '{employee_name} đã gửi yêu cầu điều chỉnh công.',                         '{"employee_name":"string","adjustment_code":"string"}'),
  ('ATT_ADJUSTMENT_APPROVED',      'ATT_ADJUSTMENT_APPROVED__IN_APP__vi-VN',
     'Yêu cầu điều chỉnh công đã được duyệt',
     'Yêu cầu điều chỉnh công {adjustment_code} của bạn đã được duyệt.',
     'Yêu cầu điều chỉnh công {adjustment_code} đã được duyệt.',               '{"adjustment_code":"string"}'),
  ('ATT_ADJUSTMENT_REJECTED',      'ATT_ADJUSTMENT_REJECTED__IN_APP__vi-VN',
     'Yêu cầu điều chỉnh công đã bị từ chối',
     'Yêu cầu điều chỉnh công {adjustment_code} của bạn đã bị từ chối. Lý do: {reason}.',
     'Yêu cầu điều chỉnh công {adjustment_code} đã bị từ chối.',               '{"adjustment_code":"string","reason":"string"}'),
  ('ATT_AUTO_ATTENDANCE_CREATED',  'ATT_AUTO_ATTENDANCE_CREATED__IN_APP__vi-VN',
     'Công đã được ghi nhận tự động',
     'Hệ thống đã tự động ghi nhận công cho ngày {work_date}.',
     'Công ngày {work_date} đã được ghi nhận tự động.',                        '{"work_date":"string"}'),
  ('ATT_REMOTE_REQUEST_SUBMITTED', 'ATT_REMOTE_REQUEST_SUBMITTED__IN_APP__vi-VN',
     'Có yêu cầu remote/công tác cần duyệt',
     '{employee_name} đã gửi yêu cầu remote/công tác {request_code} cần được duyệt.',
     '{employee_name} đã gửi yêu cầu remote/công tác.',                         '{"employee_name":"string","request_code":"string"}'),
  ('ATT_REMOTE_REQUEST_APPROVED',  'ATT_REMOTE_REQUEST_APPROVED__IN_APP__vi-VN',
     'Yêu cầu remote/công tác đã được duyệt',
     'Yêu cầu remote/công tác {request_code} của bạn đã được duyệt.',
     'Yêu cầu {request_code} đã được duyệt.',                                   '{"request_code":"string"}'),
  ('ATT_REMOTE_REQUEST_REJECTED',  'ATT_REMOTE_REQUEST_REJECTED__IN_APP__vi-VN',
     'Yêu cầu remote/công tác đã bị từ chối',
     'Yêu cầu remote/công tác {request_code} của bạn đã bị từ chối. Lý do: {reason}.',
     'Yêu cầu {request_code} đã bị từ chối.',                                   '{"request_code":"string","reason":"string"}'),
  ('ATT_REMOTE_REQUEST_CANCELLED', 'ATT_REMOTE_REQUEST_CANCELLED__IN_APP__vi-VN',
     'Yêu cầu remote/công tác đã được hủy',
     'Yêu cầu remote/công tác {request_code} đã được hủy.',
     'Yêu cầu {request_code} đã được hủy.',                                     '{"request_code":"string"}'),
  ('LEAVE_REQUEST_SUBMITTED',      'LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN',
     'Bạn có một đơn nghỉ cần duyệt',
     '{employee_name} đã gửi đơn nghỉ {leave_request_code} và đang chờ duyệt.',
     '{employee_name} đã gửi đơn nghỉ {leave_request_code}.',                   '{"employee_name":"string","leave_request_code":"string"}'),
  ('LEAVE_REQUEST_APPROVED',       'LEAVE_REQUEST_APPROVED__IN_APP__vi-VN',
     'Đơn nghỉ của bạn đã được duyệt',
     'Đơn nghỉ {leave_request_code} của bạn đã được duyệt.',
     'Đơn {leave_request_code} đã được duyệt.',                                 '{"leave_request_code":"string"}'),
  ('LEAVE_REQUEST_REJECTED',       'LEAVE_REQUEST_REJECTED__IN_APP__vi-VN',
     'Đơn nghỉ của bạn bị từ chối',
     'Đơn nghỉ {leave_request_code} của bạn đã bị từ chối. Lý do: {reason}.',
     'Đơn {leave_request_code} đã bị từ chối.',                                 '{"leave_request_code":"string","reason":"string"}'),
  ('LEAVE_REQUEST_CANCELLED',      'LEAVE_REQUEST_CANCELLED__IN_APP__vi-VN',
     'Đơn nghỉ đã được hủy',
     'Đơn nghỉ {leave_request_code} đã được hủy.',
     'Đơn {leave_request_code} đã được hủy.',                                   '{"leave_request_code":"string"}'),
  ('LEAVE_REQUEST_REVOKED',        'LEAVE_REQUEST_REVOKED__IN_APP__vi-VN',
     'Đơn nghỉ đã được thu hồi',
     'Đơn nghỉ {leave_request_code} đã được thu hồi.',
     'Đơn {leave_request_code} đã được thu hồi.',                               '{"leave_request_code":"string"}'),
  ('LEAVE_BALANCE_ADJUSTED',       'LEAVE_BALANCE_ADJUSTED__IN_APP__vi-VN',
     'Số dư phép đã được cập nhật',
     'Số dư phép {leave_type} của bạn đã được điều chỉnh. Số dư hiện tại: {balance}.',
     'Số dư phép của bạn đã được cập nhật.',                                    '{"leave_type":"string","balance":"string"}'),
  ('LEAVE_BALANCE_LOW',            'LEAVE_BALANCE_LOW__IN_APP__vi-VN',
     'Số ngày phép còn lại sắp hết',
     'Số ngày phép {leave_type} còn lại của bạn ({balance}) đang ở mức thấp.',
     'Số ngày phép còn lại của bạn sắp hết.',                                   '{"leave_type":"string","balance":"string"}'),
  ('LEAVE_SYNC_TO_ATT_FAILED',     'LEAVE_SYNC_TO_ATT_FAILED__IN_APP__vi-VN',
     'Đồng bộ nghỉ phép sang chấm công thất bại',
     'Đồng bộ đơn nghỉ {leave_request_code} sang chấm công thất bại. Vui lòng kiểm tra lại.',
     'Đồng bộ đơn {leave_request_code} sang chấm công lỗi.',                    '{"leave_request_code":"string","error_message":"string"}'),
  ('TASK_ASSIGNED',                'TASK_ASSIGNED__IN_APP__vi-VN',
     'Bạn có task mới',
     'Bạn được giao task {task_code}: {task_title}.',
     'Bạn được giao task {task_code}: {task_title}.',                           '{"task_code":"string","task_title":"string"}'),
  ('TASK_STATUS_CHANGED',          'TASK_STATUS_CHANGED__IN_APP__vi-VN',
     'Trạng thái task đã thay đổi',
     'Trạng thái task {task_code} đã đổi thành {new_status}.',
     'Task {task_code} chuyển sang {new_status}.',                             '{"task_code":"string","new_status":"string"}'),
  ('TASK_COMMENT_CREATED',         'TASK_COMMENT_CREATED__IN_APP__vi-VN',
     'Có bình luận mới trong task',
     '{actor_name} đã bình luận trong task {task_code}.',
     'Có bình luận mới trong task {task_code}.',                                '{"task_code":"string","actor_name":"string"}'),
  ('TASK_MENTIONED',               'TASK_MENTIONED__IN_APP__vi-VN',
     'Bạn được nhắc đến trong comment',
     '{actor_name} đã nhắc đến bạn trong một bình luận ở task {task_code}.',
     '{actor_name} đã mention bạn trong task {task_code}.',                     '{"task_code":"string","actor_name":"string"}'),
  ('TASK_DUE_SOON',                'TASK_DUE_SOON__IN_APP__vi-VN',
     'Task sắp đến hạn',
     'Task {task_code} sắp đến hạn vào {due_date}.',
     'Task {task_code} sắp đến deadline.',                                      '{"task_code":"string","due_date":"string"}'),
  ('TASK_OVERDUE',                 'TASK_OVERDUE__IN_APP__vi-VN',
     'Task đã quá hạn',
     'Task {task_code} đã quá hạn ({due_date}).',
     'Task {task_code} đã quá deadline.',                                       '{"task_code":"string","due_date":"string"}'),
  ('PROJECT_MEMBER_ADDED',         'PROJECT_MEMBER_ADDED__IN_APP__vi-VN',
     'Bạn đã được thêm vào dự án',
     'Bạn đã được thêm vào dự án {project_name} ({project_code}).',
     'Bạn đã được thêm vào dự án {project_name}.',                             '{"project_name":"string","project_code":"string"}'),
  ('SYSTEM_CONFIG_WARNING',        'SYSTEM_CONFIG_WARNING__IN_APP__vi-VN',
     'Cảnh báo cấu hình hệ thống',
     'Hệ thống phát hiện cảnh báo cấu hình: {message}.',
     'Có cảnh báo cấu hình cần kiểm tra.',                                      '{"message":"string"}'),
  ('SYSTEM_ERROR_DETECTED',        'SYSTEM_ERROR_DETECTED__IN_APP__vi-VN',
     'Phát hiện lỗi hệ thống',
     'Hệ thống phát hiện lỗi: {message}. Vui lòng kiểm tra ngay.',
     'Hệ thống phát hiện một lỗi nghiêm trọng.',                                '{"message":"string"}')
) AS t(event_code, template_code, title_template, body_template, short_body_template, variables_schema)
JOIN notification_events e
  ON e.event_code = t.event_code
 AND e.company_id IS NULL
 AND e.deleted_at IS NULL
ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (3) Catalog quyền NOTI config (DB-02 §9.7). 6 cặp is_sensitive=TRUE (cổng nhạy cảm — KHÔNG kế thừa qua
--     wildcard non-sensitive của company-admin; cấp tường minh ở (4)). KHÔNG cặp 'channel'/'notification-channel'
--     (phantom). read:notification (0005) GIỮ NGUYÊN non-sensitive — KHÔNG thêm lại. ON CONFLICT DO NOTHING.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view',   'notification-config',       true),
  ('update', 'notification-config',       true),
  ('view',   'notification-template',     true),
  ('update', 'notification-template',     true),
  ('view',   'notification-delivery-log', true),
  ('view',   'notification-audit-log',    true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (4a) Grant 6 cặp config @Company cho company-admin (mirror 0480/0444: resolve role+perm → RAISE EXCEPTION
--      fail-LOUD nếu thiếu → DELETE scope SAI per-pair → INSERT scope §13 ON CONFLICT DO NOTHING). super-admin
--      KHÔNG enumerate (company-scoped, runtime bootstrap phủ catalog). Idempotent bộ-ba.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  config_grants CONSTANT text[][] := ARRAY[
    ['company-admin', 'view',   'notification-config',       'Company'],
    ['company-admin', 'update', 'notification-config',       'Company'],
    ['company-admin', 'view',   'notification-template',     'Company'],
    ['company-admin', 'update', 'notification-template',     'Company'],
    ['company-admin', 'view',   'notification-delivery-log', 'Company'],
    ['company-admin', 'view',   'notification-audit-log',    'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY config_grants LOOP
    -- resolve role canonical (system role: company_id NULL, chưa xoá mềm)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0481] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog (3) phải đã chạy)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0481] permission (%:%) không có trong catalog — bước (3) phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id,permission_id,'ALLOW') có scope SAI (per-pair, KHÔNG blanket) → idempotent.
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    -- INSERT scope §13. ON CONFLICT(role_id,permission_id,effect) DO NOTHING → idempotent.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0481] config grant company-admin: % INSERT mới, % re-scope', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (4b) Grant read:notification @Own cho employee/manager/hr/company-admin (thông báo là dữ liệu CÁ NHÂN —
--      recipient_user_id = current user ⇒ Own). read:notification catalog có từ 0005. Enumerate role slug
--      TƯỜNG MINH + RAISE EXCEPTION fail-LOUD nếu role/perm thiếu. Per-pair rescope: employee (0005) đang
--      'Company' (backfill 0441 DEFAULT) → hạ về 'Own'. super-admin KHÔNG enumerate (runtime bootstrap).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  own_roles CONSTANT text[] := ARRAY['employee', 'manager', 'hr', 'company-admin'];
  rn         text;
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  SELECT id INTO v_perm_id
    FROM permissions
   WHERE action = 'read' AND resource_type = 'notification';
  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION '[0481] permission (read:notification) không có trong catalog — seed 0005 phải chạy trước';
  END IF;

  FOREACH rn IN ARRAY own_roles LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = rn AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0481] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', rn;
    END IF;

    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> 'Own';
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', 'Own')
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0481] read:notification @Own grant: % INSERT mới, % re-scope', v_seeded, v_rescoped;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.company_id IS NULL
--     AND ((r.name='company-admin' AND p.resource_type IN
--            ('notification-config','notification-template','notification-delivery-log','notification-audit-log'))
--       OR (r.name IN ('employee','manager','hr','company-admin') AND (p.action,p.resource_type)=('read','notification')));
-- DELETE FROM permissions WHERE (action,resource_type) IN
--   (('view','notification-config'),('update','notification-config'),('view','notification-template'),
--    ('update','notification-template'),('view','notification-delivery-log'),('view','notification-audit-log'));
-- DELETE FROM notification_templates WHERE company_id IS NULL AND template_code LIKE '%__IN_APP__vi-VN';
-- DELETE FROM notification_events   WHERE company_id IS NULL;  -- chỉ khi 0 template/notification tham chiếu
