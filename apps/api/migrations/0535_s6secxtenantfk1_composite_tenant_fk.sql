-- S6-SEC-XTENANTFK-1 · KI-046 — BỊT LỚP LỖ "FK MỘT-CỘT NỐI HAI BẢNG TENANT" (composite FK)
--
-- GỐC LỖI. Kiểm tra khoá ngoại của Postgres **chạy với quyền hệ thống và KHÔNG áp RLS** (hành vi
-- thiết kế của PG). Nên một FK MỘT CỘT `child.x → parent(id)` cho phép app role đứng trong ngữ cảnh
-- tenant A ghi hàng `company_id = A` nhưng `x` trỏ tới hàng của B: FK thấy hàng đó TỒN TẠI nên cho
-- qua, còn RLS `WITH CHECK` chỉ soi `company_id` (= A, hợp lệ). Đã tái lập đầu-cuối ở mig 0533 với
-- `team_members` (`INSERT 0 1`). Migration này đóng phần CÒN LẠI của cùng lớp lỗ.
--
-- SỐ ĐO (PROD `mediaos`, 202/202 migration, head 0534 — đo 2026-07-31, chi tiết ở docs/plans/S6-SEC-XTENANTFK-1.md §1):
--   • 463 FK giữa hai bảng đều có `company_id`; 460 một-cột; 3 đã được composite che ⇒ **457 CÒN HỞ**.
--     (Đính chính số cũ "458" của RELEASE-02: `tasks_parent_same_company_fk` che `tasks_parent_task_id_fkey`
--      nên số FK một-cột ĐANG được che là 3, không phải 2.)
--   • Phân lớp theo bảng ĐÍCH: **lớp T** `parent.company_id NOT NULL` = 446 cặp (vá được) ·
--     **lớp G** `parent.company_id NULLABLE` = 11 cặp — bảng catalog TOÀN CỤC (`roles` 13/17 hàng NULL,
--     `dashboard_widgets` 17/17, `notification_events` 59/59, `notification_templates` 45/45,
--     `public_holidays`, `seed_batches`). Composite FK cho lớp G sẽ **PHÁ tham chiếu hợp lệ**
--     (không gán được role hệ thống, không cấu hình được widget…) ⇒ KHÔNG vá, đã ký waiver ở
--     `apps/api/test/foundation/fk-tenant-verdicts.ts`.
--   • Hàng ĐANG lệch tenant ở lớp T (đúng ngữ nghĩa MATCH SIMPLE): **0** trên CẢ `mediaos` lẫn
--     `mediaos_dev`. 144/132 hàng "lệch" đo được ở bản quét thô đều là tham chiếu tới hàng catalog
--     toàn cục — HỢP LỆ, không phải rò tenant.
--
-- ⛔ VÌ SAO KHÔNG CÓ BƯỚC `DELETE` NHƯ 0533. 0533 xoá được vì PROD có 0 hàng `team_members` và phạm vi
-- là 1 bảng. Nhân khuôn đó ra 446 cặp = hard-delete dữ liệu nghiệp vụ thật, không audit,
-- trái BẤT BIẾN #2 (CLAUDE.md §2). Ở đây bước (0) là **TIỀN KIỂM + RAISE EXCEPTION**: đo được 0 nên
-- không kích hoạt; nếu một DB lạ có hàng lệch thì migration DỪNG ỒN ÀO kèm danh sách để người quyết,
-- rồi chạy lại (file idempotent) — KHÔNG tự ý huỷ dữ liệu.
--
-- ⛔ BẪY `ON DELETE SET NULL` TRÊN FK 2 CỘT (279 / 446 cặp rơi vào nhóm này).
-- Viết thẳng `ON DELETE SET NULL` cho composite FK là SAI: Postgres set NULL cho TOÀN BỘ cột của FK,
-- tức **cả `company_id`**. Chứng minh trên PG 17.10:
--     CONTEXT: UPDATE ONLY "child2" SET "company_id" = NULL, "parent_id" = NULL …
--     ERROR:   null value in column "company_id" … violates not-null constraint
-- Với bảng có `company_id` NULLABLE thì tệ hơn — không nổ lỗi mà **âm thầm biến hàng nghiệp vụ thành
-- hàng "toàn cục" vô chủ, nằm ngoài mọi policy RLS**. Vì vậy dùng dạng CÓ DANH SÁCH CỘT (PG 15+):
--     ON DELETE SET NULL (<col>)   -- chỉ null đúng cột FK, GIỮ NGUYÊN company_id
--
-- HÀNH VI MỚI, nói rõ:
--   • Composite FK mặc định `ON UPDATE NO ACTION` ⇒ từ nay `UPDATE <parent> SET company_id = …` bị
--     chặn khi còn hàng con. Siết ĐÚNG hướng (re-home bản ghi sang tenant khác không có nghĩa nghiệp
--     vụ ở N=1) nhưng là thay đổi thật.
--   • MATCH SIMPLE: hàng có `company_id` HOẶC cột FK là NULL thì composite FK KHÔNG kiểm. 24 cặp có
--     `src.company_id` nullable (`login_logs`, `system_job_runs`, `notification_events/templates`,
--     `dashboard_widgets`, `seed_batches/items`, `sequence_counters`, `public_holidays`,
--     `data_retention_policies`) — với chúng hàng `company_id IS NULL` là hàng hệ thống, đã có bất
--     biến riêng ghim ở `auth-me-bootstrap.int-spec`. KHÔNG kín 100%, và nói ra ở đây để người sau
--     không tưởng là kín.
--
-- HOT-FILE / BẤT BIẾN:
--   • THUẦN ADDITIVE: chỉ THÊM unique constraint + FK. KHÔNG đụng policy/RLS/grant/trigger nào.
--   • FK một-cột cũ GIỮ NGUYÊN (không DROP). Không phải vì "expand-contract vô cớ" mà vì nó CÒN
--     TÁC DỤNG THẬT: với 24 cặp có `src.company_id` NULLABLE, composite FK bỏ qua hàng
--     `company_id IS NULL` (MATCH SIMPLE) ⇒ FK cũ là ràng buộc DUY NHẤT còn hiệu lực cho những hàng đó.
--   • Idempotent: guard kiểm theo CỘT (`conkey`), không theo TÊN.
--   • CHI PHÍ CHẠY (nói cho đủ): mỗi INSERT/UPDATE ở 129 bảng nguồn từ nay chạy
--     2 lượt kiểm RI thay vì 1; mỗi DELETE hàng cha chạy 2 hành động RI. Chấp nhận được ở quy mô này,
--     nhưng KHÔNG phải "miễn phí".
--
-- ⚠️ CÁCH ĐỌC FILE NÀY (nói thẳng để reviewer không review nhầm vật): phần LITERAL cần đọc là
-- `INSERT INTO xtfk_pairs … VALUES` — 446 dòng, đó là toàn bộ tập thay đổi. Ba khối `DO` bên dưới
-- dùng `EXECUTE format(%I)` để lặp trên danh sách đó; chúng KHÔNG tự khám phá thêm cặp nào từ catalog.
-- Hệ quả phải biết: cặp nào bị BỎ SÓT khỏi danh sách thì bước tiền kiểm (0) cũng MÙ với nó.
-- Lưới bắt sót nằm ở `xtenant-fk-ratchet.int-spec.ts` (a), chạy SAU migration.
--
-- ĐƯỜNG LÙI (rollback). Thay đổi này thuần additive nên lùi được bằng DROP, không mất dữ liệu.
-- Kích hoạt khi: một write-path bắt đầu 23503 trên dữ liệu HỢP LỆ (dấu hiệu có cặp bị phân lớp sai),
-- hoặc DELETE hàng cha nổ ngoài dự kiến. Lùi theo CẶP LẺ được — mỗi constraint độc lập, KHÔNG cần
-- lùi cả 0535; ưu tiên gỡ đúng cặp đang gây sự cố trước khi nghĩ tới gỡ hàng loạt.
--
-- ⚠️ BA CONSTRAINT KHÔNG ĐƯỢC GỠ (có TRƯỚC 0535, thuộc 0503/0533 — gỡ nhầm là mở lại lỗ đã vá):
--     tasks_parent_same_company_fk · team_members_company_team_fk · team_members_company_user_fk
-- Tên `tasks_parent_same_company_fk` KẾT THÚC bằng `_company_fk` nên lọc theo LIKE sẽ quét trúng nó.
-- Đã kiểm chứng bằng cách chạy thật (2026-07-31): bản lọc đầu gỡ luôn constraint của 0503 và 0535
-- KHÔNG dựng lại (nó không nằm trong danh sách 446). Vì vậy lệnh lùi PHẢI loại trừ tường minh:
--     SELECT format('ALTER TABLE %s DROP CONSTRAINT %I;', c.conrelid::regclass, c.conname)
--       FROM pg_constraint c
--      WHERE c.contype = 'f'
--        AND (c.conname LIKE '%_company_fk' OR c.conname LIKE '%_cfk')
--        AND c.conname NOT IN ('tasks_parent_same_company_fk',
--                              'team_members_company_team_fk',
--                              'team_members_company_user_fk');
--     -- unique constraint đi kèm (chỉ gỡ nếu thật sự cần; `tasks_id_company_uq` của 0503 KHÔNG khớp mẫu này):
--     SELECT format('ALTER TABLE %s DROP CONSTRAINT %I;', c.conrelid::regclass, c.conname)
--       FROM pg_constraint c WHERE c.contype = 'u' AND c.conname LIKE '%_company_id_id_uq'
--        AND c.conname NOT IN ('teams_company_id_id_uq', 'users_company_id_id_uq');
-- Sau khi lùi, `xtenant-fk-ratchet.int-spec.ts` (a) sẽ ĐỎ và liệt kê đúng những cặp vừa mở lại — đó
-- là hành vi ĐÚNG, không phải test hỏng.
--
-- BAND 0535 (nối tiếp head 0534). Journal: idx 202, when 1717587324000.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- Khoá: file này lấy ACCESS EXCLUSIVE trên 63 bảng đích + SHARE ROW EXCLUSIVE trên các bảng nguồn,
-- và GIỮ tới lúc commit (toàn bộ chạy trong 1 transaction của drizzle migrator). `lock_timeout` để một
-- truy vấn dài đang chạy làm migration DỪNG NHANH thay vì đóng băng hàng đợi khoá của cả DB.
SET LOCAL lock_timeout = '5s';

