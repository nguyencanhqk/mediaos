# QA-06: SECURITY TESTING
# KIỂM THỬ BẢO MẬT - HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | QA-06 |
| Tên tài liệu | Security Testing |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | QA & Release Readiness - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-05 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

QA-06 định nghĩa chiến lược, phạm vi, checklist và bộ test case kiểm thử bảo mật cho hệ thống quản lý doanh nghiệp nội bộ ở giai đoạn MVP.

Tài liệu này dùng để:

1. Xác định các rủi ro bảo mật chính của hệ thống.
2. Chuẩn hóa cách kiểm thử authentication, session, token và password flow.
3. Kiểm thử authorization, RBAC, permission và data scope ở backend, frontend và API.
4. Kiểm thử chống truy cập trái phép dữ liệu nhạy cảm như hồ sơ nhân viên, bảng công, đơn nghỉ, task, file và notification.
5. Kiểm thử multi-tenant isolation bằng `company_id` và scope `System`.
6. Kiểm thử các lỗi phổ biến theo OWASP Web/API như broken access control, injection, XSS, CSRF, SSRF, insecure file upload, sensitive data exposure, rate limit và security misconfiguration.
7. Kiểm thử bảo mật file upload/download, signed URL, storage path, MIME type, kích thước file và quyền tải file.
8. Kiểm thử audit log, security event, login log và traceability.
9. Tạo tiêu chí security gate trước khi release staging/production.
10. Làm cơ sở cho QA, Backend, Frontend, DevOps và Security reviewer phối hợp kiểm thử.

QA-06 không thay thế kiểm thử xâm nhập chuyên sâu bởi đội security độc lập. Tài liệu này là security test plan và checklist bắt buộc cho MVP trước khi release.

---

## 3. Vị trí QA-06 trong chuỗi QA

```text
QA-01: QA Strategy & Test Plan
QA-02: Test Case Matrix theo module
QA-03: End-to-End Flow Testing
QA-04: API Testing & Contract Testing
QA-05: Permission, Role & Data Scope Testing
QA-06: Security Testing
```

QA-06 kế thừa trực tiếp kết quả của QA-04 và QA-05:

1. QA-04 đảm bảo API đúng contract, response/error/pagination/idempotency.
2. QA-05 đảm bảo permission, role và data scope đúng nghiệp vụ.
3. QA-06 mở rộng kiểm thử sang các rủi ro bảo mật, tấn công, lạm dụng API, rò rỉ dữ liệu và cấu hình hệ thống.

---

## 4. Căn cứ thiết kế bảo mật

QA-06 bám theo các quyết định đã chốt:

1. Backend là nguồn kiểm soát quyền cuối cùng.
2. Frontend chỉ hỗ trợ UX bằng hide, disable, mask, route guard và state, không thay thế backend guard.
3. Mỗi API nghiệp vụ mặc định yêu cầu authentication.
4. Backend phải kiểm tra authentication, user status, company status, permission, data scope, target resource và business rule.
5. API phải stateless; backend resolve `company_id`, `user_id`, `employee_id`, role, permission và data scope từ token/session/database, không tin dữ liệu định danh do frontend tự gửi.
6. Access token và refresh token là cơ chế xác thực chính của MVP.
7. Refresh token nên được revoke/rotate và không được expose ở API không liên quan auth.
8. Tất cả dữ liệu nghiệp vụ phải được filter theo `company_id`.
9. Super Admin scope `System` là trường hợp đặc biệt và phải có API/cơ chế riêng cho truy vấn liên công ty.
10. Permission không được hard-code theo role name; role chỉ là nhóm quyền seed mặc định.
11. Mỗi API dữ liệu phải khai báo required permission, allowed roles, data scope, business validation, audit log và notification event nếu có.
12. File upload mặc định là private, frontend không được nhận storage path thật.
13. File download chỉ được cấp signed URL/ngắn hạn nếu user có quyền.
14. Dashboard, Home Portal và App Switcher không xử lý nghiệp vụ gốc.
15. Notification deep link và dashboard quick action phải điều hướng về module gốc để kiểm tra permission/data scope/business rule lại.
16. Query cache và auth context phải được clear khi logout hoặc session expired.
17. Không log token, password, private URL, storage path, password hash, refresh token hash hoặc dữ liệu nhạy cảm trong client/server logs.

---

## 5. Phạm vi kiểm thử bảo mật MVP

### 5.1 Bao gồm

| Nhóm | Nội dung kiểm thử |
| --- | --- |
| Authentication | Login, logout, token expired, refresh token, password reset, account locked, session revoke |
| Authorization | Permission, data scope, direct URL, direct API, role change, privilege escalation |
| Multi-tenant | Cô lập dữ liệu theo `company_id`, chống truy cập cross-company |
| API security | Contract, method misuse, mass assignment, IDOR/BOLA, injection, idempotency, rate limit |
| Input validation | Validation schema, type confusion, payload quá lớn, field không whitelist |
| Sensitive data | Masking, field-level permission, không trả secret/hash/private path |
| File security | Upload/download, MIME, extension, size, private file, signed URL, virus scan placeholder |
| Frontend security | Token storage, route guard, cache clear, XSS output rendering, open redirect |
| Dashboard/notification | Widget scope, cache isolation, target URL nội bộ, payload không chứa secret |
| Audit/logging | Audit log cho action quan trọng, security event, login log, log masking |
| Infrastructure/config | CORS, security headers, HTTPS, env secret, debug mode, stack trace |
| Abuse/rate limit | Brute force login, reset password spam, dashboard refresh spam, notification spam |
| Dependency/security scan | SCA, secret scan, SAST, dependency vulnerability baseline |

### 5.2 Không bao gồm sâu trong MVP

| Nội dung | Hướng xử lý |
| --- | --- |
| Pentest black-box chuyên sâu | Thực hiện trước production hoặc sau MVP beta |
| Red team/social engineering | Phase sau |
| Mobile native security | Khi triển khai mobile app |
| SSO/OAuth/MFA chuyên sâu | Khi kích hoạt SSO/MFA |
| Device attendance hardware security | Khi tích hợp máy chấm công |
| AI security prompt injection/data leakage | Khi triển khai module AI |
| Full DLP/PII governance | Phase bảo mật nâng cao |

---

## 6. Mô hình rủi ro bảo mật MVP

