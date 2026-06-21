# Permission Matrix — Hệ thống Quản lý Doanh nghiệp

> **Nguồn sự thật phân quyền tầng-trên**, hợp nhất từ bộ SPEC-02…08 (mỗi SPEC §"Quyền trong module" + "Ma trận phân quyền MVP"). Engine thực thi: [ADR-0010](adr/0010-permission-engine-4-tier.md). Test deny-path TRƯỚC (RED) cho mọi quyền nhạy cảm/phê duyệt ([`CLAUDE.md` §6](../CLAUDE.md)).
>
> **3 bất biến chi phối:** (1) `company_id` ép bằng RLS ở tầng DB, KHÔNG nằm trong PermissionService; (2) không hard-delete audit; (3) masking dữ liệu nhạy cảm là việc của **server**, FE chỉ UX.
>
> ⚠️ De-media-fy 2026-06-20: bỏ quyền media/finance/payroll/SaaS cũ. Mã quyền theo quy ước `MODULE.RESOURCE.ACTION` (SPEC-01 §9.5).

---

## 1. Mô hình 4 tầng (engine)

PermissionService trả lời: **"Trong cùng 1 tenant, user X có được làm `action` lên `resource/objId` không?"**. Cross-company KHÔNG thuộc tầng này — đó là RLS.

| Tầng | Tên | Hỏi gì | Nguồn | Kết quả |
| --- | --- | --- | --- | --- |
| 1 | **RBAC** | User có `permission(action, resource)` qua role nào? | `roles` → `role_permissions` | allow / deny / none |
| 2 | **Scope** | Quyền phủ tới *phạm vi dữ liệu* chứa object này? | `data_scope` của grant | object có trong scope? |
| 3 | **Object-level** | Có grant/deny gắn trực tiếp lên *instance* này? | object grant | allow/deny — **override Tầng 1+2** |
| 4 | **Sensitive** | Action nhạy cảm? Đã cấp **tường minh** chưa? | `is_sensitive` + grant riêng | gate cứng — **không kế thừa** |

- **Deny thắng** (deny-overrides) · **deny-by-default** (thiếu grant → từ chối) · **fail-closed** (route không khai quyền → 403).
- **Sensitive không kế thừa qua wildcard** — `view dữ liệu nhạy cảm` (CCCD/lương) phải có ALLOW tường minh, kể cả Company Admin.

### 1.1 Phạm vi dữ liệu (data scope — SPEC-01 §11.2)

| Scope | Ý nghĩa |
| --- | --- |
| **Own** | Chỉ dữ liệu của chính mình |
| **Team** | Dữ liệu team/nhân viên mình quản lý (`direct_manager_id = me`) |
| **Department** | Dữ liệu trong phòng ban |
| **Company** | Toàn công ty |
| **System** | Toàn hệ thống |
| **Project** | _(chỉ TASK)_ dữ liệu trong dự án user là thành viên |

**Role hệ thống mặc định + scope:** `SUPER_ADMIN` (System) · `COMPANY_ADMIN` (Company) · `HR` (Company) · `MANAGER` (Team) · `EMPLOYEE` (Own). User có thể giữ **nhiều role**.

> Ký hiệu ma trận: **Có** = mặc định có · **Cấp** = có nếu được cấp quyền riêng · **—** = không · **Own/Team/…** = giới hạn theo scope. SA=Super Admin · ADM=Company Admin · HR · MGR=Manager · EMP=Employee (TASK thêm PM=Project Manager).

---

## 2. AUTH — Tài khoản & phân quyền (SPEC-02)

