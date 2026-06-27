# API-10: PERMISSION MATRIX — AUDIT REPORT (Rà soát API-02 → API-09)

**HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ — Kết quả rà soát permission / authorization**

> **📚 Liên quan:** [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) → [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>)

---

## 1. Thông tin tài liệu

| Trường         | Nội dung                                  |
| -------------- | ----------------------------------------- |
| Mã tài liệu    | API-10 (Audit)                            |
| Phạm vi rà soát| Permission / Allowed roles / Data scope của API-02 → API-09 |
| Phương pháp    | Trích xuất toàn bộ endpoint + permission code, đối chiếu chéo với API-01 §7 và giữa các module |
| Ngày rà soát   | 20/06/2026                                 |
| Trạng thái     | Cần review & quyết định                    |

---

## 2. Tóm tắt điều hành

Bộ tài liệu API-02 → API-09 có **mô hình authorization nhất quán ở tầng nguyên tắc** (permission + data scope, backend enforce, frontend chỉ hỗ trợ UI). Tuy nhiên ở tầng chi tiết tồn tại các nhóm vấn đề cần chốt trước khi seed DB-10 và sinh OpenAPI:

| Mức | Số lượng | Bản chất |
| --- | -------: | -------- |
| 🔴 CRITICAL | 2 | Read operation bị gate bằng quyền write/manage; internal endpoint không khai báo auth |
| 🟠 HIGH | 6 | Allowed roles/scope thiếu diện rộng; permission tham chiếu nhưng chưa seed; scope > role mâu thuẫn |
| 🟡 MEDIUM | 11 | Permission orphan; OR-permission; role chưa có trong catalog; overview ≠ detail; thiếu API ID |
| 🟢 LOW | 6 | Đặt tên không đồng nhất; idempotency mơ hồ; event-verb vs audit-verb lệch |

**Khuyến nghị ưu tiên:** xử lý toàn bộ 🔴 và 🟠 trước khi backend implement guard; 🟡/🟢 có thể chuẩn hóa song song khi viết OpenAPI.

---

## 3. Phát hiện chi tiết

> Mỗi finding: **ID · Mức · Module · Mô tả · Tác động · Khuyến nghị**.

### 🔴 CRITICAL

#### AUD-001 · FOUNDATION · Read operation bị gate bằng quyền MANAGE
- **Mô tả:** `GET /api/v1/foundation/system-settings` (list/đọc system settings) trước đây yêu cầu `FOUNDATION.SYSTEM_SETTING.MANAGE`. Không tồn tại biến thể VIEW.
- **Quyết định (đã chốt):** Bỏ namespace `SYSTEM_SETTING.*`. Settings dùng **3 verb** thống nhất: `FOUNDATION.SETTING.VIEW` (đọc company + system settings), `FOUNDATION.SETTING.UPDATE` (sửa company settings), `FOUNDATION.SETTING.SYSTEM_MANAGE` (xem + sửa system-settings, chỉ `SUPER_ADMIN`/System scope). Đọc system-settings ở mức quản trị dùng `SYSTEM_MANAGE`; đọc giá trị resolve cho user dùng `SETTING.VIEW`.
- **Trạng thái:** Đã giải quyết trong [Matrix §5.8 + §6.8](<API-10 PERMISSION MATRIX.md>).

#### AUD-002 · FOUNDATION · Internal endpoint không khai báo auth/permission
- **Mô tả:** `POST /internal/v1/foundation/public-holidays/check` không khai báo Required permission, Authentication hay business-validation auth (detail block yếu nhất). Một số internal khác (`audit-logs`, `files/link`, `settings/resolve`) chỉ ghi "internal caller authenticated" mà không nêu cơ chế (token/mTLS).
- **Tác động:** Rủi ro bảo mật — internal endpoint nếu lộ ra mạng mà không có cơ chế auth rõ ràng = lỗ hổng. Không thể sinh `securityScheme` chính xác.
- **Khuyến nghị:** Chuẩn hóa **mọi** `/internal/v1/*` dùng `internalServiceAuth` (service token/mTLS, network-policy), khai báo verbatim trong từng detail block. Áp dụng cùng chuẩn cho ATT/NOTI/DASH internal (đã nhất quán hơn).