| Mã rủi ro | Rủi ro | Mức độ | Khu vực ảnh hưởng | Biện pháp kiểm thử |
| --- | --- | --- | --- | --- |
| SEC-RISK-001 | Broken Access Control | Critical | Toàn hệ thống | Permission + scope + direct API test |
| SEC-RISK-002 | IDOR/BOLA | Critical | HR, ATT, LEAVE, TASK, FILE | Thử thay UUID resource ngoài scope |
| SEC-RISK-003 | Cross-tenant data leak | Critical | Multi-tenant | Thử truy cập dữ liệu company khác |
| SEC-RISK-004 | Token/session bị lạm dụng | High | AUTH | Token expired, refresh revoke, logout replay |
| SEC-RISK-005 | Brute force login/password reset | High | AUTH | Rate limit, lockout, generic error |
| SEC-RISK-006 | Sensitive data exposure | High | HR, ATT, LEAVE, FILE, DASH, NOTI | Verify response không trả field cấm |
| SEC-RISK-007 | File upload độc hại | High | HR, ATT, LEAVE, TASK | MIME/extension/size/private URL test |
| SEC-RISK-008 | Injection | High | API list/search/filter/sort | SQLi payload, sort whitelist, filter whitelist |
| SEC-RISK-009 | XSS | High | Comment, task title, notification, profile field | Stored/reflected XSS payload |
| SEC-RISK-010 | CSRF nếu dùng cookie auth | High | API state-changing | SameSite/CSRF token/origin test |
| SEC-RISK-011 | Open redirect | Medium | Login returnUrl, notification target | Chặn external URL |
| SEC-RISK-012 | Cache leak | High | Frontend query cache, dashboard cache | Logout/change user/cache key test |
| SEC-RISK-013 | Audit log thiếu hoặc chứa secret | High | Foundation/Audit | Verify audit coverage + masking |
| SEC-RISK-014 | Security misconfiguration | High | Deploy/config | CORS, headers, debug, stack trace |
| SEC-RISK-015 | Internal API exposed | Critical | NOTI/DASH/internal jobs | Verify internal auth/not public |

---

## 7. Chuẩn phân loại mức độ lỗi bảo mật

| Severity | Định nghĩa | Ví dụ | Yêu cầu xử lý |
| --- | --- | --- | --- |
| Critical | Có thể truy cập/sửa/xóa dữ liệu trái phép quy mô lớn hoặc chiếm tài khoản | Employee xem payroll/HR sensitive toàn công ty; Manager sửa dữ liệu ngoài team; cross-tenant leak | Block release, fix ngay |
| High | Rò rỉ dữ liệu nhạy cảm, bypass quyền quan trọng, upload file độc hại, token leak | API trả password hash/storage path/private URL; file download không kiểm tra quyền | Block release nếu thuộc P0/P1 |
| Medium | Lỗi bảo mật có điều kiện hoặc ảnh hưởng giới hạn | Error response lộ thông tin nội bộ; thiếu rate limit endpoint phụ | Fix trước production hoặc có mitigation rõ |
| Low | Hardening/defense-in-depth, không khai thác trực tiếp | Header security thiếu một số directive phụ | Có thể backlog nếu có owner/deadline |
| Info | Khuyến nghị cải thiện | Version library hơi cũ nhưng chưa có CVE exploit | Theo dõi |

> **Ánh xạ về thang severity chuẩn S0–S4 ([QA-08 §9](QA-08_Bug_Tracking_Regression_Release_Criteria.md)):** Critical → **S0**; High → **S1**; Medium → **S2**; Low → **S3**; Info → **S4**. Thang Critical/High/Medium/Low/Info ở trên dùng nội bộ cho bảo mật; khi ghi nhận bug vào bug tracker, dùng S0–S4 theo QA-08.

---

## 8. Môi trường và dữ liệu kiểm thử

### 8.1 Môi trường

| Môi trường | Mục đích |
| --- | --- |
| Local | Unit/security developer test, SAST/SCA, secret scan |
| Dev | API security test sớm, contract + permission regression |
| Staging | Security regression đầy đủ trước release |
| Production | Chỉ kiểm tra cấu hình an toàn, health, header, không destructive test |

### 8.2 Bộ tài khoản test

| Tài khoản | Vai trò | Scope | Mục đích |
| --- | --- | --- | --- |
| `employee.a@company-a.test` | Employee | Own | Self-service, own data |
| `employee.b@company-a.test` | Employee | Own | Dữ liệu khác để test IDOR |
| `manager.a@company-a.test` | Manager | Team | Team scope |
| `manager.b@company-a.test` | Manager | Team khác | Cross-team negative test |
| `hr.a@company-a.test` | HR | Company | HR company-wide |
| `admin.a@company-a.test` | Company Admin | Company | Admin config |
| `superadmin@test` | Super Admin | System | System scope có kiểm soát |
| `employee.a@company-b.test` | Employee | Own | Cross-tenant negative test |
| `locked.user@company-a.test` | Employee | Own, locked | Account locked/session revoke |

### 8.3 Dữ liệu seed cần có

1. Tối thiểu 2 company/tenant: Company A và Company B.
2. Mỗi company có ít nhất 2 phòng ban.
3. Mỗi phòng ban có manager riêng.
4. Mỗi employee có user account liên kết.
5. Có employee active, probation, inactive, resigned, locked user.
6. Có dữ liệu HR hồ sơ nhạy cảm.
7. Có attendance records, attendance logs, adjustment requests.
8. Có leave requests ở trạng thái Draft, Pending, Approved, Rejected, Cancelled, Revoked.
9. Có task/project public/private, task comment, task file.
10. Có notification cá nhân, admin notification, delivery log.
11. Có file private thuộc HR/ATT/LEAVE/TASK.
12. Có dashboard config/cache theo user/role/company.

---

## 9. Công cụ kiểm thử đề xuất

| Nhóm | Công cụ gợi ý | Mục đích |
| --- | --- | --- |
| API security | Postman/Newman, Insomnia, REST Assured, Playwright API | Kiểm thử endpoint, auth, scope, negative payload |
| DAST | OWASP ZAP baseline/full scan | Scan XSS, injection, headers, passive/active findings |
| SAST | Semgrep, CodeQL | Scan code pattern nguy hiểm |
| SCA | npm audit, pnpm audit, Snyk, Dependabot | Dependency vulnerability |
| Secret scanning | Gitleaks, TruffleHog, GitHub secret scanning | Secret/API key/token leak |
| Container/image | Trivy, Grype | Vulnerability image nếu dùng Docker |
| IaC/config | Checkov, Trivy config | Scan Docker/K8s/Terraform/GitHub Actions nếu có |
| DB security | Migration review, SQL injection test, least privilege review | Kiểm thử DB hardening |
| Browser security | DevTools, Playwright, Lighthouse security basics | Header, cookie, token, cache |
| File security | Custom script + API tests | Upload/download/MIME/signed URL |

---

## 10. Security test strategy theo tầng

### 10.1 Static checks trước khi chạy app

| Check | Điều kiện pass |
| --- | --- |
| Secret scan | Không có secret thật trong repo, `.env`, logs, screenshots |
| SCA | Không có Critical/High vulnerability chưa có mitigation |
| SAST | Không có Critical/High finding mở trước release |
| Lint security rule | Không log token/password/private URL; không dùng `dangerouslySetInnerHTML` thiếu sanitize |
| Dependency lockfile | Lockfile được commit và scan trong CI |
| Environment config | Không có secret trong `VITE_*`; debug mode off ở staging/prod |

