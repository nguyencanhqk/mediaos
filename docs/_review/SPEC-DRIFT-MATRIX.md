# Bảng đối chiếu SPEC ↔ DB/API — drift cần sửa (B3 + B4)

> Nguyên tắc: tầng **DB/API/BE/FE đã khớp nhau ~100%**; **SPEC là tầng cũ nhất, lệch**. Trừ vài chỗ DB tự mâu thuẫn (ghi rõ bên dưới), **chuẩn = DB/API**, sửa SPEC theo. Mỗi dòng = 1 thay đổi cụ thể để duyệt.
> Mức: **C**=Critical (chặn sinh code/schema) · **H**=High (sai guard/seed) · **M**=Medium · **L**=Low.

---

## 1. AUTH + Foundation (SPEC-02, DB-02/08, API-02/09/10, BACKEND-03/04/11)

| # | Mức | Chỗ | Hiện tại (lệch) | Sửa thành (chuẩn) |
|---|---|---|---|---|
| AU-1 | C | DB-01 §9.2 | `role_code` enum gồm `ADMIN` | `COMPANY_ADMIN` (khớp SPEC-02/DB-02/API-10/BACKEND-03) |
| AU-2 | H | BACKEND-11 (toàn file) | `FOUNDATION.AUDIT.VIEW/EXPORT` | `FOUNDATION.AUDIT_LOG.VIEW/EXPORT` (khớp API-09/FE-13) |
| AU-3 | H | SPEC-02/DB-02 vs API-09/FE-13 | 2 mã đọc audit lẫn lộn `AUTH.AUDIT_LOG.VIEW` ↔ `FOUNDATION.AUDIT_LOG.VIEW` | Chốt ranh giới: audit AUTH-domain (login/security) = `AUTH.AUDIT_LOG.VIEW`; audit cross-module = `FOUNDATION.AUDIT_LOG.VIEW`. Ghi vào API-10 matrix, đồng bộ seed |
| AU-4 | H | SPEC-02 §14 vs API-02 §14 | 2 hệ mã lỗi: SPEC số `AUTH-ERR-001..017`, API/BE slug `AUTH-ERR-FORBIDDEN`/`-UNAUTHENTICATED`; còn lẫn `AUTH-ERR-403` | Chốt 1 hệ (đề xuất **slug**) + bảng ánh xạ SPEC↔API; bỏ `AUTH-ERR-403` rải rác |
| AU-5 | H | FE-03 (Pascal) vs FE-06 (snake) vs code | user-status casing lệch: `Active` / `active`; code dùng `suspended` (không doc nào có) | Chốt 1 casing (đề xuất PascalCase theo DB-02). Doc hóa hoặc map `suspended` → thêm status `Suspended` + `AUTH-ERR-USER-SUSPENDED` vào SPEC-02/DB-02/API-02, hoặc map về `Locked/Inactive` |
| AU-6 | M | SPEC-02 §21, BACKEND-03 §11.1, DB-02 §16.3 | hash "argon2 HOẶC bcrypt" (để ngỏ) | Pin **argon2id** (OWASP) + tham số (memory/time/parallelism) trong 1 ADR + SPEC-02/BACKEND-03 |
| AU-7 | M | API-01/02, BACKEND-03 | TTL token là KHOẢNG (access 15–60′, refresh 7–30 ngày), 3 ví dụ khác nhau | Pin giá trị cứng (đề xuất access 15′, refresh 7 ngày) ở API-01 §3.5, các doc trỏ về |
| AU-8 | M | API-02 vs BACKEND-03 | rotation "nếu bật", reuse-detection thiếu | Chốt rotation + reuse-detection **bắt buộc MVP** (crown-jewel); sửa API-02 + DB-02 (thêm token family) |
| AU-9 | M | SPEC-02 §8.1 (17 quyền) vs API-10 (14 quyền) | `AUTH.PROFILE.VIEW/UPDATE`, `AUTH.LOGIN.ACCESS` tính là permission | Đánh dấu 3 mã là non-guard (gate bằng `Authenticated`), ghi chú trong DB-02 seed + SPEC-02 |
| AU-10 | M | SPEC-02 §16 vs API-02 | endpoint cũ `/api/auth/login`, `/api/users` (không `/v1`) | Cập nhật theo API-02: `/api/v1/auth/...`, gộp users/roles dưới `/auth`, thêm refresh/logout-all/sessions |
| AU-11 | H | thiếu | code có admin soft-delete user nhưng không doc nào định nghĩa `AUTH.USER.DELETE` | Thêm `AUTH.USER.DELETE` (hoặc xác nhận chỉ soft-delete) vào SPEC-02/DB-02/API-02/API-10 |
| AU-12 | M | SPEC-02 §15.2 (5 scope) vs §7.5 (6 scope) | `data_scope` lúc 5 lúc 6 giá trị (thiếu `Project`) | Thống nhất 6 giá trị `Own/Team/Department/Project/Company/System`; ghi rõ Project chỉ hợp lệ ở permission TASK |
| AU-13 | M | FE-03 vs FE-06 | `<PermissionGate>` props lệch: `requiredPermissions[]` vs `permission` | Chuẩn theo FE-03 (số nhiều); sửa FE-06 |