### 🟠 HIGH

#### AUD-003 · Tất cả module · Allowed roles / Data scope thiếu ở phần lớn detail block
- **Mô tả:** Nhiều endpoint chỉ xuất hiện ở bảng overview hoặc detail block rút gọn, **không khai báo Allowed roles và/hoặc Data scope**. Ví dụ điển hình:
  - AUTH: 052, 108–112, 202, 206, 208, 209, 302, 303, 402, 403 không có detail block.
  - HR: 303, 402, 502/504/505, 602/604/605, 702, 704–706, 803, 904/905, 1002 thiếu Allowed roles.
  - ATT: ~30/46 endpoint không khai báo scope/roles tường minh (chỉ suy từ permission).
  - LEAVE: 002, 107, 202, 208, 302, 502, 602, 604, 605, 702, 703, 801, 804, 902, 903 thiếu detail.
  - TASK: chỉ 11.1 & 11.2 có Allowed roles; phần lớn endpoint thiếu Data scope.
  - FOUNDATION: rất nhiều detail block bỏ trống Allowed roles.
- **Tác động:** Permission matrix phải **suy luận** roles/scope → rủi ro sai khi seed; test case permission khó viết.
- **Khuyến nghị:** Bổ sung đủ 3 trường `Required permission / Allowed roles / Data scope` cho **mọi** endpoint theo template API-01 §25. Bảng "Default roles" trong [API-10 Matrix §5](<API-10 PERMISSION MATRIX.md>) là điểm khởi đầu cần đội nghiệp vụ xác nhận.

#### AUD-004 · ATT / FOUNDATION · Permission ghi bằng văn xuôi thay vì code
- **Mô tả:** ATT-API-204 & ATT-API-304 khai báo permission là "Permission xem tương ứng" (không phải code cụ thể). FOUNDATION nhiều internal endpoint ghi "internal caller" thay code.
- **Tác động:** Không guard được, không sinh `x-required-permission`.
- **Khuyến nghị:** ATT-204 → `ATT.ADJUSTMENT.VIEW_OWN`/`VIEW_TEAM`/`VIEW_COMPANY` (theo ownership/scope, resolve runtime); ATT-304 → `ATT.REMOTE_REQUEST.VIEW_*`. Ghi rõ logic "view nào áp dụng" trong business validation.

#### AUD-005 · Nhiều module · Endpoint dùng "permission A HOẶC permission B"
- **Mô tả:** OR-permission không biểu diễn được trong matrix phẳng và khó test:
  - HR-API-501 (`MASTER_DATA.MANAGE` OR `EMPLOYEE.VIEW`).
  - ATT-API-103/203/303 (VIEW_COMPANY OR VIEW_TEAM…).
  - LEAVE-API-203 (`APPROVE` OR `REJECT`), 301/302/606/801–804/902/903 (OR + "owner request").
  - TASK-19.1/19.2/20.2/21.2 (`AUDIT_LOG.VIEW` OR `*.VIEW` / `VIEW_REPORT` OR `TASK.VIEW`).
  - NOTI-API-304 (`TEMPLATE.CREATE` OR `TEMPLATE.UPDATE`).
- **Tác động:** Guard phải hỗ trợ "any-of"; matrix/OpenAPI cần quy ước.
- **Khuyến nghị:** Chấp nhận semantics **any-of** và chuẩn hóa: `x-required-permission` là **mảng** với cờ `x-permission-mode: anyOf` (mặc định `allOf`). Đã áp dụng trong `openapi/enterprise-api.yaml`.

#### AUD-006 · NOTI / DASH · Scope khai báo rộng hơn role cho phép
- **Mô tả:** Nhiều endpoint admin/config khai báo Data scope = `Company, System` nhưng Allowed roles gồm "Admin công ty" — mà theo API-01 §3.4 / NOTI §6.2 chỉ **Super Admin** mới có scope `System`. Company Admin không bao giờ chạm tới phần `System` của scope đã khai.
- **Tác động:** Mâu thuẫn role↔scope; người đọc hiểu sai quyền thực tế.
- **Khuyến nghị:** Tách rõ: Company Admin → scope `Company`; Super Admin → scope `System`. Đừng liệt kê `System` cho endpoint mà role tối đa là Company Admin (trừ khi thực sự cho cross-company).