### 10.2 API security checks

| Check | Điều kiện pass |
| --- | --- |
| Auth required | API nghiệp vụ thiếu/invalid token trả 401 |
| Permission required | Thiếu permission trả 403 |
| Data scope | Resource ngoài scope trả 403/404 hoặc empty theo policy, không trả data |
| Tenant isolation | Dữ liệu company khác không truy cập được |
| IDOR/BOLA | Thay UUID của user khác ngoài scope bị chặn |
| Mass assignment | Field không whitelist bị ignore hoặc validation error |
| Injection | SQLi/XSS payload không làm query lỗi/lộ data |
| Rate limit | Endpoint nhạy cảm có 429 hoặc lockout phù hợp |
| Idempotency | Action quan trọng không xử lý trùng |
| Error response | Không trả stack trace, SQL error, secret, internal path |

### 10.3 Frontend security checks

| Check | Điều kiện pass |
| --- | --- |
| Token storage | Không lưu access token trong localStorage nếu không có lý do chốt |
| Query cache | Clear khi logout/session expired/change user |
| Direct URL | Route trái quyền bị 403/redirect và API vẫn 403 |
| XSS rendering | User-generated content được escape/sanitize |
| Open redirect | `returnUrl` và notification target chỉ chấp nhận internal path |
| Field mask | UI không hiển thị field nhạy cảm khi thiếu quyền, API cũng không trả raw |
| Error state | 401/403/404/409/422/500 hiển thị đúng, không lộ debug info |

### 10.4 Infrastructure/config checks

| Check | Điều kiện pass |
| --- | --- |
| HTTPS | Staging/prod dùng HTTPS, redirect HTTP -> HTTPS nếu applicable |
| CORS | Chỉ allow origin hợp lệ, không `*` với credentials |
| Cookie flags | HttpOnly, Secure, SameSite phù hợp nếu dùng cookie auth |
| Security headers | Có `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Frame-Options` hoặc `frame-ancestors` |
| Debug/stack trace | Tắt debug detail ở staging/prod |
| Internal API | `/internal/v1/*` không expose public hoặc bắt buộc service auth |
| Upload storage | Private bucket, không public list, không expose storage path |
| DB user | Application DB user không dùng superuser |

---

## 11. Bộ test case chi tiết

### 11.1 Authentication & session security

| Test ID | Mục tiêu | Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-AUTH-001 | API nghiệp vụ yêu cầu đăng nhập | Gọi `/api/v1/hr/employees`, `/api/v1/attendance/today`, `/api/v1/leave/me/requests` không token | Trả 401, không trả data | Critical |
| QA06-AUTH-002 | Token sai format bị chặn | Gửi `Authorization: Bearer invalid` | Trả 401, không crash | High |
| QA06-AUTH-003 | Token hết hạn được xử lý đúng | Dùng access token expired | API trả 401 hoặc refresh flow chạy đúng; nếu refresh fail thì logout | High |
| QA06-AUTH-004 | Logout revoke session | Login -> logout -> dùng token/refresh cũ gọi API | Bị 401, refresh token không còn hiệu lực | High |
| QA06-AUTH-005 | User locked không truy cập được | Login hoặc gọi API bằng user locked | Login fail hoặc API trả 403/account locked | High |
| QA06-AUTH-006 | Company suspended bị chặn | User thuộc company suspended gọi API | Trả 403/company inactive, không trả data | Critical |
| QA06-AUTH-007 | Password reset token hết hạn | Dùng reset token quá hạn | Reset fail, không đổi mật khẩu | High |
| QA06-AUTH-008 | Password reset token dùng một lần | Reset thành công rồi dùng lại token | Lần 2 fail | High |
| QA06-AUTH-009 | Login brute force | Gửi sai mật khẩu nhiều lần | Rate limit/lockout/generic error theo policy | High |
| QA06-AUTH-010 | Error login không reveal user tồn tại | Login email không tồn tại và sai password user tồn tại | Message tương đương, không enumerate account | Medium |
| QA06-AUTH-011 | Refresh token rotation/revoke | Refresh nhiều lần bằng token cũ nếu backend hỗ trợ rotation | Token cũ bị revoke hoặc có behavior nhất quán | High |
| QA06-AUTH-012 | Session list/terminate | Terminate session khác rồi dùng session đó gọi API | Session bị 401 | Medium |

### 11.2 Authorization, RBAC & data scope security

| Test ID | Mục tiêu | Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-AUTHZ-001 | Không hard-code role | Gán custom role có permission HR.EMPLOYEE.VIEW | User xem đúng theo permission, không cần role name HR | High |
| QA06-AUTHZ-002 | Role không đủ permission bị chặn | User không có `HR.EMPLOYEE.CREATE` gọi POST employee | Trả 403 | Critical |
| QA06-AUTHZ-003 | Scope Own chỉ xem dữ liệu chính mình | Employee A gọi detail Employee B | Trả 403/404, không trả data | Critical |
| QA06-AUTHZ-004 | Scope Team không vượt team | Manager A xem attendance Employee ngoài team | Trả 403/404 hoặc empty | Critical |
| QA06-AUTHZ-005 | Scope Department không vượt department | HR scope Department filter department khác | Bị chặn hoặc chỉ trả scope hợp lệ | Critical |
| QA06-AUTHZ-006 | Scope Company không vượt company | HR Company A gọi UUID Employee Company B | Trả 403/404 | Critical |
| QA06-AUTHZ-007 | Scope System chỉ qua API/cơ chế được phép | User không phải Super Admin thử truyền company_id khác | Bị ignore/validation/403 | Critical |
| QA06-AUTHZ-008 | Direct URL trái quyền | Vào `/system/users`, `/leave/balances` khi thiếu quyền | Frontend 403; gọi API trực tiếp vẫn 403 | High |
| QA06-AUTHZ-009 | Button hidden không đủ bảo mật | Ẩn button approve rồi gọi API approve trực tiếp | Backend 403 nếu thiếu quyền | Critical |
| QA06-AUTHZ-010 | Permission thay đổi trong phiên | Admin thu hồi quyền user đang login | API tiếp theo bị 403 hoặc cache permission invalidate theo thiết kế | High |
| QA06-AUTHZ-011 | Field-level permission | User thiếu quyền xem identity/bank/salary gọi HR detail | Field bị mask/omit, không trả raw | Critical |
| QA06-AUTHZ-012 | Admin endpoint scope | Company Admin gọi endpoint system-level | Bị chặn nếu không có scope System | Critical |

### 11.3 Multi-tenant isolation