---

## 2. HR (SPEC-03, DB-03, API-03, BACKEND-05)

| # | Mức | Chỗ | Hiện tại (lệch) | Sửa thành (chuẩn) |
|---|---|---|---|---|
| HR-1 | C | SPEC-03 §15.10 | bảng `employee_profile_change_requests` | `profile_change_requests` (khớp DB-03/API-03/BE) |
| HR-2 | H | SPEC-03 §15 | `departments`: `department_name/parent_department_id/manager_id` | DB-03: `name/parent_id/manager_employee_id` |
| HR-3 | H | SPEC-03 §15.9 | bảng audit riêng `employee_change_logs` | Bỏ — dùng `audit_logs` chung; thêm object_types HR vào CHECK (DB-08) |
| HR-4 | H | SPEC-03 §15 (employee_files) | metadata file nhúng (`file_url/mime_type/file_size`) | DB-03: FK `file_id`→`files` chung + `file_category/is_sensitive` |
| HR-5 | H | SPEC-03 vs API-03 | HR-API số + path `/api/employees` | API-03: path `/api/v1/hr/employees`, remap mã API |
| HR-6 | M | SPEC-03 §15 (mã NV) | bảng riêng `employee_code_sequences`, `reset_rule` | Foundation `sequence_counters` chung + `reset_policy` |
| HR-7 | M | API-10 AUD-016 | read contract_type = `HR.CONTRACT.VIEW`, write = `HR.MASTER_DATA.MANAGE` (trộn family) | Chốt family: hoặc `HR.MASTER_DATA.VIEW`+`MANAGE`, hoặc `HR.JOB_LEVEL.*`/`HR.CONTRACT_TYPE.*` |
| HR-8 | H | SPEC-03 (employment_status) | 6 status, không bảng transition | Định nghĩa FSM tường minh + deny-path test (cấm `Terminated`→`Official`) |
| HR-9 | M | SPEC-03 vs API-03/BE | mã lỗi `HR-ERR-001..049` (số) vs slug `HR-ERR-EMPLOYEE-NOT-FOUND` | Chốt 1 hệ + bảng ánh xạ |

---

## 3. ATT (SPEC-04, DB-04, API-04, BACKEND-06)

| # | Mức | Chỗ | Hiện tại (lệch) | Sửa thành (chuẩn = DB-04) |
|---|---|---|---|---|
| AT-1 | C | SPEC-04 §16/§22 | `attendance_date` | `work_date` |
| AT-2 | C | SPEC-04 | `check_in_time/check_out_time` | `check_in_at/check_out_at` |
| AT-3 | C | SPEC-04 | `working_minutes` | `worked_minutes` |
| AT-4 | C | SPEC-04 §22.3 | bảng `attendance_shifts`/`attendance_shift_assignments` | `shifts`/`shift_assignments` |
| AT-5 | C | SPEC-04 §22.7 | `attendance_remote_requests`, `work_location` | `remote_work_requests`, `location_text`; map DTO `date_from/to` ↔ cột |
| AT-6 | C | SPEC-04 §22.8 | bảng audit riêng `attendance_audit_logs` | Bỏ — dùng `audit_logs` chung |
| AT-7 | H | SPEC-04 §22.1 | `status/source/is_remote` | `attendance_status/attendance_source/work_mode`; thêm `overtime_minutes/applied_rule_id/has_pending_adjustment` |
| AT-8 | H | SPEC-04 §23 | path `/api/attendance/...` + đánh số ATT-API tuần tự | `/api/v1/attendance/...` + đánh số theo dải (API-04) |
| AT-9 | H | API-04 ATT-API-204/304 | quyền ghi dạng văn xuôi | mã cụ thể `ATT.ADJUSTMENT.VIEW_*`, `ATT.REMOTE_REQUEST.VIEW_*` |
| AT-10 | M | SPEC-04 (thiếu) | thiếu `ATT.ATTENDANCE.RECALCULATE` (API/DB/BE đã dùng) | thêm vào SPEC-04 + API-10 matrix |
| AT-11 | M | SPEC-04 §22.3 | `shift_type` = Fixed/Flexible | DB-04 CHECK rộng hơn (Fixed/Flexible/Split/Night) → chốt MVP scope |
| AT-12 | H | SPEC-04 §15.10 | self-approval "không nên" (mềm) | Hard-rule: người tạo ≠ người duyệt + `ATT-ERR-SELF-APPROVAL` + deny-path test |
| AT-13 | M | SPEC-04 §16, DB-04 | tích hợp `public_holidays` mơ hồ (không FK/endpoint) | Định nghĩa contract ATT→Foundation `public_holidays` |