#### AUD-007 · AUTH · Quyền hành động nhạy cảm tái dùng quyền update chung
- **Mô tả:** `force-reset-password` (AUTH-110) và revoke session người khác (AUTH-112) đều dùng `AUTH.USER.UPDATE`; gán/gỡ permission cho role (AUTH-207/208/209) dùng `AUTH.PERMISSION.ASSIGN` dù thao tác trên resource `role`.
- **Tác động:** Không tách được quyền reset mật khẩu / thu hồi session khỏi quyền sửa user chung → khó phân quyền tinh.
- **Khuyến nghị:** Cân nhắc thêm `AUTH.USER.RESET_PASSWORD`, `AUTH.USER.REVOKE_SESSION`. Quyết định có thể giữ nguyên cho MVP nhưng **ghi chú chủ ý** để tránh bị coi là lỗi.

#### AUD-008 · FOUNDATION · `settings/public` vừa "Public" vừa yêu cầu permission
- **Mô tả:** `GET /settings/public` ghi cần `FOUNDATION.SETTING.VIEW` nhưng đồng thời nói "any logged-in user may call". Hai tuyên bố mâu thuẫn.
- **Tác động:** Không rõ endpoint là `Authenticated` hay cần permission cụ thể.
- **Khuyến nghị:** Chốt là **Authenticated** (mọi user đăng nhập), bỏ yêu cầu permission cho nhánh public settings; giữ permission cho `settings/effective` (có thể chứa setting nhạy cảm).

### 🟡 MEDIUM

#### AUD-009 · NOTI / DASH · Permission orphan (khai báo nhưng không endpoint nào dùng)
- **Mô tả:** `NOTI.AUDIT_LOG.VIEW`, `DASH.AUDIT_LOG.VIEW`, `DASH.CACHE.REFRESH` có trong catalog §6.3 nhưng **không gắn endpoint nào**. (NOTI `TEMPLATE.DELETE` cũng có code nhưng không có endpoint xóa template.)
- **Tác động:** Permission "chết" gây nhiễu khi seed/audit.
- **Khuyến nghị:** Hoặc bổ sung endpoint tương ứng (vd. `GET /notifications/audit-logs`, `GET /dashboard/audit-logs`, `DELETE /notifications/templates/{id}`), hoặc gỡ permission khỏi catalog.

#### AUD-010 · NOTI · Tên permission lệch với tên resource/audit-action
- **Mô tả:** Permission dùng `NOTI.LOG.VIEW`/`NOTI.LOG.RETRY` nhưng resource/endpoint/audit là `DELIVERY_LOG` (`delivery-logs`). Permission `NOTI.EVENT.CONFIG` nhưng audit-action `NOTI.EVENT.UPDATE`. Permission `NOTI.NOTIFICATION.CREATE_SYSTEM`/`SEND_SYSTEM` nhưng audit-action `NOTI.SYSTEM_NOTIFICATION.CREATE`/`SEND`.
- **Tác động:** Dễ nhầm audit-action là permission; matrix khó map.
- **Khuyến nghị:** Đổi `NOTI.LOG.*` → `NOTI.DELIVERY_LOG.*` cho khớp resource. Giữ audit-action tách biệt và đặt tên theo cặp resource/permission. Xem [Matrix §8](<API-10 PERMISSION MATRIX.md>).

#### AUD-011 · DASH / NOTI · Audit-action code trùng dạng với permission code
- **Mô tả:** Các chuỗi `DASH.CONFIG.CREATE/DELETE/REORDER/RESET_DEFAULT`, `DASH.EXPORT`, `DASH.WIDGET.VIEW_SENSITIVE`, `NOTI.SYSTEM_NOTIFICATION.*`, `NOTI.DELIVERY_LOG.*`, `NOTI.EXPORT` dùng đúng format `MODULE.RESOURCE.ACTION` của permission nhưng là **audit action**.
- **Tác động:** Rủi ro seed nhầm vào bảng `permissions`.
- **Khuyến nghị:** Tách namespace audit-action (vd. prefix `audit:` hoặc cột riêng trong tài liệu). Danh sách đầy đủ ở [Matrix §8](<API-10 PERMISSION MATRIX.md>).