| Test ID | Mục tiêu | Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-TENANT-001 | Query list filter theo company | HR Company A gọi list employees | Chỉ trả Company A | Critical |
| QA06-TENANT-002 | IDOR cross-company HR | Dùng UUID employee Company B trong API Company A | 403/404, không data | Critical |
| QA06-TENANT-003 | Cross-company ATT | Gọi attendance record ID của Company B | 403/404 | Critical |
| QA06-TENANT-004 | Cross-company LEAVE | Duyệt leave request Company B bằng HR Company A | 403/404 | Critical |
| QA06-TENANT-005 | Cross-company TASK | Mở task/project Company B | 403/404 | Critical |
| QA06-TENANT-006 | Cross-company notification | Gọi notification ID thuộc user/company khác | 403/404 | Critical |
| QA06-TENANT-007 | Dashboard cache isolation | Login Company A rồi Company B trên cùng browser/test client | Dashboard không lẫn cache/widget/data | Critical |
| QA06-TENANT-008 | File cross-company | Dùng file_id Company B ở Company A | Không xem/tải được | Critical |
| QA06-TENANT-009 | Seed/global role confusion | Role global không làm user company tự có scope System | Không có System access nếu không được cấp | High |
| QA06-TENANT-010 | Export cross-company | Export HR/ATT/LEAVE với params company_id khác | Bị ignore/403/validation | Critical |

### 11.4 API input validation, injection & mass assignment

| Test ID | Mục tiêu | Payload/Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-API-001 | Reject invalid UUID | Gọi `/hr/employees/not-a-uuid` | 400 validation, không stack trace | Medium |
| QA06-API-002 | SQL injection search | `search=' OR 1=1 --` | Không trả vượt scope, không SQL error | High |
| QA06-API-003 | SQL injection filter | `department_id=uuid' OR '1'='1` | 400 validation | High |
| QA06-API-004 | Sort whitelist | `sort=password_hash:asc` | 400 validation hoặc ignore an toàn | High |
| QA06-API-005 | Field không whitelist | PATCH employee kèm `role=SUPER_ADMIN` | Field bị ignore/422, không privilege escalation | Critical |
| QA06-API-006 | Mass assignment company_id | POST leave kèm `company_id` khác | Ignore/422, backend dùng auth context | Critical |
| QA06-API-007 | Mass assignment employee_id | Employee A tạo leave cho Employee B | Ignore/422/403, request thuộc Employee A hoặc fail | Critical |
| QA06-API-008 | Payload quá lớn | POST comment/description cực lớn | 413/422, không crash | Medium |
| QA06-API-009 | Type confusion | Gửi array/object vào field string/date/number | 400/422 validation | Medium |
| QA06-API-010 | Method misuse | Gọi GET cho action approve hoặc POST list không hợp lệ | 405/404 theo framework, không xử lý nhầm | Medium |
| QA06-API-011 | Duplicate idempotency | Gửi 2 lần cùng Idempotency-Key tạo leave/task/check-in | Chỉ xử lý một lần, response nhất quán | High |
| QA06-API-012 | Missing idempotency action quan trọng | Gọi action cần idempotency không header | 400/422 hoặc warning theo policy | Medium |
| QA06-API-013 | Parameter pollution | `?employee_id=A&employee_id=B` | Xử lý deterministic/validation, không bypass scope | High |
| QA06-API-014 | Graph of nested validation | Body nested invalid items/checklist | Trả validation details rõ, không crash | Low |
| QA06-API-015 | Error response leak | Gây lỗi DB/constraint giả lập | Không trả SQL, stack trace, internal path | High |

### 11.5 XSS, output encoding & content security

| Test ID | Mục tiêu | Payload/Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-XSS-001 | Stored XSS trong task title | Tạo task title `<script>alert(1)</script>` | Hiển thị escaped, không execute | High |
| QA06-XSS-002 | Stored XSS trong task comment | Comment chứa `<img src=x onerror=alert(1)>` | Escaped/sanitized, không execute | High |
| QA06-XSS-003 | XSS trong employee profile field | Update display name/address chứa HTML | Không execute ở HR/DASH/NOTI | High |
| QA06-XSS-004 | XSS trong notification title/message | Event payload chứa HTML | Notification render an toàn | High |
| QA06-XSS-005 | XSS trong filename | Upload file tên `<svg onload=alert(1)>.png` | Filename escaped khi hiển thị | Medium |
| QA06-XSS-006 | Markdown/rich text nếu có | Comment hỗ trợ markdown chứa script/link JS | Sanitizer chặn `javascript:` | High |
| QA06-XSS-007 | CSP baseline | Mở app staging kiểm tra CSP | Có CSP phù hợp, không cho inline script nguy hiểm nếu có thể | Medium |
| QA06-XSS-008 | DOM XSS từ query params | Truy cập URL có query chứa script | Không render raw query | High |

### 11.6 CSRF, CORS, cookie & browser security

| Test ID | Mục tiêu | Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-BROWSER-001 | CORS không mở rộng | Request từ origin lạ | Không allow credentials/origin lạ | High |
| QA06-BROWSER-002 | Cookie flags nếu dùng cookie auth | Kiểm tra Set-Cookie | Có HttpOnly, Secure, SameSite phù hợp | High |
| QA06-BROWSER-003 | CSRF state-changing API | Từ origin lạ POST approve/check-in nếu cookie auth | Bị chặn bởi SameSite/CSRF/origin check | High |
| QA06-BROWSER-004 | Open redirect returnUrl | `/login?returnUrl=https://evil.com` | Không redirect external, chỉ internal path | High |
| QA06-BROWSER-005 | Notification target URL | Notification target là external URL | Bị reject hoặc render không điều hướng external | High |
| QA06-BROWSER-006 | Security headers | Kiểm tra response app/API | Có X-Content-Type-Options, Referrer-Policy, Frame/CSP | Medium |
| QA06-BROWSER-007 | Clickjacking | Nhúng app vào iframe external | Bị chặn bởi frame policy/CSP | Medium |
| QA06-BROWSER-008 | Cache browser dữ liệu nhạy cảm | Logout rồi Back browser | Không thấy dữ liệu nhạy cảm hoặc bị redirect/login | High |

### 11.7 File upload/download security

