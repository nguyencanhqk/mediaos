# ERD — Thiết kế DB hiện tại (theo `docs/DB`) — MediaOS

> **Nguồn sự thật = bộ thiết kế `docs/DB/DB-01…10`** (gold-standard). Đây là **thiết kế CHUẨN** cho 7 module MVP + Foundation: AUTH · HR · ATT · LEAVE · TASK · DASH · NOTI. Tài liệu này tổng hợp ERD + bảng/cột/quan hệ cấp trên; field/constraint chi tiết từng module: xem DB-02…08.
> ⚠️ **Code hiện thực hoá đang LỆCH & LẪN bảng hướng cũ** (media/finance/payroll…). Phần đối chiếu code↔thiết kế: **[§Phụ lục A](#phụ-lục-a--trạng-thái-hiện-thực-hoá-code--thiết-kế)**. Liệt kê bảng thật trong DB (gồm parked): xem lịch sử git của file này hoặc đọc thẳng `apps/api/src/db/schema/`.
> **Cập nhật:** 2026-06-26.

## Bất biến DB (DECISIONS-02 §2–3)

1. Mọi bảng có `company_id` PHẢI bật **RLS + FORCE** (BẤT BIẾN #1) — cô lập tenant ở tầng DB.
2. `audit_logs` (và bảng snapshot) **append-only**: app role REVOKE UPDATE/DELETE (BẤT BIẾN #2).
3. Secret/mật khẩu **hash/encrypt**, không plaintext (BẤT BIẾN #3).
4. Audit/event ghi qua **outbox** trong cùng transaction nghiệp vụ.
5. **Soft-delete** (`deleted_at`/`deleted_by`) cho dữ liệu quan trọng — KHÔNG hard-delete.
6. **FK giữa hai bảng tenant phải là COMPOSITE** `(company_id, x) → parent(company_id, id)` — vì kiểm
   tra FK của Postgres **bỏ qua RLS theo thiết kế**, FK một-cột KHÔNG chặn được liên kết chéo tenant
   (KI-046). Quy ước đầy đủ + 3 bẫy (`SET NULL` phải kèm danh sách cột · giữ FK cũ · bảng catalog toàn
   cục thì KHÔNG vá): **DB-01 §6.3.1**. Hiện trạng sau mig `0535`: **446/446 cặp lớp tenant-thuần đã
   bịt · 11 cặp catalog toàn cục ký waiver** (`fk-tenant-verdicts.ts`, theo dõi ở KI-055). Chốt hồi
   quy chạy ở CI: `xtenant-fk-ratchet.int-spec.ts` + ca W4 của `tenant-isolation.int-spec.ts`.

## Quy ước

- PK = khoá chính (`id` UUID) · FK = khoá ngoại `{table_singular}_id` · UK = unique · 🔑 self-FK (cây/đệ quy) · 🔒 nhạy cảm (mask theo quyền) · 🗑️ soft-delete · 🔁 append-only.
- Bảng nghiệp vụ có **bộ cột audit chuẩn**: `created_at/created_by/updated_at/updated_by/deleted_at/deleted_by` (DB-01 §5.4) — bảng dưới chỉ ghi cột đặc thù, ngầm hiểu có audit cols.
- `company_id` trên hầu hết bảng nghiệp vụ (multi-tenant); bảng global (`permissions`, `modules`, `system_settings`) có thể không có hoặc nullable.
- Mã nghiệp vụ ở cột `code` (employee_code, project_code, permission_code…). Status = text + CHECK (DB-01 §6.5).

## Thống kê (thiết kế MVP)

| Nhóm | Bảng | Nhóm | Bảng |
| --- | --- | --- | --- |
| Foundation/System | 9 | LEAVE | 7 |
| AUTH/RBAC | 8 | TASK | 11 |
| HR | 11 | NOTI | 5 |
| ATT | 9 | DASH | 3 |
| | | **TỔNG** | **63 bảng MVP** |

---

## 0. ERD cấp cao — toàn hệ thống (DB-01 §16)

```mermaid
erDiagram
    companies ||--o{ users : has
    companies ||--o{ employees : has
    companies ||--o{ departments : has
    companies ||--o{ roles : has
    companies ||--o{ projects : has
    companies ||--o{ notifications : has

    users ||--o{ user_roles : assigned
    roles ||--o{ user_roles : contains
    roles ||--o{ role_permissions : grants
    permissions ||--o{ role_permissions : included

    users ||--o| employees : linked_to
    departments ||--o{ employees : contains
    positions ||--o{ employees : assigned
    job_levels ||--o{ employees : assigned
    employees ||--o{ employees : manages

    employees ||--o{ employee_contracts : has
    employees ||--o{ attendance_records : has
    employees ||--o{ leave_requests : submits
    employees ||--o{ project_members : joins
    employees ||--o{ tasks : assigned

    projects ||--o{ tasks : contains
    leave_types ||--o{ leave_requests : classifies
    leave_requests ||--o{ attendance_records : affects
    shifts ||--o{ attendance_records : applies
    attendance_records ||--o{ attendance_logs : has
    users ||--o{ notifications : receives
```

> **Nguyên tắc liên-module:** AUTH = nền phân quyền · **HR (employees) = trung tâm dữ liệu nhân sự**; ATT/LEAVE/TASK gắn trực tiếp `employee_id` · NOTI = sink event dùng chung · DASH chỉ tổng hợp (không sở hữu dữ liệu gốc).

---

## 1. Foundation / System (DB-01 §7.1, §8 · DB-08)

```mermaid
erDiagram
    companies ||--o{ company_settings : ""
    companies ||--o{ audit_logs : "🔁"
    companies ||--o{ files : "🗑️"
    files ||--o{ file_links : ""
    companies ||--o{ sequence_counters : ""
```

| Bảng | Mô tả | Cột đặc thù chính |
| --- | --- | --- |
| **companies** 🗑️ | Công ty/tenant (gốc) | `company_code` UK · name · legal_name · tax_code · email · phone · address · timezone · status (Active/Inactive/Suspended) |
| **modules** | Danh mục module | `module_code` (AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI) · name · is_active · sort_order |
| **company_settings** | Cấu hình theo công ty | company_id · setting_key · setting_value · (override system_settings) |
| **system_settings** 🌐 | Cấu hình global/default | setting_key · setting_value (global, no company_id) |
| **audit_logs** 🔁 | Nhật ký thao tác toàn hệ thống | company_id · actor_user_id · actor_employee_id · module_code · action (CREATE/UPDATE/DELETE/APPROVE/REJECT/LOGIN/EXPORT) · entity_type · entity_id · old_values jsonb · new_values jsonb · metadata jsonb(ip/ua/request_id) · created_at |
| **files** 🗑️ | Metadata file (binary ở storage) | company_id · original_name · stored_name · mime_type · file_size · storage_provider(local/s3/gcs/minio) · storage_path · checksum · uploaded_by · is_private 🔒 |
| **file_links** | File ↔ entity nghiệp vụ (polymorphic) | file_id · module_code · entity_type · entity_id · link_type(attachment/avatar/contract/document) |
| **sequence_counters** | Sinh mã tự động | sequence_key(EMPLOYEE_CODE/LEAVE_REQUEST_CODE/PROJECT_CODE) · prefix · current_value · padding_length · reset_policy(NEVER/YEARLY/MONTHLY) |
| **public_holidays** | Ngày lễ/ngày không làm | holiday_date · name · is_paid · affects_attendance · affects_leave |

---

## 2. AUTH / RBAC (DB-01 §7.2, §9 · DB-02)

```mermaid
erDiagram
    companies ||--o{ users : has
    users ||--o| employees : linked_to
    users ||--o{ user_roles : has
    roles ||--o{ user_roles : assigned_to
    roles ||--o{ role_permissions : has
    permissions ||--o{ role_permissions : granted
    users ||--o{ user_sessions : ""
    users ||--o{ password_reset_tokens : ""
    users ||--o{ login_logs : ""
```

### users 🗑️

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| id | UUID | PK |
| company_id | UUID | FK→companies.id |
| email | VARCHAR | UK (company_id, email) |
| password_hash | VARCHAR | 🔒 hash (BẤT BIẾN #3) |
| display_name | VARCHAR | tên hiển thị |
| avatar_file_id | UUID | FK→files.id, nullable |
| status | VARCHAR | Pending Activation/Active/Inactive/Locked/Deleted |
| last_login_at · password_changed_at | TIMESTAMP | nullable |
| + audit cols | | created/updated/deleted_* |

### roles 🗑️

`id` PK · `company_id` (NULL=global) · `role_code` UK(company_id,role_code) **SUPER_ADMIN/COMPANY_ADMIN/HR/MANAGER/EMPLOYEE** · name · description · is_system_role · status(Active/Inactive).

### permissions 🌐

`id` PK · `module_code` · `permission_code` UK (vd `HR.EMPLOYEE.VIEW`) · `resource` · `action`(VIEW/CREATE/UPDATE/DELETE/APPROVE) · is_active. (Global — không company_id.)

### user_roles

`id` PK · company_id · user_id FK→users · role_id FK→roles · assigned_by · assigned_at · expired_at(nullable) · is_active. **UK (user_id, role_id)**.

### role_permissions

`id` PK · company_id(nullable) · role_id FK→roles · permission_id FK→permissions · `data_scope`(Own/Team/Department/Project/Company/System) · conditions jsonb. **UK (role_id, permission_id, data_scope)**.

### user_sessions

`id` PK · user_id FK→users · `refresh_token_hash` 🔒 · ip_address · user_agent · device_id · expired_at · revoked_at · created_at.

### password_reset_tokens

`id` PK · user_id FK→users · `token_hash` 🔒 · purpose(ResetPassword/ActivateAccount) · expires_at · used_at.

### login_logs 🔁

`id` PK · company_id(nullable, pre-auth) · user_id(nullable) · email · login_status(Success/Failed/Blocked) · failure_reason · ip_address · user_agent · created_at.

---

## 3. HR (DB-01 §7.3, §10 · DB-03)

```mermaid
erDiagram
    departments ||--o{ departments : "🔑 parent"
    departments ||--o{ employees : contains
    positions ||--o{ employees : assigned
    job_levels ||--o{ employees : assigned
    employees ||--o{ employees : "🔑 direct_manager"
    users ||--o| employees : linked_to
    employees ||--o{ employee_contracts : has
    contract_types ||--o{ employee_contracts : ""
    employees ||--o{ employee_status_histories : "🔁"
    employees ||--o{ profile_change_requests : submits
    profile_change_requests ||--o{ profile_change_request_items : contains
```

### employees 🗑️ (trung tâm dữ liệu nhân sự)

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| id | UUID | PK |
| company_id | UUID | FK→companies.id |
| user_id | UUID | FK→users.id (nullable — employee không bắt buộc có account) |
| employee_code | VARCHAR | UK (company_id, employee_code) |
| full_name · first_name · last_name | VARCHAR | |
| gender · date_of_birth | | 🔒 |
| personal_email · phone · address | | 🔒 |
| company_email | VARCHAR | UK (company_id, company_email) |
| department_id · position_id · job_level_id | UUID | FK |
| direct_manager_id | UUID | 🔑 FK→employees.id, nullable |
| joined_date · official_date · resigned_date | DATE | |
| employment_status | VARCHAR | Probation/Official/Temporarily Suspended/Resigned/Terminated |
| avatar_file_id | UUID | FK→files.id |
| + audit cols | | |

### departments 🗑️

`id` PK · company_id · `parent_department_id` 🔑 FK→departments · department_code · name · manager_employee_id FK→employees · status(Active/Inactive) · sort_order.

### positions 🗑️

`id` PK · company_id · position_code · name · description · status.

### job_levels 🗑️

`id` PK · company_id · level_code(INTERN/JUNIOR/SENIOR/MANAGER) · name · rank_order · status.

### contract_types

`id` PK · company_id · code · name · (loại hợp đồng).

### employee_contracts ✅ (mig 0462, S2-HR-BE-6)

`id` PK · company_id (RLS+FORCE) · employee_id FK→**employee_profiles** ON DELETE CASCADE · contract_type_id FK→contract_types · contract_code (unique/company khi có + chưa xoá) · title · start_date · end_date · signed_date · status(Draft/Active/Expired/Terminated/Cancelled) · is_primary (≤1 primary+Active/employee) · file_id FK→files (SET NULL, link qua FileService entity 'contract') 🔒 · note · metadata · created_by/updated_by/deleted_by (soft-delete). Perm pair (view,contract)+(manage,contract) scope=Company hr/company-admin (mig 0462). audit object_type='employee_contract'.

### employee_files

Liên kết file hồ sơ nhân viên (qua `file_links` hoặc bảng riêng) · 🔒 file is_sensitive.

### employee_status_histories 🔁

`id` PK · company_id · employee_id FK→employees · old_status · new_status · reason · changed_by · changed_at.

### profile_change_requests

`id` PK · company_id · employee_id FK→employees · requested_by FK→users · status(Pending/Approved/Rejected/Cancelled) · reason · reviewed_by · reviewed_at · review_note.

### profile_change_request_items

`id` PK · request_id FK→profile_change_requests · field_name · old_value 🔒 · new_value · value_type.

### employee_code_configs

`id` PK · company_id · config_name · prefix_pattern(EMP/{DEPT}/{YEAR}-EMP) · number_length · reset_policy · allow_manual_override · is_active.

---

## 4. ATT — Chấm công (DB-01 §7.4, §11 · DB-04)

```mermaid
erDiagram
    shifts ||--o{ shift_assignments : assigned
    shifts ||--o{ attendance_records : applies
    attendance_rules ||--o{ attendance_records : applied
    employees ||--o{ attendance_records : has
    attendance_records ||--o{ attendance_logs : has
    attendance_records ||--o{ attendance_adjustment_requests : adjusted
    employees ||--o{ remote_work_requests : submits
    remote_work_requests ||--o{ attendance_records : affects
```

### attendance_records 🗑️ (bản ghi công tổng hợp theo ngày/ca)

`id` PK · company_id · `employee_id` FK→employees · work_date · shift_id FK→shifts(nullable) · check_in_at · check_out_at · total_working_minutes · required_working_minutes · late_minutes · early_leave_minutes · missing_minutes · status(Present/Late/Absent/Leave/Remote Work/…) · source(WEB/MOBILE/MANUAL/AUTO/REMOTE/DEVICE) · leave_request_id FK→leave_requests(nullable) · remote_work_request_id · applied_rule_id · note · + audit. **UK (company_id, employee_id, work_date, shift_id)**.

| Bảng | Mô tả | Cột chính |
| --- | --- | --- |
| **shifts** 🗑️ | Ca làm việc | shift_code · start_time · end_time · break_*_time · required_working_minutes · allowed_late_minutes · allowed_early_leave_minutes · is_flexible · flexible_checkin_from/to |
| **shift_assignments** | Gán ca (company/dept/employee) | shift_id · assignment_type(Company/Department/Employee) · department_id · employee_id · effective_from/to · priority |
| **attendance_rules** | Rule chấm công | rule_name · scope_type · require_check_in/out · require_gps · allow_remote_checkin · allow_auto_attendance · allow_adjustment_request · rule_config jsonb · priority |
| **attendance_logs** 🔁 | Log check-in/out thô | attendance_record_id · employee_id · log_type(CHECK_IN/CHECK_OUT) · log_time · source · ip_address · device_info jsonb · latitude · longitude |
| **attendance_adjustment_requests** | Yêu cầu điều chỉnh công | employee_id · attendance_record_id · request_type(Missing Check-in/out/Remote/Fix Time) · reason · status(Pending/Approved/Rejected/Cancelled) · submitted_by · reviewed_by |
| **attendance_adjustment_items** | Chi tiết điều chỉnh | (field/old/new theo từng đơn) |
| **remote_work_requests** | Remote/công tác (thuộc ATT) | employee_id · request_code · work_type(Remote/Business Trip/Outside Office) · start_date/end_date · reason · status · rule_mode(AUTO_ATTENDANCE/SELF_CHECK_IN) |
| **remote_work_request_approvals** | Lịch sử duyệt remote | request_id · approver · action · acted_at |

---

## 5. LEAVE — Nghỉ phép (DB-01 §7.5, §12 · DB-05)

```mermaid
erDiagram
    leave_types ||--o{ leave_requests : classifies
    leave_types ||--o{ leave_policies : configured
    leave_types ||--o{ leave_balances : balances
    employees ||--o{ leave_requests : submits
    employees ||--o{ leave_balances : owns
    leave_balances ||--o{ leave_balance_transactions : "🔁 ledger"
    leave_requests ||--o{ leave_request_approvals : approved
    leave_requests ||--o{ leave_request_days : expands
    leave_request_days ||--o{ attendance_records : syncs
```

### leave_requests 🗑️

`id` PK · company_id · `leave_request_code` · `employee_id` FK→employees · leave_type_id FK→leave_types · duration_type(Full Day/Half Day/Hourly/Multiple Days) · start_date · end_date · start_time · end_time · total_days · total_hours · reason · status(Draft/Pending/Approved/Rejected/Cancelled/Revoked) · current_approver_id · submitted_at/approved_at/rejected_at/cancelled_at · + audit.

| Bảng | Mô tả | Cột chính |
| --- | --- | --- |
| **leave_types** 🗑️ | Loại nghỉ | leave_type_code(ANNUAL/SICK/UNPAID) · is_paid · deduct_balance · require_attachment |
| **leave_policies** | Chính sách nghỉ | leave_type_id · scope_type(Company/Department/Employee/JobLevel) · annual_quota_days · allow_negative_balance · **allow_carry_forward** · max_carry_forward_days · **carry_forward_expiry_month** · **carry_forward_expiry_day** · policy_config jsonb |
| **leave_balances** | Số dư phép NV | employee_id · leave_type_id · year · granted_days · used_days · pending_days · adjusted_days · carried_forward_days · remaining_days. **UK (company_id, employee_id, leave_type_id, year)** |
| **leave_balance_transactions** 🔁 | Ledger biến động phép | leave_balance_id · transaction_type(GRANT/USE/REFUND/ADJUST/EXPIRE/CARRY_OVER) · days · reference_type(LeaveRequest/Manual/System) · reference_id |
| **leave_request_approvals** | Lịch sử duyệt đơn | leave_request_id · approver_user_id · action(APPROVE/REJECT/CANCEL/REVOKE) · acted_at |
| **leave_request_days** | Chi tiết từng ngày nghỉ | leave_request_id · employee_id · leave_date · duration_type · leave_minutes · attendance_record_id FK→attendance_records (đồng bộ ATT) |

---

## 6. TASK — Công việc & dự án (DB-01 §7.6, §13 · DB-06)

```mermaid
erDiagram
    projects ||--o{ project_members : has
    employees ||--o{ project_members : joins
    projects ||--o{ tasks : contains
    employees ||--o{ tasks : main_assignee
    tasks ||--o{ tasks : "🔑 subtask"
    tasks ||--o{ task_assignees : assigned
    tasks ||--o{ task_watchers : watched
    tasks ||--o{ task_comments : has
    task_comments ||--o{ task_comments : "🔑 reply"
    tasks ||--o{ task_checklists : has
    task_checklists ||--o{ task_checklist_items : contains
    tasks ||--o{ task_activity_logs : "🔁 logs"
```

### tasks 🗑️

`id` PK · company_id · project_id FK→projects(nullable) · `task_code` · title · description · creator_user_id · reporter_employee_id · `main_assignee_employee_id` FK→employees · `parent_task_id` 🔑 FK→tasks · `sort_order` · priority(Low/Medium/High/Urgent) · status(Todo/In Progress/In Review/Done/Cancelled) · due_date · start_date · completed_at · + audit. *(Overdue = dẫn xuất từ due_date, KHÔNG lưu cứng.)*

> **Cây việc con (S5-TASK-SUBTASK-1, mig 0503 — DECISIONS-05):** `parent_task_id` nay là đường sống (subtask THẬT, sâu ĐÚNG 1 cấp), `sort_order` dùng cho thứ tự việc con.
> - `tasks_id_company_uq UNIQUE (id, company_id)` + `tasks_parent_same_company_fk FOREIGN KEY (parent_task_id, company_id) → (id, company_id) ON DELETE SET NULL (parent_task_id)` — **backstop tenant ở tầng DB**: RI-check của Postgres BỎ QUA RLS nên FK thường không chặn được cha cross-tenant. **Danh sách cột trong `SET NULL` là bắt buộc** (thiếu nó Postgres null hoá cả `company_id`, vốn NOT NULL ⇒ hard-delete nổ).
> - `tasks_parent_active_idx (company_id, parent_task_id) WHERE deleted_at IS NULL AND parent_task_id IS NOT NULL` — phục vụ vị từ "lá" và aggregate tiến độ.
> - `mv_dashboard_task_status` từ 0503 **đếm LÁ**: bỏ qua task còn việc con chưa huỷ (task có con thì chỉ đếm con). Định nghĩa chuẩn của ACTIVE_CHILD vs COUNTABLE_CHILD: DB-06 §4.16.

| Bảng | Mô tả | Cột chính |
| --- | --- | --- |
| **projects** 🗑️ | Dự án | project_code · name · owner_employee_id · manager_employee_id · start/end_date · status(Planning/Active/On Hold/Completed/Cancelled/Archived) · priority |
| **project_members** | Thành viên dự án | project_id · employee_id · project_role(Owner/Manager/Member/Watcher) · status. **UK (project_id, employee_id)** |
| **project_files** | File dự án | project_id · file_id |
| **task_assignees** | Nhiều người phụ trách | task_id · employee_id · role(Main/Co-assignee) |
| **task_watchers** | Người theo dõi | task_id · employee_id |
| **task_comments** 🗑️ | Bình luận (có reply) | task_id · author_user_id · parent_comment_id 🔑 · content · mentioned_user_ids jsonb |
| **task_checklists** | Checklist | task_id · title · sort_order |
| **task_checklist_items** | Item checklist | checklist_id · content · is_done · done_by · done_at |
| **task_files** | File task | task_id · file_id |
| **task_activity_logs** 🔁 | Log hoạt động | project_id · task_id · actor_user_id · action(CREATED/UPDATED/ASSIGNED/STATUS_CHANGED/COMMENTED) · old/new_values jsonb |

---

## 7. NOTI — Thông báo (DB-01 §7.7, §14 · DB-07)

```mermaid
erDiagram
    notification_events ||--o{ notification_templates : uses
    notification_events ||--o{ notifications : emits
    users ||--o{ notifications : receives
    notifications ||--o{ notification_delivery_logs : "🔁 delivered"
```

| Bảng | Mô tả | Cột chính |
| --- | --- | --- |
| **notification_events** | Danh mục event | event_code(LEAVE_REQUEST_SUBMITTED/TASK_ASSIGNED…) · module_code · default_priority(Low/Normal/High/Urgent/Critical) · is_active |
| **notification_templates** | Template | company_id(NULL=global) · event_id · channel(IN_APP/EMAIL/PUSH) · title_template · body_template · variables_schema jsonb |
| **notifications** 🗑️ | Thông báo tới user | company_id · recipient_user_id · recipient_employee_id · module_code · event_code · title · body · priority · status(Unread/Read/Hidden/Archived/Deleted) · target_type/target_id/target_url(deep-link) · payload jsonb · read_at |
| **notification_delivery_logs** 🔁 | Log gửi theo kênh | notification_id · channel(IN_APP/EMAIL/PUSH/REALTIME) · status(Pending/Sent/Failed) · provider · provider_response jsonb · error_message · sent_at |
| **notification_preferences** | Cấu hình nhận (phase sau) | user_id · event/channel · enabled |

---

## 8. DASH — Dashboard (DB-01 §7.8, §15 · DB-07)

> DASH **không sở hữu dữ liệu nghiệp vụ gốc** — chỉ cấu hình widget + cache; module nguồn ép data scope.

| Bảng | Mô tả | Cột chính |
| --- | --- | --- |
| **dashboard_widgets** | Danh mục widget | widget_code(DASH-WIDGET-001) · module_code · required_permission_code · default_data_scope(Own/Team/Company/System) · component_key |
| **dashboard_widget_configs** | Cấu hình theo company/role/user | company_id · widget_id · role_id(nullable) · user_id(nullable) · is_enabled · sort_order · config jsonb |
| **dashboard_widget_cache** | Cache số liệu (nếu cần) | company_id · widget_id · cache_key · data jsonb · expired_at |

---

## 9. Quan hệ liên-module quan trọng (DB-01 §20)

| Cạnh | Khoá | Ý nghĩa |
| --- | --- | --- |
| AUTH→HR | `users.id → employees.user_id` (1-1, nullable) | employee cần user để đăng nhập/chấm công/xin nghỉ/nhận task |
| HR→ATT | `employees.id → attendance_records.employee_id` | chấm công luôn gắn employee; NV nghỉ việc không chấm công |
| HR→LEAVE | `employees.id → leave_requests/leave_balances.employee_id` | đơn nghỉ + số dư gắn employee |
| LEAVE↔ATT | `leave_requests.id → attendance_records.leave_request_id` · `leave_request_days.attendance_record_id` | đơn Approved tạo/sửa bản ghi công (status=Leave); hủy/thu hồi → ATT tính lại |
| HR→TASK | `employees.id → projects.owner/ tasks.main_assignee_employee_id` | owner/assignee là employee; manager scope dựa `direct_manager_id` |
| *→NOTI | `event → notification_events → notifications` | mọi module phát event → NOTI |
| *→DASH | query/tổng hợp | DASH chỉ đọc, ép permission + data scope |

**Bảng append-only 🔁:** `audit_logs` · `login_logs` · `attendance_logs` · `leave_balance_transactions` · `employee_status_histories` · `task_activity_logs` · `notification_delivery_logs`.
**Bảng SỔ không DELETE / UPDATE cấp cột (mig `0549`, S11-ASSET-DB-1 — DB-15 §6.3–6.6):** `asset_assignments` (UPDATE chỉ `status, returned_at, returned_by, return_condition, return_note, updated_at, updated_by`) · `asset_maintenances` (`status, closed_at, closed_by, result_note, cost, next_due_date, updated_at, updated_by`) · `asset_inventories` (`status, closed_at, closed_by, note, total_items, found_count, missing_count, not_checked_count, updated_at, updated_by`) · `asset_inventory_items` (`result, checked_at, checked_by, note, updated_at, updated_by`) — app role **không** có UPDATE cấp bảng, **không** DELETE; `*_by` → `users` là composite FK `NO ACTION` (không để RI action ghi đè sổ). Verify đúng-bằng qua `aclexplode` trong `0549`; chốt hồi quy `s11-asset-db1-invariants.int-spec.ts`.
**Bảng SỔ ROOM (mig `0552`, S11-ROOM-DB-1 — DB-16 §6.2–6.3):** `room_bookings` (không DELETE, không `deleted_at` — huỷ là trạng thái; UPDATE chỉ `status, cancelled_at, cancelled_by, cancel_reason, updated_at, updated_by`; chốt cuối chống trùng lịch = EXCLUDE gist `room_bookings_no_overlap_excl` trên `(company_id, room_id, [starts_at, ends_at))` WHERE `Confirmed`) · `room_booking_attendees` (chỉ `SELECT, INSERT`). `meeting_rooms` (tái dụng, ALTER 0552) soft-delete, không DELETE; `mediaos_worker` SELECT cả 3 (job nhắc lịch).
**Không cascade-delete** dữ liệu nghiệp vụ (DB-01 §22.4) — dùng soft-delete giữ lịch sử.

### 9.1 Cô lập tenant ở tầng FK — hai cơ chế, đừng nhầm (mig `0535` + `0547`)

Kiểm tra khoá ngoại của Postgres **bỏ qua RLS theo thiết kế**, nên một FK một-cột giữa hai bảng đều có
`company_id` là một đường ghi chéo tenant (KI-046). Hai cơ chế phủ nó, chọn theo **bảng ĐÍCH**:

| lớp | bảng đích | cơ chế | ở đâu |
| --- | --- | --- | --- |
| **T** — `parent.company_id NOT NULL` | 448 cặp | **composite FK** `(company_id, x) → parent(company_id, id)` | mig `0535` |
| **G** — `parent.company_id` NULLABLE (catalog TOÀN CỤC) | 11 cặp | **trigger** `enforce_company_id_catalog_fk` — cha phải CÙNG TENANT **HOẶC** toàn cục (`company_id IS NULL`) | mig `0547` · `DECISIONS-10` |

Composite FK **KHÔNG dùng được** cho lớp G: nó đòi khớp đúng `company_id` nên chặn luôn tham chiếu hợp
lệ tới hàng toàn cục (đã chứng minh: gán role hệ thống nổ 23503). Đừng thử lại hướng đó.

**8 bảng CON mang guard lớp G** (11 trigger `trg_<bảng>_<cột>_catalog_fk`; 3 bảng có 2 cột FK):
`user_roles` · `positions` · `dashboard_widget_cache` · `dashboard_widget_configs` ·
`notification_templates` · `notifications` · `leave_request_days` · `seed_items`.
**6 bảng ĐÍCH (catalog toàn cục):** `roles` · `dashboard_widgets` · `notification_events` ·
`notification_templates` · `public_holidays` · `seed_batches`.
Giới hạn: **FORWARD-ONLY** (không hồi tố hàng cũ) và guard KHÔNG chạm chiều `ON DELETE CASCADE` của
bảng cha — nó chặn việc TẠO hàng lệch, nên chuỗi CASCADE xuyên tenant đứt ở mắt đầu tiên.

**Bất biến `company_id` (trigger `enforce_company_id_immutable`, mig `0436` + `0531` + `0547`) — 9 bảng:**
`data_retention_policies` · `notification_events` · `notification_templates` · `public_holidays` ·
`roles` · `seed_batches` · `seed_items` · `sequence_counters` · **`dashboard_widgets`** (thêm ở `0547` —
**dư nợ vá kèm của `0531`**, không cấp số hiệu KI riêng: guard lớp G kiểm quan hệ con→cha lúc ghi hàng
CON, nên nếu cha còn "re-home" được thì hàng con của tenant khác thành vi phạm SAU khi đã ghi).

---

## Phụ lục A — Trạng thái hiện thực hoá (code ↔ thiết kế)

> ⚠️ Code thật trong `apps/api/src/db/schema/` **CHƯA khớp 100%** thiết kế trên và **còn lẫn bảng hướng cũ (media OS)**. Bảng dưới là bản đối chiếu để reconcile dần (đừng coi code là chuẩn).

### A1. Đã build & khớp (gần) đúng thiết kế

`companies` · `users` · `roles` · `permissions` · `user_roles` · `role_permissions` · `user_sessions` · `password_reset_tokens` · `login_logs` · `audit_logs` · `files` · `file_links` · `system_settings` · `company_settings` · `sequence_counters` (→ `sequence_counters`) · `public_holidays` · `modules` · `positions` · `profile_change_requests` (+ `employee_code_configs`) · **ASSET (mig `0549`, 29/08/2026):** `asset_categories` · `assets` · `asset_assignments` · `asset_maintenances` · `asset_inventories` · `asset_inventory_items` (DB-15 §6; `employees` → `employee_profiles` theo A2). · **ROOM (S11-ROOM-DB-1, mig `0552`–`0555`, 29/08/2026 — [DB-16](<DB/DB-16 ROOM Database Design.md>)):** `meeting_rooms` (tái dụng + ALTER: +`equipment`/`description`/`requires_approval`/`is_active`/`sort_order`/`updated_*`/`deleted_by`, `capacity` NOT NULL CHECK > 0, unique `lower(name)` partial, gỡ `is_virtual`) · `room_bookings` · `room_booking_attendees` — `schema/rooms.ts`; 10 composite tenant FK; role hệ thống `office-admin` (…0013, không canonical) + 5 cặp `room`/`room-booking` + 22 grant §9e; NOTI `ROOM_BOOKING_CONFIRMED/CANCELLED/REMINDER`; audit `room_booking`. `modules.ROOM` GIỮ `is_active=false` tới `S11-ROOM-FE-1`. 4 bảng di sản `meetings`/`meeting_attendees`/`meeting_notes`/`meeting_tasks` **đã DROP** (0553, 0 hàng) + 6 cặp quyền `meeting*` xoá cứng.

### A2. Lệch TÊN (code khác thiết kế — cần biết khi tra cứu)

| Thiết kế (docs/DB) | Code thật |
| --- | --- |
| `departments` | **`org_units`** (+ `teams`, `team_members` — code thêm) |
| `employees` | **`employee_profiles`** |
| `shifts` | **`work_schedules`** |
| `job_levels`, `contract_types` | giữ tên, nằm ở `hr-master.ts` |
| `permissions.permission_code` | cặp **`(action, resource_type)`** (không có permission_code) |
| `profile_change_request_items` | gộp vào `profile_change_requests.changed_fields` (jsonb) + `employee_profile_change_histories` |

### A3. Lệch CẤU TRÚC (cần reconcile)

- **ATT/LEAVE/TASK code dùng `user_id`** thay vì `employee_id` như thiết kế → khác mô hình "employee là trung tâm". (Bảng `attendance_records`/`leave_requests`/`tasks` trong code FK→`users`.)
- **`roles`/`permissions` tối giản:** thiếu `role_code`/`role_type`/`status`/`metadata` (roles) và `permission_code`/`module_code`/`is_active` (permissions).
- **`users`:** code dùng `full_name` + `status` chữ thường (`active`/`suspended`); thiếu `display_name`/`email_verified_at`/`password_changed_at`/`avatar_file_id`.

### A4. Thiết kế CÓ nhưng code CHƯA build

`employee_files` · `shift_assignments` · `attendance_rules` · `remote_work_requests`(+approvals) · `leave_policies` · `leave_balance_transactions` · `leave_request_approvals` · `leave_request_days` · `notification_events` · `notification_templates` · `notification_delivery_logs` · toàn bộ **DASH** (`dashboard_widgets`/`_configs`/`_cache`). *(ATT/LEAVE/TASK/NOTI ở code mới là bản rút gọn hướng cũ, chưa reconcile.)* — `employee_contracts` ĐÃ build (mig 0462, S2-HR-BE-6).

- **ASSET (Phase 3 — [DB-15](<DB/DB-15 ASSET Database Design.md>) · [SPEC-13](<SPEC/SPEC-13 ASSET.md>)): ĐÃ BUILD 29/08/2026 (`S11-ASSET-DB-1`, mig `0549` DDL · `0550` seed role/quyền/audit · `0551` NOTI; `schema/assets.ts`).** 6 bảng `asset_categories` · `assets` · `asset_assignments` · `asset_maintenances` · `asset_inventories` · `asset_inventory_items` khớp DB-15 §6 (đã chuyển sang A1). Lệch có chủ đích so với chữ DB-15 (đã đính chính trong DB-15): `*_by` của 4 sổ = `NO ACTION` (không `SET NULL (col)`); `modules.ASSET` **giữ `is_active=false`** tới `S11-ASSET-FE-1`; audit CHECK clone `0545` (không `0506`). 26 composite tenant FK (verify dương đúng-bằng trong `0549`); FK người giữ trỏ `employee_profiles` (A2). Role hệ thống **`asset-manager`** (`…0012`, không canonical). Đường tên sạch: không đụng `content_assets` (media, A5). **Chưa build:** module NestJS (`S11-ASSET-BE-1`), `sequence_counters` cho loại (sinh lúc tạo loại, BE-1).

- ~~ROOM~~ — **ĐÃ BUILD** ở `S11-ROOM-DB-1` (mig `0552`–`0555`, 29/08/2026): xem A1. Còn lại của module ROOM là BE/FE (`S11-ROOM-BE-1`, `S11-ROOM-FE-1`), không phải nền dữ liệu.

- **RECRUIT (Phase 2 — [DB-14](<DB/DB-14 RECRUIT Database Design.md>) · [SPEC-12](<SPEC/SPEC-12 RECRUIT.md>)): thiết kế CÓ (Approved 31/08/2026, wave S12-RECRUIT), code CHƯA build.** 8 bảng mới `job_openings` · `candidates` · `candidate_stage_events` (append-only) · `candidate_notes` · `interviews` · `interview_participants` · `interview_feedbacks` · `offers` — thi công ở `S12-RECRUIT-DB-1` (mig `0559+` dự kiến, `schema/recruit.ts`). Nền sạch: 0 bảng di sản tuyển dụng (chỉ 2 giá trị enum trong `finance.ts`/`media.ts` đã park — A5); hàng `modules.RECRUIT` pre-seed inactive từ `0435`, GIỮ `false` tới `S12-RECRUIT-FE-1`. Khi build: `candidate_stage_events` bổ sung danh sách bảng append-only §9; role hệ thống `recruiter` (không canonical); 7 cặp `candidate` `is_sensitive=true`.

### A5. Code CÒN bảng HƯỚNG CŨ — out-of-scope, cần DỌN (de-media-fy, CLAUDE.md §1)

KHÔNG thuộc thiết kế MVP, còn sót trong DB:

- **media** (`media.ts`): platforms · channels · channel_members · platform_accounts · encryption_keys · channel_accounts · projects(media) · project_channels/teams/members · content_types · content_items · content_channels · content_assets.
- **finance** (`finance.ts`): revenue_records · cost_records · cost_allocations · profit_snapshots · expense_requests · expense_approvals.
- **payroll** (`payroll.ts`, Phase 2): salary_profiles · payroll_periods · payslips · payslip_items · bonus_penalties · payslip_acknowledgements.
- **kpi/evaluation** (`kpi.ts`/`evaluation.ts`) + **break-glass** (`break-glass.ts`). ⓘ Cụm **workflow/approval ĐÃ DỌN XONG** — xem gạch đầu dòng dưới. ⓘ **`meeting.ts` RỜI nhóm này 29/08/2026**: `meeting_rooms` là nền của module **ROOM** (SPEC-14/DB-16, A4), 4 bảng `meeting_*` còn lại được DROP ở `S11-ROOM-DB-1` theo ROOM-DEC-001 — không còn là "di sản chưa quyết".
  - **✅ 28/08/2026 — `S10-CLEAN-WORKFLOWCLUSTER-2` ĐÓNG KI-082: cụm workflow/approval đã DỌN HẾT, cả CODE lẫn BẢNG.** Mục này KHÔNG còn nằm trong danh sách "cần DỌN".
    - **CODE GỠ HẾT:** `apps/api/src/workflow/**` + `apps/api/src/approval/**` = **0 file**. Bề mặt HTTP của cụm = **0** (đợt 1 gỡ 29 route `/workflow*`, đợt 2 gỡ 3 route `/approval/*`). Ca đo runtime: `apps/api/test/foundation/workflow-surface-removed.unit-spec.ts` (ca đối chứng đổi neo sang `leave/` vì `approval/` không còn sống để làm đối chứng).
    - **BẢNG DROP HẾT — migration `0548`, 14 bảng:** `workflow_definitions` · `workflow_definition_steps` · `workflow_instances` · `workflow_steps` · `workflow_step_dependencies` · `workflow_step_checklist_states` · `workflow_step_instance_locks` · `step_transitions` · `checklists` · `checklist_items` · `approval_requests` · `approval_steps` · `approval_rules` · `defects`. Đo trước khi chạy: **0 hàng / cả 14 bảng** trên DB `mediaos` (PROD + dev-online dùng chung).
    - **CHẠM BẢNG SỐNG có chủ đích:** `tasks` mất 2 cột `workflow_step_id`/`workflow_instance_id` + 2 index + unique `tasks_dedup_key_uq` (0/12 hàng có hai cột đó NOT NULL). `evaluation_results` mất `workflow_step_id`; `bonus_penalties` mất `defect_id` **và CHECK `bonus_penalties_reference_check` được DỰNG LẠI** — `DROP COLUMN` của Postgres gỡ theo mọi CHECK chạm cột đó, để trần là mất bất biến trong im lặng.
    - **Catalog quyền:** 27 cặp mồ côi + 89 grant bị xoá (`approval-request` · `workflow-instance` · `workflow-template` · `defect` · `step`). ⛔ `channel`/`content`/`project`/`platform-account` GIỮ — bảng của chúng vẫn còn.
    - **Ảnh hưởng API đã khai:** `GET /dashboard/alerts` không còn phát loại `defect_severity`; DTO task rời 7 trường join `workflow_steps` (`stepId`·`stepCode`·`stepName`·`stepStatus`·`submissionUrl`·`submissionNote`·`workflowInstanceId`) — 0 hộ tiêu thụ FE tại thời điểm gỡ.
  - _(Lịch sử) **⟲ 27/08/2026 — `S10-CLEAN-WORKFLOWPARK-1`** đã dọn NỬA CODE trước đó: `WorkflowController` (13 route) · `WorkflowTemplatesController` (16 route) · `workflow.service.ts` · stack `workflow-templates.*` · `dag-validator` · `dag-result.adapter`. Bảng khi đó GIỮ NGUYÊN._

> **⚠️ Cụm chat KHÔNG còn out-of-scope (01/08/2026).** `chat_rooms` · `chat_room_members` · `chat_messages` (`communication.ts`, mig `0010`+`0050`, composite tenant FK `0535`) là **nền của module CHAT** — có [SPEC-15](<SPEC/SPEC-15 CHAT.md>) · [DB-12](<DB/DB-12 CHAT Database Design.md>) · [API-13](<API Design/API-13_CHAT_API_Design.md>), thi công ở wave `S7-CHAT` sau go-live. Bảng đã có RLS+FORCE + GRANT append-only đúng bất biến ⇒ **giữ nguyên, KHÔNG dọn**. Riêng `chat_rooms.channel_id` (→ `channels` media) và `chat_messages.file_url`/`file_name` đã **DROP xong** ở mig `0542` (`S7-CHAT-CLEAN-1`, bước contract của expand-contract) — xem DB-12 §6.6.
>
> Reconcile-first (CLAUDE.md §STATUS): giữ phần A1, đổi tên/bổ sung theo A2–A4 khi build từng module, **park/dọn** A5. Khi có mâu thuẫn → **`docs/DB` + `docs/spec` là chuẩn**, không phải code.

---

> Field/CHECK/index đầy đủ từng module: **DB-02** (AUTH) · **DB-03** (HR) · **DB-04** (ATT) · **DB-05** (LEAVE) · **DB-06** (TASK) · **DB-07** (NOTI/DASH) · **DB-08** (Foundation) · **DB-09** (index/hiệu năng) · **DB-10** (migration/seed). Nghiệp vụ: `docs/spec/`.