#### AUD-012 · FOUNDATION · Thiếu API ID cho toàn bộ endpoint
- **Mô tả:** API-09 không gán mã endpoint (như `FND-API-001`); các module khác đều có.
- **Tác động:** Không tham chiếu chéo được; matrix phải mô tả bằng path.
- **Khuyến nghị:** Gán dải `FND-API-xxx` theo nhóm (Companies 0xx, Modules 1xx, Settings 2xx, Audit 3xx, Files 4xx, Sequences 5xx, Holidays 6xx, Retention 7xx, Seeds 8xx, Internal 9xx).

#### AUD-013 · TASK / DASH / NOTI · Endpoint ở detail nhưng thiếu ở overview (hoặc ngược lại)
- **Mô tả:** TASK: checklist item CRUD (17.3–17.7), file list/delete (18.1/18.2), report (20.x), export (21.x) thiếu trong bảng overview §10. DASH-API-208 (`configs/bulk-update`) chỉ có ở overview, không có detail. NOTI `cleanup-jobs/run` chỉ có ở overview, không API ID/detail.
- **Tác động:** Đếm endpoint sai; sinh OpenAPI sót.
- **Khuyến nghị:** Đồng bộ bảng overview ↔ detail block cho mọi module (single source of truth là detail block).

#### AUD-014 · FOUNDATION / LEAVE / TASK · Role tham chiếu nhưng chưa có trong role catalog
- **Mô tả:** `Auditor` (FND audit/file-access logs), `DevOps/Admin kỹ thuật` (FND seeds), `Payroll Officer` (LEAVE), `Project Manager` (TASK) được dùng trong Allowed roles nhưng không nằm trong bộ role lõi 5 vai trò (`SUPER_ADMIN/COMPANY_ADMIN/HR/MANAGER/EMPLOYEE`).
- **Quyết định (đã chốt):**
  - **`Project Manager` (PM):** vai trò **được seed** ở DB-10 §13.1 (`PROJECT_MANAGER`, scope Company) và **dùng cho TASK** (project-scope). Giữ trong catalog Matrix; backend enforce theo permission + project membership, không hard-code role. Ngoài ra TASK còn có vai trò **cấp dự án** (Project Owner/Member/Watcher — SPEC-01 §10.10) không phải role hệ thống.
  - **`Payroll Officer` (PO):** seed sẵn ở DB-10 §13.1 (`PAYROLL_OFFICER`) nhưng **thuộc Phase 2 (PAYROLL)** — trong MVP chỉ dùng làm nhãn read-only cho LEAVE view/export; coi là **role tương lai**, không cấp permission MVP mặc định.
  - **`Auditor` (AUD)** và **`DevOps`:** **chưa phải role chuẩn MVP** → đánh dấu **tương lai**. Quyền audit/file-access-log gate bằng `FOUNDATION.AUDIT_LOG.*`/`FILE_ACCESS_LOG.VIEW` cấp cho `COMPANY_ADMIN`/`SUPER_ADMIN`; quyền seed/job gate bằng `FOUNDATION.SEED.*`/`JOB.RUN` cấp cho `SUPER_ADMIN` (System scope). Khi cần tách bạch sẽ thêm role `AUDITOR`/`DEVOPS` ở phase sau.
- **Tác động:** Đã giải quyết — không seed role MVP thừa; PM/PO seed nhưng PO/AUD/DevOps là nhãn/tương lai.
- **Còn lại:** Cập nhật [Matrix §2 + §6.8](<API-10 PERMISSION MATRIX.md>) (đã ghi chú `AUD` là role tương lai, `SEED.*`/`JOB.RUN` về `SUPER_ADMIN`).

