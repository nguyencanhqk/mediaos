# ERD — Hệ thống Quản lý Doanh nghiệp (theo `docs/spec/`)

> **Sơ đồ quan hệ dữ liệu** của 7 module MVP, dựng từ phần **"Dữ liệu cần lưu"** của bộ SPEC-02…08.
> Nguồn sự thật field đầy đủ: từng SPEC §"Dữ liệu cần lưu". Tài liệu này chỉ vẽ thực thể + quan hệ tầng-trên.
> ⚠️ De-media-fy 2026-06-20: ERD media/finance/payroll/SaaS cũ đã bỏ. Bảng của các subsystem **parked** (xem [`SYSTEM-DESIGN.md §14`](./SYSTEM-DESIGN.md#14-subsystem-parked-hướng-cũ)) không vẽ ở đây.

## Quy ước đọc

- **`||--o{`** = 1‑nhiều · **`}o--||`** = nhiều‑1 · **`}o--o{`** = nhiều‑nhiều (qua bảng nối) · 🔑 = self-FK (cây/đệ quy).
- 🔁 = **append-only** (app chỉ SELECT/INSERT, không UPDATE/DELETE) · 🗑️ = có `deleted_at` (soft-delete) · 🔒 = field nhạy cảm mask theo quyền.
- **Đa-công-ty:** `company_id` xuất hiện trên bảng nghiệp vụ ATT/LEAVE/TASK/DASH/NOTI + cấu hình (`leave_policies`, `employee_code_configs`…). Bảng lõi AUTH/HR (`users`, `employees`, `roles`…) ở khung đơn-công-ty (N=1) chưa mang `company_id` cứng — sẽ thêm khi bật multi-company. Cạnh `→ companies` không vẽ lặp để giảm nhiễu.
- Mã chuẩn quyền/lỗi/event theo SPEC-01 §9.

## Thống kê thực thể MVP

| Module | Bảng | Module | Bảng |
|---|---|---|---|
| AUTH (foundation) | 7 | TASK | 8 |
| HR | 13 | DASH | 3 |
| ATT | 8 | NOTI | 6 |
| LEAVE | 7 | **TỔNG** | **~52 bảng MVP** |

---

## 1. AUTH — Tài khoản, vai trò, phân quyền, audit (SPEC-02)

Module nền tảng: cung cấp RBAC + audit cho mọi module. `users.employee_id ↔ employees.user_id` là link 1‑1 tài khoản ↔ hồ sơ HR.

```mermaid
erDiagram
    users ||--o{ user_roles : "có"
    roles ||--o{ user_roles : ""
    roles ||--o{ role_permissions : ""
    permissions ||--o{ role_permissions : ""
    users ||--o{ password_reset_tokens : ""
    users }o--|| employees : "🔗 1-1 (HR, nullable)"

    users {
        uuid id PK
        uuid employee_id FK "→ employees, nullable 🗑️"
        string email UK
        string password_hash "🔒 hash"
        string status "Active/Locked/Inactive/Pending"
    }
    roles {
        uuid id PK
        string role_code UK
        string default_data_scope "Own/Team/Department/Company/System"
        bool is_system_role
    }
    permissions {
        uuid id PK
        string permission_code UK "MODULE.RESOURCE.ACTION"
        string module_code
        string resource
        string action
    }
    role_permissions {
        uuid id PK
        uuid role_id FK
        uuid permission_id FK
        string data_scope "override, nullable"
    }
    audit_logs {
        uuid id PK "🔁 append-only"
        uuid actor_id
        string action
        string module_code
        string target_type
        uuid target_id
        json old_value
        json new_value
    }
```

- **Role hệ thống mặc định:** `SUPER_ADMIN, COMPANY_ADMIN, HR, MANAGER, EMPLOYEE`. Scope mặc định: SA=System · ADM/HR=Company · MGR=Team · EMP=Own.
- **`audit_logs`** 🔁 dùng chung cho toàn hệ thống (SPEC-01 §16.3). HR change-log có thể tái dùng bảng này.
- 2FA TOTP (login challenge) mô tả ở SPEC-02; secret TOTP lưu mã hóa, recovery code lưu hash.

---

## 2. HR — Nhân sự, tổ chức, hợp đồng (SPEC-03)

```mermaid
erDiagram
    departments ||--o{ employees : "thuộc"
    positions ||--o{ employees : ""
    job_levels ||--o{ employees : ""
    employees ||--o{ employees : "🔑 direct_manager_id (Team scope)"
    departments ||--o{ departments : "🔑 parent (cây)"
    employees ||--o{ employee_contracts : ""
    contract_types ||--o{ employee_contracts : ""
    employees ||--o{ employee_files : ""
    employees ||--o{ employee_status_histories : "🔁"
    employees ||--o{ employee_change_logs : "🔁"
    employees ||--o{ employee_profile_change_requests : ""
    employee_profile_change_requests ||--o{ employee_profile_change_request_files : ""
    employee_code_configs ||--o{ employee_code_sequences : ""

    employees {
        uuid id PK "🗑️"
        string employee_code UK "auto-gen"
        uuid user_id FK "→ users, nullable"
        uuid department_id FK
        uuid position_id FK
        uuid direct_manager_id FK "🔑 self"
        string employment_status "Onboarding/Probation/Official/Suspended/Resigned/Terminated"
        string personal_id_number "🔒"
        date date_of_birth "🔒"
    }
    departments {
        uuid id PK "🗑️"
        string department_code UK
        uuid parent_department_id FK "🔑"
        uuid manager_id FK "→ employees"
    }
    employee_profile_change_requests {
        uuid id PK
        uuid employee_id FK
        string status "Draft/Pending/Approved/Rejected/Cancelled"
        json old_values
        json new_values
    }
```

- **Thực thể khác:** `positions` (chức vụ, `default_level_id`), `job_levels` (cấp bậc, `order_index`), `contract_types` (loại HĐ), `employee_code_configs` + `employee_code_sequences` (sinh mã NV tự động theo rule).
- **Nhạy cảm 🔒** (mask theo quyền `HR.EMPLOYEE.VIEW_SENSITIVE`): CCCD, ngày sinh, lương cơ bản, tài khoản ngân hàng, file `is_sensitive`.
- **Self-service:** nhân viên gửi `employee_profile_change_requests` → HR duyệt/từ chối (workflow phê duyệt nhẹ trong module).

---

## 3. ATT — Chấm công (SPEC-04)

```mermaid
erDiagram
    employees ||--o{ attendance_records : ""
    attendance_shifts ||--o{ attendance_records : "nullable"
    attendance_records ||--o{ attendance_logs : "raw check events"
    attendance_shifts ||--o{ attendance_shift_assignments : ""
    attendance_records ||--o{ attendance_adjustment_requests : ""
    employees ||--o{ attendance_remote_requests : ""

    attendance_records {
        uuid id PK "🗑️ unique(company,emp,date,shift)"
        uuid company_id
        uuid employee_id FK
        date attendance_date
        uuid shift_id FK "nullable"
        timestamptz check_in_time
        timestamptz check_out_time
        int late_minutes
        int early_leave_minutes
        string status
        string source "WEB/MOBILE/MANUAL/AUTO/REMOTE"
        json rule_snapshot
    }
    attendance_adjustment_requests {
        uuid id PK
        uuid attendance_record_id FK
        string status "Pending/Approved/Rejected/Cancelled"
        uuid approver_id
    }
    attendance_audit_logs {
        uuid id PK "🔁 append-only"
        uuid actor_id
        string action
        string target_type
    }
```

- **`attendance_logs`** 🔁: sự kiện check-in/out thô (device, IP, GPS). **`attendance_rules`** + **`attendance_shift_assignments`**: cấu hình theo độ ưu tiên Employee → Department → Company → mặc định.
- **`attendance_remote_requests`**: remote/công tác thuộc **ATT** (KHÔNG phải LEAVE).
- **Liên kết LEAVE:** đơn nghỉ được duyệt → ghi/đè `attendance_records` (status `Leave`).

---

## 4. LEAVE — Nghỉ phép (SPEC-05)

```mermaid
erDiagram
    leave_types ||--o{ leave_requests : ""
    leave_types ||--o{ leave_balances : ""
    employees ||--o{ leave_requests : ""
    employees ||--o{ leave_balances : ""
    leave_requests ||--o{ leave_request_approvals : "đa cấp"
    leave_requests ||--o{ leave_request_files : ""
    leave_balances ||--o{ leave_balance_transactions : "🔁 ledger"

    leave_requests {
        uuid id PK
        string request_code
        uuid employee_id FK
        uuid leave_type_id FK
        string duration_type "Full/Half/Hourly"
        date start_date
        date end_date
        decimal calculated_days
        string status "Draft/Pending/Approved/Rejected/Cancelled/Revoked"
        uuid approver_id
    }
    leave_balances {
        uuid id PK
        uuid employee_id FK
        uuid leave_type_id FK
        int balance_year
        decimal remaining_days
    }
    leave_balance_transactions {
        uuid id PK "🔁 append-only ledger"
        string transaction_type "Grant/Use/Pending/Release/Adjust/Expire/CarryForward"
        decimal days
        string source_type "LeaveRequest/Manual/System"
    }
    leave_policies {
        uuid id PK
        uuid company_id
        string apply_scope "Company/Department/Employee"
        string approval_flow_type "Manager Only / Manager + HR"
    }
```

- **`leave_balance_transactions`** 🔁 là ledger bất biến — số dư `leave_balances.remaining_days` là kết quả cộng dồn transaction. **`leave_policies`** ưu tiên Employee → Department → Company → mặc định.
- **Đồng bộ ATT:** duyệt → ghi `attendance_records`; hủy/thu hồi (`Revoked`) → ATT tính lại. Approver resolve qua HR `direct_manager_id`.

---

## 5. TASK — Công việc & dự án (SPEC-06)

```mermaid
erDiagram
    projects ||--o{ project_members : "N-N (project_role)"
    employees ||--o{ project_members : ""
    projects ||--o{ tasks : "nullable"
    tasks ||--o{ tasks : "🔑 parent (subtask)"
    employees ||--o{ tasks : "reporter/assignee"
    tasks ||--o{ task_watchers : ""
    tasks ||--o{ task_comments : ""
    task_comments ||--o{ task_comments : "🔑 reply"
    tasks ||--o{ task_files : ""
    tasks ||--o{ task_checklists : ""

    projects {
        uuid id PK "🗑️"
        uuid company_id
        string project_code UK
        uuid owner_id FK "→ employees"
        string status "Planning/Active/On Hold/Completed/Cancelled/Archived"
        string visibility "Private/Internal/Public"
    }
    project_members {
        uuid id PK
        uuid project_id FK
        uuid employee_id FK
        string project_role "Owner/Manager/Member/Viewer"
    }
    tasks {
        uuid id PK "🗑️"
        uuid company_id
        uuid project_id FK "nullable"
        uuid assignee_id FK "nullable"
        uuid parent_task_id FK "🔑"
        string status "Todo/In Progress/In Review/Done/Cancelled"
        string priority "Low/Medium/High/Urgent"
        date due_date
    }
    task_activity_logs {
        uuid id PK "🔁 append-only"
        string action
        string target_type "Project/Task/Comment/File"
    }
```

- **Vai trò cấp-dự-án** (`project_members.project_role`: Owner/Manager/Member/Viewer) chồng lên role hệ thống — thêm scope **Project** (member-of). `Overdue` là trạng thái **dẫn xuất** từ `due_date`, không lưu cứng (SPEC-01 §17.7).

---

## 6. DASH — Dashboard (SPEC-07)

DASH **chỉ đọc/tổng hợp** từ ATT/TASK/LEAVE/HR/NOTI/AUTH + deep-link; module nguồn ép data scope. Chỉ sở hữu bảng cấu hình widget.

```mermaid
erDiagram
    dashboard_widget_configs {
        uuid id PK
        uuid company_id
        string role_code
        string dashboard_type "Employee/Manager/HR/Admin"
        string widget_code
        bool is_enabled
        int display_order
        int default_limit "mặc định 5"
    }
    dashboard_user_preferences {
        uuid id PK "thiết kế cho Phase sau"
        uuid user_id
        string widget_code
        bool is_visible
    }
```

- Tùy chọn: bảng `dashboard_summary/cache` (`scope_type`, `metric_code`, `metric_value`, `expired_at`) cho cache số liệu — có thể chưa dùng trong MVP.

---

## 7. NOTI — Thông báo (SPEC-08)

Sink cho event từ mọi module; gửi tới user theo `recipient_user_id`.

```mermaid
erDiagram
    notification_events ||--o{ notification_templates : ""
    notification_events ||--o{ notifications : "phát"
    users ||--o{ notifications : "recipient"
    notifications ||--o{ notification_logs : "🔁 delivery"
    notification_channels ||--o{ notification_logs : ""

    notifications {
        uuid id PK "🗑️"
        uuid recipient_user_id FK
        string status "Unread/Read/Hidden/Archived/Deleted"
        string priority "Low/Normal/High/Urgent/Critical"
        string source_module "AUTH/HR/ATT/LEAVE/TASK/DASH"
        string event_code
        string target_url "deep-link"
    }
    notification_events {
        uuid id PK
        string event_code UK "→ NOTI-EVENT-XXX (SPEC-01 §20.2)"
        string source_module
        string default_priority
        bool enabled
    }
    notification_templates {
        uuid id PK
        string template_code UK
        string channel "IN_APP/EMAIL/PUSH"
        string language "vi default"
    }
    notification_logs {
        uuid id PK "🔁 append-only"
        string channel
        string status "Created/Sent/Failed/Skipped"
    }
```

- **`notification_channels`** (IN_APP bắt buộc MVP; EMAIL/PUSH Phase sau). **`notification_user_preferences`** thiết kế cho Phase sau. `event_code` ánh xạ bộ chuẩn SPEC-01 §20.2.

---

## 8. Bản đồ liên-module (tổng)

```mermaid
flowchart LR
    AUTH["AUTH<br/>users · roles · permissions · audit_logs"]
    HR["HR<br/>employees · departments · positions"]
    ATT["ATT<br/>attendance_records · shifts"]
    LEAVE["LEAVE<br/>leave_requests · balances"]
    TASK["TASK<br/>projects · tasks"]
    DASH["DASH<br/>widget_configs"]
    NOTI["NOTI<br/>notifications"]

    AUTH -->|user/role/scope| HR & ATT & LEAVE & TASK & DASH & NOTI
    HR -->|employee · manager · dept| ATT & LEAVE & TASK
    LEAVE <-->|approved leave ↔ attendance| ATT
    HR & ATT & LEAVE & TASK -->|đọc/tổng hợp| DASH
    HR & ATT & LEAVE & TASK -->|event_code| NOTI
```

**Bảng append-only 🔁 (Bất biến #2):** `audit_logs` · `attendance_audit_logs` · `task_activity_logs` · `leave_balance_transactions` · `notification_logs` · `employee_status_histories` · `employee_change_logs` — app role không UPDATE/DELETE.

> Field đầy đủ + ràng buộc CHECK/UNIQUE: xem từng SPEC §"Dữ liệu cần lưu" trong [`docs/spec/`](./spec/).
