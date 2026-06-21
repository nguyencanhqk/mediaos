# BACKEND-14: BACKEND RELEASE READINESS
# SẴN SÀNG PHÁT HÀNH BACKEND MVP
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · **BACKEND-14 Release Readiness**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01](<../API Design/API-01 TỔNG QUAN.md>) · [FE QA/Release: FRONTEND-14](<../FRONTEND/FRONTEND-14_QA_Performance_Release_Readiness.md>) · [QA Backend: BACKEND-13](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-14 |
| Tên tài liệu | Backend Release Readiness |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-13 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

BACKEND-14 định nghĩa tiêu chuẩn **sẵn sàng phát hành backend** cho MVP Version 1.0.

Tài liệu này dùng để:

1. Chốt điều kiện backend được phép phát hành lên staging hoặc production.
2. Chuẩn hóa checklist kiểm tra cuối cùng trước release.
3. Đảm bảo backend đã hoàn thiện các lớp: API, database, authentication, authorization, validation, business rule, audit log, file, notification, dashboard, system jobs và OpenAPI/Swagger.
4. Đảm bảo backend đã tích hợp đúng với frontend theo contract đã bàn giao.
5. Đảm bảo migration/seed có thể chạy từ database trống đến trạng thái dùng được cho MVP.
6. Đảm bảo các API quan trọng đã được test unit, integration, contract, permission, data scope, regression, performance và security.
7. Đảm bảo có kế hoạch deploy, rollback, smoke test, monitoring và incident response.
8. Làm checklist go/no-go cho Product, Backend, Frontend, QA và DevOps.
9. Làm tài liệu đóng gói cuối cho chuỗi BACKEND-01 -> BACKEND-14.

BACKEND-14 không thay thế tài liệu DevOps/Infrastructure chi tiết. Tài liệu này tập trung vào backend readiness ở góc độ sản phẩm, API, dữ liệu, kiểm thử và vận hành release.

---

## 3. Vị trí BACKEND-14 trong roadmap backend

```text
BACKEND-01: Backend Architecture & Project Setup
BACKEND-02: Database Migration, ORM & Seed Implementation
BACKEND-03: Auth, Session, RBAC & Permission Guard
BACKEND-04: Foundation Backend
BACKEND-05: HR Backend
BACKEND-06: Attendance Backend
BACKEND-07: Leave Backend
BACKEND-08: Task Backend
BACKEND-09: Notification Backend
BACKEND-10: Dashboard Backend
BACKEND-11: File, Audit, Settings & System Jobs
BACKEND-12: API Integration Contract & OpenAPI/Swagger
BACKEND-13: Backend Testing, Security & Performance
BACKEND-14: Backend Release Readiness
```

BACKEND-14 là bước chốt trước khi chuyển sang:

```text
Full-stack integration test
-> Staging release candidate
-> UAT
-> Production release planning
-> Production deployment
-> Post-release monitoring
```

---

## 4. Căn cứ triển khai

BACKEND-14 bám theo các quyết định đã chốt:

1. Backend là lớp kiểm soát quyền cuối cùng; frontend chỉ hỗ trợ ẩn/hiện UI.
2. Mọi API nghiệp vụ phải kiểm tra authentication, permission, data scope, business rule, audit log và notification event nếu có.
3. API public dùng prefix `/api/v1`; internal API dùng `/internal/v1` và không expose cho frontend.
4. Backend phải resolve `company_id`, `user_id`, `employee_id`, role, permission và data scope từ auth context hoặc database/cache nội bộ, không tin dữ liệu frontend tự gửi.
5. Database dùng PostgreSQL, UUID primary key, multi-tenant bằng `company_id`, soft delete cho dữ liệu nghiệp vụ quan trọng.
6. Migration + seed phải chạy được từ database trống và tạo đủ dữ liệu để test MVP.
7. Foundation cung cấp company, modules, settings, audit logs, files, file links, sequence counters, public holidays và seed tracking.
8. Dashboard chỉ tổng hợp/hiển thị/điều hướng, không xử lý nghiệp vụ gốc.
9. Notification là event-driven, payload không chứa dữ liệu nhạy cảm quá mức.
10. File private là mặc định; backend kiểm tra permission trước khi cấp quyền xem/tải.
11. Các query quan trọng phải có index, tránh N+1, có `EXPLAIN ANALYZE` trước release.
12. OpenAPI/Swagger phải phản ánh đúng request/response/error/permission/data scope của API.
13. Frontend tích hợp dựa trên API contract, response format, error format và route/deep link đã chốt.

---

## 5. Phạm vi BACKEND-14

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Release gate | Tiêu chí backend được phép release |
| Code readiness | Branch, version, build, lint, typecheck, dependency audit |
| API readiness | Contract, response/error, pagination, validation, idempotency, OpenAPI |
| DB readiness | Migration, seed, index, rollback, backup, verification |
| Security readiness | Auth, RBAC, scope, secrets, CORS, rate limit, sensitive data mask |
| Module readiness | AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION |
| Integration readiness | Frontend contract, deep link, dashboard, notification, file, jobs |
| Test readiness | Unit, integration, API, contract, permission, scope, regression, smoke |
| Performance readiness | SLA, slow query, cache, N+1, dashboard, notification unread count |
| Observability readiness | Logs, metrics, health check, audit, tracing/request id, alerting |
| Deployment readiness | Env, migration strategy, release candidate, deployment steps, rollback |
| Go/no-go | Checklist quyết định phát hành |
| Post-release | Monitoring, incident handling, hotfix, rollback, retrospective |

### 5.2 Không bao gồm sâu

| Nội dung | Giai đoạn/tài liệu xử lý |
| --- | --- |
| Thiết kế cloud infrastructure chi tiết | DevOps/Infrastructure document |
| CI/CD pipeline YAML đầy đủ | DevOps/CI-CD document |
| Kubernetes/Container orchestration chi tiết | DevOps deployment guide |
| Data warehouse/BI | Phase Reporting/BI |
| Mobile native release | Mobile release plan |
| Payroll/Recruite/Asset/Room backend release | Phase 2+ |
| SSO/OAuth/MFA production hardening nâng cao | Security phase sau nếu chưa thuộc MVP |

---

## 6. Định nghĩa Backend Release Readiness

Backend được xem là **release ready** khi thỏa mãn toàn bộ điều kiện sau:

1. Build backend chạy ổn định ở môi trường local và CI.
2. Migration + seed chạy được từ database trống.
3. API contract khớp OpenAPI/Swagger và frontend integration.
4. Tất cả API MVP đã có authentication và authorization guard đúng.
5. Permission + data scope được kiểm tra ở backend, không phụ thuộc frontend.
6. Business rule cốt lõi của HR, ATT, LEAVE, TASK, NOTI, DASH và FOUNDATION đã được test.
7. API response/error/pagination/validation đồng nhất.
8. Các thao tác thay đổi dữ liệu quan trọng có audit log.
9. Các nghiệp vụ cần thông báo đã phát event sang NOTI hoặc outbox/event pipeline.
10. File service không expose storage path/private URL trực tiếp.
11. Dashboard API có cache/fallback/degraded state phù hợp.
12. Job hệ thống đã có schedule, locking, retry và logging tối thiểu.
13. Query quan trọng có index, không N+1, không query thiếu `company_id`.
14. Security checklist không còn blocker mức Critical/High.
15. QA regression suite pass.
16. Smoke test staging pass.
17. Rollback plan đã có và được review.
18. Monitoring/logging/health check đủ để phát hiện lỗi sau release.
19. Product/QA/Backend/Frontend/DevOps đã sign-off go/no-go.

---

## 7. Release gates tổng thể

### 7.1 Gate 1 - Code complete

| Mã | Tiêu chí | Bắt buộc | Owner | Trạng thái |
| --- | --- | --- | --- | --- |
| BE14-G1-001 | Tất cả endpoint MVP đã implement | Có | Backend | Pending |
| BE14-G1-002 | Không còn TODO/blocker trong luồng P0 | Có | Backend | Pending |
| BE14-G1-003 | Code lint pass | Có | Backend | Pending |
| BE14-G1-004 | Type check/build pass | Có | Backend | Pending |
| BE14-G1-005 | Dependency lockfile ổn định | Có | Backend | Pending |
| BE14-G1-006 | Không còn console/debug log nhạy cảm | Có | Backend | Pending |
| BE14-G1-007 | Feature flag/module status rõ ràng | Có | Backend | Pending |
| BE14-G1-008 | Version backend được gắn tag release candidate | Có | Backend/DevOps | Pending |

### 7.2 Gate 2 - Database ready

| Mã | Tiêu chí | Bắt buộc | Owner | Trạng thái |
| --- | --- | --- | --- | --- |
| BE14-G2-001 | Migration chạy từ database trống thành công | Có | Backend/DB | Pending |
| BE14-G2-002 | Seed system/company/RBAC/business defaults chạy idempotent | Có | Backend/DB | Pending |
| BE14-G2-003 | Rollback migration được mô tả rõ | Có | Backend/DB | Pending |
| BE14-G2-004 | Index chính đã tạo theo query pattern | Có | Backend/DB | Pending |
| BE14-G2-005 | FK/constraint/check constraint pass | Có | Backend/DB | Pending |
| BE14-G2-006 | Không có orphan data sau seed | Có | Backend/DB | Pending |
| BE14-G2-007 | Backup trước migration production đã chuẩn bị | Có | DevOps/DB | Pending |
| BE14-G2-008 | Query verification bằng `EXPLAIN ANALYZE` cho API quan trọng | Có | Backend/DB | Pending |

### 7.3 Gate 3 - API contract ready

| Mã | Tiêu chí | Bắt buộc | Owner | Trạng thái |
| --- | --- | --- | --- | --- |
| BE14-G3-001 | OpenAPI/Swagger được generate và review | Có | Backend | Pending |
| BE14-G3-002 | Mỗi endpoint có security scheme Bearer Auth nếu cần | Có | Backend | Pending |
| BE14-G3-003 | Mỗi endpoint có required permission/data scope trong doc | Có | Backend | Pending |
| BE14-G3-004 | Response success theo chuẩn `success/message/data/meta` | Có | Backend | Pending |
| BE14-G3-005 | Response lỗi theo chuẩn `success/message/error/meta` | Có | Backend | Pending |
| BE14-G3-006 | API list có pagination/filter/sort whitelist | Có | Backend | Pending |
| BE14-G3-007 | API upload/download file có schema và permission rõ | Có | Backend | Pending |
| BE14-G3-008 | Frontend contract test pass trên staging | Có | FE/BE/QA | Pending |

### 7.4 Gate 4 - Security ready

| Mã | Tiêu chí | Bắt buộc | Owner | Trạng thái |
| --- | --- | --- | --- | --- |
| BE14-G4-001 | Auth guard áp dụng cho toàn bộ API nghiệp vụ | Có | Backend | Pending |
| BE14-G4-002 | Permission guard áp dụng ở service/controller | Có | Backend | Pending |
| BE14-G4-003 | Data scope guard test pass | Có | Backend/QA | Pending |
| BE14-G4-004 | Không nhận `company_id` từ frontend cho nghiệp vụ thông thường | Có | Backend | Pending |
| BE14-G4-005 | Sensitive fields được mask hoặc không trả về | Có | Backend/Security | Pending |
| BE14-G4-006 | Secrets không hardcode trong code/seed | Có | Backend/DevOps | Pending |
| BE14-G4-007 | Rate limit cho auth, notification, dashboard, export | Có | Backend/DevOps | Pending |
| BE14-G4-008 | CORS whitelist đúng môi trường | Có | Backend/DevOps | Pending |
| BE14-G4-009 | File private không expose storage path | Có | Backend | Pending |
| BE14-G4-010 | Không trả stack trace ở production | Có | Backend | Pending |

### 7.5 Gate 5 - QA ready

| Mã | Tiêu chí | Bắt buộc | Owner | Trạng thái |
| --- | --- | --- | --- | --- |
| BE14-G5-001 | Unit test pass | Có | Backend | Pending |
| BE14-G5-002 | Integration test pass | Có | Backend/QA | Pending |
| BE14-G5-003 | API regression test pass | Có | QA | Pending |
| BE14-G5-004 | Permission/data scope test pass | Có | QA | Pending |
| BE14-G5-005 | State transition test pass cho ATT/LEAVE/TASK | Có | QA | Pending |
| BE14-G5-006 | Notification event test pass | Có | QA | Pending |
| BE14-G5-007 | Dashboard cache/fallback test pass | Có | QA | Pending |
| BE14-G5-008 | File upload/download permission test pass | Có | QA | Pending |
| BE14-G5-009 | Smoke test staging pass | Có | QA/DevOps | Pending |
| BE14-G5-010 | Không còn bug Critical/High chưa xử lý | Có | QA/Product | Pending |

### 7.6 Gate 6 - Deployment ready

| Mã | Tiêu chí | Bắt buộc | Owner | Trạng thái |
| --- | --- | --- | --- | --- |
| BE14-G6-001 | Environment variables đã cấu hình staging/production | Có | DevOps | Pending |
| BE14-G6-002 | Secret manager hoặc env secret đã kiểm tra | Có | DevOps | Pending |
| BE14-G6-003 | Health check `/health` pass | Có | DevOps | Pending |
| BE14-G6-004 | Readiness check `/ready` pass sau migration | Có | DevOps | Pending |
| BE14-G6-005 | Job worker/scheduler chạy đúng | Có | Backend/DevOps | Pending |
| BE14-G6-006 | Logging/metrics/alerts hoạt động | Có | DevOps | Pending |
| BE14-G6-007 | Rollback image/tag đã sẵn sàng | Có | DevOps | Pending |
| BE14-G6-008 | Production backup trước deploy đã xác nhận | Có | DevOps/DB | Pending |
| BE14-G6-009 | Release note backend đã viết | Có | Backend/Product | Pending |
| BE14-G6-010 | Go/no-go meeting đã sign-off | Có | Product/QA/BE/FE/DevOps | Pending |

---

## 8. Checklist code readiness

### 8.1 Branch, tag và version

| Hạng mục | Tiêu chí |
| --- | --- |
| Release branch | Tạo branch `release/backend-mvp-v1.0` hoặc tương đương |
| Tag RC | Tạo tag `backend-v1.0.0-rc.1` cho staging candidate |
| Tag production | Chỉ tạo `backend-v1.0.0` sau khi staging/UAT pass |
| Changelog | Có danh sách thay đổi theo module |
| Build metadata | Có commit hash, build time, environment trong `/health` hoặc `/version` |

### 8.2 Quality command đề xuất

```bash
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run build
npm audit --production
```

Nếu backend không dùng Node.js, thay bằng command tương đương của stack thực tế.

### 8.3 Dependency readiness

- [ ] Lockfile được commit.
- [ ] Không dùng package chưa rõ license cho production.
- [ ] Không còn dependency deprecated nghiêm trọng.
- [ ] Không còn vulnerability Critical/High chưa có quyết định xử lý.
- [ ] Package dùng cho dev/test không được bundle vào production image nếu không cần.

### 8.4 Configuration readiness

- [ ] Tách rõ local/development/staging/production.
- [ ] Không hardcode URL frontend/backend.
- [ ] Không hardcode secret.
- [ ] Token TTL, refresh TTL, file max size, rate limit, cache TTL có config.
- [ ] CORS origin được whitelist theo môi trường.
- [ ] Job schedule có thể bật/tắt qua config.
- [ ] Swagger có thể disable ở production nếu policy yêu cầu.

---

## 9. Checklist database release readiness

### 9.1 Migration readiness

| Hạng mục | Tiêu chí |
| --- | --- |
| Database engine | PostgreSQL đúng version target |
| Extension | `pgcrypto`, `pg_trgm`, `unaccent` được bật nếu dùng |
| Migration order | Foundation -> AUTH -> HR -> ATT -> LEAVE -> TASK -> NOTI/DASH -> FK -> Index -> Seed |
| Migration deterministic | Không phụ thuộc dữ liệu ngẫu nhiên ngoài business key |
| FK vòng | Tạo nullable trước, add FK sau |
| Soft delete | Bảng nghiệp vụ quan trọng có `deleted_at` nếu đã thiết kế |
| Audit tables | Append-only, không update/delete tùy tiện |
| Seed tracking | `seed_batches`, `seed_items` ghi nhận trạng thái seed |

### 9.2 Seed readiness

| Seed layer | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Modules MVP | Có | AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI |
| Modules phase sau inactive | Khuyến nghị | PAYROLL, RECRUIT, ASSET, ROOM, CHAT, SOCIAL, MOBILE, AI |
| System settings | Có | timezone, locale, security, file, audit, notification, dashboard |
| Company settings | Có | tenant default |
| Permissions | Có | Toàn bộ permission MVP |
| Roles | Có | Super Admin/Admin/HR/Manager/Employee hoặc tương đương |
| Role-permission matrix | Có | Không hard-code theo role trong backend |
| Bootstrap admin | Có | Không hardcode mật khẩu production |
| Notification events/templates | Có | In-app MVP |
| Dashboard widgets/configs | Có | Widget theo role/scope |
| HR defaults | Có | job level, contract type, employee code config |
| ATT defaults | Có | shift/rule default nếu MVP cần |
| LEAVE defaults | Có | leave types/policy/balance config |
| Public holidays | Khuyến nghị | Cho ATT/LEAVE nếu áp dụng |

### 9.3 Verification SQL/checklist

- [ ] Kiểm tra số bảng đúng kỳ vọng.
- [ ] Kiểm tra extension đã bật.
- [ ] Kiểm tra mỗi bảng tenant-specific có `company_id`.
- [ ] Kiểm tra permission catalog không trùng `permission_code`.
- [ ] Kiểm tra role-permission không duplicate.
- [ ] Kiểm tra module MVP active.
- [ ] Kiểm tra company default active.
- [ ] Kiểm tra bootstrap admin có thể login.
- [ ] Kiểm tra seed chạy lại không tạo duplicate.
- [ ] Kiểm tra FK không lỗi.
- [ ] Kiểm tra index quan trọng tồn tại.

### 9.4 Backup và rollback database

Trước production deploy:

1. Snapshot/backup database.
2. Ghi lại migration version hiện tại.
3. Xác định migration nào có rollback tự động, migration nào rollback thủ công.
4. Không chạy destructive migration nếu chưa có backup và approval.
5. Nếu migration lâu, cần maintenance window hoặc online migration strategy.
6. Nếu migration fail trước khi app deploy, rollback DB hoặc sửa migration trước khi deploy app.
7. Nếu app deploy fail sau migration backward-compatible, rollback app trước, DB giữ nguyên nếu an toàn.

---

## 10. Checklist API release readiness

### 10.1 Chuẩn chung

- [ ] Tất cả public API dùng `/api/v1`.
- [ ] Internal API dùng `/internal/v1` và có service auth.
- [ ] API nghiệp vụ mặc định yêu cầu access token.
- [ ] Response success có `success`, `message`, `data`, `meta.request_id`.
- [ ] Response list có `pagination` nếu phân trang.
- [ ] Response lỗi có `success`, `message`, `error.code`, `error.type`, `error.details`, `meta.request_id`.
- [ ] Validation error có field-level details.
- [ ] Không trả `password_hash`, `refresh_token_hash`, secret setting, storage path file private.
- [ ] API quan trọng có idempotency nếu có nguy cơ double submit.
- [ ] API list có limit mặc định và max limit.
- [ ] Filter/sort/search theo whitelist.

### 10.2 OpenAPI/Swagger readiness

- [ ] Swagger có title, version, server theo environment.
- [ ] Security scheme Bearer Auth đầy đủ.
- [ ] Mỗi endpoint có tag module.
- [ ] Mỗi endpoint có request body schema.
- [ ] Mỗi endpoint có success response schema.
- [ ] Mỗi endpoint có error response schema.
- [ ] API list có pagination schema.
- [ ] Upload file dùng multipart schema.
- [ ] Mô tả required permission và data scope trong description hoặc extension custom.
- [ ] DTO không chứa field backend-only hoặc sensitive.
- [ ] Swagger export được file JSON/YAML cho frontend/QA.

### 10.3 API compatibility với frontend

- [ ] Field name khớp frontend integration.
- [ ] Enum value khớp frontend mapping.
- [ ] Date/time dùng ISO 8601.
- [ ] Backend dùng timezone công ty cho nghiệp vụ ngày công/nghỉ/dashboard.
- [ ] Error code khớp frontend error handling.
- [ ] `allowed_actions` hoặc action metadata trả về ở màn cần disable/hide action theo business rule.
- [ ] Notification target URL là route nội bộ, module gốc vẫn kiểm tra quyền lại.
- [ ] Dashboard quick action chỉ điều hướng hoặc gọi module gốc.

---

## 11. Checklist security readiness

### 11.1 Authentication

- [ ] Login kiểm tra user active/locked/company active.
- [ ] Password không lưu plain text.
- [ ] Access token có TTL hợp lý.
- [ ] Refresh token lưu hash.
- [ ] Logout revoke refresh/session.
- [ ] User bị khóa thì token/refresh không còn dùng được theo policy.
- [ ] Forgot/reset password token có TTL và dùng một lần.
- [ ] Login failure được log và rate limit.

### 11.2 Authorization và data scope

- [ ] Không endpoint nghiệp vụ nào thiếu permission guard.
- [ ] Backend kiểm tra target resource thuộc data scope.
- [ ] Own/Team/Department/Project/Company/System được test.
- [ ] Role chỉ là seed nhóm quyền, không hard-code `if role === HR`.
- [ ] Super Admin/System scope có route riêng hoặc guard riêng.
- [ ] User đoán UUID của công ty khác không truy cập được.
- [ ] API export áp dụng permission/scope như API list.

### 11.3 Sensitive data

- [ ] Hồ sơ nhân sự nhạy cảm có field-level guard/masking.
- [ ] Audit diff mask dữ liệu nhạy cảm.
- [ ] Notification payload không chứa secret/token/salary/bank/private file URL/raw GPS.
- [ ] File private không có public URL cố định.
- [ ] Signed URL nếu dùng phải TTL ngắn.
- [ ] Setting sensitive không trả qua public API.
- [ ] Log production không ghi raw token/password/secret.

### 11.4 Transport/config security

- [ ] HTTPS bắt buộc ở staging/production.
- [ ] Secure cookie nếu dùng cookie.
- [ ] CORS whitelist đúng frontend domains.
- [ ] Rate limit auth, notification, dashboard refresh, export, file upload.
- [ ] Body size limit và file size limit.
- [ ] MIME type validation.
- [ ] Không trả stack trace ở production.
- [ ] Security headers do gateway/app cấu hình nếu backend chịu trách nhiệm.

---

## 12. Checklist module readiness

## 12.1 AUTH readiness

| Nhóm | Checklist |
| --- | --- |
| Account | Login, logout, refresh, forgot/reset, change password pass |
| Session | Refresh token rotate/revoke nếu áp dụng, session cleanup job |
| RBAC | Users, roles, permissions, user_roles, role_permissions hoạt động |
| Permission resolve | Cache permission theo session/context và invalidate khi role thay đổi |
| Data scope | Own/Team/Department/Project/Company/System mapping đúng |
| Audit/security log | Login log, security event, role change audit |
| API | `/auth/me`, `/auth/me/permissions` hoặc tương đương sẵn sàng cho frontend |
| Test | 401, 403, locked user, inactive company, token expired, permission denied |

## 12.2 HR readiness

| Nhóm | Checklist |
| --- | --- |
| Employee | List/detail/create/update/status/soft delete pass |
| Employee code | Sinh mã tự động bằng config + sequence, chống race condition |
| User link | Link/unlink employee với user AUTH |
| Department/position/job level | CRUD/filter/sort pass |
| Contract | Current contract, expiring contract, file contract nếu có |
| Profile change request | Employee submit, HR/Admin approve/reject, apply change sau duyệt |
| File | Upload/link/unlink/download hồ sơ nhân viên qua file service |
| Sensitive field | Field-level mask nếu thiếu quyền |
| Integration | HR cung cấp employee/user/department/manager cho ATT/LEAVE/TASK/DASH/NOTI |
| Test | Search, pagination, scope Own/Team/Department/Company, duplicate email/code |

## 12.3 ATT readiness

| Nhóm | Checklist |
| --- | --- |
| Today attendance | Trả trạng thái hôm nay, can_check_in/can_check_out, rule đang áp dụng |
| Check-in/out | Web/mobile metadata, idempotency nếu cần, chống double submit |
| Leave block | Chặn chấm công khi có đơn nghỉ full-day approved |
| Shift/rule | Resolve theo employee -> department -> company |
| Attendance record/log | Ghi record tổng hợp và log thô |
| Adjustment | Employee submit, Manager/HR approve/reject, HR/Admin manual adjust |
| Remote work | Request/approve/apply rule remote/công tác nếu bật |
| Job | Missing checkout, auto attendance, recalculation nếu có |
| Notification | Phát event quên checkout, adjustment, remote request |
| Dashboard | Cung cấp widget attendance today/alerts |
| Test | Rule late/early/missing, manager team scope, HR company scope, leave conflict |

## 12.4 LEAVE readiness

| Nhóm | Checklist |
| --- | --- |
| Leave balance | My balance, admin balance, transaction ledger |
| Leave request | Draft/create/submit/cancel/detail/list pass |
| Calculation | Full-day/half-day/hourly/multiple days preview đúng |
| Approval | Manager/HR approve/reject/revoke theo scope |
| Balance transaction | Reserve/deduct/refund/adjust có transaction và idempotency |
| ATT sync | Approved/Cancelled/Revoked đồng bộ sang ATT hoặc phát event sync |
| File | File chứng minh qua file service, private mặc định |
| Notification | Submitted/approved/rejected/cancelled/balance adjusted |
| Calendar | Own/team/department/company theo quyền |
| Test | State machine, concurrent approve, insufficient balance, holiday/weekend rule |

## 12.5 TASK readiness

| Nhóm | Checklist |
| --- | --- |
| Project | List/detail/create/update/close/archive/soft delete pass |
| Member | Add/update/remove member, project role không thay thế RBAC hệ thống |
| Task | Create/update/detail/list/my tasks pass |
| Assignment | Assignee/watchers/main assignee update đúng |
| Status | Todo/In Progress/In Review/Done/Cancelled state transition |
| Kanban | Board load, change status, sort/order nếu có |
| Comment/mention | Comment CRUD, mention event sang NOTI |
| Checklist | Checklist/item CRUD, mark done |
| File | Project/task file qua file service |
| Activity log | Ghi activity nghiệp vụ task/project |
| Dashboard | My tasks, team tasks, overdue/due soon, project progress |
| Test | Project scope, assignee scope, private project, due/overdue calculation |

## 12.6 NOTI readiness

| Nhóm | Checklist |
| --- | --- |
| My notifications | List, dropdown, unread count, detail pass |
| Action | Mark read, mark all read, hide/archive/delete soft pass |
| Target | Open target trả route nội bộ, module gốc kiểm tra quyền lại |
| Internal event | Event API/service auth, dedupe, idempotency |
| Template | Render title/content an toàn, không secret/sensitive payload |
| Recipient resolver | Resolve user/manager/HR/admin theo event |
| Delivery log | IN_APP delivery log, retry framework nếu có |
| Admin config | Event/template/channel CRUD nếu thuộc MVP |
| Performance | Unread count/dropdown không scan bảng lớn |
| Test | Own scope, payload sanitizer, duplicate event, inactive recipient, mark read idempotent |

## 12.7 DASH readiness

| Nhóm | Checklist |
| --- | --- |
| Dashboard me | Resolve dashboard mặc định theo permission/config |
| Dashboard types | Employee/Manager/HR/Admin theo quyền |
| Widget catalog | Widget metadata, permission, source module |
| Widget data | Lazy load/refresh từng widget |
| Permission | Widget kiểm tra permission DASH và permission nguồn nếu cần |
| Data scope | Own/Team/Department/Project/Company/System áp dụng trước aggregate |
| Cache | TTL/invalidation theo source event |
| Fallback | Widget lỗi trả `Degraded/Error`, không làm toàn dashboard fail |
| Quick action | Chỉ metadata điều hướng/call module gốc |
| Test | Widget hidden/forbidden/degraded, source module down, cache invalidation |

## 12.8 FOUNDATION/SYSTEM readiness

| Nhóm | Checklist |
| --- | --- |
| Company | Company default active, company active check khi login/request |
| Modules | Module catalog active/inactive, app registry nếu có |
| Settings | System/company setting, sensitive setting không public |
| Audit | Audit middleware/service ghi log thao tác quan trọng |
| File | Upload/download/link/unlink, file access log, private default |
| Sequence | Sinh mã employee/leave/project/task bằng row lock |
| Holiday | Public holiday query cho ATT/LEAVE nếu dùng |
| Retention | Cleanup job/cache/log/file temp nếu có |
| Seed | Seed tracking idempotent |
| Test | Tenant isolation, file permission, audit masking, sequence race condition |

---

## 13. Integration readiness với frontend

### 13.1 Contract cần khớp

| Nhóm | Backend cần bàn giao |
| --- | --- |
| Auth context | User, employee, company, roles, permissions, scopes, module visibility |
| App registry | Danh sách app/module theo permission và module status |
| Sidebar/menu | Route/menu metadata hoặc API/contract để FE map |
| Error contract | Error code/message/details nhất quán |
| Pagination | `page`, `per_page`, `total`, `total_pages`, `has_next`, `has_prev` |
| Upload/download | File metadata, signed URL/download endpoint, permission error |
| Notification | Dropdown, unread count, open target |
| Dashboard | `/dashboard/me`, widget data, degraded state |
| Allowed actions | Action enable/disable theo permission + business rule |
| Validation | Field-level validation details cho form |

### 13.2 Flow P0 cần test tích hợp

1. Login -> Home Portal -> mở app/module.
2. App Switcher -> đổi module.
3. Dashboard load theo role -> quick action điều hướng module gốc.
4. Check-in/check-out.
5. Tạo đơn nghỉ -> gửi -> manager nhận notification -> duyệt -> employee nhận notification.
6. ATT chặn chấm công khi leave approved.
7. My tasks -> task detail -> update status -> notification/comment.
8. Notification dropdown -> open target -> module gốc kiểm tra quyền.
9. HR profile change request -> HR approve/reject -> employee nhận kết quả.
10. File upload/download trong HR/LEAVE/TASK/ATT adjustment.

### 13.3 Contract freeze rule

Sau khi release candidate được tạo:

1. Không đổi tên field response nếu chưa thông báo FE/QA.
2. Không đổi enum value nếu frontend đã map.
3. Không đổi error code nếu frontend đã xử lý.
4. Chỉ thêm field optional nếu cần.
5. Breaking change phải tạo RC mới và chạy lại contract/regression test.

---

## 14. Test readiness

### 14.1 Test pyramid đề xuất

```text
Unit tests
  -> Service/business rule tests
    -> Repository/query tests
      -> Integration tests
        -> API contract tests
          -> Permission/data scope tests
            -> E2E smoke tests
              -> Performance/security tests
```

### 14.2 Unit test bắt buộc

| Module | Unit test trọng tâm |
| --- | --- |
| AUTH | Password hash, token, permission resolver, data scope util |
| HR | Employee code generator, profile change apply, sensitive field mask |
| ATT | Attendance rule resolver, check-in/out validation, leave block logic |
| LEAVE | Leave calculation, balance ledger, state transition, idempotency |
| TASK | Task status transition, project permission, due/overdue calculation |
| NOTI | Template render, recipient resolver, payload sanitizer, dedupe |
| DASH | Widget resolver, permission filter, cache key builder, degraded state |
| FOUNDATION | Sequence service, file permission, audit mask, setting precedence |

### 14.3 Integration/API test bắt buộc

- [ ] Login success/fail/token expired.
- [ ] Auth/me trả đúng context.
- [ ] Permission denied trả 403 chuẩn.
- [ ] Scope denied trả 403 chuẩn.
- [ ] CRUD employee với HR permission.
- [ ] Employee chỉ xem hồ sơ Own.
- [ ] Manager chỉ xem team.
- [ ] Check-in/out theo rule.
- [ ] Leave approved chặn check-in.
- [ ] Leave submit/approve/reject/cancel state machine.
- [ ] Task assign/comment/mention phát notification.
- [ ] Notification unread count tăng/giảm đúng.
- [ ] Dashboard widget bị thiếu source module trả degraded.
- [ ] File upload/download kiểm tra permission.
- [ ] Audit log được ghi ở thao tác quan trọng.
- [ ] Migration + seed verification pass.

### 14.4 Permission/data scope test matrix

| Actor | Scope | Test |
| --- | --- | --- |
| Employee | Own | Chỉ xem/chỉnh dữ liệu cá nhân được phép |
| Manager | Team | Chỉ xem/duyệt dữ liệu nhân viên thuộc team |
| HR | Department | Chỉ xem dữ liệu phòng ban được cấp quyền |
| HR/Admin | Company | Xem dữ liệu toàn công ty |
| Project member | Project | Xem task/project liên quan |
| Super Admin | System | Truy cập liên công ty qua route/API riêng nếu có |

### 14.5 Regression suite P0

| Mã | Flow | Pass criteria |
| --- | --- | --- |
| REG-P0-001 | Login/logout/refresh | Token/session hoạt động đúng |
| REG-P0-002 | Permission guard | Không lộ dữ liệu trái quyền |
| REG-P0-003 | HR employee CRUD | Tạo/cập nhật/xem/filter hoạt động |
| REG-P0-004 | Employee self-service | Request duyệt mới apply vào hồ sơ |
| REG-P0-005 | ATT today | Check-in/out và trạng thái hôm nay đúng |
| REG-P0-006 | ATT adjustment | Submit/approve/reject đúng scope |
| REG-P0-007 | LEAVE request | Submit/approve/reject/cancel và balance đúng |
| REG-P0-008 | LEAVE -> ATT sync | Approved leave ảnh hưởng attendance |
| REG-P0-009 | TASK my tasks | Giao task, update status, comment đúng |
| REG-P0-010 | NOTI | Event -> notification -> unread -> mark read |
| REG-P0-011 | DASH | Dashboard me/widget/cache/degraded pass |
| REG-P0-012 | FILE | Upload/download/private permission pass |
| REG-P0-013 | AUDIT | Audit log có actor/action/target/request id |

---

## 15. Performance readiness

### 15.1 SLA đề xuất MVP

| Nhóm API | Target P95 | Ghi chú |
| --- | ---: | --- |
| Auth login | <= 800ms | Không tính cold start |
| Auth/me | <= 300ms | Có cache permission hợp lý |
| Employee list | <= 800ms | 20-50 rows/page |
| Attendance today | <= 500ms | Gọi thường xuyên |
| Check-in/out | <= 800ms | Có transaction/audit/event |
| Leave submit/approve | <= 1200ms | Có balance transaction/event |
| My tasks | <= 800ms | Không N+1 assignee/comment |
| Notification unread count | <= 100ms | Query rất thường xuyên |
| Notification dropdown | <= 300ms | Limit nhỏ, index tốt |
| Dashboard me | <= 1200ms | Widget cache/lazy/degraded |
| File metadata upload | <= 1500ms | Không tính network file lớn |

### 15.2 Query performance checklist

- [ ] Mọi query tenant-specific có `company_id`.
- [ ] Query soft delete dùng `deleted_at IS NULL` hoặc partial index.
- [ ] Query list có limit.
- [ ] Query bảng lớn không offset quá sâu nếu có thể dùng keyset.
- [ ] Không N+1 ở employee/task/notification/dashboard.
- [ ] Dashboard aggregate có cache hoặc TTL.
- [ ] Notification unread count có partial index.
- [ ] Attendance today có index employee/date.
- [ ] Leave calendar có index employee/date/status.
- [ ] Task list có index assignee/status/due.
- [ ] Export lớn chạy async/background nếu vượt ngưỡng.
- [ ] API quan trọng đã chạy `EXPLAIN ANALYZE`.

### 15.3 Load test gợi ý

| Scenario | Mục tiêu |
| --- | --- |
| Login peak | Nhiều user login đầu giờ |
| Auth/me + permissions | FE boot app sau login |
| Dashboard me | User mở dashboard đồng thời |
| Attendance check-in | Peak đầu giờ làm |
| Notification unread count | Header polling/refresh |
| Employee list | HR filter/search |
| Leave approval | Manager duyệt nhiều request |
| Task board | Kanban/list nhiều task |

### 15.4 Caching readiness

- [ ] Permission cache có TTL/invalidation.
- [ ] Settings cache có TTL/invalidation.
- [ ] Module/app registry cache có TTL/invalidation.
- [ ] Dashboard widget cache có key theo company/user/role/scope/filter.
- [ ] Notification unread count không cache quá lâu nếu ảnh hưởng UX.
- [ ] Cache Own/Team không dùng chung sai user.
- [ ] Cache clear khi logout hoặc role/permission change nếu nằm ở client side; backend cache có invalidation.

---

## 16. Observability readiness

### 16.1 Health/readiness endpoints

| Endpoint | Mục đích | Public |
| --- | --- | --- |
| `GET /api/v1/health` | Kiểm tra app sống | Có thể public/limited |
| `GET /api/v1/ready` | Kiểm tra dependency sẵn sàng | Nên internal/limited |
| `GET /api/v1/version` | Build version/commit/environment | Tùy policy |
| `/metrics` | Metrics Prometheus nếu có | Internal only |

### 16.2 Health check nên kiểm tra

- App process alive.
- Database connection.
- Migration version tương thích.
- Valkey/cache nếu dùng.
- Storage/file service nếu dùng.
- Job worker nếu cùng service.
- Notification/event queue nếu dùng.

### 16.3 Logging chuẩn

Mỗi request nên có:

1. `request_id`.
2. `correlation_id` nếu có.
3. `method`.
4. `path`.
5. `status_code`.
6. `duration_ms`.
7. `company_id` nếu đã resolve.
8. `user_id` nếu đã auth.
9. `module_code`.
10. Error code nếu lỗi.

Không log:

```text
password
password_hash
access_token
refresh_token
secret
api_key
private_file_url
storage_path
raw sensitive payload
```

### 16.4 Metrics đề xuất

| Metric | Ý nghĩa |
| --- | --- |
| HTTP request count/status/duration | Theo endpoint/module |
| DB query duration | Slow query |
| Auth login success/failure | Theo thời gian |
| 401/403 count | Phát hiện auth/scope lỗi |
| 5xx count | Lỗi hệ thống |
| Notification event processed/failed | Theo event code |
| Job success/failure/duration | Theo job name |
| File upload/download count/error | Theo module |
| Dashboard cache hit/miss | Theo widget |
| Queue lag | Nếu dùng queue/outbox |

### 16.5 Alert đề xuất

- 5xx rate vượt ngưỡng.
- P95 latency vượt SLA.
- DB connection pool gần đầy.
- Slow query > 1s tăng bất thường.
- Migration fail.
- Job critical fail liên tiếp.
- Notification event queue lag cao.
- Disk/storage gần đầy.
- Login failure spike.
- 401/403 spike sau deploy.
- Dashboard degraded rate cao.

---

## 17. Deployment readiness

### 17.1 Environment variables checklist

| Nhóm | Biến cần có |
| --- | --- |
| App | `NODE_ENV`/runtime env, `APP_NAME`, `APP_VERSION`, `PORT` |
| API | `API_BASE_URL`, `FRONTEND_URL`, `CORS_ORIGINS` |
| Database | `DATABASE_URL`, pool config, SSL config |
| Auth | JWT secret/public-private key, access TTL, refresh TTL |
| Security | Password policy, rate limit config |
| File | Storage provider, bucket/path, max size, signed URL TTL |
| Mail/External | SMTP/provider config nếu dùng |
| Cache | Valkey URL/cache TTL nếu dùng |
| Job | Worker enabled, schedule config, lock TTL |
| Observability | Log level, metrics enabled, Sentry/APM DSN nếu có |

### 17.2 Deployment strategy đề xuất

MVP có thể dùng một trong các chiến lược:

| Strategy | Khi dùng | Ghi chú |
| --- | --- | --- |
| Rolling deploy | App stateless, migration backward-compatible | Phổ biến |
| Blue/green | Cần rollback nhanh | Tốn tài nguyên hơn |
| Manual maintenance window | Migration phá vỡ backward compatibility | Dùng khi cần downtime |

Khuyến nghị MVP:

```text
1. Build image artifact immutable.
2. Backup DB.
3. Run migration backward-compatible.
4. Run seed idempotent.
5. Deploy backend release candidate.
6. Run readiness check.
7. Run smoke test.
8. Switch traffic hoặc keep deployment.
9. Monitor 30-60 phút đầu.
```

### 17.3 Deployment steps staging

```text
1. Freeze release branch.
2. Build backend artifact.
3. Deploy staging database migration.
4. Run seed staging.
5. Deploy backend staging.
6. Check /health and /ready.
7. Import/update OpenAPI for FE/QA.
8. Run API regression suite.
9. Run frontend integration smoke test.
10. Fix blocker and cut new RC if needed.
```

### 17.4 Deployment steps production

```text
1. Confirm go/no-go sign-off.
2. Announce deployment window if needed.
3. Backup production database.
4. Verify rollback artifact/tag.
5. Run migration production.
6. Run seed production idempotent.
7. Deploy backend artifact.
8. Run readiness check.
9. Run production smoke test.
10. Monitor metrics/logs/errors.
11. Confirm release success.
12. Write release note/status update.
```

### 17.5 Smoke test sau deploy

| Mã | Smoke test | Expected |
| --- | --- | --- |
| SMK-001 | `GET /health` | 200 OK |
| SMK-002 | `GET /ready` | 200 OK, DB/cache/storage ok |
| SMK-003 | Login admin | Success |
| SMK-004 | `GET /auth/me` | Trả user/company/permissions |
| SMK-005 | `GET /foundation/modules/my-apps` nếu có | Trả app theo quyền |
| SMK-006 | `GET /dashboard/me` | Trả dashboard hoặc empty hợp lệ |
| SMK-007 | `GET /notifications/unread-count` | Trả count |
| SMK-008 | HR employee list | 200, có pagination |
| SMK-009 | Attendance today | 200, trạng thái hợp lệ |
| SMK-010 | Leave balance/my requests | 200 |
| SMK-011 | My tasks | 200 |
| SMK-012 | File metadata/upload nhỏ nếu môi trường cho phép | Success |

---

## 18. Rollback readiness

### 18.1 Rollback app

Rollback app khi:

1. 5xx tăng mạnh sau deploy.
2. Auth/login lỗi diện rộng.
3. API P0 không hoạt động.
4. Latency vượt ngưỡng nghiêm trọng.
5. Frontend không tương thích contract.
6. Data corruption chưa xảy ra hoặc migration backward-compatible.

Steps:

```text
1. Stop traffic/new rollout.
2. Deploy previous stable image/tag.
3. Keep database nếu migration backward-compatible.
4. Run smoke test.
5. Monitor metrics.
6. Tạo incident note và hotfix plan.
```

### 18.2 Rollback database

Rollback DB chỉ thực hiện khi thật sự cần và đã có backup.

Triggers:

1. Migration phá schema gây app cũ không chạy.
2. Migration làm mất dữ liệu hoặc sai dữ liệu nghiêm trọng.
3. Constraint/index gây lỗi diện rộng không thể hotfix nhanh.

Steps:

```text
1. Stop app traffic hoặc bật maintenance.
2. Restore backup/snapshot hoặc chạy rollback script đã review.
3. Verify schema/data.
4. Deploy app compatible.
5. Run smoke/regression critical.
6. Ghi incident report.
```

### 18.3 Rollback seed/config

Seed/config rollback cần chú ý:

- Permission seed sai có thể làm user mất quyền hoặc lộ quyền.
- Dashboard/widget config sai có thể gây lỗi UI.
- Notification template sai có thể gửi sai nội dung.
- Company settings sai có thể ảnh hưởng attendance/leave rule.

Cần có:

1. Seed version.
2. Seed checksum.
3. Backup bảng config/seed trước update lớn.
4. Script disable config/template/widget nhanh nếu cần.

---

## 19. Go/no-go checklist

### 19.1 Go criteria

Backend được phép release khi:

- [ ] Gate 1 Code complete pass.
- [ ] Gate 2 Database ready pass.
- [ ] Gate 3 API contract ready pass.
- [ ] Gate 4 Security ready pass.
- [ ] Gate 5 QA ready pass.
- [ ] Gate 6 Deployment ready pass.
- [ ] Không còn bug Critical/High mở.
- [ ] Bug Medium còn lại đã có workaround hoặc được Product chấp nhận.
- [ ] OpenAPI/Swagger đã bàn giao cho frontend/QA.
- [ ] Release note đã viết.
- [ ] Rollback plan đã review.
- [ ] Smoke test staging pass.
- [ ] Product/QA/BE/FE/DevOps sign-off.

### 19.2 No-go criteria

Không release nếu có một trong các điều kiện:

1. Login/auth P0 lỗi.
2. Permission/data scope có lỗi lộ dữ liệu trái quyền.
3. Migration không chạy được từ database trống hoặc staging.
4. Seed RBAC/permission sai nghiêm trọng.
5. API contract phá frontend P0.
6. Check-in/check-out P0 lỗi.
7. Leave approve/balance có nguy cơ sai dữ liệu.
8. File private expose URL/storage path.
9. Dashboard/notification làm app crash diện rộng.
10. Không có rollback plan.
11. Không có backup trước production migration.
12. Monitoring/logging không đủ phát hiện lỗi nghiêm trọng.

---

## 20. Release notes template

```markdown
# Backend Release Note - v1.0.0

## Release information
- Version: backend-v1.0.0
- Date: YYYY-MM-DD
- Environment: staging/production
- Commit: <commit_hash>
- Migration version: <version>

## Modules included
- AUTH
- HR
- ATT
- LEAVE
- TASK
- NOTI
- DASH
- FOUNDATION

## Key changes
- ...

## API changes
- New endpoints:
- Updated endpoints:
- Deprecated endpoints:
- Breaking changes: None / list

## Database changes
- Migrations:
- Seeds:
- Indexes:

## Known limitations
- ...

## Rollback plan
- Previous stable tag:
- DB rollback notes:

## Sign-off
- Backend:
- Frontend:
- QA:
- Product:
- DevOps:
```

---

## 21. Incident response runbook

### 21.1 Login/auth incident

Triệu chứng:

- Login fail hàng loạt.
- 401/403 spike.
- Refresh token lỗi.

Kiểm tra:

1. JWT secret/key có đổi không.
2. Valkey/cache permission có lỗi không.
3. DB users/sessions có lỗi migration không.
4. Company status có bị seed/config sai không.
5. CORS/cookie/header Authorization có bị gateway đổi không.

Hành động:

1. Rollback app nếu lỗi code.
2. Revert config nếu lỗi env/secret.
3. Clear permission/session cache nếu lỗi cache.
4. Restore seed/config nếu role-permission sai.

### 21.2 Permission/data leak incident

Triệu chứng:

- User xem được dữ liệu ngoài scope.
- Frontend hiển thị app/menu trái quyền và API trả dữ liệu.

Hành động ngay:

1. Disable endpoint/module nếu cần.
2. Revoke/adjust role-permission seed sai.
3. Patch backend guard.
4. Kiểm tra audit logs để xác định phạm vi ảnh hưởng.
5. Thông báo stakeholder theo policy.

### 21.3 Database migration incident

Triệu chứng:

- App không start sau migration.
- Query lỗi missing column/table/constraint.
- Migration chạy nửa chừng fail.

Hành động:

1. Dừng rollout.
2. Kiểm tra migration version.
3. Nếu chưa ảnh hưởng dữ liệu, fix migration và rerun trên staging trước.
4. Nếu production đã lỗi, restore backup hoặc rollback script.
5. Deploy app compatible.

### 21.4 Performance incident

Triệu chứng:

- Latency tăng.
- DB CPU cao.
- Slow query nhiều.
- Dashboard/notification timeout.

Kiểm tra:

1. Top slow queries.
2. Có thiếu index hoặc query thiếu `company_id` không.
3. Có N+1 mới không.
4. Cache hit rate dashboard.
5. Notification unread count scan bảng lớn không.

Hành động:

1. Bật/giảm tần suất polling nếu có.
2. Tăng cache TTL tạm thời nếu an toàn.
3. Add index hotfix nếu cần và an toàn.
4. Rollback app nếu query mới gây tải.

### 21.5 Notification incident

Triệu chứng:

- Notification spam.
- Unread count sai.
- Event queue lag.

Hành động:

1. Disable event/template gây spam.
2. Kiểm tra dedupe/idempotency.
3. Pause worker nếu cần.
4. Cleanup notification trùng nếu có script an toàn.
5. Fix recipient resolver/template.

### 21.6 File incident

Triệu chứng:

- Không upload/download được file.
- File private lộ URL.
- Storage lỗi.

Hành động:

1. Disable download/upload nếu lộ dữ liệu.
2. Kiểm tra storage credentials.
3. Kiểm tra signed URL TTL.
4. Kiểm tra file permission service.
5. Kiểm tra file access logs.

---

## 22. Acceptance criteria BACKEND-14

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| BE14-AC-001 | Có định nghĩa rõ Backend Release Readiness cho MVP |
| BE14-AC-002 | Có release gates từ code, DB, API, security, QA đến deployment |
| BE14-AC-003 | Có checklist migration/seed/index/rollback database |
| BE14-AC-004 | Có checklist API contract và OpenAPI/Swagger |
| BE14-AC-005 | Có checklist security gồm auth, RBAC, scope, sensitive data, file private, rate limit |
| BE14-AC-006 | Có checklist readiness cho từng module AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION |
| BE14-AC-007 | Có integration readiness với frontend và flow P0 cần test |
| BE14-AC-008 | Có test strategy gồm unit, integration, API, permission, regression, smoke |
| BE14-AC-009 | Có performance readiness, SLA đề xuất, query/cache checklist |
| BE14-AC-010 | Có observability readiness gồm health, logs, metrics, alerts |
| BE14-AC-011 | Có deployment steps cho staging và production |
| BE14-AC-012 | Có rollback strategy cho app, DB và seed/config |
| BE14-AC-013 | Có go/no-go criteria rõ ràng |
| BE14-AC-014 | Có release note template |
| BE14-AC-015 | Có incident response runbook cho lỗi trọng yếu |
| BE14-AC-016 | Tài liệu đủ để Backend, QA, Frontend, DevOps và Product dùng làm checklist release MVP |

---

## 23. Open questions cần chốt trước production

| Mã | Câu hỏi | Owner | Trạng thái |
| --- | --- | --- | --- |
| BE14-OQ-001 | Production dùng cloud nào và deployment strategy nào? | DevOps | Open |
| BE14-OQ-002 | Có bật Swagger ở production không, hay chỉ dùng staging/internal? | Backend/Security | Open |
| BE14-OQ-003 | File storage production dùng local private storage, S3, GCS, MinIO hay Azure Blob? | DevOps/Backend | Open |
| BE14-OQ-004 | Có dùng Valkey/cache/queue trong MVP production không? | Backend/DevOps | Open |
| BE14-OQ-005 | Job scheduler chạy cùng app hay worker riêng? | Backend/DevOps | Open |
| BE14-OQ-006 | Backup/restore RPO/RTO mục tiêu là bao nhiêu? | Product/DevOps | Open |
| BE14-OQ-007 | Có yêu cầu penetration test trước production không? | Product/Security | Open |
| BE14-OQ-008 | Có cần audit export/log retention policy chính thức ngay MVP không? | Product/Compliance | Open |
| BE14-OQ-009 | Có cần maintenance window khi deploy production không? | Product/DevOps | Open |
| BE14-OQ-010 | Ai có quyền cuối cùng sign-off go/no-go production? | Product | Open |

---

## 24. Checklist sign-off

| Vai trò | Người sign-off | Điều kiện sign-off | Trạng thái |
| --- | --- | --- | --- |
| Product Owner |  | MVP scope đạt yêu cầu, known issues được chấp nhận | Pending |
| Backend Lead |  | Code/API/DB/security readiness pass | Pending |
| Frontend Lead |  | Contract/API integration pass | Pending |
| QA Lead |  | Regression/smoke/UAT pass, không còn blocker | Pending |
| DevOps Lead |  | Deploy/rollback/monitoring/backup ready | Pending |
| Security/Compliance |  | Auth/RBAC/sensitive data/file/security checklist pass | Pending |

---

## 25. Kết luận

BACKEND-14 chốt tiêu chuẩn cuối cùng để backend MVP của hệ thống quản lý doanh nghiệp nội bộ được xem là sẵn sàng phát hành.

Tư duy release chính:

```text
Code complete
-> Database migration + seed verified
-> API contract + OpenAPI locked
-> Security + permission + data scope hardened
-> Module regression pass
-> Frontend integration pass
-> Performance + observability ready
-> Deployment + rollback ready
-> Go/no-go sign-off
-> Release
-> Monitor
```

Backend không chỉ cần chạy được, mà phải đảm bảo đúng dữ liệu, đúng quyền, đúng scope, đúng contract, có thể truy vết, có thể rollback và có thể vận hành sau release.

Sau BACKEND-14, bước tiếp theo nên là:

```text
FULLSTACK-01: End-to-End Integration, UAT & Production Release Plan
```

Hoặc nếu muốn tách theo DevOps:

```text
DEVOPS-01: CI/CD, Environment, Deployment & Monitoring Plan
```