-- Danh sách cặp — LITERAL, là thứ reviewer cần đọc. 446 cặp lớp T.
-- (src, cột FK, bảng đích, hành vi ON DELETE sao chép từ FK một-cột cũ)
CREATE TEMP TABLE xtfk_pairs (src text, col text, tgt text, on_del text) ON COMMIT DROP;
INSERT INTO xtfk_pairs (src, col, tgt, on_del) VALUES
  ('api_key_usages', 'api_key_id', 'api_keys', 'CASCADE'),
  ('api_keys', 'user_id', 'users', 'NO ACTION'),
  ('approval_requests', 'assignee_id', 'users', 'SET NULL'),
  ('approval_requests', 'requested_by', 'users', 'CASCADE'),
  ('approval_requests', 'workflow_step_id', 'workflow_steps', 'CASCADE'),
  ('approval_rules', 'approver_user_id', 'users', 'CASCADE'),
  ('approval_rules', 'workflow_step_id', 'workflow_steps', 'CASCADE'),
  ('approval_steps', 'approval_request_id', 'approval_requests', 'CASCADE'),
  ('approval_steps', 'approver_user_id', 'users', 'CASCADE'),
  ('attendance_adjustment_items', 'created_by', 'users', 'SET NULL'),
  ('attendance_adjustment_items', 'request_id', 'attendance_adjustment_requests', 'CASCADE'),
  ('attendance_adjustment_requests', 'approved_by', 'users', 'SET NULL'),
  ('attendance_adjustment_requests', 'attachment_file_id', 'files', 'SET NULL'),
  ('attendance_adjustment_requests', 'attendance_record_id', 'attendance_records', 'SET NULL'),
  ('attendance_adjustment_requests', 'created_by', 'users', 'SET NULL'),
  ('attendance_adjustment_requests', 'current_approver_employee_id', 'employee_profiles', 'SET NULL'),
  ('attendance_adjustment_requests', 'current_approver_user_id', 'users', 'SET NULL'),
  ('attendance_adjustment_requests', 'deleted_by', 'users', 'SET NULL'),
  ('attendance_adjustment_requests', 'employee_id', 'employee_profiles', 'SET NULL'),
  ('attendance_adjustment_requests', 'requested_by', 'users', 'SET NULL'),
  ('attendance_adjustment_requests', 'reviewed_by', 'users', 'SET NULL'),
  ('attendance_adjustment_requests', 'task_id', 'tasks', 'SET NULL'),
  ('attendance_adjustment_requests', 'updated_by', 'users', 'SET NULL'),
  ('attendance_adjustment_requests', 'user_id', 'users', 'CASCADE'),
  ('attendance_logs', 'attendance_record_id', 'attendance_records', 'SET NULL'),
  ('attendance_logs', 'created_by', 'users', 'SET NULL'),
  ('attendance_logs', 'deleted_by', 'users', 'SET NULL'),
  ('attendance_logs', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('attendance_logs', 'photo_file_id', 'files', 'SET NULL'),
  ('attendance_logs', 'user_id', 'users', 'SET NULL'),
  ('attendance_periods', 'locked_by', 'users', 'SET NULL'),
  ('attendance_records', 'applied_rule_id', 'attendance_rules', 'SET NULL'),
  ('attendance_records', 'created_by', 'users', 'SET NULL'),
  ('attendance_records', 'deleted_by', 'users', 'SET NULL'),
  ('attendance_records', 'department_id', 'org_units', 'SET NULL'),
  ('attendance_records', 'employee_id', 'employee_profiles', 'SET NULL'),
  ('attendance_records', 'locked_by', 'users', 'SET NULL'),
  ('attendance_records', 'position_id', 'positions', 'SET NULL'),
  ('attendance_records', 'remote_work_request_id', 'remote_work_requests', 'SET NULL'),
  ('attendance_records', 'shift_id', 'shifts', 'SET NULL'),
  ('attendance_records', 'updated_by', 'users', 'SET NULL'),
  ('attendance_records', 'user_id', 'users', 'CASCADE'),
  ('attendance_records', 'work_schedule_id', 'work_schedules', 'SET NULL'),
  ('attendance_rules', 'created_by', 'users', 'SET NULL'),
  ('attendance_rules', 'deleted_by', 'users', 'SET NULL'),
  ('attendance_rules', 'department_id', 'org_units', 'SET NULL'),
  ('attendance_rules', 'employee_id', 'employee_profiles', 'SET NULL'),
  ('attendance_rules', 'updated_by', 'users', 'SET NULL'),
  ('audit_logs', 'actor_user_id', 'users', 'NO ACTION'),
  ('bonus_penalties', 'approved_by', 'users', 'RESTRICT'),
  ('bonus_penalties', 'created_by', 'users', 'NO ACTION'),
  ('bonus_penalties', 'defect_id', 'defects', 'RESTRICT'),
  ('bonus_penalties', 'kpi_result_id', 'kpi_results', 'RESTRICT'),
  ('bonus_penalties', 'payroll_period_id', 'payroll_periods', 'SET NULL'),
  ('bonus_penalties', 'task_id', 'tasks', 'RESTRICT'),
  ('bonus_penalties', 'user_id', 'users', 'NO ACTION'),
  ('break_glass_approvals', 'approver_user_id', 'users', 'NO ACTION'),
  ('break_glass_approvals', 'grant_id', 'break_glass_grants', 'CASCADE'),
  ('break_glass_approvals', 'requester_user_id', 'users', 'NO ACTION'),
  ('break_glass_grants', 'platform_account_id', 'platform_accounts', 'CASCADE'),
  ('break_glass_grants', 'requester_user_id', 'users', 'NO ACTION'),
  ('break_glass_grants', 'revoked_by', 'users', 'NO ACTION'),
  ('channel_accounts', 'channel_id', 'channels', 'CASCADE'),
  ('channel_accounts', 'platform_account_id', 'platform_accounts', 'CASCADE'),
  ('channel_members', 'channel_id', 'channels', 'CASCADE'),
  ('channel_members', 'user_id', 'users', 'CASCADE'),
  ('channels', 'channel_manager_id', 'users', 'SET NULL'),
  ('channels', 'primary_team_id', 'teams', 'SET NULL'),
  ('chat_messages', 'pinned_by', 'users', 'SET NULL'),
  ('chat_messages', 'room_id', 'chat_rooms', 'CASCADE'),
  ('chat_messages', 'sender_id', 'users', 'CASCADE'),
  ('chat_room_members', 'room_id', 'chat_rooms', 'CASCADE'),
  ('chat_room_members', 'user_id', 'users', 'CASCADE'),
  ('chat_rooms', 'channel_id', 'channels', 'SET NULL'),
  ('chat_rooms', 'created_by', 'users', 'SET NULL'),
  ('chat_rooms', 'org_unit_id', 'org_units', 'SET NULL'),
  ('chat_rooms', 'ref_id', 'projects', 'SET NULL'),
  ('checklist_items', 'checklist_id', 'checklists', 'CASCADE'),
  ('checklists', 'workflow_definition_step_id', 'workflow_definition_steps', 'SET NULL'),
  ('company_settings', 'created_by', 'users', 'SET NULL'),
  ('company_settings', 'deleted_by', 'users', 'SET NULL'),
  ('company_settings', 'updated_by', 'users', 'SET NULL'),
  ('content_assets', 'content_item_id', 'content_items', 'CASCADE'),
  ('content_assets', 'parent_asset_id', 'content_assets', 'SET NULL'),
  ('content_assets', 'superseded_by', 'content_assets', 'SET NULL'),
  ('content_assets', 'uploaded_by', 'users', 'SET NULL'),
  ('content_channels', 'channel_id', 'channels', 'CASCADE'),
  ('content_channels', 'content_item_id', 'content_items', 'CASCADE'),
  ('content_items', 'content_type_id', 'content_types', 'SET NULL'),
  ('content_items', 'main_channel_id', 'channels', 'SET NULL'),
  ('content_items', 'owner_user_id', 'users', 'SET NULL'),
  ('content_items', 'project_id', 'projects', 'CASCADE'),
  ('cost_allocations', 'cost_record_id', 'cost_records', 'CASCADE'),
  ('cost_records', 'channel_id', 'channels', 'SET NULL'),
  ('cost_records', 'content_item_id', 'content_items', 'SET NULL'),
  ('cost_records', 'entered_by', 'users', 'NO ACTION'),
  ('cost_records', 'expense_request_id', 'expense_requests', 'SET NULL'),
  ('cost_records', 'org_unit_id', 'org_units', 'SET NULL'),
  ('cost_records', 'project_id', 'projects', 'SET NULL'),
  ('cost_records', 'replaces_record_id', 'cost_records', 'NO ACTION'),
  ('cost_records', 'team_id', 'teams', 'SET NULL'),
  ('cost_records', 'user_id', 'users', 'SET NULL'),
  ('dashboard_widget_cache', 'deleted_by', 'users', 'SET NULL'),
  ('dashboard_widget_cache', 'user_id', 'users', 'CASCADE'),
  ('dashboard_widget_configs', 'created_by', 'users', 'SET NULL'),
  ('dashboard_widget_configs', 'deleted_by', 'users', 'SET NULL'),
  ('dashboard_widget_configs', 'updated_by', 'users', 'SET NULL'),
  ('dashboard_widget_configs', 'user_id', 'users', 'CASCADE'),
  ('dashboard_widgets', 'created_by', 'users', 'SET NULL'),
  ('dashboard_widgets', 'deleted_by', 'users', 'SET NULL'),
  ('dashboard_widgets', 'updated_by', 'users', 'SET NULL'),
  ('data_retention_policies', 'created_by', 'users', 'SET NULL'),
  ('data_retention_policies', 'deleted_by', 'users', 'SET NULL'),
  ('data_retention_policies', 'updated_by', 'users', 'SET NULL'),
  ('dead_letter_events', 'event_id', 'outbox_events', 'NO ACTION'),
  ('defects', 'caused_by_approval_step_id', 'approval_steps', 'SET NULL'),
  ('defects', 'responsible_user_id', 'users', 'SET NULL'),
  ('defects', 'revision_task_id', 'tasks', 'SET NULL'),
  ('defects', 'workflow_step_id', 'workflow_steps', 'CASCADE'),
  ('device_tokens', 'user_id', 'users', 'NO ACTION'),
  ('employee_contracts', 'contract_type_id', 'contract_types', 'NO ACTION'),
  ('employee_contracts', 'created_by', 'users', 'SET NULL'),
  ('employee_contracts', 'deleted_by', 'users', 'SET NULL'),
  ('employee_contracts', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('employee_contracts', 'file_id', 'files', 'SET NULL'),
  ('employee_contracts', 'updated_by', 'users', 'SET NULL'),
  ('employee_manager_relations', 'employee_user_id', 'users', 'CASCADE'),
  ('employee_manager_relations', 'manager_user_id', 'users', 'CASCADE'),
  ('employee_profile_change_histories', 'changed_by', 'users', 'SET NULL'),
  ('employee_profile_change_histories', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('employee_profile_change_histories', 'request_id', 'profile_change_requests', 'SET NULL'),
  ('employee_profiles', 'contract_type_id', 'contract_types', 'SET NULL'),
  ('employee_profiles', 'direct_manager_id', 'users', 'SET NULL'),
  ('employee_profiles', 'job_level_id', 'job_levels', 'SET NULL'),
  ('employee_profiles', 'org_unit_id', 'org_units', 'SET NULL'),
  ('employee_profiles', 'position_id', 'positions', 'SET NULL'),
  ('employee_profiles', 'user_id', 'users', 'CASCADE'),
  ('employee_profiles', 'work_schedule_id', 'work_schedules', 'SET NULL'),
  ('employee_status_histories', 'changed_by', 'users', 'SET NULL'),
  ('employee_status_histories', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('evaluation_criteria', 'template_id', 'evaluation_templates', 'CASCADE'),
  ('evaluation_results', 'evaluator_user_id', 'users', 'NO ACTION'),
  ('evaluation_results', 'subject_user_id', 'users', 'NO ACTION'),
  ('evaluation_results', 'template_id', 'evaluation_templates', 'CASCADE'),
  ('evaluation_results', 'workflow_step_id', 'workflow_steps', 'CASCADE'),
  ('evaluation_scores', 'criteria_id', 'evaluation_criteria', 'CASCADE'),
  ('evaluation_scores', 'result_id', 'evaluation_results', 'CASCADE'),
  ('expense_approvals', 'approver_user_id', 'users', 'NO ACTION'),
  ('expense_approvals', 'expense_request_id', 'expense_requests', 'CASCADE'),
  ('expense_requests', 'channel_id', 'channels', 'SET NULL'),
  ('expense_requests', 'cost_record_id', 'cost_records', 'SET NULL'),
  ('expense_requests', 'org_unit_id', 'org_units', 'SET NULL'),
  ('expense_requests', 'project_id', 'projects', 'SET NULL'),
  ('expense_requests', 'requested_by', 'users', 'NO ACTION'),
  ('expense_requests', 'task_id', 'tasks', 'SET NULL'),
  ('file_access_logs', 'actor_user_id', 'users', 'SET NULL'),
  ('file_access_logs', 'file_id', 'files', 'CASCADE'),
  ('file_access_logs', 'file_link_id', 'file_links', 'SET NULL'),
  ('file_links', 'created_by', 'users', 'RESTRICT'),
  ('file_links', 'deleted_by', 'users', 'SET NULL'),
  ('file_links', 'file_id', 'files', 'CASCADE'),
  ('files', 'deleted_by', 'users', 'SET NULL'),
  ('files', 'owner_user_id', 'users', 'SET NULL'),
  ('files', 'uploaded_by', 'users', 'RESTRICT'),
  ('goal_updates', 'actor_user_id', 'users', 'CASCADE'),
  ('goal_updates', 'goal_id', 'goals', 'CASCADE'),
  ('goals', 'created_by', 'users', 'SET NULL'),
  ('goals', 'deleted_by', 'users', 'SET NULL'),
  ('goals', 'department_id', 'org_units', 'CASCADE'),
  ('goals', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('goals', 'finalized_by', 'users', 'SET NULL'),
  ('goals', 'owner_employee_id', 'employee_profiles', 'CASCADE'),
  ('goals', 'parent_goal_id', 'goals', 'SET NULL'),
  ('goals', 'project_id', 'projects', 'CASCADE'),
  ('goals', 'updated_by', 'users', 'SET NULL'),
  ('kpi_results', 'computed_by', 'users', 'NO ACTION'),
  ('kpi_results', 'confirmed_by', 'users', 'NO ACTION'),
  ('kpi_results', 'definition_id', 'kpi_definitions', 'CASCADE'),
  ('kpi_results', 'subject_team_id', 'teams', 'NO ACTION'),
  ('kpi_results', 'subject_user_id', 'users', 'NO ACTION'),
  ('labels', 'created_by', 'users', 'SET NULL'),
  ('labels', 'project_id', 'projects', 'CASCADE'),
  ('leave_balance_transactions', 'created_by', 'users', 'SET NULL'),
  ('leave_balance_transactions', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('leave_balance_transactions', 'leave_balance_id', 'leave_balances', 'CASCADE'),
  ('leave_balance_transactions', 'leave_request_id', 'leave_requests', 'SET NULL'),
  ('leave_balance_transactions', 'leave_type_id', 'leave_types', 'CASCADE'),
  ('leave_balances', 'created_by', 'users', 'SET NULL'),
  ('leave_balances', 'deleted_by', 'users', 'SET NULL'),
  ('leave_balances', 'employee_id', 'employee_profiles', 'SET NULL'),
  ('leave_balances', 'leave_type_id', 'leave_types', 'CASCADE'),
  ('leave_balances', 'updated_by', 'users', 'SET NULL'),
  ('leave_balances', 'user_id', 'users', 'CASCADE'),
  ('leave_policies', 'contract_type_id', 'contract_types', 'SET NULL'),
  ('leave_policies', 'created_by', 'users', 'SET NULL'),
  ('leave_policies', 'deleted_by', 'users', 'SET NULL'),
  ('leave_policies', 'department_id', 'org_units', 'SET NULL'),
  ('leave_policies', 'employee_id', 'employee_profiles', 'SET NULL'),
  ('leave_policies', 'job_level_id', 'job_levels', 'SET NULL'),
  ('leave_policies', 'leave_type_id', 'leave_types', 'CASCADE'),
  ('leave_policies', 'updated_by', 'users', 'SET NULL'),
  ('leave_request_approvals', 'approver_employee_id', 'employee_profiles', 'SET NULL'),
  ('leave_request_approvals', 'approver_user_id', 'users', 'SET NULL'),
  ('leave_request_approvals', 'leave_request_id', 'leave_requests', 'CASCADE'),
  ('leave_request_days', 'attendance_record_id', 'attendance_records', 'SET NULL'),
  ('leave_request_days', 'created_by', 'users', 'SET NULL'),
  ('leave_request_days', 'deleted_by', 'users', 'SET NULL'),
  ('leave_request_days', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('leave_request_days', 'leave_request_id', 'leave_requests', 'CASCADE'),
  ('leave_request_days', 'leave_type_id', 'leave_types', 'CASCADE'),
  ('leave_request_days', 'shift_id', 'shifts', 'SET NULL'),
  ('leave_request_days', 'updated_by', 'users', 'SET NULL'),
  ('leave_requests', 'approved_by', 'users', 'SET NULL'),
  ('leave_requests', 'cancelled_by', 'users', 'SET NULL'),
  ('leave_requests', 'created_by', 'users', 'SET NULL'),
  ('leave_requests', 'current_approver_employee_id', 'employee_profiles', 'SET NULL'),
  ('leave_requests', 'current_approver_user_id', 'users', 'SET NULL'),
  ('leave_requests', 'deleted_by', 'users', 'SET NULL'),
  ('leave_requests', 'department_id', 'org_units', 'SET NULL'),
  ('leave_requests', 'direct_manager_employee_id', 'employee_profiles', 'SET NULL'),
  ('leave_requests', 'employee_id', 'employee_profiles', 'SET NULL'),
  ('leave_requests', 'leave_policy_id', 'leave_policies', 'SET NULL'),
  ('leave_requests', 'leave_type_id', 'leave_types', 'RESTRICT'),
  ('leave_requests', 'position_id', 'positions', 'SET NULL'),
  ('leave_requests', 'rejected_by', 'users', 'SET NULL'),
  ('leave_requests', 'revoked_by', 'users', 'SET NULL'),
  ('leave_requests', 'submitted_by', 'users', 'SET NULL'),
  ('leave_requests', 'task_id', 'tasks', 'SET NULL'),
  ('leave_requests', 'updated_by', 'users', 'SET NULL'),
  ('leave_requests', 'user_id', 'users', 'CASCADE'),
  ('leave_types', 'created_by', 'users', 'SET NULL'),
  ('leave_types', 'deleted_by', 'users', 'SET NULL'),
  ('leave_types', 'updated_by', 'users', 'SET NULL'),
  ('login_logs', 'session_id', 'user_sessions', 'SET NULL'),
  ('login_logs', 'user_id', 'users', 'SET NULL'),
  ('meeting_attendees', 'meeting_id', 'meetings', 'CASCADE'),
  ('meeting_attendees', 'user_id', 'users', 'CASCADE'),
  ('meeting_notes', 'author_user_id', 'users', 'CASCADE'),
  ('meeting_notes', 'meeting_id', 'meetings', 'CASCADE'),
  ('meeting_rooms', 'created_by', 'users', 'SET NULL'),
  ('meeting_tasks', 'meeting_id', 'meetings', 'CASCADE'),
  ('meeting_tasks', 'task_id', 'tasks', 'CASCADE'),
  ('meetings', 'meeting_room_id', 'meeting_rooms', 'SET NULL'),
  ('meetings', 'organizer_id', 'users', 'CASCADE'),
  ('notification_delivery_logs', 'notification_id', 'notifications', 'CASCADE'),
  ('notification_delivery_logs', 'recipient_user_id', 'users', 'CASCADE'),
  ('notification_events', 'created_by', 'users', 'SET NULL'),
  ('notification_events', 'deleted_by', 'users', 'SET NULL'),
  ('notification_events', 'updated_by', 'users', 'SET NULL'),
  ('notification_preferences', 'user_id', 'users', 'CASCADE'),
  ('notification_rules', 'created_by', 'users', 'SET NULL'),
  ('notification_templates', 'created_by', 'users', 'SET NULL'),
  ('notification_templates', 'deleted_by', 'users', 'SET NULL'),
  ('notification_templates', 'updated_by', 'users', 'SET NULL'),
  ('notifications', 'created_by', 'users', 'SET NULL'),
  ('notifications', 'deleted_by', 'users', 'SET NULL'),
  ('notifications', 'recipient_employee_id', 'employee_profiles', 'SET NULL'),
  ('notifications', 'recipient_user_id', 'users', 'CASCADE'),
  ('notifications', 'updated_by', 'users', 'SET NULL'),
  ('notifications', 'user_id', 'users', 'CASCADE'),
  ('object_permissions', 'granted_by', 'users', 'NO ACTION'),
  ('org_units', 'head_user_id', 'users', 'SET NULL'),
  ('org_units', 'parent_id', 'org_units', 'SET NULL'),
  ('password_reset_tokens', 'user_id', 'users', 'NO ACTION'),
  ('payroll_periods', 'approved_by', 'users', 'SET NULL'),
  ('payroll_periods', 'attendance_period_id', 'attendance_periods', 'SET NULL'),
  ('payroll_periods', 'created_by', 'users', 'SET NULL'),
  ('payroll_periods', 'published_by', 'users', 'SET NULL'),
  ('payslip_acknowledgements', 'payslip_id', 'payslips', 'NO ACTION'),
  ('payslip_acknowledgements', 'resolved_by', 'users', 'SET NULL'),
  ('payslip_acknowledgements', 'user_id', 'users', 'NO ACTION'),
  ('payslip_items', 'payslip_id', 'payslips', 'CASCADE'),
  ('payslips', 'created_by', 'users', 'NO ACTION'),
  ('payslips', 'payroll_period_id', 'payroll_periods', 'NO ACTION'),
  ('payslips', 'replaces_payslip_id', 'payslips', 'NO ACTION'),
  ('payslips', 'salary_profile_id', 'salary_profiles', 'NO ACTION'),
  ('payslips', 'user_id', 'users', 'NO ACTION'),
  ('platform_accounts', 'owner_user_id', 'users', 'SET NULL'),
  ('positions', 'org_unit_id', 'org_units', 'SET NULL'),
  ('profile_change_requests', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('profile_change_requests', 'requested_by', 'users', 'CASCADE'),
  ('profile_change_requests', 'reviewed_by', 'users', 'SET NULL'),
  ('profit_snapshots', 'created_by', 'users', 'SET NULL'),
  ('project_channels', 'channel_id', 'channels', 'CASCADE'),
  ('project_channels', 'project_id', 'projects', 'CASCADE'),
  ('project_members', 'created_by', 'users', 'SET NULL'),
  ('project_members', 'deleted_by', 'users', 'SET NULL'),
  ('project_members', 'employee_id', 'employee_profiles', 'SET NULL'),
  ('project_members', 'invited_by', 'users', 'SET NULL'),
  ('project_members', 'project_id', 'projects', 'CASCADE'),
  ('project_members', 'removed_by', 'users', 'SET NULL'),
  ('project_members', 'updated_by', 'users', 'SET NULL'),
  ('project_members', 'user_id', 'users', 'CASCADE'),
  ('project_states', 'project_id', 'projects', 'CASCADE'),
  ('project_teams', 'project_id', 'projects', 'CASCADE'),
  ('project_teams', 'team_id', 'teams', 'CASCADE'),
  ('projects', 'archived_by', 'users', 'SET NULL'),
  ('projects', 'cancelled_by', 'users', 'SET NULL'),
  ('projects', 'closed_by', 'users', 'SET NULL'),
  ('projects', 'created_by', 'users', 'SET NULL'),
  ('projects', 'deleted_by', 'users', 'SET NULL'),
  ('projects', 'department_id', 'org_units', 'SET NULL'),
  ('projects', 'org_unit_id', 'org_units', 'SET NULL'),
  ('projects', 'owner_employee_id', 'employee_profiles', 'SET NULL'),
  ('projects', 'owner_user_id', 'users', 'SET NULL'),
  ('projects', 'project_manager_id', 'users', 'SET NULL'),
  ('projects', 'updated_by', 'users', 'SET NULL'),
  ('public_holidays', 'created_by', 'users', 'SET NULL'),
  ('public_holidays', 'deleted_by', 'users', 'SET NULL'),
  ('public_holidays', 'updated_by', 'users', 'SET NULL'),
  ('refresh_tokens', 'replaced_by', 'refresh_tokens', 'NO ACTION'),
  ('refresh_tokens', 'user_id', 'users', 'NO ACTION'),
  ('remote_work_request_approvals', 'approver_employee_id', 'employee_profiles', 'SET NULL'),
  ('remote_work_request_approvals', 'approver_user_id', 'users', 'SET NULL'),
  ('remote_work_request_approvals', 'remote_work_request_id', 'remote_work_requests', 'CASCADE'),
  ('remote_work_requests', 'approved_by', 'users', 'SET NULL'),
  ('remote_work_requests', 'attachment_file_id', 'files', 'SET NULL'),
  ('remote_work_requests', 'cancelled_by', 'users', 'SET NULL'),
  ('remote_work_requests', 'created_by', 'users', 'SET NULL'),
  ('remote_work_requests', 'current_approver_employee_id', 'employee_profiles', 'SET NULL'),
  ('remote_work_requests', 'current_approver_user_id', 'users', 'SET NULL'),
  ('remote_work_requests', 'deleted_by', 'users', 'SET NULL'),
  ('remote_work_requests', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('remote_work_requests', 'rejected_by', 'users', 'SET NULL'),
  ('remote_work_requests', 'requested_by', 'users', 'CASCADE'),
  ('remote_work_requests', 'updated_by', 'users', 'SET NULL'),
  ('revenue_records', 'channel_id', 'channels', 'SET NULL'),
  ('revenue_records', 'content_item_id', 'content_items', 'SET NULL'),
  ('revenue_records', 'entered_by', 'users', 'NO ACTION'),
  ('revenue_records', 'project_id', 'projects', 'SET NULL'),
  ('revenue_records', 'replaces_record_id', 'revenue_records', 'NO ACTION'),
  ('salary_profiles', 'user_id', 'users', 'CASCADE'),
  ('security_alerts', 'subject_user_id', 'users', 'NO ACTION'),
  ('seed_batches', 'executed_by', 'users', 'SET NULL'),
  ('sequence_counters', 'created_by', 'users', 'SET NULL'),
  ('sequence_counters', 'deleted_by', 'users', 'SET NULL'),
  ('sequence_counters', 'updated_by', 'users', 'SET NULL'),
  ('shift_assignments', 'created_by', 'users', 'SET NULL'),
  ('shift_assignments', 'deleted_by', 'users', 'SET NULL'),
  ('shift_assignments', 'department_id', 'org_units', 'SET NULL'),
  ('shift_assignments', 'employee_id', 'employee_profiles', 'SET NULL'),
  ('shift_assignments', 'shift_id', 'shifts', 'CASCADE'),
  ('shift_assignments', 'updated_by', 'users', 'SET NULL'),
  ('shifts', 'created_by', 'users', 'SET NULL'),
  ('shifts', 'deleted_by', 'users', 'SET NULL'),
  ('shifts', 'updated_by', 'users', 'SET NULL'),
  ('step_transitions', 'workflow_definition_id', 'workflow_definitions', 'CASCADE'),
  ('system_job_runs', 'triggered_by_user_id', 'users', 'SET NULL'),
  ('task_activity_logs', 'actor_employee_id', 'employee_profiles', 'SET NULL'),
  ('task_activity_logs', 'actor_user_id', 'users', 'SET NULL'),
  ('task_activity_logs', 'project_id', 'projects', 'SET NULL'),
  ('task_activity_logs', 'task_id', 'tasks', 'SET NULL'),
  ('task_assignees', 'assigned_by', 'users', 'SET NULL'),
  ('task_assignees', 'created_by', 'users', 'SET NULL'),
  ('task_assignees', 'deleted_by', 'users', 'SET NULL'),
  ('task_assignees', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('task_assignees', 'removed_by', 'users', 'SET NULL'),
  ('task_assignees', 'task_id', 'tasks', 'CASCADE'),
  ('task_assignees', 'updated_by', 'users', 'SET NULL'),
  ('task_attachments', 'task_id', 'tasks', 'CASCADE'),
  ('task_attachments', 'uploaded_by', 'users', 'SET NULL'),
  ('task_checklist_items', 'checklist_id', 'task_checklists', 'CASCADE'),
  ('task_checklist_items', 'created_by', 'users', 'SET NULL'),
  ('task_checklist_items', 'deleted_by', 'users', 'SET NULL'),
  ('task_checklist_items', 'done_by', 'users', 'SET NULL'),
  ('task_checklist_items', 'done_by_employee_id', 'employee_profiles', 'SET NULL'),
  ('task_checklist_items', 'task_id', 'tasks', 'CASCADE'),
  ('task_checklist_items', 'updated_by', 'users', 'SET NULL'),
  ('task_checklists', 'created_by', 'users', 'SET NULL'),
  ('task_checklists', 'deleted_by', 'users', 'SET NULL'),
  ('task_checklists', 'task_id', 'tasks', 'CASCADE'),
  ('task_checklists', 'updated_by', 'users', 'SET NULL'),
  ('task_comments', 'created_by', 'users', 'SET NULL'),
  ('task_comments', 'deleted_by', 'users', 'SET NULL'),
  ('task_comments', 'task_id', 'tasks', 'CASCADE'),
  ('task_comments', 'user_id', 'users', 'CASCADE'),
  ('task_labels', 'label_id', 'labels', 'CASCADE'),
  ('task_labels', 'task_id', 'tasks', 'CASCADE'),
  ('task_template_items', 'created_by', 'users', 'SET NULL'),
  ('task_template_items', 'deleted_by', 'users', 'SET NULL'),
  ('task_template_items', 'template_id', 'task_templates', 'CASCADE'),
  ('task_template_items', 'updated_by', 'users', 'SET NULL'),
  ('task_templates', 'created_by', 'users', 'SET NULL'),
  ('task_templates', 'deleted_by', 'users', 'SET NULL'),
  ('task_templates', 'department_id', 'org_units', 'SET NULL'),
  ('task_templates', 'updated_by', 'users', 'SET NULL'),
  ('task_watchers', 'added_by', 'users', 'SET NULL'),
  ('task_watchers', 'created_by', 'users', 'SET NULL'),
  ('task_watchers', 'deleted_by', 'users', 'SET NULL'),
  ('task_watchers', 'employee_id', 'employee_profiles', 'CASCADE'),
  ('task_watchers', 'removed_by', 'users', 'SET NULL'),
  ('task_watchers', 'task_id', 'tasks', 'CASCADE'),
  ('task_watchers', 'updated_by', 'users', 'SET NULL'),
  ('tasks', 'assignee_user_id', 'users', 'SET NULL'),
  ('tasks', 'cancelled_by', 'users', 'SET NULL'),
  ('tasks', 'completed_by', 'users', 'SET NULL'),
  ('tasks', 'content_item_id', 'content_items', 'SET NULL'),
  ('tasks', 'created_by', 'users', 'SET NULL'),
  ('tasks', 'creator_user_id', 'users', 'SET NULL'),
  ('tasks', 'deleted_by', 'users', 'SET NULL'),
  ('tasks', 'department_id', 'org_units', 'SET NULL'),
  ('tasks', 'goal_id', 'goals', 'SET NULL'),
  ('tasks', 'main_assignee_employee_id', 'employee_profiles', 'SET NULL'),
  ('tasks', 'project_id', 'projects', 'SET NULL'),
  ('tasks', 'reporter_employee_id', 'employee_profiles', 'SET NULL'),
  ('tasks', 'state_id', 'project_states', 'SET NULL'),
  ('tasks', 'updated_by', 'users', 'SET NULL'),
  ('tasks', 'workflow_instance_id', 'workflow_instances', 'SET NULL'),
  ('tasks', 'workflow_step_id', 'workflow_steps', 'SET NULL'),
  ('teams', 'leader_user_id', 'users', 'SET NULL'),
  ('teams', 'org_unit_id', 'org_units', 'SET NULL'),
  ('user_preferences', 'created_by', 'users', 'SET NULL'),
  ('user_preferences', 'updated_by', 'users', 'SET NULL'),
  ('user_preferences', 'user_id', 'users', 'CASCADE'),
  ('user_recovery_codes', 'user_id', 'users', 'NO ACTION'),
  ('user_roles', 'deleted_by', 'users', 'SET NULL'),
  ('user_roles', 'granted_by', 'users', 'NO ACTION'),
  ('user_roles', 'user_id', 'users', 'CASCADE'),
  ('user_security_events', 'actor_user_id', 'users', 'SET NULL'),
  ('user_security_events', 'user_id', 'users', 'NO ACTION'),
  ('user_sessions', 'revoked_by', 'users', 'SET NULL'),
  ('user_sessions', 'user_id', 'users', 'NO ACTION'),
  ('user_totp', 'user_id', 'users', 'NO ACTION'),
  ('users', 'created_by', 'users', 'SET NULL'),
  ('users', 'deleted_by', 'users', 'SET NULL'),
  ('users', 'updated_by', 'users', 'SET NULL'),
  ('webhook_deliveries', 'endpoint_id', 'webhook_endpoints', 'CASCADE'),
  ('webhook_event_subscriptions', 'endpoint_id', 'webhook_endpoints', 'CASCADE'),
  ('workflow_definition_steps', 'default_checklist_id', 'checklists', 'SET NULL'),
  ('workflow_definition_steps', 'workflow_definition_id', 'workflow_definitions', 'CASCADE'),
  ('workflow_definitions', 'created_by', 'users', 'SET NULL'),
  ('workflow_instances', 'content_item_id', 'content_items', 'CASCADE'),
  ('workflow_instances', 'created_by', 'users', 'SET NULL'),
  ('workflow_instances', 'project_id', 'projects', 'CASCADE'),
  ('workflow_instances', 'workflow_definition_id', 'workflow_definitions', 'NO ACTION'),
  ('workflow_step_checklist_states', 'checked_by', 'users', 'SET NULL'),
  ('workflow_step_checklist_states', 'checklist_item_id', 'checklist_items', 'CASCADE'),
  ('workflow_step_checklist_states', 'workflow_step_id', 'workflow_steps', 'CASCADE'),
  ('workflow_step_dependencies', 'from_step_id', 'workflow_definition_steps', 'CASCADE'),
  ('workflow_step_dependencies', 'to_step_id', 'workflow_definition_steps', 'CASCADE'),
  ('workflow_step_dependencies', 'workflow_definition_id', 'workflow_definitions', 'CASCADE'),
  ('workflow_step_instance_locks', 'caused_by_step_id', 'workflow_steps', 'CASCADE'),
  ('workflow_step_instance_locks', 'locked_step_id', 'workflow_steps', 'CASCADE'),
  ('workflow_steps', 'assignee_user_id', 'users', 'SET NULL'),
  ('workflow_steps', 'reviewer_user_id', 'users', 'SET NULL'),
  ('workflow_steps', 'workflow_instance_id', 'workflow_instances', 'CASCADE');

-- (0) TIỀN KIỂM — KHÔNG dọn dẹp. Đếm hàng ĐANG lệch tenant đúng ngữ nghĩa MATCH SIMPLE (bỏ qua hàng
--     có NULL, vì ADD CONSTRAINT cũng bỏ qua). > 0 ⇒ DỪNG kèm danh sách, để người quyết xoá hay sửa.
DO $preflight$
DECLARE r record; n bigint; total bigint := 0; msg text := ''; npairs int;
BEGIN
  -- CHỐNG HỎNG-IM-LẶNG. `CREATE TEMP TABLE … ON COMMIT DROP` chỉ sống trong transaction. Qua drizzle
  -- migrator (một transaction) thì đúng; nhưng nếu ai áp file bằng `psql -f` KHÔNG có `-1`, temp table
  -- biến mất sau câu đầu ⇒ cả ba khối DO lặp trên 0 dòng và migration "thành công" với 0 constraint.
  -- RAISE NOTICE không phải cổng — assert cứng mới là.
  SELECT count(*) INTO npairs FROM xtfk_pairs;
  IF npairs <> 446 THEN
    RAISE EXCEPTION '0535 DỪNG — danh sách cặp có % dòng, phải là 446. Nếu chạy bằng psql thì dùng "psql -1 -f" (một transaction), vì temp table ON COMMIT DROP biến mất giữa các câu.', npairs;
  END IF;

  FOR r IN SELECT * FROM xtfk_pairs ORDER BY src, col LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I s JOIN %I t ON s.%I = t.id
        WHERE s.company_id IS NOT NULL AND s.%I IS NOT NULL AND s.company_id <> t.company_id',
      r.src, r.tgt, r.col, r.col
    ) INTO n;
    IF n > 0 THEN
      total := total + n;
      msg := msg || format(E'\n    %s.%s -> %s : %s hàng', r.src, r.col, r.tgt, n);
    END IF;
  END LOOP;
  IF total > 0 THEN
    RAISE EXCEPTION E'0535 DỪNG — % hàng lệch tenant đã tồn tại, phải có người quyết (KHÔNG tự xoá, BẤT BIẾN #2):%\n  Sau khi xử lý, chạy lại migration (idempotent).', total, msg;
  END IF;
  RAISE NOTICE '0535 (0) tiền kiểm: 0 hàng lệch tenant trên % cặp', (SELECT count(*) FROM xtfk_pairs);
END $preflight$;

-- (1) Đích của composite FK phải có UNIQUE tương ứng. `id` đã là PK ⇒ (company_id, id) unique một
--     cách tầm thường; constraint này chỉ để Postgres CHẤP NHẬN nó làm đích tham chiếu.
--     63 bảng đích lớp T (3 bảng đã có sẵn từ mig 0503/0533 ⇒ bỏ qua).
DO $uq$
DECLARE t text; n int := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'api_keys',
    'approval_requests',
    'approval_steps',
    'attendance_adjustment_requests',
    'attendance_periods',
    'attendance_records',
    'attendance_rules',
    'break_glass_grants',
    'channels',
    'chat_rooms',
    'checklist_items',
    'checklists',
    'content_assets',
    'content_items',
    'content_types',
    'contract_types',
    'cost_records',
    'defects',
    'employee_profiles',
    'evaluation_criteria',
    'evaluation_results',
    'evaluation_templates',
    'expense_requests',
    'file_links',
    'files',
    'goals',
    'job_levels',
    'kpi_definitions',
    'kpi_results',
    'labels',
    'leave_balances',
    'leave_policies',
    'leave_requests',
    'leave_types',
    'meeting_rooms',
    'meetings',
    'notifications',
    'org_units',
    'outbox_events',
    'payroll_periods',
    'payslips',
    'platform_accounts',
    'positions',
    'profile_change_requests',
    'project_states',
    'projects',
    'refresh_tokens',
    'remote_work_requests',
    'revenue_records',
    'salary_profiles',
    'shifts',
    'task_checklists',
    'task_templates',
    'tasks',
    'teams',
    'user_sessions',
    'users',
    'webhook_endpoints',
    'work_schedules',
    'workflow_definition_steps',
    'workflow_definitions',
    'workflow_instances',
    'workflow_steps'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = t::regclass AND c.contype IN ('u', 'p')
         AND array_length(c.conkey, 1) = 2
         AND (SELECT count(*) FROM unnest(c.conkey) k
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
              WHERE a.attname IN ('company_id', 'id')) = 2
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (company_id, id)', t, t || '_company_id_id_uq');
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '0535 (1) unique (company_id, id): thêm % / % bảng đích', n, 63;
END $uq$;

-- (2) Composite FK. Guard kiểm theo CỘT nên chạy lại an toàn; tên vượt 63 byte dùng hậu tố `_cfk`
--     thay vì để Postgres âm thầm cắt cụt.
DO $fk$
DECLARE r record; n int := 0; cname text; act text;
BEGIN
  FOR r IN SELECT * FROM xtfk_pairs ORDER BY src, col LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.contype = 'f' AND c.conrelid = r.src::regclass AND c.confrelid = r.tgt::regclass
         AND array_length(c.conkey, 1) = 2
         AND (SELECT count(*) FROM unnest(c.conkey) k
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
              WHERE a.attname IN ('company_id', r.col)) = 2
    ) THEN
      cname := r.src || '_' || r.col || '_company_fk';
      IF length(cname) > 63 THEN cname := r.src || '_' || r.col || '_cfk'; END IF;
      -- SET NULL PHẢI kèm danh sách cột, nếu không Postgres null luôn company_id (xem header).
      act := CASE WHEN r.on_del = 'SET NULL' THEN format('SET NULL (%I)', r.col) ELSE r.on_del END;
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id, %I) REFERENCES %I (company_id, id) ON DELETE %s',
        r.src, cname, r.col, r.tgt, act
      );
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '0535 (2) composite FK: thêm % / % cặp', n, (SELECT count(*) FROM xtfk_pairs);
END $fk$;

-- (3) TRẢ `lock_timeout` VỀ MẶC ĐỊNH. `SET LOCAL` sống tới hết TRANSACTION, mà drizzle bọc TẤT CẢ
--     migration đang chờ trong MỘT transaction (`drizzle-orm/pg-core/dialect.js` → `session.transaction`).
--     Không trả lại thì mọi migration áp SAU 0535 trong cùng lượt chạy cũng thừa hưởng timeout 5s và có
--     thể chết oan vì một khoá chậm không liên quan. (security-reviewer FULL gate 2026-07-31, MEDIUM.)
SET LOCAL lock_timeout = DEFAULT;