| Test ID | Mục tiêu | Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-FILE-001 | File private mặc định | Upload file HR/LEAVE/TASK | Response chỉ có metadata/file_id, không storage path | High |
| QA06-FILE-002 | Download kiểm tra quyền | User ngoài scope dùng file_id | 403/404, không cấp URL | Critical |
| QA06-FILE-003 | Signed URL ngắn hạn | Lấy download_url rồi chờ hết hạn | URL hết hạn không tải được | High |
| QA06-FILE-004 | MIME spoofing | Upload `.jpg` chứa executable/script | Bị chặn nếu MIME/extension không hợp lệ hoặc đánh dấu cần scan | High |
| QA06-FILE-005 | Extension bị cấm | Upload `.exe`, `.sh`, `.html`, `.svg` nếu policy cấm | Bị reject | High |
| QA06-FILE-006 | Size limit | Upload file vượt max size | 413/422, không lưu partial nguy hiểm | Medium |
| QA06-FILE-007 | Filename path traversal | Upload tên `../../secret.txt` | Tên được sanitize, không path traversal | High |
| QA06-FILE-008 | Public storage listing | Thử truy cập bucket/path public | Không list được, không public path | Critical |
| QA06-FILE-009 | File access log | Tải/xem file nhạy cảm | Có file_access_log/audit nếu policy yêu cầu | Medium |
| QA06-FILE-010 | Cross-module file attach | Gắn file HR vào task trái quyền | Bị chặn nếu không có quyền file/source entity | High |
| QA06-FILE-011 | Private URL trong notification | Notification payload chứa file URL | Không chứa `private_file_url`/`storage_path` | High |
| QA06-FILE-012 | Virus scan placeholder | Upload file nguy hiểm mẫu EICAR nếu có scan | Scan block/quarantine hoặc ghi rõ not-supported + mitigation | Medium |

### 11.8 Sensitive data exposure & masking

| Test ID | Mục tiêu | Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-DATA-001 | Không trả password hash | Gọi user detail/list | Không có `password_hash` | Critical |
| QA06-DATA-002 | Không trả refresh token hash | Gọi session/detail | Không có `refresh_token_hash` | Critical |
| QA06-DATA-003 | Không trả secret setting | Gọi settings API thiếu quyền | Secret bị mask/omit | Critical |
| QA06-DATA-004 | HR sensitive field mask | Employee/Manager xem HR detail | identity/bank/salary bị mask/omit nếu thiếu quyền | Critical |
| QA06-DATA-005 | Attendance GPS/IP detail | List attendance records | Không trả raw GPS/IP/device detail nếu không cần | High |
| QA06-DATA-006 | Audit raw diff mask | Xem audit logs | Dữ liệu nhạy cảm old/new value bị mask nếu thiếu quyền | High |
| QA06-DATA-007 | Dashboard không lộ dữ liệu nguồn | Dashboard user thiếu source permission | Widget hidden/forbidden/degraded, không trả raw | High |
| QA06-DATA-008 | Notification payload safe | GET notification detail | Không chứa password/token/secret/salary/private URL/raw GPS | High |
| QA06-DATA-009 | Export respects mask/scope | Export HR/ATT/LEAVE thiếu quyền field | File export không có field nhạy cảm | Critical |
| QA06-DATA-010 | Error details không lộ PII | Gây validation/business error | Details không chứa PII quá mức | Medium |

### 11.9 Module-specific security test matrix

#### 11.9.1 AUTH / Account / RBAC

| Test ID | Mục tiêu | Kết quả mong đợi | Severity |
| --- | --- | --- | --- |
| QA06-MOD-AUTH-001 | User thiếu quyền không xem được user list | 403 | High |
| QA06-MOD-AUTH-002 | User không thể tự gán role cao hơn | 403/audit | Critical |
| QA06-MOD-AUTH-003 | Role permission update cần audit | Có audit log old/new | High |
| QA06-MOD-AUTH-004 | Không xóa/disable Super Admin cuối cùng nếu policy cấm | Business error | Critical |
| QA06-MOD-AUTH-005 | Password change yêu cầu current password | Không đổi nếu current password sai | High |
| QA06-MOD-AUTH-006 | Session revoke user khác cần permission | 403 nếu thiếu quyền | High |

#### 11.9.2 HR

| Test ID | Mục tiêu | Kết quả mong đợi | Severity |
| --- | --- | --- | --- |
| QA06-MOD-HR-001 | Employee chỉ xem hồ sơ của mình | Không xem Employee B | Critical |
| QA06-MOD-HR-002 | Profile change request không cập nhật trực tiếp hồ sơ chính | Chỉ tạo request pending | High |
| QA06-MOD-HR-003 | HR approve profile change ngoài scope bị chặn | 403/404 | Critical |
| QA06-MOD-HR-004 | Employee code config chỉ admin/HR có quyền sửa | 403 nếu thiếu quyền | High |
| QA06-MOD-HR-005 | Soft delete employee không làm mất audit/history | Audit/history còn | Medium |
| QA06-MOD-HR-006 | Employee file chỉ người có quyền xem/tải | 403/404 nếu ngoài scope | Critical |

#### 11.9.3 ATT

| Test ID | Mục tiêu | Kết quả mong đợi | Severity |
| --- | --- | --- | --- |
| QA06-MOD-ATT-001 | Employee không check-in cho người khác | employee_id tự gửi bị ignore/422 | Critical |
| QA06-MOD-ATT-002 | Check-in/out cần idempotency | Không tạo trùng log/record | High |
| QA06-MOD-ATT-003 | Approved leave full-day chặn check-in | Business error, audit nếu cần | High |
| QA06-MOD-ATT-004 | Manager chỉ duyệt adjustment team mình | 403 ngoài team | Critical |
| QA06-MOD-ATT-005 | HR manual adjustment cần audit old/new | Có audit đầy đủ | High |
| QA06-MOD-ATT-006 | Remote request GPS/IP/photo không lộ ở list | Raw data chỉ detail có quyền | High |

#### 11.9.4 LEAVE

| Test ID | Mục tiêu | Kết quả mong đợi | Severity |
| --- | --- | --- | --- |
| QA06-MOD-LEAVE-001 | Employee không tạo leave cho người khác | employee_id tự gửi bị ignore/422 | Critical |
| QA06-MOD-LEAVE-002 | Manager chỉ approve team | 403 ngoài team | Critical |
| QA06-MOD-LEAVE-003 | Leave balance adjust cần permission + idempotency | Thiếu quyền 403, duplicate không xử lý trùng | High |
| QA06-MOD-LEAVE-004 | Approved/cancel/revoke sync ATT trong transaction/consistency | Không lệch dữ liệu | High |
| QA06-MOD-LEAVE-005 | Leave calendar theo scope | Không lộ lịch nghỉ ngoài scope | High |
| QA06-MOD-LEAVE-006 | File chứng minh nghỉ phép private | Không tải được nếu không có quyền | High |

#### 11.9.5 TASK

| Test ID | Mục tiêu | Kết quả mong đợi | Severity |
| --- | --- | --- | --- |
| QA06-MOD-TASK-001 | Project private chỉ member/scope phù hợp xem | 403/404 nếu ngoài quyền | Critical |
| QA06-MOD-TASK-002 | User không assign task cho employee ngoài scope nếu policy cấm | Business/403 | High |
| QA06-MOD-TASK-003 | Comment mention không gửi notification lộ dữ liệu private | Notification safe, target guard lại | High |
| QA06-MOD-TASK-004 | Task status update cần permission/business rule | 403/422 nếu không hợp lệ | High |
| QA06-MOD-TASK-005 | Task file private theo task/project permission | 403/404 nếu ngoài quyền | High |
| QA06-MOD-TASK-006 | XSS trong comment/task detail | Không execute | High |

