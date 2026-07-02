# API-10: PERMISSION MATRIX (Tổng hợp)

**HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ — Consolidated RBAC Permission Matrix**

> **📚 Bộ tài liệu API**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>) · **API-10 Permission Matrix** · [API-10 Audit Report](<API-10 PERMISSION AUDIT REPORT.md>)
>
> **Nguồn:** Trích xuất từ phần "Required permission / Allowed roles / Data scope" của API-02 → API-09 và quy chuẩn authorization của [API-01 §7](<API-01 TỔNG QUAN.md>).

---

## 1. Thông tin tài liệu

| Trường         | Nội dung                                          |
| -------------- | ------------------------------------------------- |
| Mã tài liệu    | API-10                                            |
| Tên tài liệu   | Permission Matrix tổng hợp                        |
| Phiên bản      | v1.0                                              |
| Trạng thái     | Draft                                             |
| Phạm vi        | API-02 AUTH → API-09 FOUNDATION                   |
| Tài liệu nguồn | API-01 → API-09                                   |
| Tài liệu liên quan | [API-10 Permission Audit Report](<API-10 PERMISSION AUDIT REPORT.md>) |
| Ngày tạo       | 20/06/2026                                        |

---

## 2. Mục đích & cách đọc

Tài liệu này hợp nhất **toàn bộ permission RBAC** của 8 module nghiệp vụ vào một bảng tham chiếu duy nhất, phục vụ:

1. Seed `permissions` và `role_permissions` (DB-10 bootstrap).
2. Cấu hình permission guard / policy ở backend.
3. Đối chiếu chéo giữa các module (tránh trùng/thiếu permission).
4. Sinh `x-required-permission` / `x-data-scope` cho OpenAPI (xem `openapi/enterprise-api.yaml`).

