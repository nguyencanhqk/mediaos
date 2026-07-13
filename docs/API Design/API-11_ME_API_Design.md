# API-11: ME API DESIGN (Trung tâm cá nhân & Cài đặt tài khoản)

**MODULE ME - TRUNG TÂM CÁ NHÂN / EMPLOYEE SELF-SERVICE - API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · **API-11 ME**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-09 ME](<../SPEC/SPEC-09 ME.md>) · [Thiết kế DB: DB-08 Audit/Files/Settings (`user_preferences`)](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-09 Index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Seed ME](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-11 |
| Tên tài liệu | ME API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | ME - Trung tâm cá nhân, cài đặt tài khoản, self-service |
| Phiên bản | v0.1 |
| Trạng thái | **Stub / Draft** (chờ owner duyệt PR S5-ME-DOC-1 → Approved cùng SPEC-09 §1) |
| Giai đoạn | MVP Version 1.0 - bổ sung |
| Tài liệu nguồn | SPEC-09 ME, API-01 Tổng quan, DB-08/09/10, permission-matrix-spec |
| Ngày tạo | 13/07/2026 |
| Ngày cập nhật | 13/07/2026 |

> **Trạng thái Stub:** Tài liệu này khoá **tên file + danh sách endpoint + nguyên tắc bắt buộc** để README/SPEC-09 §22.10 trỏ nhất quán. Chi tiết DTO/schema request-response, mã lỗi `ME-ERR-XXX` đầy đủ và ví dụ payload sẽ được bổ sung ở WO backend ME (`S5-ME-BE-*`). ME là lớp tổng hợp — **không tạo dữ liệu canonical mới** ngoài `user_preferences`.

---

## 2. Mục đích tài liệu

Tài liệu này mô tả thiết kế API cho module **ME (Trung tâm cá nhân / Personal Hub)** — lớp trải nghiệm self-service tập trung cho **user hiện tại**. ME tổng hợp dữ liệu cá nhân đang phân tán giữa AUTH, HR, ATT, LEAVE, TASK, NOTI và DASH thành một trải nghiệm thống nhất, nhưng **không chiếm quyền sở hữu** dữ liệu nguồn (SPEC-09 §3.2, §24).

API-11 dùng làm cơ sở cho:

1. Backend triển khai controller/service/DTO cho module ME dưới prefix `/api/v1/me`.
2. Backend orchestrate gọi lại service module nguồn (HR, AUTH, ATT, LEAVE, TASK, NOTI) theo đúng permission nguồn.
3. Frontend triển khai màn hình ME (overview, profile, account, security/sessions, preferences).
4. QA viết test IDOR/permission/scope cho khu vực ME (own-scope, chống nhận owner ID từ client).

---

## 3. Căn cứ thiết kế

API-11 tuân thủ các quyết định đã chốt trong bộ tài liệu:

1. **API-01** — mọi API dùng prefix `/api/v1`, envelope response/error thống nhất, pagination chuẩn, header `X-Request-Id` / `Idempotency-Key`, và bắt buộc kiểm tra authentication + permission + data scope + business validation + audit.
2. **SPEC-09 ME** — nguồn sự thật nghiệp vụ: phạm vi (§5), permission (§11), quy tắc nghiệp vụ (§12), yêu cầu API (§14), dữ liệu/lưu trữ (§15), audit & bảo mật (§17), quyết định ME-DEC-001..010 (§21).
3. **DB-08** — bảng `user_preferences` (personal preference theo user, có `company_id`, `UNIQUE(company_id, user_id)`, RLS ENABLE + FORCE — bất biến #1).
4. **DB-09** — index `user_preferences(company_id, user_id)`.
5. **DB-10** — seed module `ME` + permission ME (`ME.ACCESS`, preference/avatar/notification-preference) theo pattern idempotent `ON CONFLICT DO NOTHING`.
6. **permission-matrix-spec** — ánh xạ permission ME sang tuple `(action, resource_type)` mà permission engine thực thi.
7. **API-02 AUTH** — nền tảng xác thực, resolve `user_id + company_id` từ access token; session/security qua AUTH.
8. **API-03 HR** — nguồn canonical hồ sơ nhân viên và change-request; ME không sửa hồ sơ trực tiếp (ME-DEC-005).

---

## 4. Phạm vi API-11

### 4.1 Bao gồm trong MVP

| Nhóm API | Mô tả |
| --- | --- |
| ME Root / Overview | Tổng hợp danh tính + trạng thái tổng quan của user hiện tại |
| ME Profile | Đọc hồ sơ cá nhân & công việc (mask theo quyền); điều hướng change-request về HR |
| ME Account | Đọc thông tin tài khoản (email, role hiển thị, trạng thái 2FA) |
| ME Security | Xem/ thu hồi phiên đăng nhập, xem hoạt động bảo mật của chính mình |
| ME Summary | Summary chấm công / nghỉ phép / task / thông báo — chịu lỗi cục bộ từng section |
| ME Preferences | Đọc/cập nhật personal preference (`user_preferences`): giao diện, thông báo tùy chọn |
| ME Avatar | Upload/xóa avatar qua file service chung |

### 4.2 Không bao gồm (ngoài phạm vi API-11 hiện tại)

- Sửa hồ sơ trực tiếp (dùng HR change-request — ME-DEC-005).
- Đổi mật khẩu/2FA setup canonical (dùng API-02 AUTH — §5 dưới).
- Export dữ liệu cá nhân (ME-DEC-009: P1/phase sau).
- Biến ME thành dashboard thứ hai (ME-DEC-010: tái dùng query DASH, không sở hữu).

---

## 5. Endpoint tổng hợp ME (SPEC-09 §14.2)

Prefix: `/api/v1/me`

```http
GET    /api/v1/me
GET    /api/v1/me/overview
GET    /api/v1/me/profile
GET    /api/v1/me/account
GET    /api/v1/me/security/sessions
DELETE /api/v1/me/security/sessions/{session_id}
POST   /api/v1/me/security/sessions/revoke-others
GET    /api/v1/me/security/activity
GET    /api/v1/me/attendance-summary
GET    /api/v1/me/leave-summary
GET    /api/v1/me/task-summary
GET    /api/v1/me/notification-summary
GET    /api/v1/me/preferences
PATCH  /api/v1/me/preferences
PATCH  /api/v1/me/preferences/appearance
PATCH  /api/v1/me/preferences/notifications
POST   /api/v1/me/avatar
DELETE /api/v1/me/avatar
```

### 5.1 Bảng endpoint (stub — chi tiết DTO ở WO backend)

| Method | Path | Chức năng | Permission ME (SPEC-09 §11.1) | Ghi audit |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/me` | Danh tính user hiện tại (account + link employee) | `ME.ACCESS` | — |
| GET | `/api/v1/me/overview` | Tổng quan tổng hợp (card + quick actions) | `ME.OVERVIEW.VIEW` | — |
| GET | `/api/v1/me/profile` | Hồ sơ cá nhân & công việc (mask theo quyền) | `ME.PROFILE.VIEW` | — |
| GET | `/api/v1/me/account` | Thông tin tài khoản (email, role hiển thị, 2FA) | `ME.ACCOUNT.VIEW` | — |
| GET | `/api/v1/me/security/sessions` | Danh sách phiên đăng nhập của chính mình | `ME.SESSION.VIEW_OWN` | — |
| DELETE | `/api/v1/me/security/sessions/{session_id}` | Thu hồi một phiên (phải thuộc user hiện tại) | `ME.SESSION.REVOKE_OWN` | ✅ |
| POST | `/api/v1/me/security/sessions/revoke-others` | Thu hồi tất cả phiên khác | `ME.SESSION.REVOKE_OWN` | ✅ |
| GET | `/api/v1/me/security/activity` | Nhật ký hoạt động bảo mật của chính mình | `ME.SECURITY_ACTIVITY.VIEW_OWN` | — |
| GET | `/api/v1/me/attendance-summary` | Summary chấm công (own) | `ME.ATTENDANCE.VIEW_OWN` + ATT nguồn | — |
| GET | `/api/v1/me/leave-summary` | Summary nghỉ phép (own) | `ME.LEAVE.VIEW_OWN` + LEAVE nguồn | — |
| GET | `/api/v1/me/task-summary` | Summary công việc (own) | `ME.TASK.VIEW_OWN` + TASK nguồn | — |
| GET | `/api/v1/me/notification-summary` | Summary thông báo (unread count…) | `ME.NOTIFICATION.VIEW_OWN` + NOTI nguồn | — |
| GET | `/api/v1/me/preferences` | Đọc personal preference | `ME.PREFERENCE.VIEW_OWN` | — |
| PATCH | `/api/v1/me/preferences` | Cập nhật preference tổng hợp | `ME.PREFERENCE.UPDATE_OWN` | ✅ |
| PATCH | `/api/v1/me/preferences/appearance` | Cập nhật giao diện (theme/locale/density/date-time format) | `ME.PREFERENCE.UPDATE_OWN` | ✅ |
| PATCH | `/api/v1/me/preferences/notifications` | Cập nhật notification preference tùy chọn | `ME.NOTIFICATION_PREFERENCE.UPDATE_OWN` | ✅ |
| POST | `/api/v1/me/avatar` | Upload avatar (qua file service; kiểm MIME/size) | `ME.AVATAR.UPDATE_OWN` | ✅ (nếu file private) |
| DELETE | `/api/v1/me/avatar` | Xóa avatar | `ME.AVATAR.UPDATE_OWN` | ✅ (nếu file private) |

> **Notation permission:** Chuỗi `ME.RESOURCE.ACTION` ở trên là **nhãn hiển thị/ánh xạ** sang tuple `(action, resource_type)` mà permission engine thực thi (xem `permission-matrix-spec` + DB-10 seed). Permission engine không dùng chuỗi dotted — cùng quy ước đã pin ở API-09 §1.

---

## 6. Endpoint nghiệp vụ nguồn được gọi lại (SPEC-09 §14.3)

ME **không định nghĩa lại** các nghiệp vụ mutation quan trọng. Mọi hành động sâu điều hướng/gọi về module gốc, và **module gốc kiểm tra permission + business rule lại** (SPEC-09 §12.5):

```http
POST /api/v1/hr/me/profile-change-requests   # sửa hồ sơ → HR approval flow (ME-DEC-005)
POST /api/v1/auth/change-password            # đổi mật khẩu → AUTH
POST /api/v1/attendance/check-in             # chấm công → ATT
POST /api/v1/attendance/check-out            # chấm công → ATT
POST /api/v1/leave/requests                  # tạo đơn nghỉ → LEAVE
GET  /api/v1/tasks/my-tasks                  # công việc của tôi → TASK
GET  /api/v1/notifications                   # thông báo → NOTI
```

---

## 7. Nguyên tắc API BẮT BUỘC (SPEC-09 §14.4, §17)

1. **Chống IDOR — KHÔNG nhận `user_id` hoặc `employee_id` từ client** cho mọi endpoint ME. Owner được **resolve từ access token** (`Access token → user_id + company_id → HR resolve employee → current-person context`, SPEC-09 §12.1). Không có tham số nào cho phép frontend truyền owner ID khác.
2. **Own scope mặc định** — mọi truy vấn giới hạn ở dữ liệu của user hiện tại; session revoke phải **xác minh session thuộc user hiện tại** trước khi thu hồi (SPEC-09 §17.1).
3. **Summary chịu lỗi cục bộ** — response summary/overview có **trạng thái riêng từng section** (`ok` / `module_disabled` / `error` / `unlinked`). Một module nguồn lỗi **không** làm toàn bộ ME lỗi (SPEC-09 §12.3, §18.2). Không trả dữ liệu stale từ cache cũ khi module bị tắt.
4. **Mask theo quyền** — không trả field nhạy cảm (lương, PII, `password_hash`, `refresh_token_hash`, token, secret, storage path file private) nếu user không được phép; masking là việc của server (API-01 §11.4).
5. **Mutation quan trọng ghi audit + security event** — đổi mật khẩu, thu hồi session, upload/xóa avatar private, gửi change-request, thay đổi notification preference bắt buộc, export dữ liệu (SPEC-09 §17). **Không** ghi mật khẩu cũ/mới, token, secret vào audit. Bảng audit là **append-only** (bất biến #2).
6. **Backend không phụ thuộc dữ liệu role do frontend gửi** — quyền lấy từ engine phía server (API-01 §3.1).
7. **`company_id` ở mọi query** — mọi truy vấn nghiệp vụ đi qua `withTenant(companyId, fn)`; cache key phải gồm `company_id + user_id`, không dùng cache chung giữa user (SPEC-09 §12.6, bất biến #1).
8. **Mọi endpoint ME yêu cầu authentication** — không có endpoint ME public.

---

## 8. Chuẩn response, lỗi, pagination, idempotency (theo API-01)

### 8.1 Envelope thành công (object)

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": { "...": "..." },
  "meta": { "request_id": "req_...", "timestamp": "2026-07-13T10:00:00+07:00" }
}
```

### 8.2 Envelope list + pagination (vd. `GET /me/security/sessions`, `GET /me/security/activity`)

```json
{
  "success": true,
  "message": "Lấy danh sách thành công",
  "data": [ { "...": "..." } ],
  "pagination": { "page": 1, "per_page": 20, "total": 100, "total_pages": 5, "has_next": true, "has_prev": false },
  "meta": { "request_id": "req_...", "timestamp": "2026-07-13T10:00:00+07:00" }
}
```

### 8.3 Summary với trạng thái từng section

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "attendance": { "status": "ok", "data": { "...": "..." } },
    "leave": { "status": "module_disabled", "data": null },
    "task": { "status": "error", "data": null },
    "notification": { "status": "ok", "data": { "unread": 3 } }
  },
  "meta": { "request_id": "req_...", "timestamp": "2026-07-13T10:00:00+07:00" }
}
```

### 8.4 Envelope lỗi + mã lỗi

Mã lỗi theo format API-01 §13 `MODULE-ERR-CODE`. Namespace ME dùng `ME-ERR-XXX` (danh mục đầy đủ bổ sung ở WO backend). Dùng lại nhóm lỗi chung của API-01:

| Mã lỗi | HTTP | Ý nghĩa |
| --- | ---: | --- |
| `AUTH-ERR-UNAUTHENTICATED` | 401 | Chưa đăng nhập / token không hợp lệ |
| `AUTH-ERR-FORBIDDEN` | 403 | Không có `ME.ACCESS` hoặc permission nguồn |
| `AUTH-ERR-SCOPE-DENIED` | 403 | Truy cập ngoài own-scope |
| `RESOURCE-ERR-NOT-FOUND` | 404 | Session/preference/avatar không tồn tại hoặc không thuộc user |
| `VALIDATION-ERR-001` | 400 | Body preference/appearance/notification sai định dạng |
| `BUSINESS-ERR-001` | 422 | Vi phạm rule (vd. cố tắt notification bắt buộc — ME-DEC-007; company khóa timezone) |
| `ME-ERR-UNLINKED-EMPLOYEE` | 409 | Tài khoản chưa liên kết hồ sơ nhân viên (SPEC-09 §12.2) — stub, chốt ở WO backend |
| `ME-ERR-DATA-INCONSISTENT` | 409 | Nhiều employee active bất thường; ghi audit/alert, cần Admin/HR xử lý (SPEC-09 §12.4) — stub |

```json
{
  "success": false,
  "message": "Bạn không có quyền thực hiện thao tác này",
  "error": { "code": "AUTH-ERR-FORBIDDEN", "type": "ForbiddenError", "details": null },
  "meta": { "request_id": "req_...", "timestamp": "2026-07-13T10:00:00+07:00" }
}
```

### 8.5 Idempotency

Mutation quan trọng của ME (revoke session/others, upload avatar) **nên** nhận header `Idempotency-Key` (API-01 §21). Khóa idempotency scope theo `company_id + user_id + method + path + idempotency_key`, TTL ví dụ 24 giờ; replay trả `meta.idempotent_replay: true`.

---

## 9. Dữ liệu ME (SPEC-09 §15, DB-08)

- ME **không tạo lại**: `users`, `employees`, `attendance_records`, `leave_requests`, `tasks`, `notifications` (SPEC-09 §15.1).
- Bảng canonical do ME sở hữu: **`user_preferences`** — personal preference theo user (locale, timezone, theme, date/time format, default landing, density, favorite_modules, me_layout_config). Bắt buộc `company_id`, `UNIQUE(company_id, user_id)`, RLS ENABLE + **FORCE** (bất biến #1). Chi tiết cột: DB-08 §`user_preferences`; index: DB-09; seed module/permission: DB-10.

---

## 10. Trạng thái tài liệu & việc còn nợ

| Hạng mục | Trạng thái |
| --- | --- |
| Tên file + prefix + danh sách endpoint §14.2 | ✅ Khoá ở stub này |
| Nguyên tắc bắt buộc (IDOR/summary/mask/audit/tenant) | ✅ Ghi rõ (§7) |
| Cross-link SPEC-09 / DB-08 / DB-09 / DB-10 / permission-matrix / API-01 | ✅ |
| DTO request/response chi tiết từng endpoint | ⏳ WO backend ME (`S5-ME-BE-*`) |
| Danh mục mã lỗi `ME-ERR-XXX` đầy đủ | ⏳ WO backend ME |
| OpenAPI/Swagger cho nhóm ME | ⏳ WO backend/devops ME |
| Flip Trạng thái Stub/Draft → Approved | ⏳ khi owner duyệt PR S5-ME-DOC-1 (đồng bộ SPEC-09 §1 + ME-DEC) |

---

## 11. Liên quan

- **Đặc tả nghiệp vụ (nguồn sự thật):** [SPEC-09 ME](<../SPEC/SPEC-09 ME.md>) — §11 permission, §14 API, §15 dữ liệu, §17 audit/bảo mật, §21 ME-DEC.
- **Chuẩn API:** [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) — envelope, mã lỗi, pagination, idempotency.
- **Thiết kế DB:** [DB-08 `user_preferences`](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-09 index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed ME](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>).
- **Phân quyền:** [Ma trận phân quyền](<../permission-matrix-spec.md>).
- **Chỉ mục:** [README §8](<../README.md>).