#### 11.9.6 NOTI

| Test ID | Mục tiêu | Kết quả mong đợi | Severity |
| --- | --- | --- | --- |
| QA06-MOD-NOTI-001 | User chỉ xem notification của mình | 403/404 notification người khác | Critical |
| QA06-MOD-NOTI-002 | Admin notification list cần permission/scope | 403 nếu thiếu quyền | High |
| QA06-MOD-NOTI-003 | Notification payload không chứa key bị cấm | Không password/token/secret/private URL | High |
| QA06-MOD-NOTI-004 | Deep link đi qua route/module guard | Không bypass quyền module gốc | High |
| QA06-MOD-NOTI-005 | Internal event API không public | 401/403 nếu không service auth | Critical |
| QA06-MOD-NOTI-006 | Dedupe key chống tạo trùng notification | 409 hoặc return existing theo contract | Medium |

#### 11.9.7 DASH

| Test ID | Mục tiêu | Kết quả mong đợi | Severity |
| --- | --- | --- | --- |
| QA06-MOD-DASH-001 | Dashboard me chỉ trả widget user có quyền | Không trả widget thiếu permission | High |
| QA06-MOD-DASH-002 | Widget source permission được kiểm tra | Thiếu source permission -> hidden/forbidden/degraded | High |
| QA06-MOD-DASH-003 | Cache Own/Team không dùng chung sai user | Không lộ dữ liệu user/team khác | Critical |
| QA06-MOD-DASH-004 | Dashboard admin config cần audit | Có audit config update/delete/reset | Medium |
| QA06-MOD-DASH-005 | Widget source lỗi không trả stack trace | Degraded/error safe | Medium |
| QA06-MOD-DASH-006 | Rate limit refresh dashboard | 429/slowdown theo policy | Medium |

#### 11.9.8 FOUNDATION / SYSTEM

| Test ID | Mục tiêu | Kết quả mong đợi | Severity |
| --- | --- | --- | --- |
| QA06-MOD-SYS-001 | Audit log view cần permission | 403 nếu thiếu quyền | High |
| QA06-MOD-SYS-002 | Audit log không sửa/xóa tùy tiện | Không có endpoint hoặc chỉ super admin có audit | High |
| QA06-MOD-SYS-003 | Company settings secret mask | Không trả raw secret | Critical |
| QA06-MOD-SYS-004 | Module catalog không làm lộ app hidden nếu policy ẩn | Chỉ trả module theo quyền/status | Medium |
| QA06-MOD-SYS-005 | Sequence counter không bị client chỉnh | 403/validation nếu thiếu quyền | High |
| QA06-MOD-SYS-006 | Public holidays không vượt tenant/scope | Filter company đúng | Medium |

### 11.10 Rate limit & abuse testing

| Test ID | Mục tiêu | Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-RATE-001 | Login brute force | 20-50 lần sai mật khẩu/IP/user | 429/lockout/captcha policy nếu có | High |
| QA06-RATE-002 | Forgot password spam | Gửi nhiều request email | Rate limit + generic message | High |
| QA06-RATE-003 | Refresh token spam | Gọi refresh liên tục | Rate limit hoặc revoke behavior an toàn | Medium |
| QA06-RATE-004 | Check-in/out spam | Click/gửi nhiều request song song | Idempotency + business rule chống trùng | High |
| QA06-RATE-005 | Dashboard refresh spam | Refresh `/dashboard/me` liên tục | 429/cache/debounce | Medium |
| QA06-RATE-006 | Notification mark all read spam | Gọi liên tục | Rate limit hoặc idempotent safe | Medium |
| QA06-RATE-007 | File download spam | Tải file private liên tục | Rate limit/log phù hợp | Medium |
| QA06-RATE-008 | Export abuse | Gọi export range lớn/nhiều lần | Giới hạn range, queue hoặc 429 | High |

### 11.11 Audit, logging & monitoring security

| Test ID | Mục tiêu | Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-AUDIT-001 | Login success/fail ghi log | Login thành công/thất bại | Có login log/security event theo policy | Medium |
| QA06-AUDIT-002 | Role/permission change audit | Update role permission | Có actor, target, old/new masked, request_id | High |
| QA06-AUDIT-003 | HR sensitive update audit | Update employee contract/status/profile | Có audit log | High |
| QA06-AUDIT-004 | Attendance manual adjustment audit | HR chỉnh công trực tiếp | Có audit old/new | High |
| QA06-AUDIT-005 | Leave balance adjust audit | Điều chỉnh phép | Có audit old/new + transaction | High |
| QA06-AUDIT-006 | File access log | Tải file nhạy cảm | Có file access log nếu bật | Medium |
| QA06-AUDIT-007 | Audit log masking | Xem audit chứa PII/secret | Mask đúng theo quyền | High |
| QA06-AUDIT-008 | Audit immutability basic | Thử sửa/xóa audit log qua API | Không cho phép hoặc chỉ admin đặc biệt + audit | High |
| QA06-AUDIT-009 | Request ID correlation | Gọi API lỗi/action quan trọng | Response/log có request_id tương ứng | Medium |
| QA06-AUDIT-010 | No secret in logs | Kiểm tra app/backend logs sau test | Không token/password/private URL | Critical |

### 11.12 CI/CD and release security checks

| Test ID | Mục tiêu | Bước kiểm thử | Kết quả mong đợi | Severity |
| --- | --- | --- | --- | --- |
| QA06-CICD-001 | Secret scanning in CI | Commit test secret giả hoặc chạy scan repo | CI phát hiện/không có secret thật | High |
| QA06-CICD-002 | Dependency scan | Chạy `pnpm audit`/Snyk/Dependabot | Không có Critical/High chưa xử lý | High |
| QA06-CICD-003 | SAST baseline | Chạy Semgrep/CodeQL | Không có Critical/High open | High |
| QA06-CICD-004 | Docker image scan nếu có | Chạy Trivy image | Không có Critical/High chưa xử lý | Medium |
| QA06-CICD-005 | Env production sanity | Kiểm tra env staging/prod | Debug off, no public secret, correct API base | High |
| QA06-CICD-006 | Build artifact không chứa `.env` | Inspect artifact | Không đóng gói secret file | Critical |
| QA06-CICD-007 | Source map policy | Staging/prod source map theo policy | Không public source map nếu policy cấm | Medium |
| QA06-CICD-008 | Migration không seed password yếu production | Review seed/bootstrap | Admin bootstrap an toàn, không default password public | Critical |

---

## 12. Security checklist theo OWASP API Top 10