---

## 4. LEAVE (SPEC-05, DB-05, API-05, BACKEND-07)

| # | Mức | Chỗ | Hiện tại (lệch) | Sửa thành (chuẩn) |
|---|---|---|---|---|
| LV-1 | C | SPEC-05 §18 / API-05 §24 / BE-07 | 3 hệ mã lỗi rời rạc (số SPEC / slug API / số-khác-nghĩa BE) | Chốt 1 bộ canonical + map FE↔BE↔API |
| LV-2 | C | FE-10 vs BE-07 | **`LEAVE-ERR-016` trái nghĩa**: FE "không có người duyệt" / BE "sai chuyển trạng thái" | Đồng bộ ngay theo bộ canonical (LV-1) |
| LV-3 | H | SPEC-05 §15.4 vs DB-05 §7.3 vs FE-10 | công thức số dư + tập field lệch (thiếu `carried_forward`/`expired_days` ở FE) | Thống nhất 1 công thức + 1 tập field; thêm `carry_forward`+`expired` vào FE-10 entity |
| LV-4 | H | SPEC-05 §9.2 / DB-05 §8.1 (thiếu) | thiếu quyền API dùng: `SUBMIT`, `REVOKE`, `FILE.*`, `BALANCE.TRANSACTION_VIEW`, `POLICY.CREATE/DELETE`, `TYPE.CREATE/DELETE` | bổ sung vào SPEC-05 §9.2 + DB-05 §8.1 seed |
| LV-5 | H | SPEC-05 §9.2 vs API-05 | VIEW tách lẻ `VIEW_TEAM/DEPARTMENT/COMPANY` vs gộp `VIEW`+scope | chốt 1 mô hình cho permission matrix |
| LV-6 | H | SPEC-05 §14.9 | self-approval "không nên" (mềm) | Hard-rule MUST + `LEAVE-TC` deny-path (khớp BE-07 §22.3) |
| LV-7 | H | FE-10 vs BE-07 | NOTI event lệch: FE thiếu `LEAVE_REQUEST_REVOKED`, có `LEAVE_LOW_BALANCE` (BE không có) | sửa FE: thêm route REVOKED, đổi/bỏ `LEAVE_LOW_BALANCE` |
| LV-8 | M | SPEC-05 §8/§17 | `Revoked` ghi "phase sau" nhưng API/DB/BE đã implement đủ | nâng `Revoked` thành trạng thái MVP chính thức |
| LV-9 | M | SPEC-05 §16.6 vs DB-05 §13.1 | bảng riêng `leave_request_files` | bỏ — dùng `files`+`file_links` chung |
| LV-10 | M | SPEC-05 §16.7 vs DB-05 §7.4 | transaction-type 7 (PascalCase) vs 12 (UPPER_SNAKE) | chuẩn theo DB-05 |
| LV-11 | M | SPEC-05 §17 | path `/api/leave-requests/...` (không `/v1`) | `/api/v1/leave/requests/...` (API-05) |

---

## 5. TASK (SPEC-06, DB-06, API-06, BACKEND-08)

