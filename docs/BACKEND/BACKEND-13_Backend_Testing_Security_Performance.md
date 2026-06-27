# BACKEND-13: BACKEND TESTING, SECURITY & PERFORMANCE
# KIEM THU BACKEND, BAO MAT & HIEU NANG
# HE THONG QUAN LY DOANH NGHIEP NOI BO

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · **BACKEND-13 Testing/Security/Perf** · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Index/Hiệu năng: DB-09](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [Chuẩn API: API-01](<../API Design/API-01 TỔNG QUAN.md>) · [FE QA/Release: FRONTEND-14](<../FRONTEND/FRONTEND-14_QA_Performance_Release_Readiness.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thong tin tai lieu

| Truong | Noi dung |
| --- | --- |
| Ma tai lieu | BACKEND-13 |
| Ten tai lieu | Backend Testing, Security & Performance |
| Ten du an | He thong quan ly doanh nghiep noi bo |
| Ten san pham | Enterprise Management System |
| Giai doan | Backend Implementation - MVP Version 1.0 |
| Trang thai | Draft |
| Ngay tao | 20/06/2026 |
| Ngay cap nhat | 20/06/2026 |
| Tai lieu nguon | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-12 |
| Nguoi viet |  |
| Nguoi duyet |  |

---

## 2. Muc dich tai lieu

BACKEND-13 dinh nghia chien luoc kiem thu, bao mat va hieu nang cho backend cua he thong quan ly doanh nghiep noi bo.

Tai lieu nay dung de:

1. Chot test strategy tong the cho backend MVP.
2. Xac dinh loai test bat buoc: unit, integration, API, contract, e2e, security, performance, migration, regression.
3. Chuan hoa cach test authentication, authorization, RBAC, data scope va multi-tenant isolation.
4. Chuan hoa cach test cac nghiep vu loi: HR, ATT, LEAVE, TASK, NOTI, DASH va FOUNDATION.
5. Chuan hoa checklist bao mat API, du lieu nhay cam, file private, audit log, token/session va secret.
6. Chuan hoa muc tieu hieu nang backend: API latency, database query, dashboard widget, notification unread count, export va job.
7. Dinh nghia CI/CD quality gate truoc khi merge va truoc khi release.
8. Lam co so de QA viet test case chi tiet, DevOps cau hinh pipeline va Backend team tu danh gia release readiness.

BACKEND-13 khong thay the test case chi tiet cua tung module. Tai lieu nay la khung nghiem thu ky thuat va tieu chuan release cho backend.

---

## 3. Vi tri BACKEND-13 trong roadmap backend

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
```

BACKEND-13 la buoc tong hop sau khi cac module backend da co controller, service, repository, migration, seed va OpenAPI contract. Buoc nay tap trung vao:

1. Chung minh backend dung nghiep vu.
2. Chung minh backend khong ro ri du lieu trai quyen.
3. Chung minh backend chiu duoc tai MVP.
4. Chung minh migration/seed co the dung DB tu trang thai trong.
5. Chung minh release co the rollback, debug va audit.

---

## 4. Can cu thiet ke

BACKEND-13 bam theo cac quyet dinh da chot:

1. Backend la nguon kiem soat quyen cuoi cung; frontend chi an/hien UI de cai thien trai nghiem.
2. Moi API nghiep vu phai kiem tra authentication, permission, data scope, business rule, audit log va notification event neu can.
3. API public dung prefix `/api/v1`, internal API dung `/internal/v1` va khong duoc expose cho frontend.
4. Access token + refresh token la co che xac thuc MVP.
5. Backend resolve `company_id`, `user_id`, `employee_id`, role, permission va data scope tu auth context; frontend khong tu truyen cac gia tri nay cho nghiep vu thong thuong.
6. Moi query nghiep vu phai filter theo `company_id`, tru mot so bang global hoac scope System.
7. Database dung PostgreSQL, UUID, soft delete, audit log, file private, setting va sequence counter dung chung.
8. DB migration phai chay duoc tu database trong va seed phai idempotent.
9. Dashboard chi tong hop/cache/format du lieu, khong xu ly nghiep vu goc.
10. Notification payload phai an toan, khong chua du lieu nhay cam khong can thiet.
11. Cac API thay doi du lieu quan trong can idempotency key, transaction va audit log.
12. Cac query quan trong can duoc kiem tra `EXPLAIN ANALYZE` truoc release.

---

## 5. Pham vi BACKEND-13

### 5.1 Bao gom

| Nhom | Noi dung |
| --- | --- |
| Test strategy | Test pyramid, test layer, test naming, coverage target |
| Unit test | Service, validator, policy, guard, mapper, utility |
| Integration test | Repository, database transaction, event, cache, file, settings |
| API test | Auth, response format, error format, pagination, idempotency, permission |
| Contract test | OpenAPI validation, request/response schema, generated client compatibility |
| E2E backend flow | Login, HR, ATT, LEAVE, TASK, NOTI, DASH end-to-end |
| Security test | Auth, RBAC, data scope, tenant isolation, secret, file, rate limit |
| Performance test | API latency, DB query, dashboard, notification, export, job |
| Migration test | Build DB from empty, seed, rollback, idempotent seed, schema drift |
| Regression test | Module critical workflow and cross-module sync |
| CI gate | Lint, typecheck, test, migration, OpenAPI diff, vulnerability scan |
| Release readiness | Smoke test, monitoring, alert, backup, rollback, Go/No-Go checklist |

### 5.2 Khong bao gom

1. Test case UI chi tiet cua frontend.
2. Kiem thu mobile native app.
3. Penetration test chuyen sau boi ben thu ba.
4. Chaos engineering quy mo production.
5. Performance test ha tang cloud cuoi cung.
6. BI/data warehouse benchmark nang cao.
7. Payroll/Recruit/Asset/Room/Chat/Social/AI ngoai MVP.

Cac muc nay co the tach thanh QA-01, SEC-01, DEVOPS-01 hoac PERFORMANCE-01 o phase sau.

---

## 6. Nguyen tac test tong the

### 6.1 Test pyramid backend

| Tang test | Muc tieu | Ty trong de xuat |
| --- | --- | --- |
| Unit test | Logic nho, nhanh, khong dung DB/network | 50% - 60% |
| Integration test | Service + repository + database/cache/event | 25% - 35% |
| API/E2E backend test | Flow thuc qua HTTP va auth guard | 10% - 15% |
| Performance/security test | Chay theo pipeline rieng hoac truoc release | Theo dot release |

Nguyen tac:

1. Unit test phai nhanh va on dinh.
2. Integration test phai dung database test that, khong mock repository neu can test transaction/query.
3. API test phai di qua middleware/guard/interceptor/exception handler that.
4. Khong dua tat ca vao E2E vi cham va kho debug.
5. Moi bug nghiem trong sau khi fix phai co regression test.

### 6.2 Test naming convention

```text
<module>.<layer>.<scenario>.<expected_result>
```

Vi du:

```text
auth.guard.missing_token.return_401
leave.approval.manager_scope_team.approve_success
leave.approval.manager_cross_team.return_403
attendance.checkin.leave_full_day_approved.return_422
task.assign.assignee_on_leave.return_warning
noti.mark_all_read.only_current_user_updated
dash.widget.cache_key_wrong_scope.not_reused
```

### 6.3 Test data convention

| Loai fixture | Muc dich |
| --- | --- |
| `companyA`, `companyB` | Test multi-tenant isolation |
| `superAdmin` | Test System scope |
| `companyAdmin` | Test Company scope |
| `hrUser` | Test HR workflows |
| `managerUser` | Test Team scope |
| `employeeUser` | Test Own scope |
| `otherTeamEmployee` | Test scope denied |
| `inactiveEmployee` | Test blocked business rule |
| `lockedUser` | Test login/session denied |

Moi integration/API test lien quan phan quyen nen co it nhat 2 company hoac 2 scope de tranh test gia.

---

## 7. Quality target cho MVP

### 7.1 Coverage target

| Nhom code | Unit/Integration coverage toi thieu | Ghi chu |
| --- | ---: | --- |
| Auth guard, permission guard, data scope service | 90% | Bat buoc vi lien quan bao mat |
| Token/session/password service | 90% | Bat buoc vi lien quan truy cap |
| HR service core | 80% | Employee, profile change, code generation |
| ATT service core | 85% | Check-in/out, rule, adjustment, remote |
| LEAVE service core | 85% | Balance, approval, ATT sync |
| TASK service core | 80% | Project, assign, status, comment, checklist |
| NOTI service core | 80% | Event, dedupe, mark read, template |
| DASH service core | 75% | Widget query, permission, cache |
| Foundation service | 80% | Audit, file, settings, sequence |
| DTO validation | 70% | Tap trung field quan trong |

Coverage khong phai muc tieu duy nhat. Cac test lien quan data scope va business transition quan trong hon viec dat ty le cao nhung test hinh thuc.

### 7.2 Release blocking defects

Cac loi sau phai chan release:

1. User xem/sua du lieu khac company.
2. User co scope Own xem du lieu Team/Company.
3. Manager duyet du lieu ngoai team khi khong co quyen.
4. API thay doi du lieu bo qua audit log bat buoc.
5. API quan trong xu ly trung request khi co retry/idempotency.
6. Chay migration tu DB trong bi loi.
7. Seed production tao du lieu mau hoac lo secret.
8. Dashboard cache tra nham user/scope/company.
9. Notification payload lo du lieu nhay cam.
10. File private tai duoc khi khong co quyen.
11. Query realtime quan trong timeout o data volume MVP.
12. Password/reset/refresh token luu plain text.

---

## 8. Test environment

### 8.1 Moi truong test bat buoc

| Moi truong | Muc dich |
| --- | --- |
| Local | Developer chay unit/integration nhanh |
| CI ephemeral | Moi PR dung DB/cache rieng, reset tu migration |
| Development | Test tich hop nhanh giua frontend/backend |
| Staging | Test gan production, seed gan that, khong dung dev-only data |
| Production smoke | Kiem tra sau deploy voi tai khoan/system check an toan |

### 8.2 Test infrastructure

Khuyen nghi moi truong CI su dung:

1. PostgreSQL test database.
2. Valkey/cache test neu backend dung cache.
3. Object storage mock/local cho file service.
4. Mail/notification fake provider.
5. Queue/event bus local hoac test adapter.
6. Clock/timezone fixed theo `Asia/Ho_Chi_Minh` de test ATT/LEAVE on dinh.

### 8.3 Database reset strategy

| Loai test | Cach reset |
| --- | --- |
| Unit test | Khong dung DB |
| Integration test nho | Transaction rollback per test |
| Integration test workflow | Truncate schema test + seed minimal |
| API/E2E suite | Recreate DB tu migration + seed once, reset data theo test group |
| Migration test | Tao DB trong moi lan chay |

Khong duoc dung shared staging DB cho CI PR vi de gay flakiness va ro ri data.

---

## 9. Unit test plan

### 9.1 AUTH unit test

| Nhom | Test bat buoc |
| --- | --- |
| Password service | Hash password, verify password, reject plain text, policy min length |
| Token service | Sign access token, verify expired token, verify wrong type, parse claims |
| Refresh token service | Hash token, rotate token, revoke token, expired token |
| Permission resolver | Merge multiple roles, resolve highest/allowed scope, inactive role ignored |
| Auth guard | Missing token 401, invalid token 401, locked user 403 |
| Permission guard | Missing permission 403, missing scope 403, System scope allowed |

### 9.2 FOUNDATION unit test

| Nhom | Test bat buoc |
| --- | --- |
| Audit service | Build audit event, mask sensitive fields, append-only behavior |
| File policy | Validate mime, size, visibility, link permission |
| Setting service | Resolve system default, company override, sensitive setting masking |
| Sequence service | Format code, reset by year/month, pad number, invalid config |
| Public holiday service | Check holiday range, company override, fallback global |

### 9.3 HR unit test

| Nhom | Test bat buoc |
| --- | --- |
| Employee code | Auto generate, duplicate handling, manual override policy |
| Profile change | Diff old/new field, allowed fields, apply after approve only |
| Employee status | Valid transitions, block resigned employee for linked operations |
| Sensitive fields | Mask fields without permission |
| Org scope | Resolve team/direct manager/department |

### 9.4 ATT unit test

| Nhom | Test bat buoc |
| --- | --- |
| Rule engine | Fixed shift, flexible shift, late, early, missing checkout |
| Check-in/out | Validate employee status, duplicate check-in, checkout before check-in |
| Leave block | Approved full-day leave blocks attendance |
| Remote rule | Approved remote allows auto/manual attendance by config |
| Adjustment | Validate items, approval transition, direct adjustment reason required |
| Recalculation | Recompute status after leave cancel/adjustment |

### 9.5 LEAVE unit test

| Nhom | Test bat buoc |
| --- | --- |
| Leave calculation | Full day, half day, hourly, multiple days, holiday exclusion |
| Balance | Hold, deduct, release, adjustment, no negative if policy disallows |
| State machine | Draft -> Pending -> Approved/Rejected/Cancelled/Revoked |
| Approval policy | Manager team, HR company, duplicate approval blocked |
| ATT sync | Approved creates/updates leave day for attendance recalculation |

### 9.6 TASK unit test

| Nhom | Test bat buoc |
| --- | --- |
| Project member | Add/remove member, role in project, inactive member blocked |
| Task assignment | Assignee active, project member required if config enabled |
| Task status | Valid transition, Done requires checklist if required |
| Comment mention | Mention user exists and can view task |
| Watcher | Auto watcher creator/owner, remove watcher |
| Activity log | Correct activity type and actor |

### 9.7 NOTI unit test

| Nhom | Test bat buoc |
| --- | --- |
| Event service | Event disabled, dedupe key, recipient resolver |
| Template renderer | Missing variable fallback, locale fallback, safe payload |
| Notification action | Mark read, mark all read, hide/archive/delete soft |
| Delivery log | Retry count, mask provider secret, failure handling |
| Unread counter | Only current user, only same company |

### 9.8 DASH unit test

| Nhom | Test bat buoc |
| --- | --- |
| Widget registry | Widget active/inactive, required permission |
| Dashboard resolver | Employee/Manager/HR/Admin dashboard precedence |
| Widget permission | Hide forbidden widget, empty due to scope |
| Cache key | Includes company, user/role, scope, filters |
| Cache TTL | Expired cache recompute, stale status returned correctly |

---

## 10. Integration test plan

### 10.1 Repository + database test

Moi repository chinh can test:

1. Filter theo `company_id`.
2. Soft delete khong tra record active list.
3. Pagination co limit.
4. Search/filter/sort dung whitelist.
5. Unique constraint dung business key.
6. Foreign key khong cho du lieu mo coi.
7. Transaction rollback khi co loi giua luong.
8. Query projection khong tra field nhay cam neu service khong yeu cau.

### 10.2 Transaction integration test

| Module | Transaction can test |
| --- | --- |
| AUTH | Login creates session + login log; logout revokes session |
| HR | Create employee + user link + contract + audit + code sequence |
| HR | Approve profile change updates employee + audit + notification event |
| ATT | Check-in creates attendance record + attendance log + audit/event |
| ATT | Manual adjustment updates record + log + audit + notification |
| LEAVE | Submit/approve request updates balance ledger + request + ATT sync + event |
| TASK | Create task inserts task + assignee + watcher + activity + event |
| TASK | Change status updates task + activity + notification event |
| NOTI | Consume event creates notifications + delivery logs atomically |
| DASH | Invalidate cache marks widget cache stale without deleting source data |
| FOUNDATION | File upload creates file metadata + file link + access log if needed |

### 10.3 Cross-module integration test

| Ma test | Flow | Expected |
| --- | --- | --- |
| BE13-INT-001 | HR tao employee moi co user | User login duoc, employee mapping dung |
| BE13-INT-002 | Employee gui profile change | HR nhan notification, employee chua bi update |
| BE13-INT-003 | HR approve profile change | Employee update, audit log co old/new, employee nhan notification |
| BE13-INT-004 | Employee co leave approved full day | ATT check-in bi chan |
| BE13-INT-005 | Leave approved sau khi da co attendance | ATT record duoc recalculate theo rule |
| BE13-INT-006 | Leave revoked | ATT record duoc recalculate lai |
| BE13-INT-007 | Task assigned | Assignee nhan notification, Dashboard my task cap nhat/cache stale |
| BE13-INT-008 | Task due soon job | NOTI tao notification dung nguoi, khong spam duplicate |
| BE13-INT-009 | Notification deep link | Module goc van check permission truoc khi tra chi tiet |
| BE13-INT-010 | Dashboard manager scope Team | Chi tong hop employee/task/leave cua team |

---

## 11. API test plan

### 11.1 API response contract

Moi endpoint public can test:

1. Response thanh cong co `success`, `message`, `data`, `meta.request_id`.
2. List response co `pagination` khi phan trang.
3. Error response co `success=false`, `message`, `error.code`, `error.type`, `meta.request_id`.
4. Validation error co `details` theo field.
5. Date/time dung ISO 8601.
6. Khong tra secret/password hash/refresh token hash/private storage path.
7. HTTP status dung ngu canh: 200, 201, 400, 401, 403, 404, 409, 422, 429, 500.

### 11.2 Authentication API test

| Scenario | Expected |
| --- | --- |
| Missing Authorization header | 401 |
| Invalid token format | 401 |
| Expired access token | 401 + code token expired |
| Revoked session | 401 |
| Locked user | 403 |
| Inactive company | 403 |
| Refresh token valid | New access token |
| Refresh token reused after rotate | 401/403 depending policy |
| Logout | Session revoked, current token unusable |

### 11.3 Authorization API test

Moi endpoint nghiep vu can co it nhat cac nhom test:

| Scenario | Expected |
| --- | --- |
| No permission | 403 |
| Has permission but wrong scope | 403 |
| Own scope target self | 200/201 |
| Own scope target other employee | 403/404 safe response |
| Team scope target team member | 200 |
| Team scope target other team | 403 |
| Company scope same company | 200 |
| Company scope other company | 403/404 safe response |
| System scope if allowed | 200 |

### 11.4 Pagination/search/filter/sort test

| Scenario | Expected |
| --- | --- |
| Missing page/per_page | Default pagination |
| `per_page` > max | Clamp or validation error theo policy |
| Sort field not whitelisted | 400 validation |
| Filter field not supported | 400 validation |
| Search unicode co dau/khong dau | Ket qua dung neu da ho tro unaccent |
| List large range | Gioi han range hoac yeu cau export |
| Offset qua lon | Canh bao/chuyen keyset neu endpoint quy dinh |

### 11.5 Idempotency API test

Cac API sau can test idempotency:

1. Check-in/check-out.
2. Attendance adjustment submit/approve/direct adjust.
3. Leave submit/approve/reject/cancel/revoke.
4. Leave balance adjustment.
5. HR create employee neu co retry tu client.
6. Profile change approval.
7. Task create/assign/change status neu action co retry.
8. Notification internal event consume.
9. File upload/link neu co retry.

Expected:

1. Cung `Idempotency-Key` + cung request -> tra cung ket qua hoac no-op an toan.
2. Cung key + request khac body -> 409 conflict.
3. Khong co key voi API bat buoc -> 400.
4. Idempotency record co TTL/cleanup.

---

## 12. Contract test & OpenAPI validation

### 12.1 OpenAPI contract gate

Truoc merge/release can kiem tra:

1. Tat ca endpoint co method, path, tags, security, request body, response schema.
2. Tat ca response loi dung error schema chung.
3. Tat ca list endpoint dung pagination schema.
4. Tat ca endpoint co permission metadata trong description hoac extension.
5. Tat ca enum trong schema dong bo voi backend validation.
6. Khong co endpoint internal xuat hien trong public OpenAPI.
7. Khong co field secret/private path trong response schema.

### 12.2 Consumer contract voi frontend

Frontend can co kha nang generate type/client tu OpenAPI. Contract test can check:

1. Field bat buoc khong bi xoa neu chua co versioning.
2. Rename field la breaking change va phai duoc canh bao.
3. Them optional field khong phai breaking change.
4. Doi enum/status co the la breaking change neu frontend dang dung switch strict.
5. Endpoint route/path param phai dung kebab-case/UUID convention.

### 12.3 OpenAPI diff rule

| Loai thay doi | Gate |
| --- | --- |
| Xoa endpoint | Block unless approved breaking change |
| Xoa required field response | Block |
| Doi type field | Block |
| Doi HTTP status chinh | Warning/Block tuy endpoint |
| Them optional field | Allow |
| Them endpoint moi | Allow |
| Them enum value | Warning neu frontend strict |
| Them required request field | Block unless versioned |

---

## 13. E2E backend flow test

### 13.1 Flow AUTH + Home context

```text
1. Admin tao user + gan role.
2. User login.
3. Backend tra auth context: user, company, employee, roles, permissions, data scopes.
4. User goi /api/v1/auth/me.
5. User goi app registry/dashboard me.
6. Logout.
7. Token cu khong dung duoc.
```

### 13.2 Flow HR self-service

```text
1. Employee login.
2. Xem ho so cua minh.
3. Gui yeu cau sua so dien thoai/dia chi.
4. HR xem danh sach request pending.
5. HR approve.
6. Employee profile duoc update.
7. Audit log co old/new.
8. Employee nhan notification ket qua.
```

### 13.3 Flow Attendance daily

```text
1. Employee login.
2. Goi today attendance.
3. Check-in thanh cong.
4. Check-out thanh cong.
5. Attendance record tinh du gio/di muon/ve som theo rule.
6. Dashboard employee hien trang thai moi.
```

### 13.4 Flow Leave approval + ATT sync

```text
1. Employee tao don nghi.
2. Employee submit.
3. Manager/HR xem don pending theo scope.
4. Approve don.
5. Leave balance bi tru dung.
6. Leave request days duoc tao.
7. ATT ngay nghi bi danh dau Leave hoac chan check-in.
8. NOTI gui ket qua.
9. DASH widget pending leave/leave balance cap nhat hoac cache stale.
```

### 13.5 Flow Task collaboration

```text
1. Manager tao project.
2. Them member.
3. Tao task va assign employee.
4. Assignee nhan notification.
5. Assignee cap nhat status.
6. Comment mention user.
7. Mentioned user nhan notification neu co quyen xem task.
8. Dashboard task widget cap nhat/cache stale.
```

---

## 14. Security test plan

### 14.1 Authentication security

Checklist:

- [ ] Password khong luu plain text.
- [ ] Password hash dung algorithm manh va co salt.
- [ ] Reset token chi luu hash.
- [ ] Refresh token chi luu hash.
- [ ] Access token co `exp`, `iat`, `sub`, `company_id`, `session_id`, `token_type`.
- [ ] Backend verify `token_type=access` khi goi API nghiep vu.
- [ ] Refresh endpoint chi chap nhan refresh token.
- [ ] Logout revoke session/refresh token.
- [ ] Locked user khong refresh duoc token.
- [ ] Password reset token het han hoac da dung khong dung lai duoc.
- [ ] Brute force login co rate limit va security event.
- [ ] Login log khong luu password/token.

### 14.2 Authorization/RBAC security

Checklist:

- [ ] Moi API nghiep vu co required permission.
- [ ] Permission guard chay truoc service mutation.
- [ ] Data scope check target resource, khong chi check route.
- [ ] Role khong hard-code thay cho permission.
- [ ] Multi-role user resolve permission/scope dung.
- [ ] Scope Own/Team/Department/Company/System duoc test rieng.
- [ ] Project scope cua TASK kiem tra membership/role trong project.
- [ ] Dashboard widget kiem tra permission truoc khi query/cache.
- [ ] Notification target link khong bypass permission cua module goc.

### 14.3 Multi-tenant isolation

Moi module phai co test:

1. User company A khong xem record company B.
2. User company A khong cap nhat/xoa record company B.
3. Search/filter/sort khong leak record company B.
4. Export khong leak record company B.
5. Dashboard cache key khong dung chung giua company.
6. Notification unread count khong dem nham company.
7. File link/file download khong cho cross-company.
8. Admin company khong goi API System neu khong co scope System.

### 14.4 Data sensitivity & field-level security

Doi voi HR va file:

- [ ] Thong tin nhay cam khong tra ve neu thieu permission.
- [ ] Contract/file nhay cam can permission rieng.
- [ ] Audit log co the ghi old/new nhung phai mask field nhay cam khi hien thi.
- [ ] Export phai dung cung permission voi list/detail.
- [ ] Notification payload khong chua full salary/contract/private profile data.
- [ ] Error message khong tiet lo record ton tai ngoai scope neu policy chon safe 404.

### 14.5 Input validation & injection prevention

Checklist:

- [ ] UUID path param validate truoc khi query.
- [ ] Query params dung whitelist cho filter/sort/include.
- [ ] Text input trim/length limit.
- [ ] Comment/task/notification content sanitize khi render o frontend; backend khong luu script neu policy yeu cau.
- [ ] SQL query dung parameter binding, khong concat raw input.
- [ ] JSONB filter chi cho field whitelist.
- [ ] File name sanitize.
- [ ] CSV/Excel export can chong formula injection neu xuat file.

### 14.6 File security

Checklist:

- [ ] File mac dinh private.
- [ ] Upload gioi han size.
- [ ] Upload validate mime type va extension.
- [ ] Khong tin vao client-provided mime.
- [ ] File storage path/private key khong tra ve public response.
- [ ] Download qua signed URL ngan han hoac streaming endpoint co permission check.
- [ ] File link entity phai cung company.
- [ ] File access log ghi khi xem/tai file nhay cam.
- [ ] Xoa file la soft delete/mark deleted neu dang linked.
- [ ] Virus scan co the phase sau, nhung MVP can co hook interface.

### 14.7 Rate limiting & abuse protection

Can co rate limit rieng cho:

| Endpoint/Nhom | Ly do |
| --- | --- |
| Login | Chong brute force |
| Forgot/reset password | Chong spam email/token |
| Refresh token | Chong abuse session |
| File upload | Chong storage abuse |
| Search/list heavy | Chong query abuse |
| Notification internal event | Chong spam event |
| Export | Chong job abuse |

### 14.8 Secret & configuration security

Checklist:

- [ ] Khong commit `.env` production.
- [ ] Khong hard-code admin password trong seed.
- [ ] Secret lay tu environment/secret manager.
- [ ] Log khong in token/password/secret.
- [ ] Error response khong tra stack trace production.
- [ ] CORS chi allow domain hop le.
- [ ] Internal API co auth rieng hoac network policy.
- [ ] Production config bat HTTPS only.

---

## 15. Security test cases theo module

### 15.1 AUTH security cases

| Ma | Scenario | Expected |
| --- | --- | --- |
| BE13-SEC-AUTH-001 | Login sai password lien tuc | Bi rate limit/security event |
| BE13-SEC-AUTH-002 | Token het han goi API | 401 |
| BE13-SEC-AUTH-003 | Refresh token da revoke | 401 |
| BE13-SEC-AUTH-004 | User bi khoa sau khi login | API tiep theo bi 403/401 theo policy |
| BE13-SEC-AUTH-005 | Reset token dung lai lan 2 | 401/422 |

### 15.2 HR security cases

| Ma | Scenario | Expected |
| --- | --- | --- |
| BE13-SEC-HR-001 | Employee xem employee khac | 403/404 |
| BE13-SEC-HR-002 | Manager xem nhan vien ngoai team | 403/404 |
| BE13-SEC-HR-003 | HR xem file hop dong khi thieu permission file | 403 |
| BE13-SEC-HR-004 | Employee sua profile truc tiep qua PATCH employee | 403 |
| BE13-SEC-HR-005 | Profile change request apply truoc approve | Khong duoc update employee |

### 15.3 ATT security cases

| Ma | Scenario | Expected |
| --- | --- | --- |
| BE13-SEC-ATT-001 | Employee check-in cho employee_id khac | 403/validation ignored |
| BE13-SEC-ATT-002 | Manager xem bang cong ngoai team | 403/empty |
| BE13-SEC-ATT-003 | HR direct adjust khong reason | 400/422 |
| BE13-SEC-ATT-004 | User cross-company update attendance | 403/404 |
| BE13-SEC-ATT-005 | Attendance export range qua lon | 400/202 export job theo policy |

### 15.4 LEAVE security cases

| Ma | Scenario | Expected |
| --- | --- | --- |
| BE13-SEC-LEAVE-001 | Employee approve don cua minh | 403 |
| BE13-SEC-LEAVE-002 | Manager approve don ngoai team | 403 |
| BE13-SEC-LEAVE-003 | Leave balance adjust thieu permission | 403 |
| BE13-SEC-LEAVE-004 | Cancel approved leave khi policy cam | 422 |
| BE13-SEC-LEAVE-005 | File chung minh cua don khac | 403 |

### 15.5 TASK security cases

| Ma | Scenario | Expected |
| --- | --- | --- |
| BE13-SEC-TASK-001 | User ngoai project xem private project | 403/404 |
| BE13-SEC-TASK-002 | User comment task khong duoc xem | 403 |
| BE13-SEC-TASK-003 | Mention user khong co quyen xem task | Khong tao mention hoac validation warning |
| BE13-SEC-TASK-004 | Assignee la employee da nghi | 422 |
| BE13-SEC-TASK-005 | File task private cross-company | 403 |

### 15.6 NOTI/DASH security cases

| Ma | Scenario | Expected |
| --- | --- | --- |
| BE13-SEC-NOTI-001 | User xem notification cua user khac | 403/404 |
| BE13-SEC-NOTI-002 | Mark all read | Chi notification cua current user bi update |
| BE13-SEC-NOTI-003 | Notification payload co secret | Bi mask/reject |
| BE13-SEC-DASH-001 | Dashboard cache tra nham user | Bi chan boi cache key va permission check |
| BE13-SEC-DASH-002 | Widget thieu permission | Khong tra data |

---

## 16. Performance target cho MVP

### 16.1 API latency target

| Nhom API | P95 target | Ghi chu |
| --- | ---: | --- |
| Auth `/me`, refresh token | <= 300ms | Khong tinh lan cold start |
| Login | <= 800ms | Bao gom password verify |
| HR/ATT/LEAVE/TASK list co pagination | <= 800ms | Du lieu MVP/staging volume |
| Detail API | <= 500ms | Projection gon |
| Check-in/check-out | <= 800ms | Bao gom transaction/log/event |
| Leave submit/approve | <= 1200ms | Bao gom balance + ATT sync + event |
| Task create/assign/status | <= 1000ms | Bao gom activity + event |
| Notification unread count | <= 100ms | Can partial index/cache neu can |
| Notification dropdown | <= 300ms | Khong join nghiep vu goc nang |
| Dashboard widget single | <= 800ms | Neu uncached |
| Dashboard full page | <= 1500ms | Co lazy load/cache |
| File metadata/list | <= 500ms | Khong tinh upload binary lon |
| Export sync nho | <= 3000ms | Export lon chuyen background job |

### 16.2 Database query target

| Loai query | Target |
| --- | ---: |
| Permission resolve cached | <= 50ms |
| Permission resolve uncached | <= 150ms |
| Employee list P95 | <= 300ms |
| Attendance monthly list P95 | <= 500ms |
| Leave pending approval P95 | <= 300ms |
| My task/task team list P95 | <= 500ms |
| Notification unread count P95 | <= 100ms |
| Dashboard widget query P95 | <= 500ms |
| Audit log list P95 | <= 800ms |

### 16.3 Data volume benchmark cho MVP

Performance test nen dung toi thieu:

| Du lieu | Volume MVP benchmark |
| --- | ---: |
| Companies | 2 - 5 |
| Users | 1,000 - 5,000 |
| Employees | 1,000 - 5,000 |
| Attendance records | 250,000 - 1,000,000 |
| Attendance logs | 500,000 - 2,000,000 |
| Leave requests | 20,000 - 100,000 |
| Tasks | 50,000 - 300,000 |
| Task comments | 100,000 - 500,000 |
| Notifications | 500,000 - 2,000,000 |
| Audit logs | 500,000 - 5,000,000 |
| Files metadata | 50,000 - 300,000 |

Neu MVP thuc te nho hon, van nen benchmark voi volume lon hon de phat hien index/query sai tu som.

---

## 17. Performance test plan

### 17.1 Load test scenarios

| Ma | Scenario | Muc tieu |
| --- | --- | --- |
| BE13-PERF-001 | 100 users login trong 5 phut | Auth/session/log on dinh |
| BE13-PERF-002 | 300 users goi dashboard/me | Dashboard resolver/cache khong nghen |
| BE13-PERF-003 | 500 users check attendance today | Today attendance p95 dat target |
| BE13-PERF-004 | 200 users check-in trong 10 phut | Lock/transaction/idempotency on dinh |
| BE13-PERF-005 | HR list employees search/filter | Index search hoat dong |
| BE13-PERF-006 | Manager list attendance team monthly | Query scope team dat target |
| BE13-PERF-007 | Leave pending approval | Query pending khong scan bang lon |
| BE13-PERF-008 | Task Kanban/List | Task assignee/status/due index hoat dong |
| BE13-PERF-009 | Notification unread/dropdown polling | Partial index/cache unread count |
| BE13-PERF-010 | Dashboard widget refresh | Cache TTL/invalidation on dinh |

### 17.2 Stress test

Stress test dung de tim diem gay nghen, khong phai pass/fail release hang ngay.

Can theo doi:

1. CPU backend.
2. Memory backend.
3. DB CPU/IO.
4. Slow query.
5. Connection pool saturation.
6. Queue lag.
7. Cache hit rate.
8. Error rate 5xx/429.
9. P95/P99 latency.
10. Lock wait/deadlock.

### 17.3 Soak test

Chay 2 - 4 gio voi tai trung binh de phat hien:

1. Memory leak.
2. Connection leak.
3. Token/session cleanup issue.
4. Queue retry loop.
5. Dashboard cache phinh to.
6. Notification delivery log tang nhanh bat thuong.
7. Audit log insert anh huong API latency.

---

## 18. Database performance checklist

### 18.1 Query checklist

Moi query quan trong can kiem tra:

- [ ] Co filter `company_id`.
- [ ] Co filter `deleted_at IS NULL` neu la bang soft delete.
- [ ] Dung index dung thu tu cot.
- [ ] Khong sequential scan tren bang lon neu khong co ly do.
- [ ] Khong join thieu dieu kien company.
- [ ] Khong N+1 query.
- [ ] Khong offset qua lon cho bang lon.
- [ ] Khong sort lon khong dung index.
- [ ] Khong tra qua nhieu cot.
- [ ] Khong query JSONB khong index neu filter thuong xuyen.
- [ ] Dashboard query uncached khong qua 500ms neu co the.
- [ ] Notification unread query khong qua 100ms neu co the.

### 18.2 EXPLAIN ANALYZE gate

Cac endpoint sau bat buoc co `EXPLAIN ANALYZE` truoc release:

1. `GET /api/v1/hr/employees`.
2. `GET /api/v1/attendance/records`.
3. `GET /api/v1/attendance/today`.
4. `GET /api/v1/leave/requests`.
5. `GET /api/v1/leave/calendar`.
6. `GET /api/v1/tasks/my-tasks`.
7. `GET /api/v1/tasks/projects/{id}/kanban`.
8. `GET /api/v1/notifications/unread-count`.
9. `GET /api/v1/notifications/dropdown`.
10. `GET /api/v1/dashboard/me`.
11. `GET /api/v1/dashboard/widgets/{widget_code}`.
12. `GET /api/v1/foundation/audit-logs`.

### 18.3 N+1 prevention gate

Backend khong duoc release API list neu:

1. Moi row lai query department/position/assignee rieng.
2. Moi task lai query assignees/watchers/comments count rieng.
3. Moi notification lai join module goc de lay detail.
4. Moi dashboard widget lai resolve permission lai tu DB ma khong cache/context.
5. Moi file link lai query file metadata rieng thay vi batch/preload.

---

## 19. Cache strategy test

### 19.1 Cache can test

| Cache | Test bat buoc |
| --- | --- |
| Permission cache | Invalidate khi role/permission thay doi |
| Auth context cache | Khong dung lai sau logout/lock user |
| Dashboard widget cache | Key gom company/user/role/scope/filter |
| Notification unread count cache | Invalidate khi create/mark read/delete |
| Settings cache | Invalidate khi update company setting |
| Module/app registry cache | Invalidate khi module disabled |
| Lookup/master data cache | Invalidate khi HR/ATT/LEAVE setting thay doi |

### 19.2 Cache safety rule

1. Cache khong duoc bo qua permission check.
2. Cache key phai gom `company_id`.
3. Cache user-specific phai gom `user_id` hoac role/scope signature.
4. Cache dashboard phai gom filter/date context.
5. Sensitive data khong nen cache public/shared.
6. Logout/permission update phai xoa cache nhay cam neu can.

---

## 20. Job, queue & background task test

### 20.1 Jobs MVP

| Job | Test bat buoc |
| --- | --- |
| Missing checkout detection | Tao notification dung employee, khong duplicate |
| Task due soon/overdue | Dedupe notification theo task/date |
| Contract expiring alert | HR/employee nhan dung theo config |
| Dashboard cache cleanup | Xoa/expire cache dung TTL |
| Notification delivery retry | Retry dung limit, log failure |
| File cleanup temp/deleted | Khong xoa file dang linked |
| Audit/log retention | Chi archive/delete theo policy |
| Seed/migration verify | Chay smoke sau migration |

### 20.2 Job idempotency

Moi job can test:

1. Chay lai khong tao duplicate notification/event.
2. Job fail giua chung co the retry an toan.
3. Co lock hoac dedupe key de tranh 2 worker xu ly cung luc.
4. Co log job run, duration, success/failure.
5. Co metric queue lag/retry count.

---

## 21. Migration & seed test

### 21.1 Migration test bat buoc

| Ma | Scenario | Expected |
| --- | --- | --- |
| BE13-MIG-001 | Tao DB trong va chay all migration | Thanh cong |
| BE13-MIG-002 | Chay seed system/tenant/RBAC/business | Thanh cong |
| BE13-MIG-003 | Chay seed lan 2 | Khong duplicate |
| BE13-MIG-004 | Schema snapshot compare | Khong drift |
| BE13-MIG-005 | Migration order sai | CI phat hien fail |
| BE13-MIG-006 | Missing extension | Bao loi ro rang |
| BE13-MIG-007 | FK/constraint/index verification | Du constraint/index can thiet |
| BE13-MIG-008 | Bootstrap admin | Khong hardcode secret, bat doi password neu policy |
| BE13-MIG-009 | Production seed | Khong co dev-only/sample data |
| BE13-MIG-010 | Rollback dry-run neu co | Khong mat data ngoai plan |

### 21.2 Seed verification

Sau seed, phai co:

1. Modules MVP active: AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI.
2. Modules phase sau inactive neu co.
3. Permission catalog day du.
4. Role mac dinh: Super Admin, Company Admin, HR, Manager, Employee.
5. Role-permission matrix co data scope dung.
6. Company settings mac dinh.
7. Sequence counters can thiet.
8. Leave types/policies mac dinh.
9. Attendance default shift/rule.
10. Notification events/templates.
11. Dashboard widgets/configs.
12. Bootstrap admin an toan.

---

## 22. Observability & monitoring readiness

### 22.1 Log bat buoc

Moi request can co:

1. `request_id`.
2. `correlation_id` neu co.
3. Method/path/status/duration.
4. User/company neu authenticated.
5. Client type/version neu co.
6. Error code neu fail.
7. Khong log token/password/secret.

### 22.2 Metrics bat buoc

| Metric | Muc dich |
| --- | --- |
| API request count | Theo endpoint/status |
| API latency P50/P95/P99 | Theo endpoint |
| Error rate 4xx/5xx | Phat hien regression |
| DB query latency | Slow query |
| DB connection pool usage | Phat hien nghen pool |
| Cache hit/miss | Dashboard/permission/settings |
| Queue lag | Notification/job |
| Job success/failure | Background jobs |
| Auth failure/rate limit | Security monitoring |
| File upload/download error | File service |

### 22.3 Alert de xuat

| Alert | Threshold de xuat |
| --- | --- |
| 5xx error rate | > 1% trong 5 phut |
| API P95 latency | > 2s trong 10 phut |
| DB slow query | Query > 1s lap lai nhieu lan |
| DB connection pool | > 85% trong 5 phut |
| Queue lag | > 5 phut voi job quan trong |
| Login failure spike | Tang bat thuong trong 10 phut |
| File upload failure | > 5% trong 10 phut |
| Disk/storage usage | > 80% |
| Dashboard cache error | > 5% widget requests |

---

## 23. CI/CD quality gates

### 23.1 Pull request gate

Moi PR backend phai pass:

1. Install/build.
2. Lint.
3. Type check.
4. Unit test.
5. Integration test lien quan module.
6. Migration compile/validate neu PR co migration.
7. OpenAPI schema generate thanh cong.
8. OpenAPI diff khong co breaking change chua approve.
9. Security static scan/vulnerability scan co ban.
10. Secret scan.

### 23.2 Main branch gate

Sau merge vao main:

1. Chay full unit test.
2. Chay full integration test.
3. Chay migration from empty DB.
4. Chay seed idempotency.
5. Chay API smoke test.
6. Build docker image.
7. Generate OpenAPI artifact.
8. Publish test report.

### 23.3 Release candidate gate

Truoc deploy staging/production:

1. Full regression test.
2. Security test suite.
3. Performance smoke/load test subset.
4. Migration dry-run tren DB clone/staging.
5. Backup/rollback plan.
6. Monitoring dashboard san sang.
7. Release note + known issues.
8. Go/No-Go sign-off.

---

## 24. Smoke test sau deploy

Sau deploy backend, chay smoke test:

1. `GET /api/v1/health`.
2. Login admin test.
3. `GET /api/v1/auth/me`.
4. `GET /api/v1/dashboard/me`.
5. `GET /api/v1/hr/employees?page=1&per_page=5`.
6. `GET /api/v1/attendance/today` voi employee test.
7. `GET /api/v1/leave/balances/my` neu endpoint co.
8. `GET /api/v1/tasks/my-tasks`.
9. `GET /api/v1/notifications/unread-count`.
10. Tao va rollback/no-op mot action test neu moi truong cho phep.
11. Kiem tra audit log cho login/action quan trong.
12. Kiem tra log/metrics khong co loi bat thuong.

Production smoke khong duoc tao du lieu that neu khong co test tenant/test account rieng.

---

## 25. Module acceptance checklist

### 25.1 AUTH acceptance

- [ ] Login/logout/refresh/forgot/reset pass test pass.
- [ ] Session/token revoke hoat dong.
- [ ] Permission resolver dung voi multi-role.
- [ ] Data scope service dung voi Own/Team/Department/Company/System.
- [ ] Login log va security event duoc ghi.
- [ ] Rate limit login/reset pass hoat dong.

### 25.2 FOUNDATION acceptance

- [ ] Settings resolve system/company override dung.
- [ ] File private upload/list/download/link/unlink dung permission.
- [ ] File access log cho file nhay cam.
- [ ] Audit log ghi dung actor/action/entity/old/new.
- [ ] Sequence counter transaction-safe.
- [ ] Public holiday service dung cho ATT/LEAVE.

### 25.3 HR acceptance

- [ ] Employee CRUD theo permission/scope.
- [ ] Employee code auto-generate dung config.
- [ ] My profile chi xem cua minh.
- [ ] Profile change request chi apply sau approve.
- [ ] Contract/file/sensitive fields duoc guard.
- [ ] HR data cung cap dung cho ATT/LEAVE/TASK/DASH/NOTI.

### 25.4 ATT acceptance

- [ ] Today attendance dung shift/rule.
- [ ] Check-in/check-out idempotent.
- [ ] Leave approved full day chan attendance.
- [ ] Remote request/rule hoat dong theo config.
- [ ] Adjustment request/direct adjustment co audit/event.
- [ ] Attendance records list/export theo scope.

### 25.5 LEAVE acceptance

- [ ] Leave calculation dung full/half/hour/multiple days.
- [ ] Balance ledger khong bi update truc tiep bo qua transaction.
- [ ] Submit/approve/reject/cancel/revoke state machine dung.
- [ ] Manager/HR approval theo scope.
- [ ] Approved leave sync ATT.
- [ ] NOTI/DASH event/cache update dung.

### 25.6 TASK acceptance

- [ ] Project/member/task CRUD theo permission/scope/project role.
- [ ] Assign employee active va hop le.
- [ ] Status workflow dung.
- [ ] Comment/mention/file/checklist hoat dong.
- [ ] Activity log day du.
- [ ] NOTI/DASH event/cache update dung.

### 25.7 NOTI acceptance

- [ ] Consume event tao notification dung recipient.
- [ ] Dedupe/throttle event quan trong.
- [ ] Unread count/dropdown nhanh va dung user.
- [ ] Mark read/all read/hide/archive/delete soft dung scope.
- [ ] Template/payload an toan.
- [ ] Delivery log khong lo secret.

### 25.8 DASH acceptance

- [ ] Dashboard me tra dung dashboard type theo user.
- [ ] Widget permission/data scope dung.
- [ ] Cache key khong ro ri user/scope/company.
- [ ] Widget fallback khi module source loi.
- [ ] Cache TTL/invalidation dung khi event module nguon xay ra.

---

## 26. Rủi ro va huong xu ly

| Rui ro | Muc do | Huong xu ly |
| --- | --- | --- |
| Test chi pass happy path | Cao | Bat buoc permission/scope/error regression test |
| Mock qua nhieu nen khong bat loi transaction | Cao | Integration test dung DB that cho service quan trong |
| Dashboard cache ro ri data | Rat cao | Cache key gom company/user/scope, test cross-user/cross-company |
| Permission seed sai | Rat cao | Matrix test role-permission-data scope truoc release |
| Migration fail production | Rat cao | CI build DB tu trong, staging dry-run, backup/rollback plan |
| Query cham khi data tang | Cao | Benchmark volume MVP, EXPLAIN ANALYZE, index theo DB-09 |
| Notification spam | Trung binh | Dedupe key, throttle, event enable/disable, job idempotency |
| Audit log qua lon | Trung binh | Retention policy, partition/archive phase sau |
| File private bi truy cap trai phep | Rat cao | Download endpoint/signed URL always checks permission |
| Idempotency thieu voi action quan trong | Cao | Gate checklist cho mutation endpoints |
| Secret lo trong log/seed | Rat cao | Secret scan, log masking, env/secret manager |

---

## 27. Definition of Done cho BACKEND-13

Backend MVP chi duoc xem la san sang release khi:

1. Tat ca unit test quan trong pass.
2. Tat ca integration test core workflow pass.
3. API test pass voi response/error contract.
4. Permission + data scope test pass cho moi module.
5. Migration from empty DB pass.
6. Seed idempotency pass.
7. OpenAPI diff khong co breaking change chua approve.
8. Security checklist critical pass.
9. Performance smoke/load test dat target P95 co ban.
10. Query quan trong da kiem tra EXPLAIN ANALYZE.
11. Audit log va observability san sang.
12. Release smoke test script san sang.
13. Backup/rollback plan san sang.
14. Khong con release-blocking defect.

---

## 28. Thu tu trien khai de xuat

| Buoc | Noi dung | Ket qua |
| --- | --- | --- |
| 1 | Lap test infrastructure | DB/cache/file/queue test adapter |
| 2 | Viet unit test cho guard/policy/service core | Bao mat logic nen tang |
| 3 | Viet integration test DB/transaction | Chung minh data consistency |
| 4 | Viet API test contract | Chung minh HTTP/API dung chuan |
| 5 | Viet permission/data scope matrix | Chung minh khong ro ri data |
| 6 | Viet migration/seed test | Chung minh DB bootstrap duoc |
| 7 | Viet performance benchmark script | Chung minh query/API dat muc MVP |
| 8 | Thiet lap CI gate | Tu dong chan regression |
| 9 | Chay staging regression | Chuan bi release candidate |
| 10 | Chot Go/No-Go checklist | San sang deploy |

---

## 29. Phu luc A - Test matrix tong hop

| Module | Unit | Integration | API | Scope | Security | Performance |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Login/refresh |
| FOUNDATION | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Bat buoc | File/audit/settings |
| HR | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Employee list/search |
| ATT | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Today/records/check-in |
| LEAVE | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Pending/calendar/balance |
| TASK | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Bat buoc | My tasks/Kanban |
| NOTI | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Unread/dropdown |
| DASH | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Bat buoc | Dashboard/widget/cache |

---

## 30. Phu luc B - Go/No-Go checklist

### 30.1 Go neu tat ca dung

- [ ] Full regression pass.
- [ ] Critical security test pass.
- [ ] Migration dry-run pass.
- [ ] Seed idempotency pass.
- [ ] Performance P95 dat target MVP hoac co mitigation duoc approve.
- [ ] OpenAPI artifact da publish.
- [ ] Monitoring/alert da bat.
- [ ] Backup da xac nhan.
- [ ] Rollback plan da xac nhan.
- [ ] Release notes da san sang.

### 30.2 No-Go neu co bat ky muc nao

- [ ] Co loi cross-company data leak.
- [ ] Co loi data scope leak.
- [ ] Co loi token/session nghiem trong.
- [ ] Migration/seed fail.
- [ ] API critical 5xx chua ro nguyen nhan.
- [ ] Query critical timeout.
- [ ] Dashboard cache ro ri user/scope.
- [ ] File private truy cap trai phep.
- [ ] Secret/token/password xuat hien trong log/response.
- [ ] Khong co backup/rollback plan.

---

## 31. Ket luan

BACKEND-13 hoan thien lop kiem soat chat luong ky thuat cho backend MVP.

Tai lieu nay dam bao backend khong chi co day du API/module, ma con duoc nghiem thu theo ba tru cot:

1. **Testing**: logic dung, workflow dung, API contract dung, migration/seed dung.
2. **Security**: auth/RBAC/data scope/multi-tenant/file/private data duoc bao ve.
3. **Performance**: query/API/dashboard/notification/job dat muc on dinh cho MVP va co duong mo rong.

Sau BACKEND-13, du an co the chuyen sang:

```text
QA-01: Master Test Plan & Test Case Suite
DEVOPS-01: CI/CD, Deployment, Monitoring & Release Operation
SEC-01: Security Hardening & Penetration Test Preparation
PERF-01: Performance Benchmark Report
```