| OWASP API Risk | Checklist QA-06 |
| --- | --- |
| API1 Broken Object Level Authorization | IDOR/BOLA test cho HR, ATT, LEAVE, TASK, NOTI, FILE |
| API2 Broken Authentication | Login, token, refresh, logout, password reset, brute force |
| API3 Broken Object Property Level Authorization | Field-level permission, mass assignment, sensitive field masking |
| API4 Unrestricted Resource Consumption | Rate limit, payload size, export limit, dashboard refresh limit |
| API5 Broken Function Level Authorization | Direct API action test, role/permission/scope test |
| API6 Unrestricted Access to Sensitive Business Flows | Check-in spam, approve spam, notification/event abuse, export abuse |
| API7 Server Side Request Forgery | Nếu có URL import/webhook/file fetch ở phase sau thì test SSRF; MVP không expose URL fetch public |
| API8 Security Misconfiguration | CORS, headers, debug, stack trace, internal API, storage public access |
| API9 Improper Inventory Management | API versioning, internal/public endpoint separation, disabled module behavior |
| API10 Unsafe Consumption of APIs | Notification/internal event service auth, external delivery provider masking |

---

## 13. Security checklist theo OWASP ASVS rút gọn

| Nhóm ASVS | Checklist MVP |
| --- | --- |
| V2 Authentication | Password policy, login error generic, reset token one-time/expiry, session revoke |
| V3 Session Management | Token expiry, refresh revoke/rotation, cookie flags, logout clear session |
| V4 Access Control | Permission + scope + target resource + business rule ở backend |
| V5 Validation | Schema validation, whitelist, injection payload, payload size |
| V7 Error/Logging | No stack trace, no secret logs, audit important actions |
| V8 Data Protection | Mask sensitive fields, no hash/token/private path, private files |
| V10 Malicious Code | SAST/SCA/secret scan, dependency baseline |
| V11 Business Logic | Idempotency, duplicate action, state transition guard |
| V12 File/Resource | MIME/extension/size, signed URL, private storage |
| V14 Configuration | Security headers, CORS, HTTPS, debug off, internal API protected |

---

## 14. API security negative payload library

QA có thể dùng payload mẫu sau trong Postman/Newman hoặc Playwright API tests.

### 14.1 SQL injection payloads

```text
' OR '1'='1
' OR 1=1 --
admin'--
1; DROP TABLE users; --
%' UNION SELECT password_hash FROM users --
```

### 14.2 XSS payloads

```html
<script>alert(1)</script>
<img src=x onerror=alert(1)>
<svg onload=alert(1)>
<a href="javascript:alert(1)">click</a>
```

### 14.3 Path traversal payloads

```text
../../../../etc/passwd
..\..\..\windows\win.ini
%2e%2e%2f%2e%2e%2fsecret
```

### 14.4 Mass assignment fields

```json
{
  "company_id": "other-company-id",
  "user_id": "other-user-id",
  "employee_id": "other-employee-id",
  "role": "SUPER_ADMIN",
  "roles": ["SUPER_ADMIN"],
  "permissions": ["AUTH.USER.UPDATE"],
  "data_scope": "System",
  "is_admin": true,
  "status": "Approved",
  "created_by": "other-user-id",
  "approved_by": "other-user-id"
}
```

### 14.5 Forbidden response assertions

Khi bị chặn, response không được chứa:

```text
password
password_hash
refresh_token
refresh_token_hash
access_token
secret
api_key
storage_path
private_file_url
raw_gps
precise_ip_location
salary
bank_account_number
identity_number
stack
sql
```

---

## 15. Gợi ý cấu trúc automated security regression

```text
tests/security/
  auth/
    auth-required.spec.ts
    token-refresh.spec.ts
    password-reset.spec.ts
    brute-force.spec.ts
  authorization/
    permission-direct-api.spec.ts
    data-scope-own-team-company.spec.ts
    tenant-isolation.spec.ts
    idor-bola.spec.ts
  api/
    validation-injection.spec.ts
    mass-assignment.spec.ts
    idempotency.spec.ts
    error-response-leak.spec.ts
  frontend/
    route-guard.spec.ts
    open-redirect.spec.ts
    xss-rendering.spec.ts
    logout-cache-clear.spec.ts
  files/
    upload-validation.spec.ts
    download-permission.spec.ts
    signed-url-expiry.spec.ts
  modules/
    hr-security.spec.ts
    attendance-security.spec.ts
    leave-security.spec.ts
    task-security.spec.ts
    notification-security.spec.ts
    dashboard-security.spec.ts
  ci/
    dependency-scan-check.md
    secret-scan-check.md
    dast-zap-baseline.md
```

### 15.1 Tagging test

| Tag | Ý nghĩa |
| --- | --- |
| `@security` | Tất cả test bảo mật |
| `@critical` | Block release nếu fail |
| `@auth` | Authentication/session/token |
| `@authz` | Authorization/data scope |
| `@tenant` | Multi-tenant isolation |
| `@file` | File security |
| `@xss` | XSS/output encoding |
| `@rate-limit` | Abuse/rate limit |
| `@audit` | Audit/logging |
| `@release-gate` | Phải pass trước release |

### 15.2 Smoke security suite bắt buộc mỗi build

| Suite | Test tối thiểu |
| --- | --- |
| Auth smoke | QA06-AUTH-001, 002, 003, 004 |
| Authz smoke | QA06-AUTHZ-002, 003, 004, 006 |
| Tenant smoke | QA06-TENANT-001, 002, 006, 008 |
| API smoke | QA06-API-002, 004, 005, 006 |
| File smoke | QA06-FILE-001, 002, 003 |
| Data smoke | QA06-DATA-001, 002, 003, 004 |
| Frontend smoke | QA06-BROWSER-004, QA06-XSS-001, QA06-XSS-002 |

---

## 16. Security gate trước release

### 16.1 Điều kiện pass bắt buộc

Một bản build chỉ được promote lên staging release candidate khi:

1. Không có test `@critical` fail.
2. Không có Critical/High vulnerability từ SAST/SCA/secret scan chưa có mitigation.
3. Toàn bộ API nghiệp vụ pass auth required test.
4. Toàn bộ API dữ liệu pass permission + data scope negative test.
5. Cross-tenant data isolation pass cho HR, ATT, LEAVE, TASK, NOTI, DASH, FILE.
6. File upload/download pass security smoke.
7. Password reset/login/session pass security smoke.
8. Không có secret/token/private URL trong frontend/backend logs.
9. Không có stack trace hoặc SQL error trong response staging.
10. Security checklist CORS/cookie/header/debug/internal API được review.

### 16.2 Điều kiện có thể chấp nhận có điều kiện

Có thể release nếu chỉ còn lỗi Medium/Low khi:

1. Không ảnh hưởng dữ liệu nhạy cảm.
2. Không thể khai thác từ internet hoặc có mitigation hạ tầng.
3. Có owner rõ.
4. Có deadline fix.
5. Được Product Owner + Tech Lead + Security/QA Lead chấp thuận bằng văn bản.