**Mã quyền:** `AUTH.LOGIN.ACCESS · AUTH.PROFILE.VIEW · AUTH.PROFILE.UPDATE · AUTH.PASSWORD.CHANGE · AUTH.USER.{VIEW,CREATE,UPDATE,LOCK,UNLOCK,ASSIGN_ROLE} · AUTH.ROLE.{VIEW,CREATE,UPDATE,DELETE} · AUTH.PERMISSION.{VIEW,ASSIGN} · AUTH.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Đăng nhập/xuất · Đổi mật khẩu · Xem hồ sơ cá nhân | Có | Có | Có | Có | Có |
| Xem danh sách user | Có | Có | — | — | — |
| Tạo / Cập nhật user | Có | Có | Cấp | — | — |
| Khóa / Mở khóa user | Có | Có | — | — | — |
| Xem / Tạo / Cập nhật role | Có | Có (giới hạn) | — | — | — |
| Gán role cho user | Có | Có | — | — | — |
| Xem / Gán permission | Có | Có (giới hạn) | — | — | — |
| Xem audit log AUTH | Có | Cấp | — | — | — |

---

## 3. HR — Nhân sự (SPEC-03)

**Mã quyền (nhóm):** `HR.EMPLOYEE.{VIEW,VIEW_SENSITIVE,CREATE,UPDATE,CHANGE_STATUS,DELETE,EXPORT,IMPORT,FILE_VIEW,FILE_UPLOAD,FILE_DELETE} · HR.DEPARTMENT.{VIEW,CREATE,UPDATE,DELETE} · HR.POSITION.{…} · HR.CONTRACT.{…} · HR.ORG_CHART.VIEW · HR.MASTER_DATA.MANAGE · HR.PROFILE_CHANGE_REQUEST.{CREATE,VIEW_OWN,VIEW,APPROVE,REJECT,CANCEL_OWN} · HR.EMPLOYEE_CODE_CONFIG.{VIEW,UPDATE} · HR.EMPLOYEE_CODE.{PREVIEW,MANUAL_OVERRIDE} · HR.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Xem danh sách nhân viên | Có | Cấp | Có | Team/Dept | — |
| Xem hồ sơ cá nhân | Có | Có | Có | Giới hạn | Own |
| **Xem dữ liệu nhạy cảm** 🔒 (CCCD/lương) | Có | Cấp | Cấp | — | — |
| Thêm / Cập nhật nhân viên | Có | Cấp | Có | Cấp (giới hạn) | Một số trường cá nhân (nếu cho phép) |
| Đổi trạng thái · Xóa mềm nhân viên | Có | Cấp | Có | — | — |
| Quản lý phòng ban / chức vụ / hợp đồng | Có | Có | Cấp | — | — |
| Upload/Xem file hồ sơ | Có | Cấp | Có | — | — |
| Xuất danh sách · Xem lịch sử thay đổi | Có | Cấp | Cấp | — | — |
| Gửi/Xem/Hủy yêu cầu sửa hồ sơ của mình | Có | Có | Có | Có | Có |
| Duyệt/Từ chối yêu cầu sửa hồ sơ | Có | Cấp | Có | — | — |
| Cấu hình mã NV / Sửa mã thủ công | Có | Cấp | Cấp | — | — |

---

## 4. ATT — Chấm công (SPEC-04)