> ⚠️ **Cảnh báo độ tin cậy.** Một số endpoint trong API-02 → API-09 **không khai báo đầy đủ** Allowed roles / Data scope ở detail block. Cột "Default roles (seed)" dưới đây là **đề xuất chuẩn hóa** dựa trên `Required permission`, scope ngầm định và ví dụ trong API-01 §26 — KHÔNG phải lúc nào cũng được khai báo verbatim trong module doc. Các điểm cần chốt được liệt kê trong [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

**Ký hiệu role (cột grid):**

| Mã | Role | Scope mặc định |
| -- | ---- | -------------- |
| `SA`  | Super Admin            | System |
| `CA`  | Company Admin (Admin công ty) | Company |
| `HR`  | HR                     | Company / Department |
| `MGR` | Manager                | Team |
| `PM`  | Project Manager        | Project |
| `PO`  | Payroll Officer        | Company (read leave/att) |
| `EMP` | Employee               | Own |

Ký hiệu ô grid: `✓` = được seed mặc định · `(✓)` = chỉ khi được cấp thêm (grant tùy chọn) · trống = không.

---

## 3. Mô hình data scope (nhắc lại API-01 §7.2)

`Own ⊂ Team ⊂ Department ⊂ Company ⊂ System`; `Project` là scope ngang (theo membership dự án). Backend luôn kiểm tra **permission AND scope AND target-in-scope** (API-01 §7.3).

---

## 4. Quy ước đặt tên permission (chuẩn hóa đề xuất)

```text
MODULE.RESOURCE.ACTION
```

- `MODULE` ∈ { AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION }
- `RESOURCE` = danh từ tài nguyên (EMPLOYEE, REQUEST, SHIFT…). Dùng `_` cho tên ghép (AUDIT_LOG, SHIFT_ASSIGNMENT).
- `ACTION` = VIEW / CREATE / UPDATE / DELETE / EXPORT / APPROVE / REJECT … ; hậu tố `_OWN` / `_TEAM` / `_COMPANY` khi quyền tách theo scope.

Các sai lệch so với quy ước này được ghi trong [Audit Report §3](<API-10 PERMISSION AUDIT REPORT.md>).

---

## 5. Catalog permission theo module

Mỗi bảng: **Permission · Action · Default roles (seed) · Max data scope · Endpoint dùng**.
"Endpoint dùng" ghi theo mã API trong module doc; `(OR)` = endpoint chấp nhận quyền này HOẶC quyền khác.

### 5.1 AUTH (API-02) — prefix `/api/v1/auth`

| Permission | Default roles | Max scope | Endpoint dùng |
| ---------- | ------------- | --------- | ------------- |
| `AUTH.PASSWORD.CHANGE` | SA, CA, HR, MGR, EMP | Own | AUTH-API-007 |
| `AUTH.USER.VIEW` | SA, CA, HR(✓) | Company/System | 101, 102, 111 |
| `AUTH.USER.CREATE` | SA, CA, HR(✓) | Company/System | 103 |
| `AUTH.USER.UPDATE` | SA, CA, HR(✓) | Company/System | 104, 110, 112 |
| `AUTH.USER.LOCK` | SA, CA | Company/System | 105 |
| `AUTH.USER.UNLOCK` | SA, CA | Company/System | 106 |
| `AUTH.USER.ASSIGN_ROLE` | SA, CA | Company/System | 107, 108, 109 |
| `AUTH.ROLE.VIEW` | SA, CA | Company/System | 201, 202, 206 |
| `AUTH.ROLE.CREATE` | SA, CA | Company/System | 203 |
| `AUTH.ROLE.UPDATE` | SA, CA | Company/System | 204 |
| `AUTH.ROLE.DELETE` | SA | Company/System | 205 |
| `AUTH.PERMISSION.VIEW` | SA, CA | Company/System | 301, 302, 303, 304 |
| `AUTH.PERMISSION.ASSIGN` | SA | Company/System | 207, 208, 209 |
| `AUTH.AUDIT_LOG.VIEW` | SA, CA | Company/System | 401, 402, 403 |

> Self-service (`/auth/me/*` gồm `/auth/me/sessions*`, login, logout, refresh, forgot/reset password) = `Public` hoặc `Authenticated`, không cần permission code. **Bỏ `AUTH.SESSION.VIEW/REVOKE`** (endpoint quản lý session bản thân chỉ cần `Authenticated`). `AUTH.PROFILE.VIEW`/`AUTH.PROFILE.UPDATE`/`AUTH.LOGIN.ACCESS` chỉ là nhãn mô tả/ví dụ payload, **không phải guard** (màn hồ sơ cá nhân gate bằng `Authenticated`) → xem Audit §4.

### 5.2 HR (API-03) — prefix `/api/v1/hr`

| Permission | Default roles | Max scope | Endpoint dùng |
| ---------- | ------------- | --------- | ------------- |
| `HR.EMPLOYEE.VIEW` | SA, CA, HR, MGR, EMP(Own) | Own→System | 001, 003, 011, 101, 1002, (501 OR) |
| `HR.EMPLOYEE.VIEW_SENSITIVE` | SA, CA, HR(✓) | Company/System | gate field-level (003, 009, 202, 804) |
| `HR.EMPLOYEE.CREATE` | SA, CA, HR | Company/System | 002 |
| `HR.EMPLOYEE.UPDATE` | SA, CA, HR | Team(✓)→System | 004, 007, 008 |
| `HR.EMPLOYEE.DELETE` | SA, CA, HR(✓) | Company/System | 005 |
| `HR.EMPLOYEE.CHANGE_STATUS` | SA, CA, HR | Company/System | 006 |
| `HR.EMPLOYEE.EXPORT` | SA, CA, HR(✓) | Team→System | 009 |
| `HR.EMPLOYEE.FILE_VIEW` | SA, CA, HR(✓) | Team(✓)→System | 801, 803, 804 |
| `HR.EMPLOYEE.FILE_UPLOAD` | SA, CA, HR(✓) | Company/System | 802 |
| `HR.EMPLOYEE.FILE_DELETE` | SA, CA, HR(✓) | Company/System | 805 |
| `HR.PROFILE_CHANGE_REQUEST.CREATE` | EMP, MGR, HR, CA | Own | 102, 104 |
| `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` | EMP, MGR, HR, CA | Own | 103, 105 |
| `HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN` | EMP, MGR, HR, CA | Own | 106 |
| `HR.PROFILE_CHANGE_REQUEST.VIEW` | SA, CA, HR | Team(✓)→System | 201, 202 |
| `HR.PROFILE_CHANGE_REQUEST.APPROVE` | SA, CA, HR | Team(✓)→System | 203 |
| `HR.PROFILE_CHANGE_REQUEST.REJECT` | SA, CA, HR | Team(✓)→System | 204 |
| `HR.DEPARTMENT.VIEW` | SA, CA, HR, MGR(✓) | Company/System | 301, 302, 303 |
| `HR.DEPARTMENT.CREATE` | SA, CA, HR(✓) | Company/System | 304 |
| `HR.DEPARTMENT.UPDATE` | SA, CA, HR(✓) | Company/System | 305 |
| `HR.DEPARTMENT.DELETE` | SA, CA, HR(✓) | Company/System | 306 |
| `HR.POSITION.VIEW` | SA, CA, HR, MGR(✓) | Company/System | 401, 402 |
| `HR.POSITION.CREATE` | SA, CA, HR(✓) | Company/System | 403 |
| `HR.POSITION.UPDATE` | SA, CA, HR(✓) | Company/System | 404 |
| `HR.POSITION.DELETE` | SA, CA, HR(✓) | Company/System | 405 |
| `HR.MASTER_DATA.MANAGE` | SA, CA, HR(✓) | Company/System | 503, 504, 505, 603, 604, 605 |
| `HR.CONTRACT.VIEW` | SA, CA, HR | Team(✓)→System | 601, 602, 701, 702 |
| `HR.CONTRACT.CREATE` | SA, CA, HR | Company/System | 703 |
| `HR.CONTRACT.UPDATE` | SA, CA, HR | Company/System | 704, 706 |
| `HR.CONTRACT.DELETE` | SA, CA, HR(✓) | Company/System | 705 |
| `HR.ORG_CHART.VIEW` | SA, CA, HR, MGR | Team→System | 1001 |
| `HR.EMPLOYEE_CODE_CONFIG.VIEW` | SA, CA, HR(✓) | Company/System | 901 |
| `HR.EMPLOYEE_CODE_CONFIG.UPDATE` | SA, CA, HR(✓) | Company/System | 902 |
| `HR.EMPLOYEE_CODE.PREVIEW` | SA, CA, HR(✓) | Company/System | 903 |
| `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` | SA, CA, HR(✓) | Company/System | 904, 905 |
| `HR.AUDIT_LOG.VIEW` | SA, CA, HR(✓) | Team(✓)→System | 010 |

### 5.3 ATT (API-04) — prefix `/api/v1/attendance`

| Permission | Default roles | Max scope | Endpoint dùng |
| ---------- | ------------- | --------- | ------------- |
| `ATT.ATTENDANCE.VIEW_OWN` | EMP, MGR, HR, CA, SA | Own | 001, 101 |
| `ATT.ATTENDANCE.CHECK_IN` | EMP, MGR, HR, CA, SA | Own | 002 |
| `ATT.ATTENDANCE.CHECK_OUT` | EMP, MGR, HR, CA, SA | Own | 003 |
| `ATT.ATTENDANCE.VIEW_TEAM` | MGR, HR, CA, SA | Team | 102 |
| `ATT.ATTENDANCE.VIEW_COMPANY` | HR, CA, SA | Department/Company/System | 103 (OR) |
| `ATT.ATTENDANCE.VIEW_DETAIL` | MGR(✓), HR, CA, SA | Team→System | 104, 105, 702 |
| `ATT.ATTENDANCE.VIEW_SENSITIVE` | HR, CA, SA | Company/System | gate field-level (104, 105, 108) |
| `ATT.ATTENDANCE.ADJUST_DIRECT` | HR, CA, SA | Team→System | 106 |
| `ATT.ATTENDANCE.RECALCULATE` | HR, CA, SA | Company/System | 107 |
| `ATT.ATTENDANCE.EXPORT` | HR, CA, SA | Department→System | 108 |
| `ATT.ADJUSTMENT.VIEW_OWN` | EMP, MGR, HR, CA | Own | 201 |
| `ATT.ADJUSTMENT.CREATE_OWN` | EMP, MGR, HR, CA | Own | 202 |
| `ATT.ADJUSTMENT.VIEW_TEAM` | MGR, HR, CA, SA | Team | 203 (OR) |
| `ATT.ADJUSTMENT.VIEW_COMPANY` | HR, CA, SA | Company/System | 203 (OR) |
| `ATT.ADJUSTMENT.APPROVE` | MGR, HR, CA, SA | Team→System | 205 |
| `ATT.ADJUSTMENT.REJECT` | MGR, HR, CA, SA | Team→System | 206 |
| `ATT.ADJUSTMENT.CANCEL_OWN` | EMP, MGR, HR, CA | Own | 207 |
| `ATT.REMOTE_REQUEST.VIEW_OWN` | EMP, MGR, HR, CA | Own | 301 |
| `ATT.REMOTE_REQUEST.CREATE_OWN` | EMP, MGR, HR, CA | Own | 302 |
| `ATT.REMOTE_REQUEST.VIEW_TEAM` | MGR, HR, CA, SA | Team | 303 (OR) |
| `ATT.REMOTE_REQUEST.VIEW_COMPANY` | HR, CA, SA | Company/System | 303 (OR) |
| `ATT.REMOTE_REQUEST.APPROVE` | MGR, HR, CA, SA | Team→System | 305 |
| `ATT.REMOTE_REQUEST.REJECT` | MGR, HR, CA, SA | Team→System | 306 |
| `ATT.REMOTE_REQUEST.CANCEL_OWN` | EMP, MGR, HR, CA | Own | 307 |
| `ATT.SHIFT.VIEW` | HR, CA, SA, MGR(✓) | Company/System | 401, 403 |
| `ATT.SHIFT.CREATE` | HR, CA, SA | Company/System | 402 |
| `ATT.SHIFT.UPDATE` | HR, CA, SA | Company/System | 404 |
| `ATT.SHIFT.DELETE` | HR, CA, SA | Company/System | 405 |
| `ATT.SHIFT_ASSIGNMENT.VIEW` | HR, CA, SA, MGR(✓) | Company/System | 501, 503 |
| `ATT.SHIFT_ASSIGNMENT.UPDATE` | HR, CA, SA | Company/System | 502, 504, 505 |
| `ATT.RULE.VIEW` | HR, CA, SA | Company/System | 601, 603, 606 |
| `ATT.RULE.CONFIG` | HR, CA, SA | Company/System | 602, 604, 605 |
| `ATT.AUDIT_LOG.VIEW` | HR, CA, SA | Company/System | 701 |

> Internal jobs ATT-API-801/802/803 dùng `internalServiceAuth`, không gắn permission RBAC.

### 5.4 LEAVE (API-05) — prefix `/api/v1/leave`

| Permission | Default roles | Max scope | Endpoint dùng |
| ---------- | ------------- | --------- | ------------- |
| `LEAVE.BALANCE.VIEW_OWN` | EMP, MGR, HR | Own | 001, 002, 003 |
| `LEAVE.REQUEST.VIEW_OWN` | EMP, MGR, HR | Own | 101, 102 |
| `LEAVE.REQUEST.CREATE` | EMP, MGR, HR | Own | 103, (301 OR), (606 OR) |
| `LEAVE.REQUEST.UPDATE_DRAFT` | EMP | Own | 104, (107 OR) |
| `LEAVE.REQUEST.SUBMIT` | EMP | Own | 105, (302 OR) |
| `LEAVE.REQUEST.CANCEL_OWN` | EMP | Own | 106, (107 OR) |
| `LEAVE.REQUEST.VIEW` | SA, CA, HR, MGR, PO | Team→System | 201, 202, (208 OR), (301 OR) |
| `LEAVE.REQUEST.APPROVE` | MGR, HR, CA, SA | Team→System | 203(OR), 204 |
| `LEAVE.REQUEST.REJECT` | MGR, HR, CA, SA | Team→System | 203(OR), 205 |
| `LEAVE.REQUEST.CANCEL_ANY` | HR, CA, SA | Department→System | 206 |
| `LEAVE.REQUEST.REVOKE` | HR, CA, SA | Department→System | 207 |
| `LEAVE.REQUEST.EXPORT` | HR, CA, SA, PO(✓) | Department→System | 901, (902 OR), (903 OR) |
| `LEAVE.CALENDAR.VIEW_OWN` | EMP, MGR, HR | Own | 401 |
| `LEAVE.CALENDAR.VIEW_TEAM` | MGR, HR, CA, SA | Team | 402, 403(OR) |
| `LEAVE.CALENDAR.VIEW_COMPANY` | HR, CA, SA | Company/System | 403(OR), (902 OR) |
| `LEAVE.TYPE.VIEW` | EMP, MGR, HR, CA | Company/System | 501(OR), 502 |
| `LEAVE.TYPE.CREATE` | HR, CA, SA | Company/System | 503 |
| `LEAVE.TYPE.UPDATE` | HR, CA, SA | Company/System | 504 |
| `LEAVE.TYPE.DELETE` | HR, CA, SA | Company/System | 505 |
| `LEAVE.POLICY.VIEW` | HR, CA, SA | Company/System | 601, 602, (606 OR) |
| `LEAVE.POLICY.CREATE` | HR, CA, SA | Company/System | 603 |
| `LEAVE.POLICY.UPDATE` | HR, CA, SA | Company/System | 604 |
| `LEAVE.POLICY.DELETE` | HR, CA, SA | Company/System | 605 |
| `LEAVE.BALANCE.VIEW` | HR, CA, SA, MGR(✓) | Team→System | 701, 702, (903 OR) |
| `LEAVE.BALANCE.TRANSACTION_VIEW` | HR, CA, SA | Company/System | 703 |
| `LEAVE.BALANCE.ADJUST` | HR, CA, SA | Department→System | 704, 705 |
| `LEAVE.FILE.VIEW` | EMP(owner), MGR, HR, CA, SA | Own→System | 801(OR), 803(OR) |
| `LEAVE.FILE.UPLOAD` | EMP(owner), HR, CA | Own→System | 802(OR) |
| `LEAVE.FILE.DELETE` | EMP(owner), HR, CA | Own→System | 804(OR) |
| `LEAVE.AUDIT_LOG.VIEW` | HR, CA, SA | Company/System | 208(OR) |

### 5.5 TASK (API-06) — prefix `/api/v1/tasks`

| Permission | Default roles | Max scope | Endpoint dùng |
| ---------- | ------------- | --------- | ------------- |
| `TASK.PROJECT.VIEW` | SA, CA, MGR, PM, EMP(member), HR(✓) | Own→System | 11.1, 11.3, 12.1, 18.1(GET), 19.2(OR) |
| `TASK.PROJECT.CREATE` | SA, CA, MGR, PM, HR(✓) | Team→System | 11.2 |
| `TASK.PROJECT.UPDATE` | SA, CA, MGR, PM | Project→System | 11.4, 11.6(OR) |
| `TASK.PROJECT.CLOSE` | SA, CA, MGR, PM | Project→System | 11.5, 11.6(OR) |
| `TASK.PROJECT.ARCHIVE` | SA, CA, MGR, PM | Project→System | 11.7 |
| `TASK.PROJECT.DELETE` | SA, CA, MGR(✓) | Project→System | 11.8 |
| `TASK.PROJECT.MANAGE_MEMBER` | SA, CA, MGR, PM | Project | 12.2, 12.3, 12.4 |
| `TASK.PROJECT.FILE_UPLOAD` | SA, CA, MGR, PM, EMP(member) | Project | 18.1(POST) |
| `TASK.PROJECT.FILE_DELETE` | SA, CA, MGR, PM | Project | 18.1(DELETE) |
| `TASK.PROJECT.VIEW_REPORT` | SA, CA, MGR, PM | Project→System | 20.1, 20.2(OR), 21.2(OR) |
| `TASK.TASK.VIEW` | SA, CA, MGR, PM, EMP(member) | Own→System | 13.1, 13.3, 13.4, 10.3*, 16.1, 17.1, 18.2(GET), 19.1(OR), 20.2(OR) |
| `TASK.TASK.CREATE` | SA, CA, MGR, PM, EMP(member) | Project | 13.2 |
| `TASK.TASK.UPDATE` | SA, CA, MGR, PM, EMP(assignee) | Project | 13.5, 17.2–17.7 |
| `TASK.TASK.DELETE` | SA, CA, MGR, PM | Project | 13.6 |
| `TASK.TASK.ASSIGN` | SA, CA, MGR, PM | Project | 14.1 |
| `TASK.TASK.UPDATE_STATUS` | SA, CA, MGR, PM, EMP(assignee) | Project | 14.2 |
| `TASK.TASK.UPDATE_PRIORITY` | SA, CA, MGR, PM | Project | 14.3, (13.5 cond) |
| `TASK.TASK.UPDATE_DEADLINE` | SA, CA, MGR, PM | Project | 14.4, (13.5 cond) |
| `TASK.TASK.WATCH` | SA, CA, MGR, PM, EMP(member) | Project | 14.5, 14.6 |
| `TASK.TASK.VIEW_KANBAN` | SA, CA, MGR, PM, EMP(member) | Project | 15.1 |
| `TASK.TASK.COMMENT` | SA, CA, MGR, PM, EMP(member) | Project | 16.2, 16.3, 16.4 |
| `TASK.TASK.FILE_UPLOAD` | SA, CA, MGR, PM, EMP(member) | Project | 18.2(POST) |
| `TASK.TASK.FILE_DELETE` | SA, CA, MGR, PM | Project | 18.2(DELETE) |
| `TASK.TASK.EXPORT` | SA, CA, MGR, PM(✓) | Project→System | 21.1 |
| `TASK.AUDIT_LOG.VIEW` | SA, CA, MGR(✓) | Project→System | 19.1(OR), 19.2(OR) |

> `*10.3` = nhóm aggregate `/assigned-to-me`, `/created-by-me`, `/watching`, `/overdue`, `/due-soon` (scope Own).

### 5.6 NOTI (API-07) — prefix `/api/v1/notifications`

| Permission | Default roles | Max scope | Endpoint dùng |
| ---------- | ------------- | --------- | ------------- |
| `NOTI.NOTIFICATION.VIEW_OWN` | EMP, MGR, HR, CA, SA | Own | 001, 002 |
| `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` | EMP, MGR, HR, CA, SA | Own | 004, 005 |
| `NOTI.NOTIFICATION.COUNT_UNREAD_OWN` | EMP, MGR, HR, CA, SA | Own | 003 |
| `NOTI.NOTIFICATION.MARK_READ_OWN` | EMP, MGR, HR, CA, SA | Own | 101, 102 |
| `NOTI.NOTIFICATION.MARK_ALL_READ_OWN` | EMP, MGR, HR, CA, SA | Own | 103 |
| `NOTI.NOTIFICATION.HIDE_OWN` | EMP, MGR, HR, CA, SA | Own | 104, 105 |
| `NOTI.NOTIFICATION.DELETE_OWN` | EMP, MGR, HR, CA, SA | Own | 106 |
| `NOTI.NOTIFICATION.VIEW_COMPANY` | SA, CA(✓) | Company/System | 201, 202 |
| `NOTI.NOTIFICATION.CREATE_SYSTEM` | SA, CA(✓) | Company/System | 203 |
| `NOTI.NOTIFICATION.SEND_SYSTEM` | SA, CA(✓) | Company/System | 204 |
| `NOTI.EVENT.VIEW` | SA, CA, HR(✓) | Company/System | 301 |
| `NOTI.EVENT.CONFIG` | SA, CA, HR(✓) | Company/System | 302 |
| `NOTI.TEMPLATE.VIEW` | SA, CA, HR(✓) | Company/System | 303, 306 |
| `NOTI.TEMPLATE.CREATE` | SA, CA, HR(✓) | Company/System | 304(OR) |
| `NOTI.TEMPLATE.UPDATE` | SA, CA, HR(✓) | Company/System | 304(OR), 305 |
| `NOTI.TEMPLATE.DELETE` | SA, CA(✓) | Company/System | *(không có endpoint — xem Audit)* |
| `NOTI.CHANNEL.VIEW` | SA, CA(✓) | Company/System | 307 |
| `NOTI.CHANNEL.UPDATE` | SA, CA(✓) | Company/System | 308 |
| `NOTI.LOG.VIEW` | SA, CA(✓) | Company/System | 401, 402 |
| `NOTI.LOG.RETRY` | SA, CA(✓) | Company/System | 403 |
| `NOTI.AUDIT_LOG.VIEW` | SA, CA(✓) | Company/System | *(không có endpoint — xem Audit)* |

> Internal NOTI (`/internal/v1/notifications/*`) dùng `internalServiceAuth`.

### 5.7 DASH (API-08) — prefix `/api/v1/dashboard`

> DASH dùng mô hình **permission + data_scope + dashboard_type + widget_code**; "Allowed roles" trong API-08 chỉ là gợi ý (API-08 §6.1).
>
> **Bỏ permission chung `DASH.WIDGET.VIEW`** (route widget-catalog): route catalog widget gate bằng `DASH.DASHBOARD.VIEW`; mỗi widget nhạy cảm còn gate thêm `DASH.WIDGET.VIEW_<WIDGET>` (per-widget) bên dưới.

| Permission | Default roles | Max scope | Endpoint dùng |
| ---------- | ------------- | --------- | ------------- |
| `DASH.DASHBOARD.VIEW` | EMP, MGR, HR, CA, SA | per-widget | 001, 002, 003, 008 |
| `DASH.DASHBOARD.VIEW_EMPLOYEE` | EMP, MGR, HR, CA, SA | per-widget | 004 |
| `DASH.DASHBOARD.VIEW_MANAGER` | MGR, HR(✓), CA, SA | per-widget | 005 |
| `DASH.DASHBOARD.VIEW_HR` | HR, CA(✓), SA | per-widget | 006 |
| `DASH.DASHBOARD.VIEW_ADMIN` | CA, SA | per-widget | 007 |
| `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | EMP, MGR, HR, CA, SA | Own | 101 |
| `DASH.WIDGET.VIEW_MY_TASKS` | EMP, MGR, HR, CA, SA | Own | 102 |
| `DASH.WIDGET.VIEW_TASK_ALERTS` | EMP, MGR, HR(✓), CA, SA | Own→System | 103 |
| `DASH.WIDGET.VIEW_LEAVE_BALANCE` | EMP, MGR, HR, CA, SA | Own | 104 |
| `DASH.WIDGET.VIEW_PENDING_LEAVE` | MGR, HR, CA, SA | Team→System | 105 |
| `DASH.WIDGET.VIEW_LEAVE_CALENDAR` | MGR, HR, CA, SA | Team→System | 106 |
| `DASH.WIDGET.VIEW_NOTIFICATIONS` | EMP, MGR, HR, CA, SA | Own | 107 |
| `DASH.WIDGET.VIEW_HR_OVERVIEW` | HR, CA, SA | Department→System | 108 |
| `DASH.WIDGET.VIEW_NEW_EMPLOYEES` | HR, CA, SA | Department→System | 109 |
| `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` | HR, CA, SA | Department→System | 110 |
| `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` | MGR, HR, CA, SA | Team→System | 111 |
| `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | EMP(member), MGR, HR(✓), CA, SA | Own→System | 112 |
| `DASH.WIDGET.VIEW_USER_SUMMARY` | CA, SA | Company/System | 113 |
| `DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY` | CA, HR(✓), SA | Company/System | 114 |
| `DASH.WIDGET.VIEW_MODULE_STATUS` | CA, SA | Company/System | 115 |
| `DASH.WIDGET.VIEW_CONFIG_WARNINGS` | CA, SA | Company/System | 116 |
| `DASH.WIDGET.VIEW_NEW_USERS` | CA, SA | Company/System | 117 |
| `DASH.WIDGET.VIEW_SYSTEM_LOGS` | CA, SA | Company/System | 118 |
| `DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS` | CA, SA | Company/System | 119 |
| `DASH.WIDGET.VIEW_LATEST_LEAVE` | EMP, MGR, HR, CA, SA | Own | 120 |
| `DASH.WIDGET.VIEW_TEAM_TASKS_TODAY` | MGR, HR(✓), CA, SA | Team→System | 121 |
| `DASH.WIDGET.VIEW_PROBATION_ENDING` | HR, CA, SA | Department→System | 122 |
| `DASH.CONFIG.VIEW` | CA, SA | Company/System | 201, 203 |
| `DASH.CONFIG.UPDATE` | CA, SA | Company/System | 202, 204, 205, 206, 207, 208 |
| `DASH.AUDIT_LOG.VIEW` | CA, SA | Company/System | *(không có endpoint — xem Audit)* |
| `DASH.CACHE.REFRESH` | SA | System | *(không có endpoint — xem Audit)* |

> Internal DASH (`/internal/v1/dashboard/*`) dùng `internalServiceAuth`.

### 5.8 FOUNDATION (API-09) — prefix `/api/v1/foundation`

> **Catalog chuẩn = [BACKEND-11 §8.1](<../BACKEND/BACKEND-11_File_Audit_Settings_System_Jobs.md>)**. Bỏ tiền tố `SYSTEM.*` (BE-04 cũ). Company tách `VIEW`/`UPDATE` (bỏ `.MANAGE`). Settings dùng `VIEW`/`UPDATE`/`SYSTEM_MANAGE`. Audit dùng `FOUNDATION.AUDIT_LOG.*`.

| Permission | Default roles | Max scope | Endpoint dùng |
| ---------- | ------------- | --------- | ------------- |
| `FOUNDATION.COMPANY.VIEW` | EMP, MGR, HR, CA, SA | Company/System | company/current (GET), companies(list) |
| `FOUNDATION.COMPANY.UPDATE` | CA(own), SA | Company/System | company/current (PATCH), companies suspend/activate |
| `FOUNDATION.MODULE.VIEW` | CA, SA, (EMP public) | Company/System | modules, modules/{code} |
| `FOUNDATION.MODULE.UPDATE` | SA | System | modules/{code} PATCH |
| `FOUNDATION.SETTING.VIEW` | Authenticated / CA, HR | Company/System | settings/resolve, company-settings(list) |
| `FOUNDATION.SETTING.UPDATE` | CA, SA | Company/System | company-settings PATCH/reset |
| `FOUNDATION.SETTING.SYSTEM_MANAGE` | SA | System | system-settings list (GET) + PATCH |
| `FOUNDATION.AUDIT_LOG.VIEW` | CA, SA, AUD | Company/System | audit-logs (+entity, detail) |
| `FOUNDATION.AUDIT_LOG.EXPORT` | CA, SA, AUD | Company/System | audit-logs/export |
| `FOUNDATION.FILE.UPLOAD` | EMP, MGR, HR, CA, SA (per module) | Company+module | files/upload POST |
| `FOUNDATION.FILE.VIEW` | per module policy | Company+module | files/{id}, files(list) |
| `FOUNDATION.FILE.DOWNLOAD` | per module policy | Company+module | files/{id}/download, files/{id}/download-url |
| `FOUNDATION.FILE.DELETE` | per module policy | Company+module | files/{id} DELETE |
| `FOUNDATION.FILE.LINK` | per module policy | Company+module | file-links POST |
| `FOUNDATION.FILE.UNLINK` | per module policy | Company+module | file-links/{id} DELETE |
| `FOUNDATION.FILE_ACCESS_LOG.VIEW` | CA, SA, AUD | Company/System | file-access-logs |
| `FOUNDATION.SEQUENCE.VIEW` | CA, SA | Company/System | sequences(list), sequences/{key}/preview |
| `FOUNDATION.SEQUENCE.UPDATE` | CA(✓), SA | Company/System | sequences POST/PATCH |
| `FOUNDATION.HOLIDAY.VIEW` | EMP, MGR, HR, CA, SA | Company/System | public-holidays, /check |
| `FOUNDATION.HOLIDAY.MANAGE` | HR(✓), CA, SA | Company/System | public-holidays POST/PATCH/DELETE/import |
| `FOUNDATION.RETENTION.VIEW` | CA(✓), SA | Company/System | retention-policies(list) |
| `FOUNDATION.RETENTION.MANAGE` | SA | System | retention-policies POST/PATCH |
| `FOUNDATION.JOB.VIEW` | CA(✓), SA | Company/System | system-jobs(list), system-job-runs |
| `FOUNDATION.JOB.RUN` | SA | System | system-jobs/{code}/run (manual trigger) |
| `FOUNDATION.SEED.VIEW` | SA | System | seed-batches, seed-items |
| `FOUNDATION.SEED.RUN` | internal/SA | System | (internal) seeds/run |

> **CHỐT 2026-07-02 (S2-FND-DOC-1):** Ma trận FOUNDATION dotted trên = NHÃN đọc-hiểu; catalog THỰC THI CHUẨN = tuple `(action, resource_type)` namespace `foundation-*` seed `0435_foundation_db5_retention_seed_modules.sql` (28 cặp). Cờ `is_sensitive=TRUE` (khớp seed 0435): `update:foundation-module`, `system-manage:foundation-setting`, `manage:foundation-retention`, `run:foundation-job`, `view:foundation-seed`, `run:foundation-seed`; các cặp `foundation-*` còn lại `is_sensitive=FALSE`. Khi seed↔doc lệch → seed 0435 thắng.

> Internal FOUNDATION (`/internal/v1/foundation/*`) + `/api/v1/health` dùng `internalServiceAuth` / public health. Sinh mã sequence chạy qua internal service (`FOUNDATION.SEQUENCE.UPDATE` chỉ gate cấu hình; sinh mã thực thi nội bộ).

---

## 6. Role × Permission seed grid (gợi ý bootstrap)

> `✓` seed mặc định · `(✓)` grant tùy chọn · trống = không. Đây là **đề xuất seed** để DB-10 khởi tạo `role_permissions`; backend vẫn enforce theo permission, không hard-code theo role (API-01 §7.5).

### 6.1 AUTH

| Permission | SA | CA | HR | MGR | EMP |
| ---------- | -- | -- | -- | --- | --- |
| PASSWORD.CHANGE | ✓ | ✓ | ✓ | ✓ | ✓ |
| USER.VIEW | ✓ | ✓ | (✓) | | |
| USER.CREATE | ✓ | ✓ | (✓) | | |
| USER.UPDATE | ✓ | ✓ | (✓) | | |
| USER.LOCK / UNLOCK | ✓ | ✓ | | | |
| USER.ASSIGN_ROLE | ✓ | ✓ | | | |
| ROLE.VIEW | ✓ | ✓ | | | |
| ROLE.CREATE / UPDATE | ✓ | ✓ | | | |
| ROLE.DELETE | ✓ | | | | |
| PERMISSION.VIEW | ✓ | ✓ | | | |
| PERMISSION.ASSIGN | ✓ | | | | |
| AUDIT_LOG.VIEW | ✓ | ✓ | | | |

### 6.2 HR

| Permission (rút gọn) | SA | CA | HR | MGR | EMP |
| -------------------- | -- | -- | -- | --- | --- |
| EMPLOYEE.VIEW | ✓ | ✓ | ✓ | ✓ | ✓(Own) |
| EMPLOYEE.VIEW_SENSITIVE | ✓ | ✓ | (✓) | | |
| EMPLOYEE.CREATE/UPDATE/CHANGE_STATUS | ✓ | ✓ | ✓ | | |
| EMPLOYEE.DELETE/EXPORT | ✓ | ✓ | (✓) | | |
| EMPLOYEE.FILE_* | ✓ | ✓ | (✓) | | |
| PROFILE_CHANGE_REQUEST.*_OWN / CREATE | ✓ | ✓ | ✓ | ✓ | ✓ |
| PROFILE_CHANGE_REQUEST.VIEW/APPROVE/REJECT | ✓ | ✓ | ✓ | | |
| DEPARTMENT.VIEW / POSITION.VIEW | ✓ | ✓ | ✓ | (✓) | |
| DEPARTMENT.* (write) / POSITION.* (write) | ✓ | ✓ | (✓) | | |
| MASTER_DATA.MANAGE | ✓ | ✓ | (✓) | | |
| CONTRACT.VIEW | ✓ | ✓ | ✓ | | |
| CONTRACT.CREATE/UPDATE/DELETE | ✓ | ✓ | ✓ | | |
| ORG_CHART.VIEW | ✓ | ✓ | ✓ | ✓ | |
| EMPLOYEE_CODE* / CONFIG* | ✓ | ✓ | (✓) | | |
| AUDIT_LOG.VIEW | ✓ | ✓ | (✓) | | |

### 6.3 ATT

| Permission (rút gọn) | SA | CA | HR | MGR | EMP |
| -------------------- | -- | -- | -- | --- | --- |
| ATTENDANCE.VIEW_OWN / CHECK_IN / CHECK_OUT | ✓ | ✓ | ✓ | ✓ | ✓ |
| ATTENDANCE.VIEW_TEAM | ✓ | ✓ | ✓ | ✓ | |
| ATTENDANCE.VIEW_COMPANY / VIEW_DETAIL | ✓ | ✓ | ✓ | (✓) | |
| ATTENDANCE.VIEW_SENSITIVE | ✓ | ✓ | ✓ | | |
| ATTENDANCE.ADJUST_DIRECT / RECALCULATE / EXPORT | ✓ | ✓ | ✓ | | |
| ADJUSTMENT.*_OWN | ✓ | ✓ | ✓ | ✓ | ✓ |
| ADJUSTMENT.VIEW_TEAM / APPROVE / REJECT | ✓ | ✓ | ✓ | ✓ | |
| ADJUSTMENT.VIEW_COMPANY | ✓ | ✓ | ✓ | | |
| REMOTE_REQUEST.*_OWN | ✓ | ✓ | ✓ | ✓ | ✓ |
| REMOTE_REQUEST.VIEW_TEAM / APPROVE / REJECT | ✓ | ✓ | ✓ | ✓ | |
| REMOTE_REQUEST.VIEW_COMPANY | ✓ | ✓ | ✓ | | |
| SHIFT.* / SHIFT_ASSIGNMENT.* / RULE.* | ✓ | ✓ | ✓ | (✓ view) | |
| AUDIT_LOG.VIEW | ✓ | ✓ | ✓ | | |

### 6.4 LEAVE

| Permission (rút gọn) | SA | CA | HR | MGR | EMP | PO |
| -------------------- | -- | -- | -- | --- | --- | -- |
| BALANCE.VIEW_OWN / REQUEST.VIEW_OWN | ✓ | ✓ | ✓ | ✓ | ✓ | |
| REQUEST.CREATE / UPDATE_DRAFT / SUBMIT / CANCEL_OWN | ✓ | ✓ | ✓ | ✓ | ✓ | |
| CALENDAR.VIEW_OWN | ✓ | ✓ | ✓ | ✓ | ✓ | |
| REQUEST.VIEW | ✓ | ✓ | ✓ | ✓ | | ✓ |
| REQUEST.APPROVE / REJECT | ✓ | ✓ | ✓ | ✓ | | |
| REQUEST.CANCEL_ANY / REVOKE | ✓ | ✓ | ✓ | | | |
| REQUEST.EXPORT | ✓ | ✓ | ✓ | | | (✓) |
| CALENDAR.VIEW_TEAM | ✓ | ✓ | ✓ | ✓ | | |
| CALENDAR.VIEW_COMPANY | ✓ | ✓ | ✓ | | | |
| TYPE.* / POLICY.* (write) | ✓ | ✓ | ✓ | | | |
| TYPE.VIEW | ✓ | ✓ | ✓ | ✓ | ✓ | |
| BALANCE.VIEW / TRANSACTION_VIEW | ✓ | ✓ | ✓ | (✓) | | |
| BALANCE.ADJUST | ✓ | ✓ | ✓ | | | |
| FILE.* | ✓ | ✓ | ✓ | (✓) | ✓(owner) | |
| AUDIT_LOG.VIEW | ✓ | ✓ | ✓ | | | |

### 6.5 TASK

| Permission (rút gọn) | SA | CA | MGR | PM | EMP |
| -------------------- | -- | -- | --- | -- | --- |
| PROJECT.VIEW / TASK.VIEW / VIEW_KANBAN | ✓ | ✓ | ✓ | ✓ | ✓(member) |
| PROJECT.CREATE | ✓ | ✓ | ✓ | ✓ | |
| PROJECT.UPDATE / CLOSE / ARCHIVE | ✓ | ✓ | ✓ | ✓ | |
| PROJECT.DELETE | ✓ | ✓ | (✓) | | |
| PROJECT.MANAGE_MEMBER / FILE_* / VIEW_REPORT | ✓ | ✓ | ✓ | ✓ | (upload: member) |
| TASK.CREATE / COMMENT / WATCH / FILE_UPLOAD | ✓ | ✓ | ✓ | ✓ | ✓(member) |
| TASK.UPDATE / UPDATE_STATUS | ✓ | ✓ | ✓ | ✓ | ✓(assignee) |
| TASK.ASSIGN / DELETE / UPDATE_PRIORITY / UPDATE_DEADLINE / FILE_DELETE | ✓ | ✓ | ✓ | ✓ | |
| TASK.EXPORT | ✓ | ✓ | ✓ | (✓) | |
| AUDIT_LOG.VIEW | ✓ | ✓ | (✓) | | |

### 6.6 NOTI

| Permission (rút gọn) | SA | CA | HR | MGR | EMP |
| -------------------- | -- | -- | -- | --- | --- |
| NOTIFICATION.*_OWN (view/detail/count/mark/hide/delete) | ✓ | ✓ | ✓ | ✓ | ✓ |
| NOTIFICATION.VIEW_COMPANY / CREATE_SYSTEM / SEND_SYSTEM | ✓ | (✓) | | | |
| EVENT.VIEW / CONFIG | ✓ | ✓ | (✓) | | |
| TEMPLATE.VIEW / CREATE / UPDATE | ✓ | ✓ | (✓) | | |
| TEMPLATE.DELETE | ✓ | (✓) | | | |
| CHANNEL.VIEW / UPDATE | ✓ | (✓) | | | |
| LOG.VIEW / RETRY | ✓ | (✓) | | | |

### 6.7 DASH

| Nhóm permission | SA | CA | HR | MGR | EMP |
| --------------- | -- | -- | -- | --- | --- |
| DASHBOARD.VIEW / VIEW_EMPLOYEE | ✓ | ✓ | ✓ | ✓ | ✓ |
| DASHBOARD.VIEW_MANAGER | ✓ | ✓ | (✓) | ✓ | |
| DASHBOARD.VIEW_HR | ✓ | (✓) | ✓ | | |
| DASHBOARD.VIEW_ADMIN | ✓ | ✓ | | | |
| WIDGET.* self (my_tasks, leave_balance, notifications, latest_leave, attendance_today) | ✓ | ✓ | ✓ | ✓ | ✓ |
| WIDGET.* team (pending_leave, leave_calendar, attendance_alerts, team_tasks_today) | ✓ | ✓ | ✓ | ✓ | |
| WIDGET.* HR (hr_overview, new_employees, contract_expiring, probation_ending) | ✓ | ✓ | ✓ | | |
| WIDGET.* admin (user/employee_summary, module_status, config_warnings, new_users, system_logs, system_notifications) | ✓ | ✓ | (emp_summary HR✓) | | |
| CONFIG.VIEW / UPDATE | ✓ | ✓ | | | |

### 6.8 FOUNDATION

| Permission (rút gọn) | SA | CA | HR | MGR | EMP | AUD |
| -------------------- | -- | -- | -- | --- | --- | --- |
| COMPANY.VIEW / MODULE.VIEW / SETTING.VIEW / HOLIDAY.VIEW | ✓ | ✓ | ✓ | ✓ | ✓ | |
| COMPANY.UPDATE | ✓ | ✓(own) | | | | |
| MODULE.UPDATE / SETTING.SYSTEM_MANAGE | ✓ | | | | | |
| SETTING.UPDATE | ✓ | ✓ | | | | |
| AUDIT_LOG.VIEW / EXPORT / FILE_ACCESS_LOG.VIEW | ✓ | ✓ | | | | ✓ |
| FILE.* (upload/view/download/delete/link/unlink) | ✓ | ✓ | ✓ | ✓ | ✓ | (theo module gốc) |
| SEQUENCE.VIEW / UPDATE | ✓ | ✓ | | | | |
| HOLIDAY.MANAGE | ✓ | ✓ | (✓) | | | |
| RETENTION.VIEW | ✓ | (✓) | | | | |
| RETENTION.MANAGE | ✓ | | | | | |
| JOB.VIEW | ✓ | (✓) | | | | |
| JOB.RUN / SEED.* | ✓ | | | | | |

> `AUD` (Auditor) được tham chiếu trong API-09 cho audit/file-access logs nhưng **chưa có trong role catalog hệ thống chuẩn** → giữ là role tương lai. `SEED.*`/`JOB.RUN` gate ở `SUPER_ADMIN` (System scope); DevOps không phải role chuẩn MVP. Xem [Audit Report §5](<API-10 PERMISSION AUDIT REPORT.md>).

---

## 7. Thống kê tổng hợp

| Module | # permission RBAC | # endpoint (public) | # endpoint internal | Ghi chú |
| ------ | ----------------: | ------------------: | ------------------: | ------- |
| AUTH       | 14 | 41 | 0 | + `AUTH.PROFILE.VIEW` chỉ trong ví dụ |
| HR         | 35 | 60 | 0 | `VIEW_SENSITIVE` là field-gate |
| ATT        | 33 | 43 | 3 | nhiều VIEW tách theo scope |
| LEAVE      | 30 | 46 | 1 | + Payroll Officer role |
| TASK       | 25 | 49 | 0 | + Project Manager role |
| NOTI       | 21 | 26 | 6 | 2 permission orphan |
| DASH       | 31 | 38 | 4 | 2 permission orphan |
| FOUNDATION | 28 | ~44 | 7 | catalog = BACKEND-11 §8.1; chưa có API ID |
| **Tổng**   | **~217** | **~347** | **~21** | |

> Con số là **xấp xỉ**: một số endpoint chỉ xuất hiện ở bảng overview, một số permission là field-level gate. Chi tiết sai lệch trong [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

---

## 8. Chuỗi giá trị không phải permission RBAC (đừng seed nhầm)

Các chuỗi dạng `MODULE.RESOURCE.ACTION` sau xuất hiện trong tài liệu nhưng **KHÔNG phải permission guard** — chúng là **audit action code** hoặc chỉ là ví dụ. Tuyệt đối không seed vào bảng `permissions`:

- **Audit action (NOTI §20.1):** `NOTI.SYSTEM_NOTIFICATION.CREATE`, `NOTI.SYSTEM_NOTIFICATION.SEND`, `NOTI.EVENT.UPDATE`, `NOTI.DELIVERY_LOG.RETRY`, `NOTI.DELIVERY_LOG.VIEW_PAYLOAD`, `NOTI.NOTIFICATION.ADMIN_VIEW`, `NOTI.EXPORT`.
- **Audit action (DASH §13/§16):** `DASH.CONFIG.CREATE`, `DASH.CONFIG.DELETE`, `DASH.CONFIG.REORDER`, `DASH.CONFIG.RESET_DEFAULT`, `DASH.EXPORT`, `DASH.WIDGET.VIEW_SENSITIVE`.
- **Chỉ trong ví dụ payload (AUTH):** `AUTH.PROFILE.VIEW`.

Trùng tên giữa audit-action và permission (vd. `NOTI.TEMPLATE.CREATE`) được phân tích trong [Audit Report §3.4](<API-10 PERMISSION AUDIT REPORT.md>).

---

## 9. Việc cần chốt

Toàn bộ điểm mâu thuẫn, thiếu sót và đề xuất sửa được tổng hợp trong **[API-10 Permission Audit Report](<API-10 PERMISSION AUDIT REPORT.md>)**. Sau khi chốt audit, cập nhật lại bảng matrix này và regenerate phần `x-required-permission` trong `openapi/enterprise-api.yaml`.