### 16.3 Điều kiện block release

Block release nếu có bất kỳ lỗi nào sau:

1. User xem/sửa/xóa dữ liệu ngoài scope.
2. Cross-company data leak.
3. API trả password hash, refresh token hash, secret, private file path.
4. File private tải được không cần quyền.
5. Manager/Employee thực hiện action admin/HR trái phép.
6. XSS stored trên màn P0/P1.
7. Login/password reset có thể brute force không giới hạn.
8. Internal API public có thể gọi từ frontend/internet.
9. Audit log action nhạy cảm bị thiếu nghiêm trọng.
10. Secret thật xuất hiện trong repo/build artifact/log.

---

## 17. Quy trình xử lý lỗi bảo mật

### 17.1 Tạo bug bảo mật

Mỗi security bug cần có:

| Trường | Nội dung |
| --- | --- |
| Title | `[SEC][Module][Severity] Mô tả ngắn` |
| Severity | Critical/High/Medium/Low/Info |
| Environment | Local/Dev/Staging/Production |
| Account used | Tài khoản test đã dùng |
| Affected endpoint/screen | URL/API/screen code |
| Steps to reproduce | Bước tái hiện rõ ràng |
| Expected result | Kết quả an toàn mong đợi |
| Actual result | Kết quả lỗi |
| Evidence | Screenshot, request/response đã mask secret |
| Impact | Dữ liệu/quyền bị ảnh hưởng |
| Suggested fix | Gợi ý nếu có |
| Owner | Backend/Frontend/DevOps/Product |
| Retest scope | Test case cần chạy lại |

### 17.2 Quy tắc evidence

1. Không đính kèm token thật.
2. Không đính kèm private file thật nếu chứa PII.
3. Mask email, identity number, bank account, salary, token, secret.
4. Giữ lại `request_id` để truy vết log.
5. Nếu cần chứng minh dữ liệu bị lộ, chỉ dùng dữ liệu test seed.

### 17.3 Retest và regression

Sau khi fix bug bảo mật:

1. Retest đúng test case fail.
2. Chạy regression quanh module liên quan.
3. Nếu lỗi thuộc access control, chạy lại QA-05 scope matrix liên quan.
4. Nếu lỗi thuộc file, chạy lại toàn bộ smoke file security.
5. Nếu lỗi thuộc token/session, chạy lại toàn bộ auth security smoke.
6. Ghi kết quả vào release checklist.

---

## 18. Ma trận owner kiểm thử

| Nhóm kiểm thử | Owner chính | Phối hợp |
| --- | --- | --- |
| Authentication/session | Backend Lead | QA, Frontend |
| Authorization/data scope | Backend Lead | QA, Product |
| Frontend route/cache/XSS | Frontend Lead | QA, Backend |
| File security | Backend Lead | DevOps, QA |
| CORS/cookie/header/HTTPS | DevOps Lead | Backend, QA |
| SAST/SCA/secret scan | DevOps/Security | Backend, Frontend |
| Audit/logging | Backend Lead | QA, Product |
| Dashboard/notification security | Backend + Frontend | QA |
| Security sign-off | QA Lead/Security reviewer | Product, Tech Lead |

---

## 19. Checklist nghiệm thu QA-06

QA-06 được xem là hoàn thành khi:

1. Có danh sách rủi ro bảo mật MVP và severity rõ ràng.
2. Có test case cho authentication/session/password reset.
3. Có test case cho permission, data scope, direct API và direct URL.
4. Có test case cho multi-tenant isolation.
5. Có test case cho IDOR/BOLA ở HR, ATT, LEAVE, TASK, NOTI, FILE.
6. Có test case cho injection, XSS, mass assignment và validation.
7. Có test case cho file upload/download private.
8. Có test case cho sensitive data masking.
9. Có test case cho dashboard/notification cache/deep link/payload.
10. Có checklist CORS, cookie, security headers, debug/stack trace và internal API.
11. Có security gate rõ cho staging/production release.
12. Có bug handling workflow và evidence masking rule.
13. Có smoke security suite bắt buộc chạy trước release.
14. Có owner cho từng nhóm kiểm thử.
15. Có tiêu chí block release khi phát hiện lỗi Critical/High.

---

## 20. Kết luận

QA-06 là lớp kiểm thử bảo mật bắt buộc trước khi hệ thống chuyển sang release readiness.

Tư duy kiểm thử chính:

```text
Không tin frontend
-> Không tin dữ liệu định danh từ client
-> Backend kiểm tra permission + data scope + target resource
-> Mọi dữ liệu nhạy cảm phải được mask/omit theo quyền
-> File private mặc định
-> Token/session có vòng đời rõ
-> Audit action quan trọng
-> Cache không được lộ dữ liệu người khác
-> Lỗi Critical/High phải block release
```

Sau QA-06, bước tiếp theo nên là:

```text
QA-07: Performance & Load Testing
```

QA-07 sẽ kiểm thử hiệu năng API, dashboard cache, notification count, bảng công, export, truy vấn lớn, concurrent users, job nền và khả năng chịu tải trước khi release production.

---

## 21. Tài liệu liên quan

| Mã | Tài liệu | Quan hệ |
| --- | --- | --- |
| [QA-01](QA-01_QA_Strategy_And_Test_Plan.md) | QA Strategy & Test Plan | Tài liệu nền: security testing strategy tổng quan |
| [QA-02](QA-02_Test_Case_Matrix_theo_module.md) | Test Case Matrix theo module | Ma trận test case (gồm nhóm security) |
| [QA-03](QA-03_End-to-End_Flow_Testing.md) | End-to-End Flow Testing | Flow nghiệp vụ xuyên module |
| [QA-04](QA-04_API_Testing_Contract_Testing.md) | API Testing & Contract Testing | Kiểm thử API contract/response/error |
| [QA-05](QA-05_Permission_Role_Data_Scope_Testing.md) | Permission, Role & Data Scope Testing | RBAC, data scope (kế thừa trực tiếp) |
| **QA-06 (tài liệu này)** | Security Testing | Bảo mật, OWASP, multi-tenant isolation |
| [QA-07](QA-07_Performance_Load_Testing.md) | Performance & Load Testing | Hiệu năng, tải, SLA/SLO |
| [QA-08](QA-08_Bug_Tracking_Regression_Release_Criteria.md) | Bug Tracking, Regression & Release Criteria | **Chuẩn severity (S0–S4)**, bug lifecycle, release gate |
| [QA-09](QA-09_UAT_Plan_Business_Acceptance.md) | UAT Plan & Business Acceptance | Nghiệm thu nghiệp vụ với stakeholder |
| [QA-10](QA-10_MVP_Release_Readiness_Checklist.md) | MVP Release Readiness Checklist | Checklist release gate cuối |