**Mã quyền (nhóm):** `ATT.ATTENDANCE.{CHECK_IN,CHECK_OUT,VIEW_OWN,VIEW_TEAM,VIEW_COMPANY,VIEW_DETAIL,EXPORT,ADJUST_DIRECT} · ATT.ADJUSTMENT.{CREATE_OWN,VIEW_OWN,VIEW_TEAM,VIEW_COMPANY,APPROVE,REJECT,CANCEL_OWN} · ATT.SHIFT.{VIEW,CREATE,UPDATE,DELETE} · ATT.SHIFT_ASSIGNMENT.{VIEW,UPDATE} · ATT.RULE.{VIEW,CONFIG} · ATT.REMOTE_REQUEST.{CREATE_OWN,VIEW_OWN,VIEW_TEAM,VIEW_COMPANY,APPROVE,REJECT} · ATT.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Check-in/out · Xem bảng công cá nhân | Có | Có | Có | Có | Có |
| Xem bảng công team | Có | Cấp | Cấp | Có | — |
| Xem bảng công toàn công ty | Có | Cấp | Có | — | — |
| Cấu hình ca làm / gán ca / rule | Có | Cấp | Cấp | — | — |
| Gửi yêu cầu điều chỉnh công | Có | Có | Có | Có | Có |
| Duyệt/Từ chối điều chỉnh công | Có | Cấp | Có | Team | — |
| Điều chỉnh công trực tiếp | Có | Cấp | Có | — | — |
| Gửi remote/công tác | Có | Có | Có | Có | Có |
| Duyệt remote/công tác | Có | Cấp | Cấp | Team | — |
| Xuất bảng công · Xem audit log ATT | Có | Cấp | Cấp | — | — |

---

## 5. LEAVE — Nghỉ phép (SPEC-05)

**Mã quyền (nhóm):** `LEAVE.REQUEST.{CREATE,VIEW_OWN,VIEW_TEAM,VIEW_DEPARTMENT,VIEW_COMPANY,UPDATE_OWN,CANCEL_OWN,APPROVE,REJECT,CANCEL_ANY,EXPORT} · LEAVE.TYPE.{VIEW,CREATE,UPDATE,DELETE} · LEAVE.POLICY.{VIEW,UPDATE} · LEAVE.BALANCE.{VIEW_OWN,VIEW,ADJUST} · LEAVE.CALENDAR.{VIEW_OWN,VIEW_TEAM,VIEW_COMPANY} · LEAVE.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Tạo / Xem / Hủy đơn nghỉ của mình | Có | Có | Có | Có | Có |
| Xem đơn nghỉ team | Có | Cấp | Cấp | Có | — |
| Xem đơn nghỉ toàn công ty | Có | Cấp | Có | — | — |
| Duyệt / Từ chối đơn nghỉ | Có | Cấp | Cấp | Team | — |
| Hủy đơn người khác | Có | Cấp | Cấp | — | — |
| Quản lý loại nghỉ / chính sách phép | Có | Cấp | Cấp | — | — |
| Xem số dư phép cá nhân | Có | Có | Có | Có | Có |
| Xem số dư phép nhân viên | Có | Cấp | Có | Team (cấp) | — |
| Điều chỉnh số dư phép | Có | Cấp | Cấp | — | — |
| Xem lịch nghỉ team / công ty | Có | Cấp | Cấp/Có | Team | — |

---

## 6. TASK — Công việc & dự án (SPEC-06)

Thêm cột **PM** (Project Manager — vai trò cấp-dự-án) và scope **Project**.