#### AUD-015 · ATT / LEAVE · Scope khai báo nhưng thiếu permission tương ứng
- **Mô tả:** LEAVE calendar endpoint khai báo scope `Department` nhưng không có `LEAVE.CALENDAR.VIEW_DEPARTMENT` (chỉ có VIEW_TEAM/VIEW_COMPANY). ATT có VIEW_OWN/TEAM/COMPANY nhưng một số endpoint scope `Department/System` không có permission riêng.
- **Tác động:** Khoảng trống giữa scope và permission; guard mơ hồ ở scope Department.
- **Khuyến nghị:** Quy ước Department gộp vào `VIEW_COMPANY` (company-level đã bao Department) HOẶC thêm permission `_DEPARTMENT`. Chốt một hướng và ghi rõ.

#### AUD-016 · HR · Permission family trộn lẫn trên cùng resource
- **Mô tả:** Contract Type: read dùng `HR.CONTRACT.VIEW` nhưng write (create/update/delete) dùng `HR.MASTER_DATA.MANAGE`. Job Level dùng hoàn toàn `HR.MASTER_DATA.MANAGE`. Một resource (Contract Type) trộn 2 họ permission.
- **Tác động:** Khó hiểu/khó phân quyền tinh.
- **Khuyến nghị:** Hoặc tạo `HR.CONTRACT_TYPE.*` / `HR.JOB_LEVEL.*` đầy đủ, hoặc thống nhất master-data dùng chung `HR.MASTER_DATA.VIEW` + `HR.MASTER_DATA.MANAGE`. Tránh trộn.

#### AUD-017 · ATT · Một permission gánh nhiều action
- **Mô tả:** `ATT.SHIFT_ASSIGNMENT.UPDATE` dùng cho create/update/delete (502/504/505); `ATT.RULE.CONFIG` dùng cho create/update/delete (602/604/605) — khác với SHIFT có tách CREATE/UPDATE/DELETE.
- **Tác động:** Không tách được quyền tạo vs xóa; không nhất quán nội bộ module.
- **Khuyến nghị:** Quyết định có chủ ý: hoặc tách CREATE/UPDATE/DELETE cho đồng bộ với SHIFT, hoặc ghi chú đây là "manage gộp" cố ý. Ưu tiên đồng bộ.

#### AUD-018 · HR / ATT / DASH · Audit log khai báo có điều kiện/mơ hồ
- **Mô tả:** Nhiều endpoint ghi "Không bắt buộc; có thể log nếu…", "Có nếu cấu hình…", "if sensitive". Không có Yes/No dứt khoát.
- **Tác động:** Không sinh được `x-audit-log` boolean rõ ràng; khó kiểm thử audit.
- **Khuyến nghị:** Chuẩn hóa `x-audit-log` ∈ { `always`, `conditional`, `none` } và nêu điều kiện. Tài liệu hiện đã có cột — chỉ cần chuẩn enum.

#### AUD-019 · DASH · Lỗi copy-paste trong ví dụ (không phải permission nhưng ảnh hưởng đọc hiểu)
- **Mô tả:** Ví dụ response Manager/HR/Admin dashboard (§11.5–11.7) đều trả `"dashboard_type": "Employee"`. Internal endpoint (INT-001..004) dùng chung body + message "Xử lý cache dashboard thành công".
- **Tác động:** Không phải lỗi permission nhưng gây nhầm khi đối chiếu scope theo dashboard_type.
- **Khuyến nghị:** Sửa ví dụ cho đúng dashboard_type tương ứng.

### 🟢 LOW

#### AUD-020 · Tất cả module · Cách diễn đạt Idempotency không chuẩn
- **Mô tả:** Dùng "Bắt buộc khuyến nghị" / "Khuyến nghị bắt buộc" (mâu thuẫn nội tại), "Khuyến nghị", "Không bắt buộc" lẫn lộn. Bảng §idempotency đôi khi mâu thuẫn detail block (vd. LEAVE-103).
- **Khuyến nghị:** Chuẩn hóa `x-idempotency` ∈ { `Required`, `Optional`, `No` }. "Bắt buộc khuyến nghị" → `Required`. Đã áp dụng trong matrix + OpenAPI.