| # | Mức | Chỗ | Hiện tại (lệch) | Sửa thành (chuẩn) |
|---|---|---|---|---|
| TK-1 | H | SPEC-06 §8.2 / DB-06 §12.1 (thiếu) | thiếu `TASK.PROJECT.FILE_UPLOAD/DELETE` (API/BE dùng) | bổ sung vào SPEC + DB seed |
| TK-2 | H | SPEC-06 §15 | checklist 1 bảng phẳng | DB/API/BE: 2 bảng `task_checklists` + `task_checklist_items` |
| TK-3 | H | SPEC-06 §18a vs API-06 §25 | mã lỗi số `TASK-ERR-001..042` vs slug | chốt 1 hệ (nhất quán với LEAVE) |
| TK-4 | H | SPEC-06 §16.3 vs API-06 §10.4 | `PUT /tasks/{id}/status`, `/assignee` (không `/v1`) | `POST /api/v1/tasks/{id}/change-status`, `/assign`, +`change-priority`/`change-deadline` |
| TK-5 | M | SPEC-06 §15.3 | `assignee_id/reporter_id` (đơn) | `main_assignee_employee_id` + bảng `task_assignees` (multi) + `reporter_employee_id` |
| TK-6 | M | SPEC-06 | `due_date` / `order_index` / `is_archived` | DB: `due_at` / `sort_order` / `is_locked` |
| TK-7 | M | DB-06 §8.7 (nội bộ) | enum `assignee_role` thiếu `Reviewer` (CHECK §7.5 có 3) | sửa §8.7 = `Main/CoAssignee/Reviewer` |
| TK-8 | M | SPEC-06 §19 vs DB/API | NOTI event 3 quy ước; DB thiếu `TASK_COMPLETED` | chốt string-code canonical (SPEC-08); thêm `TASK_COMPLETED` vào DB |
| TK-9 | M | SPEC-06 §15 vs DB-06 §4.3 | `company_id` "nếu multi-company"; nhiều bảng con thiếu | `company_id` NOT NULL **mọi bảng** (Bất biến #1) |
| TK-10 | M | SPEC-06 §16.6 | checklist update dùng `TASK.TASK.UPDATE_STATUS` | `TASK.TASK.UPDATE` |

---

## 6. DASH + NOTI (SPEC-07/08, DB-07, API-07/08, BACKEND-09/10)

| # | Mức | Chỗ | Hiện tại (lệch) | Sửa thành (chuẩn) |
|---|---|---|---|---|
| DN-1 | C | SPEC-08 §17 | path `/api/notifications/me`, verb PATCH (không `/v1`) | API-07: `/api/v1/notifications`, POST `mark-read`/`mark-all-read`, `/dropdown` |
| DN-2 | C | SPEC-08 §14 | tên bảng `notification_logs`/`notification_user_preferences`/`notification_channels` | DB-07: `notification_delivery_logs`/`notification_preferences`; bỏ `notification_channels` (ở settings) |
| DN-3 | C | SPEC-08 §14.1 | thiếu `company_id` trên bảng notifications | thêm `company_id NOT NULL` (Bất biến #1), trỏ DB-07 |
| DN-4 | H | SPEC-08 §19 vs API-07 | mã lỗi số `NOTI-ERR-001..015` vs slug | chốt 1 hệ; sửa tham chiếu trong NOTI-SCREEN-010 |
| DN-5 | H | DB-07 §8.4 vs §10.1 (tự mâu thuẫn) | `NOTI.TYPE.*` vs `NOTI.EVENT.*` | chốt `NOTI.EVENT.*` (khớp API-07/BE-09) |
| DN-6 | H | SPEC-08 §17 vs API-07/BE-09 | 3 cách đánh số `NOTI-API-XXX` trùng-số-khác-nghĩa | chốt 1 bảng (theo API-07) |
| DN-7 | M | SPEC-07 §8.2/DB-07 §10.2 (thiếu) | thiếu `DASH.CACHE.REFRESH` (API/BE dùng) | bổ sung vào seed |
| DN-8 | M | SPEC-07 §19 vs API-08 | mã lỗi DASH số vs slug | chốt slug (API-08) |
| DN-9 | M | SPEC-07 §14.15–14.19 | module nguồn widget = "System config" (mơ hồ) | đổi thành `FOUNDATION`/`AUDIT` (khớp API-08/BE-10) |
| DN-10 | M | SPEC-08 registry | thiếu event "nhắc check-in/out" mà DASH §4.1 nhắc | thêm `ATT_CHECKIN_REMINDER`/`ATT_CHECKOUT_REMINDER` hoặc bỏ khỏi mô tả DASH |
| DN-11 | M | SPEC-08 §18.2 | response chỉ `unread_count` | thêm `high_priority_unread_count`/`urgent_unread_count` (API-07/FE-12) |

---

## 7. Việc xác nhận chéo (cross-module)
- Đối chiếu danh sách **NOTI-EVENT** mà LEAVE/ATT/TASK hứa phát ↔ registry SPEC-08 (đảm bảo không event nào thiếu producer hoặc thiếu định nghĩa).
- Thống nhất **convention masking server-side** duy nhất cho HR/ATT/DASH (đề xuất: OMIT field ở list + cờ `_masked`, chỉ trả ở detail khi đủ `*.VIEW_SENSITIVE` + scope).
- Sau khi chốt hệ mã lỗi (số vs slug) cho 1 module, áp **nhất quán toàn bộ 7 module** theo SPEC-01 §9.6.