**Mã quyền (nhóm):** `TASK.PROJECT.{VIEW,CREATE,UPDATE,DELETE,CLOSE,ARCHIVE,MANAGE_MEMBER,VIEW_REPORT} · TASK.TASK.{VIEW,CREATE,UPDATE,DELETE,ASSIGN,UPDATE_STATUS,UPDATE_PRIORITY,UPDATE_DEADLINE,COMMENT,FILE_UPLOAD,FILE_DELETE,WATCH,VIEW_KANBAN,EXPORT} · TASK.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | PM | EMP |
|---|---|---|---|---|---|---|
| Xem danh sách dự án | Có | Cấp | Cấp | Scope | Dự án phụ trách | Nếu là member |
| Tạo dự án | Có | Cấp | Cấp | Cấp | Cấp | — |
| Cập nhật dự án | Có | Cấp | Cấp | Dự án QL | Dự án phụ trách | — |
| Đóng/hủy dự án · Quản lý thành viên | Có | Cấp | — | Nếu owner | Nếu owner | — |
| Xem / Tạo task | Có | Cấp | Cấp | Team/Project | Project | Task liên quan / Cấp |
| Giao task | Có | Cấp | Cấp | Team/Project | Project | — |
| Cập nhật trạng thái task | Có | Cấp | Cấp | Scope | Project | Nếu là assignee |
| Bình luận / Upload file task | Có | Nếu xem được task | Nếu xem được task | Nếu xem được task | Nếu xem được task | Nếu xem được task |
| Xóa task | Có | Cấp | — | Creator/owner | Owner | — |
| Xem báo cáo dự án · Xuất task | Có | Cấp | Cấp | Scope | Dự án phụ trách | — |

---

## 7. DASH — Dashboard (SPEC-07)

DASH chỉ hiển thị/deep-link; **module nguồn ép data scope thật**. Quyền widget gate hiển thị.

**Mã quyền (nhóm):** `DASH.DASHBOARD.{VIEW,VIEW_EMPLOYEE,VIEW_MANAGER,VIEW_HR,VIEW_ADMIN} · DASH.WIDGET.VIEW_* (theo widget) · DASH.CONFIG.{VIEW,UPDATE} · DASH.AUDIT_LOG.VIEW`

| Dashboard / widget | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Xem Dashboard · Dashboard Employee | Có | Có | Có | Có | Có |
| Dashboard Manager | Có | Cấp | Cấp | Có | — |
| Dashboard HR | Có | Cấp | Có | — | — |
| Dashboard Admin | Có | Có | — | — | — |
| Widget chấm công hôm nay · task của tôi · số ngày phép · thông báo mới | Có | Có | Có | Có | Có |
| Widget đơn nghỉ chờ duyệt · task team quá hạn · lịch nghỉ team | Có | Cấp | Cấp | Có | — |
| Widget tổng quan nhân sự · nhân sự mới · hợp đồng sắp hết hạn · sắp hết thử việc | Có | Cấp | Có | — | — |
| Widget tổng user/nhân viên · module · log hệ thống · tài khoản mới | Có | Có | — | — | — |
| Widget tiến độ dự án | Có | Cấp | Liên quan | Scope | Nếu là member |
| Cấu hình widget theo role | Có | Cấp | — | — | — |

---

## 8. NOTI — Thông báo (SPEC-08)

**Mã quyền (nhóm):** `NOTI.NOTIFICATION.{VIEW_OWN,VIEW_DETAIL_OWN,COUNT_UNREAD_OWN,MARK_READ_OWN,MARK_ALL_READ_OWN,HIDE_OWN,DELETE_OWN,VIEW_COMPANY,CREATE_SYSTEM,SEND_SYSTEM} · NOTI.EVENT.{VIEW,CONFIG} · NOTI.TEMPLATE.{VIEW,UPDATE} · NOTI.CHANNEL.{VIEW,UPDATE} · NOTI.LOG.VIEW · NOTI.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Xem/đếm/đánh dấu đã đọc · ẩn/xóa mềm thông báo của mình | Có | Có | Có | Có | Có |
| Xem log thông báo toàn công ty | Có | Cấp | — | — | — |
| Tạo thông báo hệ thống thủ công | Có | Cấp | — | — | — |
| Cấu hình loại / template thông báo | Có | Cấp | Cấp | — | — |
| Cấu hình kênh gửi · Xem audit log NOTI | Có | Cấp | — | — | — |

---

## 9. Nguyên tắc dữ liệu nhạy cảm (SPEC-01 §11.3)

Dữ liệu nhạy cảm: lương · tài khoản ngân hàng · CCCD/CMND · hợp đồng · hồ sơ nhân sự · dữ liệu kỷ luật/nghỉ việc · chấm công chi tiết · log hệ thống.

1. Không hiển thị nếu không có quyền (mask ở **server**).
2. Không cho export nếu không có quyền export riêng.
3. Mọi thao tác xem/sửa/xuất dữ liệu nhạy cảm **ghi audit**.
4. Dữ liệu lương tách quyền riêng (Phase 2 — không mặc định cho HR nếu công ty yêu cầu kiểm soát chặt).

> Chi tiết từng quyền (điều kiện, mã lỗi deny-path, test case): xem từng SPEC trong [`docs/spec/`](./spec/). Quyền là cặp `(action, resource)` + cờ `is_sensitive`; seed `ON CONFLICT DO NOTHING` (hot-file, append).