#### AUD-021 · AUTH / HR · Notification-event verb lệch audit-action verb
- **Mô tả:** Cùng thao tác nhưng event vs audit khác verb: AUTH role change → event `USER_ROLE_CHANGED` vs audit `USER_ROLE_UPDATED`; reset password → event `PASSWORD_CHANGED` vs audit `PASSWORD_RESET_COMPLETED`. HR export → event `HR_EMPLOYEE_EXPORT_COMPLETED` vs audit `HR_EMPLOYEE_EXPORTED`.
- **Khuyến nghị:** Thống nhất verb (ưu tiên quá khứ phân từ: `*_UPDATED`, `*_COMPLETED`) giữa audit action và notification event, hoặc lập bảng ánh xạ 1-1.

#### AUD-022 · HR / NOTI · Notification event trên endpoint nhưng vắng trong bảng event tổng
- **Mô tả:** HR: nhiều event ở detail block (`HR_DEPARTMENT_*`, `HR_POSITION_*`, `HR_CONTRACT_PRIMARY_CHANGED`, `HR_EMPLOYEE_FILE_*`…) không có trong bảng §25. NOTI: `source_module` enum lệch giữa §9.3 và §14.1 (thiếu FOUNDATION).
- **Khuyến nghị:** Đồng bộ bảng event tổng với event khai ở endpoint; thống nhất enum `source_module` gồm đủ 8 module + SYSTEM.

#### AUD-023 · FOUNDATION / ATT · Endpoint "check" trùng logic ở 2 prefix
- **Mô tả:** `GET /api/v1/foundation/public-holidays/check` và `POST /internal/v1/foundation/public-holidays/check`; ATT internal job naming lệch (`auto-checkout-job` vs `auto-attendance-job`).
- **Khuyến nghị:** Giữ 1 nguồn logic; internal chỉ gọi lại service chung. Thống nhất tên job.

#### AUD-024 · FOUNDATION · Đặt tên resource có `_` không đồng nhất
- **Mô tả:** `FILE_ACCESS_LOG`, `SYSTEM_SETTING` dùng `_` trong segment resource; phần lớn resource khác là một từ. Chấp nhận được nhưng cần quy ước.
- **Khuyến nghị:** Cho phép `_` trong tên ghép (đã nêu ở [Matrix §4](<API-10 PERMISSION MATRIX.md>)); giữ nhất quán.

#### AUD-025 · LEAVE / DASH · Mã lỗi tham chiếu chéo không khớp
- **Mô tả:** LEAVE approve block trích `ATT-ERR-PERIOD-LOCKED` thay vì `LEAVE-ERR-PERIOD-LOCKED`. DASH per-endpoint table dùng `DASH-ERR-FORBIDDEN`/`DASH-ERR-NOT_FOUND` (HTTP 500) trong khi bảng chuẩn §17 dùng `DASH-ERR-FORBIDDEN_DASHBOARD`/`DASH-ERR-CONFIG_NOT_FOUND` (HTTP 403/404/503).
- **Khuyến nghị:** Đồng bộ mã lỗi với bảng chuẩn từng module; sửa HTTP status (forbidden=403, not-found=404, source-unavailable=503).

---

## 4. Bảng tổng hợp finding

| ID | Mức | Module | Tiêu đề |
| -- | --- | ------ | ------- |
| AUD-001 | 🔴 | FND | Read gate bằng quyền MANAGE (system-settings) |
| AUD-002 | 🔴 | FND | Internal endpoint không khai báo auth |
| AUD-003 | 🟠 | All | Thiếu Allowed roles / Data scope diện rộng |
| AUD-004 | 🟠 | ATT/FND | Permission ghi bằng văn xuôi thay code |
| AUD-005 | 🟠 | All | OR-permission (any-of) |
| AUD-006 | 🟠 | NOTI/DASH | Scope rộng hơn role cho phép |
| AUD-007 | 🟠 | AUTH | Hành động nhạy cảm tái dùng quyền update chung |
| AUD-008 | 🟠 | FND | settings/public vừa Public vừa cần permission |
| AUD-009 | 🟡 | NOTI/DASH | Permission orphan |
| AUD-010 | 🟡 | NOTI | Tên permission lệch resource (LOG vs DELIVERY_LOG) |
| AUD-011 | 🟡 | DASH/NOTI | Audit-action trùng dạng permission |
| AUD-012 | 🟡 | FND | Thiếu API ID |
| AUD-013 | 🟡 | TASK/DASH/NOTI | Overview ≠ detail |
| AUD-014 | 🟡 | FND/LEAVE/TASK | Role chưa có trong catalog (Auditor/DevOps/PO/PM) |
| AUD-015 | 🟡 | ATT/LEAVE | Scope thiếu permission tương ứng |
| AUD-016 | 🟡 | HR | Permission family trộn trên 1 resource |
| AUD-017 | 🟡 | ATT | 1 permission gánh nhiều action |
| AUD-018 | 🟡 | HR/ATT/DASH | Audit log khai báo có điều kiện mơ hồ |
| AUD-019 | 🟡 | DASH | Lỗi copy-paste ví dụ dashboard_type |
| AUD-020 | 🟢 | All | Idempotency diễn đạt không chuẩn |
| AUD-021 | 🟢 | AUTH/HR | Event-verb vs audit-verb lệch |
| AUD-022 | 🟢 | HR/NOTI | Event endpoint vắng trong bảng tổng |
| AUD-023 | 🟢 | FND/ATT | Endpoint "check" trùng / tên job lệch |
| AUD-024 | 🟢 | FND | Resource naming `_` không đồng nhất |
| AUD-025 | 🟢 | LEAVE/DASH | Mã lỗi tham chiếu chéo không khớp |

---

## 5. Quyết định cần chốt (action items)

1. **Role catalog chuẩn (đã chốt):** `PROJECT_MANAGER` + `PAYROLL_OFFICER` seed ở DB-10 §13.1 (PM dùng cho TASK; PO thuộc Phase 2). `Auditor`/`DevOps` **không phải role MVP** — gate bằng permission `FOUNDATION.AUDIT_LOG.*`/`SEED.*`/`JOB.RUN` ở `COMPANY_ADMIN`/`SUPER_ADMIN` (AUD-014).
2. **VIEW/MANAGE tách bạch:** thêm `FOUNDATION.SYSTEM_SETTING.VIEW`; rà các cặp read/write còn gộp (AUD-001, AUD-016, AUD-017).
3. **Internal auth chuẩn:** mọi `/internal/v1/*` dùng `internalServiceAuth`, khai báo verbatim (AUD-002).
4. **any-of permission:** chốt quy ước `x-permission-mode: anyOf` (AUD-005).
5. **Scope vs role:** không liệt kê `System` cho endpoint role tối đa là Company Admin (AUD-006); chốt cách xử lý scope Department (AUD-015).
6. **Permission orphan:** thêm endpoint hoặc gỡ permission (AUD-009).
7. **Đặt tên:** `NOTI.LOG.*` → `NOTI.DELIVERY_LOG.*`; tách namespace audit-action (AUD-010, AUD-011).
8. **Hoàn thiện tài liệu:** bổ sung Allowed roles/scope còn thiếu, gán API ID cho FND, đồng bộ overview↔detail (AUD-003, AUD-012, AUD-013).
9. **Sau khi chốt:** cập nhật [API-10 Matrix](<API-10 PERMISSION MATRIX.md>) và regenerate `x-required-permission` trong `openapi/enterprise-api.yaml`.

---

## 6. Điểm tốt đã ghi nhận (giữ nguyên)

- Mô hình `permission + data_scope`, backend enforce, frontend chỉ hỗ trợ UI — nhất quán toàn bộ (API-01 §7, áp dụng đều).
- Tách scope theo hậu tố `_OWN`/`_TEAM`/`_COMPANY` (ATT, LEAVE, NOTI) rõ ràng.
- Field-level gate (`*.VIEW_SENSITIVE`) tách khỏi quyền view thường (HR, ATT) — tốt cho dữ liệu nhạy cảm.
- DASH dùng `permission + dashboard_type + widget_code` — mô hình widget-registry mở rộng tốt.
- Internal API tách prefix `/internal/v1` đồng nhất (trừ vài chỗ thiếu khai báo auth ở FND).
