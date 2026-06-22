> ✅ **ĐÍNH CHÍNH STACK (đã đồng bộ body 22/06):** Tài liệu này đã được dọn về stack CHỐT: **Vite + React 19 SPA + TanStack Router (KHÔNG Next.js)** · **Drizzle + drizzle-kit (KHÔNG Prisma)** · **Valkey** · **Vitest**. Nguồn chuẩn: [DECISIONS-02](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# IMPLEMENTATION-04: Sprint 1 Foundation, Environment & Core Infrastructure Execution Plan
# KẾ HOẠCH THỰC THI SPRINT 1 - NỀN TẢNG, MÔI TRƯỜNG & HẠ TẦNG LÕI

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-04 |
| Tên tài liệu | Sprint 1 Foundation, Environment & Core Infrastructure Execution Plan |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | MVP Version 1.0 |
| Sprint | Sprint 1 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-04, BACKEND-01 (stack đã khóa), DEVOPS-01 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả kế hoạch thực thi chi tiết cho **Sprint 1: Foundation, Environment & Core Infrastructure** của MVP.

Sprint 1 không tập trung xây đầy đủ nghiệp vụ HR, chấm công, nghỉ phép, task hoặc dashboard. Sprint này tập trung dựng **nền kỹ thuật có thể chạy, kiểm thử và mở rộng** cho toàn bộ các sprint sau.

Tài liệu này dùng để:

1. Chốt mục tiêu Sprint 1.
2. Chốt phạm vi việc cần làm và việc chưa làm trong Sprint 1.
3. Chia backlog Sprint 1 thành epic, story, task và acceptance criteria.
4. Chuẩn hóa môi trường local, development và cấu hình nền.
5. Triển khai skeleton backend, frontend, database, migration, seed và CI cơ bản.
6. Đảm bảo các sprint nghiệp vụ sau có nền ổn định để triển khai nhanh.
7. Làm checklist cho Product, Backend, Frontend, QA và DevOps nghiệm thu Sprint 1.

---

## 3. Vị trí Sprint 1 trong roadmap IMPLEMENTATION

Chuỗi IMPLEMENTATION đề xuất:

```text
IMPLEMENTATION-01: MVP Implementation Roadmap & Sprint Plan
IMPLEMENTATION-02: Detailed Product Backlog & Epic Breakdown
IMPLEMENTATION-03: Sprint 0 Execution Plan & Issue Board Setup
IMPLEMENTATION-04: Sprint 1 Foundation, Environment & Core Infrastructure Execution Plan
IMPLEMENTATION-05: Sprint 2 Auth & HR Core Execution Plan
IMPLEMENTATION-06: Sprint 3 Attendance & Leave Core Execution Plan
IMPLEMENTATION-07: Sprint 4 Task, Notification & Dashboard Execution Plan
IMPLEMENTATION-08: Sprint 5 Integration, QA Hardening & UAT Execution Plan
IMPLEMENTATION-09: Sprint 6 Stabilization, Release Candidate & Go-live Execution Plan
IMPLEMENTATION-10: Post-MVP Backlog & Phase 2 Planning
```

Sprint 1 là sprint đầu tiên bắt đầu tạo nền code và môi trường chạy thật sau khi Sprint 0 đã chốt issue board, workflow, team convention và sprint setup.

---

## 4. Mục tiêu Sprint 1

### 4.1 Mục tiêu tổng quát

Kết thúc Sprint 1, hệ thống phải có một nền tảng kỹ thuật tối thiểu nhưng ổn định để các sprint sau có thể triển khai nghiệp vụ trên cùng một chuẩn.

Kết quả mong muốn:

```text
Repository sẵn sàng
-> Local environment chạy được
-> Database migration/seed chạy được
-> Backend API shell chạy được
-> Auth/session/RBAC skeleton chạy được
-> Foundation service skeleton chạy được
-> Frontend app shell chạy được
-> API client/query layer cơ bản chạy được
-> CI quality gate cơ bản chạy được
-> QA smoke test pass
```

### 4.2 Mục tiêu nghiệp vụ gián tiếp

Sprint 1 cần chuẩn bị nền cho các nghiệp vụ MVP sau:

| Nghiệp vụ | Nền Sprint 1 cần chuẩn bị |
| --- | --- |
| Đăng nhập, phân quyền | Auth/session, permission seed, route/API guard skeleton |
| Nhân sự | Company, user, employee link chuẩn bị, file/audit/sequence foundation |
| Chấm công | Timezone, company setting, public holiday, audit, idempotency, API client |
| Nghỉ phép | Sequence, public holiday, notification event seed, audit, transaction pattern |
| Task | File foundation, user/employee actor, notification event seed, activity/audit pattern |
| Dashboard | Widget catalog seed, cache table/skeleton, permission-aware API pattern |
| Notification | Event/template seed, notification table/skeleton, unread pattern chuẩn bị |

### 4.3 Mục tiêu kỹ thuật

1. Tạo được project structure chuẩn cho backend và frontend.
2. Chạy được local stack bằng một lệnh hoặc một checklist rõ ràng.
3. Có database PostgreSQL local/development và migration runner.
4. Có seed nền: company, modules, permissions, roles, role-permissions, settings, sequence, notification events, dashboard widgets ở mức tối thiểu.
5. Có API health, auth bootstrap và API response/error format thống nhất.
6. Có frontend route shell gồm public route, protected route, Home Portal placeholder và Module Workspace placeholder.
7. Có API client chung, error mapper cơ bản và query provider.
8. Có logging, request id/correlation id và audit service skeleton.
9. Có CI chạy lint, typecheck, unit test tối thiểu và migration smoke test.
10. Có tài liệu setup/handoff để developer mới có thể chạy project.

---

## 5. Nguyên tắc triển khai Sprint 1

### 5.1 Làm nền trước, chưa mở rộng nghiệp vụ

Sprint 1 chỉ xây phần foundation cần thiết để sprint sau làm nhanh hơn. Không cố nhồi toàn bộ nghiệp vụ vào Sprint 1.

Đúng:

```text
Tạo API shell, guard, migration, seed, auth context, route metadata.
```

Không đúng:

```text
Xây đầy đủ bảng công, duyệt nghỉ, Kanban, dashboard report phức tạp ngay trong Sprint 1.
```

### 5.2 Backend là nguồn kiểm soát quyền cuối cùng

Frontend có thể ẩn/hiện app, menu, route, button và field theo permission để cải thiện UX. Tuy nhiên API backend vẫn phải kiểm tra authentication, permission, data scope và business rule.

### 5.3 Multi-tenant ready từ đầu

Dù MVP có thể chỉ chạy cho một công ty, database, API và seed vẫn phải thiết kế theo `company_id` và auth context. Frontend không tự gửi `company_id` trong nghiệp vụ thông thường nếu backend có thể resolve từ token/session.

### 5.4 Không hard-code theo role name

Role là nhóm quyền seed mặc định. Hệ thống cần kiểm tra theo permission và data scope.

Không nên:

```text
if role = HR then allow
```

Nên:

```text
check permission HR.EMPLOYEE.VIEW + scope Company/Department/Team/Own
```

### 5.5 Seed phải idempotent

Seed có thể chạy nhiều lần mà không tạo dữ liệu trùng. Mỗi seed item cần business key ổn định, checksum hoặc version nếu có thể.

### 5.6 File private là mặc định

File trong hệ thống doanh nghiệp thường là dữ liệu nội bộ hoặc nhạy cảm. Sprint 1 chỉ cần skeleton file service, nhưng nguyên tắc mặc định là private, không expose storage path hoặc public URL cố định.

### 5.7 Audit log chuẩn từ đầu

Các thao tác quan trọng như login, thay đổi setting, tạo user, cập nhật role-permission, upload/link file, chạy seed quan trọng cần có cơ chế ghi audit hoặc security event ngay từ nền.

---

## 6. Phạm vi Sprint 1

### 6.1 Bao gồm trong Sprint 1

| Nhóm | Nội dung |
| --- | --- |
| Repository | Cấu trúc repo, branch convention, scripts, env example |
| Local environment | Docker Compose hoặc hướng dẫn chạy local stack: app, API, DB, storage giả lập nếu cần |
| Database | PostgreSQL, extension, migration runner, schema foundation/auth tối thiểu |
| Seed | Company, modules, settings, permissions, roles, role-permissions, sequence, events/widgets tối thiểu |
| Backend shell | App bootstrap, config module, health check, error handler, response transformer |
| Auth skeleton | Login/logout/refresh/me skeleton hoặc mock-real hybrid, password hash, session/token strategy nền |
| RBAC skeleton | Permission resolver, data scope resolver, guard decorator/middleware skeleton |
| Foundation service | Audit service, setting service, sequence service, file metadata service skeleton |
| Frontend shell | Vite + React 19 SPA shell (TanStack Router), public/protected route, Home Portal placeholder, Module Workspace placeholder |
| Frontend permission | Auth context, permission checker, route guard, app/sidebar registry skeleton |
| API client | Client wrapper, response/error type, token injection placeholder, query provider, mock support |
| CI | Lint, typecheck, unit test, build, migration smoke test ở mức cơ bản |
| QA | Smoke test checklist, test data, environment verification |
| Documentation | README setup, env guide, migration/seed guide, sprint handoff |

### 6.2 Không bao gồm trong Sprint 1

| Nhóm | Lý do chuyển sang sprint sau |
| --- | --- |
| HR full CRUD | Sprint sau tập trung module nghiệp vụ |
| Chấm công check-in/check-out đầy đủ | Cần foundation + HR/Auth ổn định trước |
| Nghỉ phép tạo/duyệt đầy đủ | Cần ATT/HR/Auth và transaction pattern rõ |
| Task/Kanban đầy đủ | Cần app shell, API client, permission và file foundation trước |
| Dashboard widget dữ liệu thật | Sprint 1 chỉ seed catalog/cache skeleton |
| Notification realtime/WebSocket | Sprint 1 chỉ tạo event/template/message skeleton nếu cần |
| Payroll, Recruit, Asset, Room, Chat, Social, AI | Không thuộc MVP core sprint này |
| Production hardening đầy đủ | Chuyển sang DevOps/QA/UAT/Hardening sprint |

---

## 7. Kết quả đầu ra bắt buộc của Sprint 1

| Mã | Deliverable | Mô tả | Bắt buộc |
| --- | --- | --- | --- |
| IMP04-DEL-001 | Repo structure | Backend/frontend/shared/scripts/docs có cấu trúc rõ | Có |
| IMP04-DEL-002 | Local setup | Developer chạy được local theo README | Có |
| IMP04-DEL-003 | Env example | `.env.example` cho backend/frontend/database | Có |
| IMP04-DEL-004 | Database migration runner | Chạy migration từ DB trống | Có |
| IMP04-DEL-005 | Foundation schema | Companies, modules, settings, audit, files, sequence, seed tracking tối thiểu | Có |
| IMP04-DEL-006 | Auth/RBAC schema | Users, roles, permissions, user_roles, role_permissions, sessions/logs tối thiểu | Có |
| IMP04-DEL-007 | Seed baseline | Module, permission, role, setting, company, admin bootstrap tối thiểu | Có |
| IMP04-DEL-008 | Backend API shell | Health, response/error, request id, auth middleware skeleton | Có |
| IMP04-DEL-009 | Frontend app shell | Login placeholder, protected layout, Home Portal placeholder, Module Workspace placeholder | Có |
| IMP04-DEL-010 | API client shell | API client, error mapper, query provider, service convention | Có |
| IMP04-DEL-011 | Permission framework skeleton | Permission checker, route guard, action guard skeleton | Có |
| IMP04-DEL-012 | CI quality gate | Lint/typecheck/test/build/migration check chạy được | Có |
| IMP04-DEL-013 | Smoke test report | QA hoặc dev verify local/dev environment | Có |
| IMP04-DEL-014 | Sprint handoff note | Ghi rõ thứ đã xong, chưa xong, blocker, input cho Sprint 2 | Có |

---

## 8. Sprint assumptions

| Nhóm | Giả định |
| --- | --- |
| Sprint length | 2 tuần (10 ngày làm việc) là chuẩn cho đủ deliverable; biến thể 1 tuần (5 ngày) chỉ dùng cho skeleton-only/giảm scope |
| Team | Backend, Frontend, QA, DevOps, Product/BA tham gia review |
| Database | PostgreSQL là database chính |
| Frontend | Vite + React 19 SPA + TanStack Router/TypeScript theo stack đã chốt trong FRONTEND-01 |
| Backend | Stack đã được **khóa cứng trong BACKEND-01**: NestJS + TypeScript, Drizzle + drizzle-kit, PostgreSQL + UUID, Valkey cache, test bằng Vitest + Supertest, API base path `/api/v1`. Sprint 1 **CONFIRM** (không quyết định lại) stack này. |

> **Lưu ý stack (đã khóa, không phải quyết định trong Sprint 1):** Backend stack đã được chốt trong **BACKEND-01** — NestJS + TypeScript, Drizzle + drizzle-kit, PostgreSQL với khóa chính UUID, Valkey làm cache/session, test bằng Vitest + Supertest, API base path `/api/v1`. Sprint 1 chỉ có nhiệm vụ **xác nhận (CONFIRM)** và hiện thực hóa stack này, không tranh luận lại lựa chọn framework/ORM/test runner. Mọi chỗ trong tài liệu này còn ghi "nếu đã có", "mono hoặc multi", "chọn migration tool" được hiểu theo nghĩa hiện thực hóa quyết định đã chốt, không phải mở lại quyết định kiến trúc.
| Auth | Access token + refresh token là cơ chế xác thực MVP |
| Deployment | Sprint 1 tối thiểu có local và development; staging có thể chuẩn bị skeleton |
| Data thật | Không import dữ liệu thật trong Sprint 1 |
| Secret | Không hard-code secret trong source code hoặc seed |

---

## 9. Timeline Sprint 1 đề xuất

> Timeline tính theo tuần làm việc 5 ngày. **Phương án 2 tuần (10 ngày làm việc) là bắt buộc** cho toàn bộ deliverable Sprint 1 (91 story point — xem §35 Capacity & Estimation). Phương án 1 tuần chỉ là biến thể **skeleton-only / giảm scope**, không đủ cho toàn bộ deliverable bắt buộc.

### 9.1 Phương án sprint 1 tuần (skeleton-only / reduced-scope)

> **Cảnh báo:** Tuần làm việc là 5 ngày, không phải 7 ngày. Phương án 1 tuần (5 ngày làm việc) **không đủ** để hoàn thành toàn bộ deliverable bắt buộc của Sprint 1. Chỉ dùng phương án này khi team chấp nhận **giảm scope xuống skeleton tối thiểu** (bỏ/hoãn FE Core 093-096 và một phần foundation service), phần còn lại chuyển carry-over sang Sprint 2. Để đạt đủ deliverable, dùng **phương án 2 tuần ở §9.2**.

| Ngày (work day) | Trọng tâm | Kết quả cuối ngày |
| --- | --- | --- |
| Day 1 | Repo, environment, project bootstrap | Repo chạy được skeleton backend/frontend, env example có bản đầu |
| Day 2 | Database migration foundation + AUTH/RBAC schema | PostgreSQL chạy local, migration runner chạy được M00-M03 |
| Day 3 | Seed baseline + backend API/auth skeleton | Seed cơ bản, admin bootstrap, health/response/error, auth/me/login/logout skeleton |
| Day 4 | Frontend app shell + API client (rút gọn) | Login placeholder, protected route, Home Portal skeleton, API client cơ bản |
| Day 5 | CI + QA smoke + review/handoff | CI chạy, smoke test local pass, demo và handoff với carry-over rõ |

### 9.2 Phương án sprint 2 tuần

| Giai đoạn | Ngày | Trọng tâm |
| --- | --- | --- |
| Setup | Day 1-2 | Repo, scripts, env, local stack, Docker/dev guide |
| Database | Day 3-4 | Migration runner, Foundation schema, AUTH/RBAC schema |
| Seed | Day 5 | Seed baseline, admin bootstrap, seed verification |
| Backend core | Day 6-7 | API shell, config, logger, error handler, auth/session skeleton |
| Frontend core | Day 8-9 | App shell, protected route, permission checker, API client |
| Integration | Day 10 | FE-BE auth/me integration, health dashboard/dev smoke |
| CI/QA | Day 11-12 | CI quality gate, unit/smoke tests, migration smoke |
| Hardening | Day 13 | Fix defects, cleanup docs, remove temporary hacks |
| Review | Day 14 | Demo, sprint review, Sprint 2 readiness check |

---

## 10. Sprint 1 backlog tổng quan

| Epic | Tên epic | Owner chính | Mức ưu tiên |
| --- | --- | --- | --- |
| IMP04-E01 | Repository & Project Bootstrap | Tech Lead / DevOps | P0 |
| IMP04-E02 | Local/Development Environment | DevOps / Backend | P0 |
| IMP04-E03 | Database Migration Foundation | Backend / Database | P0 |
| IMP04-E04 | Initial Seed & Bootstrap Admin | Backend | P0 |
| IMP04-E05 | Backend API Core Infrastructure | Backend | P0 |
| IMP04-E06 | Auth, Session & RBAC Skeleton | Backend / Frontend | P0 |
| IMP04-E07 | Foundation Shared Services Skeleton | Backend | P0 |
| IMP04-E08 | Frontend App Runtime & Layout Shell | Frontend | P0 |
| IMP04-E09 | Frontend Permission Framework & API Client | Frontend | P0 |
| IMP04-E10 | CI Quality Gate & Code Standards | DevOps / Tech Lead | P0 |
| IMP04-E11 | Smoke Test & QA Foundation | QA | P1 |
| IMP04-E12 | Documentation & Handoff | All | P1 |

---

## 11. Epic IMP04-E01 - Repository & Project Bootstrap

### 11.1 Mục tiêu

Thiết lập cấu trúc repository và project skeleton đủ rõ để team phát triển song song backend/frontend mà không xung đột quy ước.

### 11.2 User stories

| Story ID | User story | Priority |
| --- | --- | --- |
| IMP04-E01-S01 | Là developer, tôi muốn clone repo và chạy lệnh setup cơ bản để bắt đầu phát triển nhanh. | P0 |
| IMP04-E01-S02 | Là tech lead, tôi muốn repo có cấu trúc thư mục chuẩn để dễ review và mở rộng module. | P0 |
| IMP04-E01-S03 | Là QA/DevOps, tôi muốn có scripts chuẩn để chạy build/test/migration nhất quán. | P0 |

### 11.3 Task checklist

- [ ] Tạo hoặc chuẩn hóa repo chính.
- [ ] Chốt mô hình repo: mono-repo hoặc multi-repo.
- [ ] Tạo thư mục backend.
- [ ] Tạo thư mục frontend.
- [ ] Tạo thư mục docs.
- [ ] Tạo thư mục scripts.
- [ ] Tạo thư mục migrations/seeds nếu thuộc backend repo.
- [ ] Tạo `.gitignore` chuẩn.
- [ ] Tạo `.editorconfig`.
- [ ] Tạo formatter/linter config.
- [ ] Tạo README root.
- [ ] Tạo `CONTRIBUTING.md` nếu cần.
- [ ] Tạo convention đặt branch, commit, PR title.
- [ ] Tạo scripts chuẩn: install, dev, build, test, lint, typecheck, migrate, seed.

### 11.4 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E01-AC-001 | Developer mới có thể đọc README và biết cách chạy project local. |
| IMP04-E01-AC-002 | Repo có phân tách rõ backend, frontend, docs, scripts. |
| IMP04-E01-AC-003 | Có script hoặc hướng dẫn chạy lint/test/build tối thiểu. |
| IMP04-E01-AC-004 | Không có secret thật trong repo. |
| IMP04-E01-AC-005 | PR đầu tiên qua được CI tối thiểu hoặc local quality check. |

---

## 12. Epic IMP04-E02 - Local/Development Environment

### 12.1 Mục tiêu

Dựng môi trường local và development đủ để backend/frontend/database chạy cùng nhau.

### 12.2 Phạm vi môi trường

| Environment | Mục tiêu Sprint 1 |
| --- | --- |
| Local | Developer tự chạy được toàn stack |
| Development | Team có môi trường chung để test tích hợp sơ bộ |
| Staging | Chỉ chuẩn bị cấu hình/placeholder nếu chưa cần deploy |
| Production | Không triển khai trong Sprint 1 |

### 12.3 Thành phần local stack

| Thành phần | Bắt buộc | Ghi chú |
| --- | --- | --- |
| PostgreSQL | Có | Database chính |
| Backend API | Có | Chạy local port cố định |
| Frontend web | Có | Chạy local port cố định |
| Object storage local | Có thể | MinIO/local folder nếu file service cần test |
| Mail/mock mail | Có thể | Chỉ cần nếu forgot/reset password test thật |
| Valkey/cache | Có thể | Chỉ thêm nếu auth/session/cache cần ngay |

### 12.4 Env files đề xuất

```text
.env.example
.env.local
.env.development
.env.staging
.env.production.example
```

### 12.5 Biến môi trường backend tối thiểu

```env
APP_ENV=local
APP_PORT=3000
APP_NAME=Enterprise Management System
API_BASE_PATH=/api/v1
DATABASE_URL=postgresql://ems_user:ems_password@localhost:5432/ems_local
JWT_ACCESS_SECRET=change_me_access_secret
JWT_REFRESH_SECRET=change_me_refresh_secret
ACCESS_TOKEN_TTL_MINUTES=30
REFRESH_TOKEN_TTL_DAYS=30
DEFAULT_TIMEZONE=Asia/Ho_Chi_Minh
DEFAULT_LOCALE=vi-VN
FILE_STORAGE_PROVIDER=local
FILE_STORAGE_PRIVATE_PATH=./storage/private
LOG_LEVEL=debug
```

### 12.6 Biến môi trường frontend tối thiểu

```env
VITE_APP_NAME="Enterprise Management System"
VITE_APP_ENV="local"
VITE_API_BASE_URL="http://localhost:3000/api/v1"
VITE_INTERNAL_BUILD_VERSION="0.1.0"
VITE_ENABLE_MOCK_API="false"
VITE_ENABLE_DEBUG_PANEL="true"
```

### 12.7 Task checklist

- [ ] Tạo Docker Compose cho PostgreSQL.
- [ ] Tạo database user/password/database local.
- [ ] Tạo file `.env.example` cho backend.
- [ ] Tạo file `.env.example` cho frontend.
- [ ] Tạo script `dev` chạy backend.
- [ ] Tạo script `dev` chạy frontend.
- [ ] Tạo script `db:up`, `db:down`, `db:reset` nếu có.
- [ ] Tạo health check cho backend.
- [ ] Cấu hình CORS local.
- [ ] Cấu hình timezone mặc định `Asia/Ho_Chi_Minh`.
- [ ] Ghi README hướng dẫn setup local từ DB trống.

### 12.8 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E02-AC-001 | Developer chạy được database local. |
| IMP04-E02-AC-002 | Backend gọi được database local. |
| IMP04-E02-AC-003 | Frontend gọi được backend local qua base URL. |
| IMP04-E02-AC-004 | Health check backend trả trạng thái OK. |
| IMP04-E02-AC-005 | Không có secret production trong env example. |

---

## 13. Epic IMP04-E03 - Database Migration Foundation

### 13.1 Mục tiêu

Tạo migration runner và schema nền theo thứ tự đúng để database trống có thể dựng lên trạng thái MVP foundation.

### 13.2 Migration scope Sprint 1

Sprint 1 tập trung các nhóm migration sau:

| Nhóm | Nội dung | Mức độ Sprint 1 |
| --- | --- | --- |
| M00 | PostgreSQL extensions | Bắt buộc |
| M01 | Foundation base tables | Bắt buộc |
| M02 | Foundation operation tables | Bắt buộc |
| M03 | AUTH/RBAC tables | Bắt buộc |
| M04 | HR minimal references | Nên có ở mức tối thiểu nếu cần user-employee mapping |
| M05 | Cross-module FK subset an toàn | Bắt buộc ở mức subset an toàn (foundation/auth/HR minimal) |
| M06 | Foundation/auth indexes | Bắt buộc cho unique constraint và query nền |
| M07+ | ATT/LEAVE/TASK/NOTI/DASH full schema | Có thể chỉ tạo skeleton hoặc chuyển Sprint sau |

### 13.3 Migration order Sprint 1

```text
M00 enable extensions
  -> M01 create foundation base
  -> M02 create foundation operation
  -> M03 create auth/rbac
  -> M04 create minimal HR reference if required
  -> M05 add safe cross-module FK subset
  -> M06 add foundation/auth indexes
```

### 13.4 Bảng foundation bắt buộc

| Bảng | Mục đích |
| --- | --- |
| `companies` | Tenant/company chính |
| `modules` | Danh mục module |
| `system_settings` | Cấu hình global |
| `company_settings` | Cấu hình theo công ty |
| `audit_logs` | Nhật ký thao tác quan trọng |
| `files` | Metadata file |
| `file_links` | Liên kết file với entity nghiệp vụ |
| `file_access_logs` | Log truy cập file nhạy cảm, có thể tạo ngay |
| `sequence_counters` | Bộ đếm sinh mã tự động |
| `public_holidays` | Ngày nghỉ lễ/ngày không làm việc |
| `data_retention_policies` | Chính sách retention cơ bản |
| `seed_batches` | Theo dõi batch seed |
| `seed_items` | Theo dõi item seed |

### 13.5 Bảng AUTH/RBAC bắt buộc

| Bảng | Mục đích |
| --- | --- |
| `users` | Tài khoản đăng nhập |
| `roles` | Vai trò |
| `permissions` | Danh mục quyền |
| `user_roles` | Gán role cho user |
| `role_permissions` | Gán permission + data scope cho role |
| `user_sessions` | Phiên đăng nhập/refresh token hash |
| `password_reset_tokens` | Token reset password hash |
| `login_logs` | Nhật ký đăng nhập |
| `user_security_events` | Sự kiện bảo mật tài khoản |

### 13.6 Constraint/index tối thiểu

| Nhóm | Constraint/index |
| --- | --- |
| Company | Unique active `company_code` |
| Module | Unique active `module_code` |
| Settings | Unique active setting key theo system/company |
| User | Unique active normalized email theo company |
| Role | Unique role code theo company/global |
| Permission | Unique permission code |
| Role permission | Unique role + permission + scope nếu cần |
| Sequence | Unique company + sequence key |
| Audit | Index company + module + created_at |
| Session | Index user + status + expires_at |

### 13.7 Task checklist

- [ ] Xác nhận migration tool theo BACKEND-01 (Drizzle + drizzle-kit).
- [ ] Tạo migration folder convention.
- [ ] Tạo migration table/history nếu tool cần.
- [ ] Tạo migration M00 enable extensions.
- [ ] Tạo migration M01 foundation base.
- [ ] Tạo migration M02 foundation operation.
- [ ] Tạo migration M03 AUTH/RBAC.
- [ ] Tạo migration cross-module FK subset an toàn.
- [ ] Tạo migration index foundation/auth.
- [ ] Tạo rollback strategy cho local/dev.
- [ ] Tạo script reset DB local.
- [ ] Tạo migration smoke test.

### 13.8 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E03-AC-001 | Database trống chạy migration thành công. |
| IMP04-E03-AC-002 | Migration chạy lại không phá database nếu theo đúng quy trình. |
| IMP04-E03-AC-003 | Có bảng foundation và auth/rbac tối thiểu. |
| IMP04-E03-AC-004 | Có index/constraint quan trọng cho unique và query nền. |
| IMP04-E03-AC-005 | Migration local và development cùng một kết quả schema. |

---

## 14. Epic IMP04-E04 - Initial Seed & Bootstrap Admin

### 14.1 Mục tiêu

Tạo dữ liệu nền để hệ thống có thể đăng nhập, kiểm tra quyền và hiển thị app/module sau khi migration chạy xong.

### 14.2 Seed layers Sprint 1

| Layer | Nội dung | Bắt buộc |
| --- | --- | --- |
| S00 System seed | Modules, system settings, permissions | Có |
| S01 Tenant seed | Default company, company settings, sequence counters | Có |
| S02 RBAC seed | Roles, role permissions, bootstrap admin | Có |
| S03 HR minimal seed | Job levels/contract types/employee code config nếu cần | Nên có |
| S07 NOTI seed | Notification events/templates tối thiểu | Nên có |
| S08 DASH seed | Dashboard widget catalog/config tối thiểu | Nên có |
| S09 Dev-only seed | Sample user/employee/tasks | Chỉ local/dev, không production |

### 14.3 Module seed MVP

| Module code | Tên module | Active Sprint 1 |
| --- | --- | --- |
| AUTH | Tài khoản & phân quyền | true |
| HR | Quản lý nhân sự | true |
| ATT | Chấm công | true |
| LEAVE | Nghỉ phép | true |
| TASK | Công việc & Dự án | true |
| DASH | Dashboard | true |
| NOTI | Thông báo hệ thống | true |
| PAYROLL | Tiền lương | false |
| RECRUIT | Tuyển dụng | false |
| ASSET | Tài sản | false |
| ROOM | Phòng họp | false |
| CHAT | Chat nội bộ | false |
| SOCIAL | Mạng xã hội nội bộ | false |
| MOBILE | Mobile app | false |
| AI | AI & tích hợp | false |

### 14.4 Role seed tối thiểu

| Role code | Mục đích |
| --- | --- |
| SUPER_ADMIN | Quản trị toàn hệ thống |
| COMPANY_ADMIN | Quản trị công ty |
| HR | Quản lý nhân sự |
| MANAGER | Quản lý team/phòng ban |
| EMPLOYEE | Nhân viên sử dụng hằng ngày |
| PROJECT_MANAGER | Quản lý dự án/task nếu cần |

### 14.5 Permission seed nhóm nền

| Nhóm | Ví dụ permission |
| --- | --- |
| AUTH | `AUTH.USER.VIEW`, `AUTH.USER.CREATE`, `AUTH.ROLE.VIEW`, `AUTH.PERMISSION.VIEW` |
| HR | `HR.EMPLOYEE.VIEW`, `HR.EMPLOYEE.CREATE`, `HR.PROFILE_CHANGE.APPROVE` |
| ATT | `ATT.ATTENDANCE.VIEW_OWN`, `ATT.ATTENDANCE.CHECK_IN`, `ATT.ADJUSTMENT.APPROVE` |
| LEAVE | `LEAVE.REQUEST.CREATE`, `LEAVE.REQUEST.APPROVE`, `LEAVE.BALANCE.VIEW_OWN` |
| TASK | `TASK.TASK.VIEW`, `TASK.TASK.CREATE`, `TASK.TASK.UPDATE_STATUS` |
| DASH | `DASH.DASHBOARD.VIEW`, `DASH.CONFIG.UPDATE` |
| NOTI | `NOTI.NOTIFICATION.READ`, `NOTI.TEMPLATE.UPDATE` |
| FOUNDATION | `FOUNDATION.SETTING.VIEW`, `FOUNDATION.AUDIT_LOG.VIEW`, `FOUNDATION.FILE.READ` |

### 14.6 Bootstrap admin

Sprint 1 cần có một trong hai cách bootstrap admin:

| Cách | Mô tả | Khuyến nghị |
| --- | --- | --- |
| CLI command | Tạo admin từ terminal bằng env input | Nên dùng |
| Seed dev-only | Tạo admin mặc định local/dev | Chỉ local/dev |
| Manual SQL | Insert thủ công | Không khuyến nghị |
| Admin invite flow | Gửi email invite | Phase sau nếu cần |

Yêu cầu bảo mật:

1. Không hard-code mật khẩu admin production.
2. Mật khẩu phải hash.
3. Bootstrap admin phải ghi security event hoặc seed item.
4. Chỉ chạy bootstrap nếu chưa có admin hợp lệ hoặc có flag rõ.

### 14.7 Task checklist

- [ ] Tạo seed runner.
- [ ] Tạo seed tracking bằng `seed_batches`, `seed_items`.
- [ ] Seed module catalog.
- [ ] Seed system settings.
- [ ] Seed default company.
- [ ] Seed company settings.
- [ ] Seed permission catalog.
- [ ] Seed default roles.
- [ ] Seed role-permission matrix.
- [ ] Seed sequence counters.
- [ ] Seed notification events/templates tối thiểu.
- [ ] Seed dashboard widgets/configs tối thiểu.
- [ ] Tạo bootstrap admin CLI hoặc script.
- [ ] Viết verification query/check.

### 14.8 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E04-AC-001 | Seed chạy được sau migration từ DB trống. |
| IMP04-E04-AC-002 | Seed chạy lại không tạo trùng dữ liệu. |
| IMP04-E04-AC-003 | Có company mặc định hoặc tenant bootstrap rõ. |
| IMP04-E04-AC-004 | Có user admin đăng nhập được ở local/dev. |
| IMP04-E04-AC-005 | Có role-permission matrix tối thiểu để frontend/backend test guard. |

---

## 15. Epic IMP04-E05 - Backend API Core Infrastructure

### 15.1 Mục tiêu

Tạo backend API shell theo chuẩn chung để các module sau chỉ cần thêm controller/service nghiệp vụ mà không phải tự xử lý lại auth, response, error, logging, audit và config.

### 15.2 Thành phần backend core

| Thành phần | Mục đích |
| --- | --- |
| App bootstrap | Khởi động API server |
| Config service | Đọc env, validate config |
| Database connection | Kết nối DB, transaction support |
| Health endpoint | Kiểm tra trạng thái app/DB |
| Response transformer | Chuẩn response thành công |
| Exception handler | Chuẩn response lỗi |
| Request id middleware | Gắn request_id/correlation_id |
| Logger | Log request, error, security event |
| Auth middleware/guard | Resolve user/session |
| Permission guard | Kiểm tra permission/data scope skeleton |
| Audit service | Ghi audit log append-only skeleton |
| Event publisher skeleton | Chuẩn bị notification/dashboard invalidation |
| OpenAPI skeleton | Chuẩn bị Swagger/API docs nếu dùng |

### 15.3 API endpoint Sprint 1

| Method | Endpoint | Mục đích | Auth |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | Health check public | Không |
| GET | `/api/v1/health/db` | Health check DB | Có thể giới hạn dev/internal |
| POST | `/api/v1/auth/login` | Login skeleton/real basic | Không |
| POST | `/api/v1/auth/refresh-token` | Refresh token skeleton/real basic | Không hoặc cookie |
| POST | `/api/v1/auth/logout` | Logout current session | Có |
| GET | `/api/v1/auth/me` | Lấy current user/session/permission/module access | Có |
| GET | `/api/v1/foundation/modules/my-apps` | App registry theo quyền, có thể mock-real hybrid | Có |
| GET | `/api/v1/foundation/settings/public` | Public settings an toàn cho frontend | Có hoặc public tùy policy |

### 15.4 Response format bắt buộc

Success object:

```json
{
  "success": true,
  "message": "Thao tác thành công",
  "data": {},
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-21T00:00:00+07:00"
  }
}
```

Error object:

```json
{
  "success": false,
  "message": "Bạn không có quyền thực hiện thao tác này",
  "error": {
    "code": "AUTH-ERR-FORBIDDEN",
    "type": "ForbiddenError",
    "details": null
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-21T00:00:00+07:00"
  }
}
```

### 15.5 Task checklist

- [ ] Tạo backend app bootstrap.
- [ ] Tạo config validation.
- [ ] Tạo database connection.
- [ ] Tạo health endpoints.
- [ ] Tạo global response wrapper.
- [ ] Tạo global exception handler.
- [ ] Tạo request id/correlation id middleware.
- [ ] Tạo logger base.
- [ ] Tạo module boundary convention.
- [ ] Tạo transaction helper/unit of work nếu stack hỗ trợ.
- [ ] Tạo API documentation skeleton.
- [ ] Tạo common error code convention.
- [ ] Tạo common pagination type.
- [ ] Tạo common idempotency key handling skeleton.

### 15.6 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E05-AC-001 | API server chạy local. |
| IMP04-E05-AC-002 | Health endpoint trả response chuẩn. |
| IMP04-E05-AC-003 | API lỗi trả error format chuẩn. |
| IMP04-E05-AC-004 | Request có request_id trong response/log. |
| IMP04-E05-AC-005 | Backend có module skeleton cho auth/foundation. |

---

## 16. Epic IMP04-E06 - Auth, Session & RBAC Skeleton

### 16.1 Mục tiêu

Triển khai nền xác thực và phân quyền tối thiểu để frontend/backend có thể test luồng protected route, app visibility và permission guard.

### 16.2 Sprint 1 auth scope

| Chức năng | Mức Sprint 1 |
| --- | --- |
| Login bằng email/password | Basic real hoặc mock-real hybrid |
| Password hash | Bắt buộc nếu login real |
| Access token | Bắt buộc nếu login real |
| Refresh token | Nên có skeleton, có thể basic |
| Logout | Basic session revoke/clear |
| Auth me | Bắt buộc |
| Permission resolver | Bắt buộc |
| Data scope resolver | Bắt buộc ở mức role_permission |
| Account lock/inactive | Skeleton validation |
| Forgot/reset password | Có thể placeholder API nếu chưa làm full |
| MFA/SSO | Không làm Sprint 1 |

### 16.3 Auth me response tối thiểu

```json
{
  "user": {
    "id": "uuid",
    "email": "admin@example.com",
    "display_name": "Admin",
    "status": "active",
    "company_id": "uuid",
    "employee_id": null,
    "roles": [
      { "id": "uuid", "code": "COMPANY_ADMIN", "name": "Admin công ty" }
    ],
    "permissions": [
      { "permission": "DASH.DASHBOARD.VIEW", "scopes": ["Company"] }
    ]
  },
  "company": {
    "id": "uuid",
    "name": "Default Company",
    "code": "DEFAULT",
    "status": "active"
  },
  "employee": null,
  "modules": [
    { "module_code": "DASH", "status": "active" },
    { "module_code": "HR", "status": "active" }
  ],
  "settings": {
    "locale": "vi-VN",
    "timezone": "Asia/Ho_Chi_Minh"
  }
}
```

### 16.4 Permission guard behavior

| Trường hợp | Kết quả API |
| --- | --- |
| Chưa đăng nhập | 401 |
| Token sai/hết hạn | 401 |
| User locked/inactive | 403 |
| Company inactive/suspended | 403 |
| Thiếu permission | 403 |
| Có permission nhưng sai scope | 403 hoặc empty theo endpoint |
| Có permission và scope hợp lệ | Cho qua |

### 16.5 Task checklist

- [ ] Tạo password hash utility.
- [ ] Tạo login service.
- [ ] Tạo access token strategy.
- [ ] Tạo refresh token/session strategy skeleton.
- [ ] Tạo logout service.
- [ ] Tạo `/auth/me`.
- [ ] Resolve roles của user.
- [ ] Resolve permissions + scopes từ role_permissions.
- [ ] Resolve company context.
- [ ] Resolve module access.
- [ ] Tạo auth guard middleware.
- [ ] Tạo permission guard decorator/middleware.
- [ ] Tạo unit test permission resolver.
- [ ] Tạo login/security event log.

### 16.6 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E06-AC-001 | Admin bootstrap có thể login ở local/dev. |
| IMP04-E06-AC-002 | `/auth/me` trả user, company, roles, permissions, modules. |
| IMP04-E06-AC-003 | API protected không có token trả 401. |
| IMP04-E06-AC-004 | Permission guard có thể chặn request thiếu quyền. |
| IMP04-E06-AC-005 | Login/logout/security event được log ở mức tối thiểu. |

---

## 17. Epic IMP04-E07 - Foundation Shared Services Skeleton

### 17.1 Mục tiêu

Tạo các service dùng chung để module nghiệp vụ sau dùng lại thay vì tự code riêng.

### 17.2 Shared services Sprint 1

| Service | Mục đích Sprint 1 |
| --- | --- |
| AuditService | Ghi audit log append-only |
| SettingService | Đọc system/company setting theo precedence |
| SequenceService | Sinh mã tự động bằng transaction/row lock skeleton |
| FileService | Lưu metadata file và link entity skeleton |
| ModuleService | Đọc module catalog/app access |
| SeedService | Ghi nhận seed batch/item |
| PublicHolidayService | Query holiday cơ bản theo company/global |
| EventPublisher | Publish internal event skeleton cho NOTI/DASH sau này |

### 17.3 Audit service interface đề xuất

```ts
interface AuditLogInput {
  companyId?: string | null;
  actorUserId?: string | null;
  moduleCode: string;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  requestId?: string;
}
```

### 17.4 Sequence service rule

Không sinh mã bằng `MAX(code) + 1`. Sequence phải dùng row lock hoặc cơ chế atomic tương đương.

Pattern:

```text
Begin transaction
-> SELECT sequence_counters FOR UPDATE
-> current_value + step
-> format code
-> update current_value
-> commit
```

### 17.5 File service rule

Sprint 1 có thể chỉ lưu metadata, chưa cần upload UI hoàn chỉnh. Tuy nhiên cần chuẩn bị:

1. `files.visibility = Private` mặc định.
2. Không trả storage path trực tiếp ra frontend.
3. `file_links` phải có `module_code`, `entity_type`, `entity_id`.
4. Download thật có thể chuyển sang sprint sau nếu chưa cần.

### 17.6 Task checklist

- [ ] Tạo AuditService skeleton.
- [ ] Tạo SettingService skeleton.
- [ ] Tạo SequenceService skeleton.
- [ ] Tạo FileService metadata skeleton.
- [ ] Tạo ModuleService skeleton.
- [ ] Tạo SeedService helper.
- [ ] Tạo PublicHolidayService query cơ bản.
- [ ] Tạo EventPublisher interface.
- [ ] Tạo unit test cho setting precedence.
- [ ] Tạo unit test cho sequence lock logic nếu có thể.

### 17.7 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E07-AC-001 | AuditService ghi được log mẫu. |
| IMP04-E07-AC-002 | SettingService đọc được company override và system fallback. |
| IMP04-E07-AC-003 | SequenceService sinh được code không trùng trong test cơ bản. |
| IMP04-E07-AC-004 | FileService không expose storage path private. |
| IMP04-E07-AC-005 | ModuleService trả được danh sách module active/inactive. |

---

## 18. Epic IMP04-E08 - Frontend App Runtime & Layout Shell

### 18.1 Mục tiêu

Tạo app frontend chạy được với route shell, provider, layout và placeholder screen để sprint sau triển khai module nghiệp vụ.

### 18.2 Frontend scope Sprint 1

| Nhóm | Nội dung |
| --- | --- |
| App runtime | Vite + React 19 SPA + TanStack Router/TypeScript theo stack đã chốt |
| Providers | QueryProvider, AuthProvider, PermissionProvider, ThemeProvider, ToastProvider |
| Public routes | Login, forgot password, reset password placeholder |
| Protected routes | Protected layout, auth bootstrap boundary |
| Home Portal | Placeholder app grid/module cards |
| Module Workspace | Topbar/sidebar/content shell placeholder |
| Error routes | Forbidden, Not Found, Error State |
| State components | Loading, Empty, Error, Forbidden basic |
| App Switcher | Placeholder hoặc basic overlay if feasible |
| Build | Frontend build pass |

### 18.3 Route shell Sprint 1

```text
/public
  /login
  /forgot-password
  /reset-password

/protected
  /home
  /dashboard
  /hr
  /attendance
  /leave
  /tasks
  /notifications
  /system
  /account/profile
```

### 18.4 Layout shell

| Layout | Route | Sprint 1 behavior |
| --- | --- | --- |
| AuthLayout | `/login`, `/forgot-password`, `/reset-password` | Render form/card placeholder |
| HomePortalLayout | `/home` | Render app cards theo registry/mock hoặc API |
| ModuleWorkspaceLayout | `/dashboard`, `/hr`, `/attendance`, etc. | Render topbar/sidebar/page shell |
| ErrorLayout | `/forbidden`, not found | Render state component |

### 18.5 Task checklist

- [ ] Khởi tạo frontend project.
- [ ] Tạo design token CSS cơ bản.
- [ ] Tạo AppProviders.
- [ ] Tạo AuthLayout.
- [ ] Tạo HomePortalLayout.
- [ ] Tạo ModuleWorkspaceLayout.
- [ ] Tạo GlobalTopbar placeholder.
- [ ] Tạo ModuleSidebar placeholder.
- [ ] Tạo AppSwitcher placeholder/basic.
- [ ] Tạo LoginPage placeholder/basic real form.
- [ ] Tạo HomePage app grid placeholder.
- [ ] Tạo module overview placeholders.
- [ ] Tạo ForbiddenPage, NotFoundPage.
- [ ] Tạo loading/error/empty state base.
- [ ] Build frontend thành công.

### 18.6 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E08-AC-001 | Frontend chạy local. |
| IMP04-E08-AC-002 | Có route public và protected rõ. |
| IMP04-E08-AC-003 | User vào `/home` thấy Home Portal placeholder. |
| IMP04-E08-AC-004 | User mở module thấy Module Workspace shell. |
| IMP04-E08-AC-005 | Frontend build pass trong CI/local. |

---

## 19. Epic IMP04-E09 - Frontend Permission Framework & API Client

### 19.1 Mục tiêu

Tạo framework frontend để gọi API, giữ auth context, kiểm tra permission theo metadata và hiển thị UI theo quyền.

### 19.2 API client scope

| Thành phần | Sprint 1 |
| --- | --- |
| API response type | Có |
| API error type | Có |
| Pagination type | Có |
| API client wrapper | Có |
| Token injection | Có nếu login real |
| 401 handling | Basic |
| Refresh replay | Skeleton hoặc basic |
| Error mapper | Basic |
| QueryProvider | Có |
| Query key convention | Có |
| Mock service | Nên có nếu backend chưa đủ |

### 19.3 Permission framework scope

| Thành phần | Sprint 1 |
| --- | --- |
| Permission type | Có |
| DataScope type | Có |
| `can` | Có |
| `canAny` | Có |
| `canAll` | Có |
| `hasScope` | Có |
| `checkRequirement` | Có |
| Route metadata | Có |
| App registry | Có |
| Sidebar registry | Có skeleton |
| Action registry | Có skeleton |
| PermissionGate component | Có basic |
| DisabledActionTooltip | Có thể chuyển sprint sau |
| MaskedField | Có thể chuyển sprint sau |

### 19.4 App registry Sprint 1

| Module | Path | Required permission mẫu | Status |
| --- | --- | --- | --- |
| DASH | `/dashboard` | `DASH.DASHBOARD.VIEW` | Active |
| HR | `/hr` | `HR.EMPLOYEE.VIEW` | Active |
| ATT | `/attendance` | `ATT.ATTENDANCE.VIEW_OWN` | Active |
| LEAVE | `/leave` | `LEAVE.REQUEST.CREATE` hoặc `LEAVE.REQUEST.VIEW_OWN` | Active |
| TASK | `/tasks` | `TASK.TASK.VIEW` | Active |
| NOTI | `/notifications` | `NOTI.NOTIFICATION.READ` | Active |
| SYSTEM | `/system` | `AUTH.USER.VIEW` hoặc `FOUNDATION.SETTING.VIEW` | Active theo quyền |

### 19.5 Task checklist

- [ ] Tạo API client core.
- [ ] Tạo response/error types.
- [ ] Tạo error mapper.
- [ ] Tạo QueryProvider.
- [ ] Tạo auth API service: login/logout/me/refresh.
- [ ] Tạo foundation API service: my apps/settings public.
- [ ] Tạo permission checker utility.
- [ ] Tạo route metadata registry.
- [ ] Tạo app registry.
- [ ] Tạo sidebar registry skeleton.
- [ ] Tạo PermissionGate component.
- [ ] Tạo ProtectedRoute/RouteGuard logic.
- [ ] Tạo auth bootstrap flow.
- [ ] Tạo unit test permission utility.

### 19.6 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E09-AC-001 | API client gọi được `/health` hoặc `/auth/me`. |
| IMP04-E09-AC-002 | Permission checker unit test pass. |
| IMP04-E09-AC-003 | Protected route redirect hoặc show loading/forbidden đúng. |
| IMP04-E09-AC-004 | Home Portal có thể lọc app theo permission/module status ở mức cơ bản. |
| IMP04-E09-AC-005 | Logout clear auth context và query cache nhạy cảm. |

---

## 20. Epic IMP04-E10 - CI Quality Gate & Code Standards

### 20.1 Mục tiêu

Tạo quality gate tối thiểu để mọi thay đổi vào nhánh chính đều được kiểm tra tự động.

### 20.2 CI jobs Sprint 1

| Job | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Install dependencies | Có | Cache dependency nếu có thể |
| Lint backend | Có | Theo stack backend |
| Lint frontend | Có | ESLint |
| Typecheck backend | Có nếu TypeScript | Theo stack backend |
| Typecheck frontend | Có | `tsc --noEmit` |
| Unit test backend | Có tối thiểu | Permission/config/service tests |
| Unit test frontend | Có tối thiểu | Permission utility/API client tests |
| Build backend | Có | Build artifact hoặc compile |
| Build frontend | Có | Production build |
| Migration smoke | Có | DB service ephemeral hoặc local CI DB |
| Seed smoke | Nên có | Chạy seed baseline sau migration |
| Security scan | Có thể | Dependency audit basic nếu feasible |

### 20.3 Branch/PR guard

| Rule | Sprint 1 |
| --- | --- |
| PR required | Có |
| At least 1 review | Nên có |
| CI pass before merge | Có |
| No direct push main | Nên có |
| Conventional commit | Nên có |
| Linked issue | Nên có |

### 20.4 Task checklist

- [ ] Tạo CI workflow.
- [ ] Cấu hình dependency install.
- [ ] Cấu hình lint job.
- [ ] Cấu hình typecheck job.
- [ ] Cấu hình unit test job.
- [ ] Cấu hình build job.
- [ ] Cấu hình PostgreSQL service cho migration smoke.
- [ ] Chạy migration trong CI.
- [ ] Chạy seed baseline trong CI hoặc dev workflow.
- [ ] Tạo badge/status nếu cần.
- [ ] Ghi CI troubleshooting guide.

### 20.5 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E10-AC-001 | CI chạy tự động khi mở PR. |
| IMP04-E10-AC-002 | CI kiểm tra lint/typecheck/test/build tối thiểu. |
| IMP04-E10-AC-003 | Migration smoke test pass trên DB trống. |
| IMP04-E10-AC-004 | PR không được merge nếu P0 CI fail. |
| IMP04-E10-AC-005 | Có hướng dẫn xử lý lỗi CI thường gặp. |

---

## 21. Epic IMP04-E11 - Smoke Test & QA Foundation

### 21.1 Mục tiêu

QA có checklist để xác nhận nền Sprint 1 chạy được trước khi team bắt đầu Sprint 2.

### 21.2 Smoke test checklist

| Mã test | Nội dung | Kết quả mong muốn |
| --- | --- | --- |
| IMP04-QA-001 | Clone repo và cài dependency | Không lỗi |
| IMP04-QA-002 | Start database local | PostgreSQL chạy |
| IMP04-QA-003 | Run migration từ DB trống | Migration pass |
| IMP04-QA-004 | Run seed baseline | Seed pass, không duplicate |
| IMP04-QA-005 | Start backend | API chạy |
| IMP04-QA-006 | GET `/api/v1/health` | 200 OK response chuẩn |
| IMP04-QA-007 | Login admin local/dev | Login success nếu auth real |
| IMP04-QA-008 | GET `/api/v1/auth/me` | Có user/company/permission/module |
| IMP04-QA-009 | Start frontend | Web chạy |
| IMP04-QA-010 | Open login page | Render đúng layout |
| IMP04-QA-011 | Login và redirect Home Portal | Vào `/home` |
| IMP04-QA-012 | Open module placeholder | Module Workspace render |
| IMP04-QA-013 | Access protected route without login | Redirect/login hoặc forbidden đúng |
| IMP04-QA-014 | API request without token | 401 chuẩn |
| IMP04-QA-015 | User thiếu permission | 403 hoặc UI hidden/forbidden đúng |
| IMP04-QA-016 | CI pipeline | Pass |

### 21.3 Bug severity trong Sprint 1

| Severity | Ví dụ |
| --- | --- |
| Blocker | Không chạy được project local, migration fail, backend không start |
| Critical | Login/auth me fail, seed duplicate, CI không chạy được |
| Major | Route guard sai, permission utility sai, error format sai |
| Minor | UI placeholder lệch, text sai, README thiếu chi tiết nhỏ |

### 21.4 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E11-AC-001 | Smoke test P0 pass trên local. |
| IMP04-E11-AC-002 | Smoke test P0 pass trên development nếu đã có dev env. |
| IMP04-E11-AC-003 | Tất cả blocker/critical bug được xử lý trước Sprint Review. |
| IMP04-E11-AC-004 | Known issues được ghi rõ trong handoff. |

---

## 22. Epic IMP04-E12 - Documentation & Handoff

### 22.1 Mục tiêu

Đảm bảo mọi nền tảng đã dựng trong Sprint 1 có tài liệu đủ để sprint sau sử dụng mà không phải hỏi lại nhiều.

### 22.2 Tài liệu cần có

| Tài liệu | Nội dung |
| --- | --- |
| README root | Cách setup toàn dự án |
| Backend README | Cách chạy API, migration, seed, test |
| Frontend README | Cách chạy frontend, env, build, test |
| Env guide | Danh sách biến môi trường và ý nghĩa |
| Migration guide | Cách tạo/chạy/rollback migration |
| Seed guide | Cách chạy seed, idempotency, dev-only data |
| API convention note | Response/error/auth/header/request id |
| Permission guide | Permission format, data scope, role seed |
| CI guide | Pipeline, cách đọc lỗi, cách chạy local tương ứng |
| Sprint handoff | Done, carry-over, blockers, input Sprint 2 |

### 22.3 Sprint handoff format

```text
1. What was completed
2. What was not completed
3. Known issues
4. Technical debt introduced
5. Environment URLs / setup notes
6. Migration/seed status
7. API endpoints available
8. Frontend routes available
9. Test accounts / dev-only credentials policy
10. Sprint 2 readiness checklist
```

### 22.4 Acceptance criteria

| Mã | Tiêu chí |
| --- | --- |
| IMP04-E12-AC-001 | Developer mới có thể setup local theo tài liệu. |
| IMP04-E12-AC-002 | QA biết cách chạy smoke test Sprint 1. |
| IMP04-E12-AC-003 | Sprint 2 team biết endpoint/route/schema nào đã sẵn sàng. |
| IMP04-E12-AC-004 | Handoff ghi rõ phần carry-over và rủi ro còn lại. |

---

## 23. Issue board Sprint 1 đề xuất

> **Lưu ý chuẩn hóa (canonical):** Board columns và label taxonomy chính thức được định nghĩa trong **IMPLEMENTATION-03 §9 (Workflow board)** và **§11 (Label taxonomy)**. Sprint 1 sử dụng đúng board 12 cột (Inbox -> Backlog -> Refinement -> Ready for Sprint -> Sprint Backlog -> In Progress -> In Review -> QA Ready -> QA Testing -> Blocked -> Done -> Deferred/Cancelled) và label namespaced (`type:`, `module:`, `layer:`, `priority:`, `status:`, `risk:`) của IMPLEMENTATION-03. Phần dưới đây chỉ là **view rút gọn** để tham khảo nhanh trong Sprint 1; nếu có khác biệt, IMPLEMENTATION-03 là nguồn chuẩn.

### 23.1 Board columns (view rút gọn — chuẩn xem IMPLEMENTATION-03 §9)

```text
Backlog
-> Ready for Dev
-> In Progress
-> Code Review
-> Ready for QA
-> QA Testing
-> Done
-> Blocked
```

### 23.2 Label đề xuất (view rút gọn — chuẩn xem IMPLEMENTATION-03 §11)

> Khi tạo issue thật, dùng label namespaced canonical của IMPLEMENTATION-03 §11 (ví dụ `module:foundation`, `layer:backend`, `priority:p0`, `risk:migration`). Bảng dưới là alias rút gọn cho dễ đọc trong tài liệu Sprint 1.

| Label | Ý nghĩa |
| --- | --- |
| `sprint-1` | Thuộc Sprint 1 (Iteration field = Sprint 1 trong board canonical) |
| `foundation` | Foundation/shared infrastructure |
| `backend` | Backend task |
| `frontend` | Frontend task |
| `database` | Migration/schema/seed |
| `devops` | Environment/CI/deploy |
| `qa` | Test/smoke/regression |
| `security` | Auth, permission, secret, access |
| `blocked` | Đang bị blocker |
| `p0` | Bắt buộc hoàn thành |
| `p1` | Nên hoàn thành |
| `carry-over` | Chuyển sprint sau |

### 23.3 Issue template

```markdown
## Mục tiêu

## Phạm vi

## Checklist
- [ ]

## Acceptance Criteria
- [ ]

## Test Notes

## Dependencies / Blockers
```

---

## 24. Definition of Ready cho Sprint 1 task

Một task Sprint 1 được xem là Ready khi:

1. Có mô tả rõ mục tiêu.
2. Có output cụ thể.
3. Có owner chính.
4. Có dependency rõ.
5. Có acceptance criteria.
6. Có test note hoặc cách verify.
7. Không phụ thuộc quyết định kiến trúc chưa chốt.
8. Không yêu cầu secret production hoặc thông tin chưa có.

---

## 25. Definition of Done cho Sprint 1 task

Một task Sprint 1 được xem là Done khi:

1. Code đã merge hoặc tài liệu đã được cập nhật.
2. CI tương ứng pass.
3. Không còn blocker/critical bug liên quan.
4. Có test hoặc smoke verification phù hợp.
5. Có README/handoff nếu task ảnh hưởng cách chạy hệ thống.
6. Không hard-code secret.
7. Không bypass permission/auth guard bằng hack tạm mà không ghi technical debt.
8. Được QA/Tech Lead xác nhận nếu là P0 foundation task.

---

## 26. Sprint 1 dependency map

```text
Repo bootstrap
  -> Local environment
    -> Database migration runner
      -> Foundation schema
        -> AUTH/RBAC schema
          -> Seed baseline
            -> Backend auth/me/login skeleton
              -> Frontend auth bootstrap
                -> Protected route + Home Portal
                  -> Module Workspace placeholder
                    -> Sprint 2 business workflow

CI quality gate
  -> chạy song song nhưng cần repo/scripts ổn định

QA smoke test
  -> cần local/dev environment + seed + backend/frontend shell
```

---

## 27. Rủi ro Sprint 1 và hướng xử lý

| Rủi ro | Mức độ | Dấu hiệu | Hướng xử lý |
| --- | --- | --- | --- |
| Chọn stack/tool migration chậm | Cao | Tranh luận kéo dài, chưa code | Chốt tạm theo BACKEND-01 hoặc chọn tool phổ biến, không đổi giữa sprint |
| Seed không idempotent | Cao | Chạy lại seed tạo trùng role/permission | Dùng business key + upsert + seed tracking |
| Auth làm quá sâu | Trung bình | Sprint 1 bị trễ vì forgot/reset/MFA/SSO | Chỉ làm login/me/logout/refresh basic, phần nâng cao chuyển sau |
| Frontend chờ backend | Trung bình | Home Portal không test được | Dùng MSW/mock theo contract `/auth/me`, `/modules/my-apps` |
| DB schema làm quá nhiều module | Cao | Migration quá lớn, dễ fail | Sprint 1 ưu tiên Foundation + AUTH/RBAC; module nghiệp vụ để skeleton hoặc sprint sau |
| CI mất nhiều thời gian | Trung bình | Pipeline flaky, quá chậm | Chỉ P0 jobs trước: lint/typecheck/test/build/migration smoke |
| Secret bị commit nhầm | Cao | `.env` thật vào repo | `.gitignore`, secret scan basic, chỉ commit `.env.example` |
| Permission hard-code theo role | Cao | UI/API check role string | Review bắt buộc dùng permission + scope |
| Local setup khó chạy | Cao | Developer cần nhiều bước thủ công | Docker Compose + README từng bước + troubleshooting |

---

## 28. Technical debt được phép trong Sprint 1

Một số điểm có thể chấp nhận tạm thời nếu được ghi rõ:

| Technical debt | Điều kiện chấp nhận | Hạn xử lý |
| --- | --- | --- |
| Auth UI chỉ basic | Login được, protected route test được | Sprint 2/3 tùy roadmap |
| App registry hybrid local + backend | Có interface rõ để đổi sang backend-driven | Sprint 2 hoặc Sprint 4 |
| File service chưa upload binary thật | Có metadata model và rule private | Khi module HR/LEAVE/TASK cần file |
| Notification event publisher chỉ skeleton | Có event contract và seed event | Sprint NOTI hoặc module cần event |
| Dashboard cache chỉ skeleton | Có bảng/config và interface | Sprint DASH |
| Staging chưa deploy thật | Local/dev pass, DevOps plan rõ | Sprint DevOps/UAT |

Không được chấp nhận:

1. Secret thật trong repo.
2. Migration không chạy được từ DB trống.
3. Seed tạo dữ liệu trùng khi chạy lại.
4. Backend bỏ qua auth/permission guard ở API protected mà không ghi rõ.
5. Frontend hard-code role thay vì permission.
6. Không có README setup.

---

## 29. Sprint 1 demo script

### 29.1 Demo technical flow

1. Clone repo.
2. Copy `.env.example` sang `.env.local`.
3. Start database local.
4. Run migration.
5. Run seed.
6. Start backend.
7. Call `/api/v1/health`.
8. Login admin local/dev.
9. Call `/api/v1/auth/me`.
10. Start frontend.
11. Login trên UI hoặc dùng auth mock nếu chưa có UI real.
12. Vào Home Portal.
13. Mở Dashboard/HR/Attendance/Leave/Tasks placeholder.
14. Test route không có quyền hoặc logout.
15. Show CI pipeline pass.

### 29.2 Demo cần tránh

Không demo nghiệp vụ chưa thuộc Sprint 1 như:

1. Tạo nhân viên đầy đủ.
2. Check-in/check-out thật.
3. Tạo đơn nghỉ thật.
4. Kanban thật.
5. Dashboard dữ liệu thật.

Nếu có placeholder, phải nói rõ là placeholder nền để sprint sau triển khai.

---

## 30. Sprint 1 review checklist

| Nhóm | Câu hỏi nghiệm thu |
| --- | --- |
| Repo | Repo có cấu trúc đủ rõ chưa? |
| Local | Developer mới có chạy được không? |
| Database | DB trống có migration + seed được không? |
| Seed | Seed chạy lại có idempotent không? |
| Backend | API shell có response/error/request id chuẩn không? |
| Auth | Admin có login/me/logout được không? |
| RBAC | Permission + data scope resolver hoạt động chưa? |
| Foundation | Audit/setting/sequence/file skeleton đã có chưa? |
| Frontend | Home Portal và Module Workspace shell chạy chưa? |
| API client | Frontend gọi được API chuẩn chưa? |
| CI | Lint/typecheck/test/build/migration smoke pass chưa? |
| QA | Smoke test P0 pass chưa? |
| Handoff | Sprint 2 có đủ nền để làm workflow hằng ngày chưa? |

---

## 31. Sprint 2 readiness checklist

Sprint 2 chỉ nên bắt đầu khi các điều kiện sau đạt:

- [ ] Local environment chạy được ổn định.
- [ ] Development environment có thể dùng để test tích hợp hoặc đã có kế hoạch rõ.
- [ ] Migration foundation/auth chạy từ DB trống.
- [ ] Seed baseline chạy idempotent.
- [ ] Admin login được.
- [ ] `/auth/me` trả permission/module access.
- [ ] Backend guard skeleton có thể dùng cho API module.
- [ ] Frontend protected route và API client hoạt động.
- [ ] Home Portal/Module Workspace shell có thể mở các module.
- [ ] CI P0 pass.
- [ ] QA smoke test pass.
- [ ] Carry-over không chặn Sprint 2 core daily workflow.

---

## 32. Input cho IMPLEMENTATION-05

Sau Sprint 1, IMPLEMENTATION-05 có thể bắt đầu triển khai **Sprint 2 Auth & HR Core** dựa trên nền sau:

| Nền từ Sprint 1 | Sprint 2 sử dụng để làm gì |
| --- | --- |
| Auth/me + permission | Hiển thị đúng app/menu/action theo quyền |
| Database migration runner | Thêm migration HR/ATT/LEAVE/TASK chi tiết |
| Seed baseline | Bổ sung seed ca làm, loại nghỉ, user/employee mẫu dev |
| Backend API shell | Thêm controller/service nghiệp vụ |
| Foundation services | Ghi audit, sinh mã, đọc setting, link file |
| Frontend app shell | Thêm màn hình nghiệp vụ vào Module Workspace |
| API client/query layer | Tạo hooks cho HR/ATT/LEAVE/TASK/NOTI |
| CI/smoke | Bảo vệ chất lượng khi thêm nghiệp vụ |

---

## 33. Backlog chi tiết dạng task table

| ID | Task | Owner | Priority | Dependency | Output |
| --- | --- | --- | --- | --- | --- |
| IMP04-T001 | Chốt repo structure | Tech Lead | P0 | Sprint 0 | Repo folders |
| IMP04-T002 | Tạo README setup root | Tech Lead | P0 | T001 | README |
| IMP04-T003 | Tạo Docker Compose PostgreSQL | DevOps/BE | P0 | T001 | DB local |
| IMP04-T004 | Tạo env example backend/frontend | BE/FE | P0 | T001 | `.env.example` |
| IMP04-T005 | Tạo migration runner | BE | P0 | T003 | Migration command |
| IMP04-T006 | Migration M00 extensions | BE | P0 | T005 | SQL migration |
| IMP04-T007 | Migration Foundation base | BE | P0 | T006 | Foundation tables |
| IMP04-T008 | Migration Foundation ops | BE | P0 | T007 | Audit/file/sequence/seed tables |
| IMP04-T009 | Migration AUTH/RBAC | BE | P0 | T008 | Auth tables |
| IMP04-T010 | Seed module catalog | BE | P0 | T009 | Module seed |
| IMP04-T011 | Seed settings | BE | P0 | T009 | Settings seed |
| IMP04-T012 | Seed permissions | BE | P0 | T009 | Permission seed |
| IMP04-T013 | Seed roles + role permissions | BE | P0 | T012 | RBAC seed |
| IMP04-T014 | Bootstrap admin | BE | P0 | T013 | Admin user |
| IMP04-T015 | Backend health endpoint | BE | P0 | T004 | `/health` |
| IMP04-T016 | Backend response/error wrapper | BE | P0 | T015 | Standard API response |
| IMP04-T017 | Request id middleware | BE | P0 | T016 | Request tracing |
| IMP04-T018 | Auth login/me/logout skeleton | BE | P0 | T014,T016 | Auth endpoints |
| IMP04-T019 | Permission resolver | BE | P0 | T013 | Permission guard base |
| IMP04-T020 | Audit service skeleton | BE | P0 | T008 | Audit service |
| IMP04-T021 | Setting service skeleton | BE | P0 | T011 | Setting service |
| IMP04-T022 | Sequence service skeleton | BE | P0 | T008 | Sequence service |
| IMP04-T023 | File metadata service skeleton | BE | P1 | T008 | File service |
| IMP04-T024 | Frontend project bootstrap | FE | P0 | T001 | Web app skeleton |
| IMP04-T025 | Frontend providers | FE | P0 | T024 | AppProviders |
| IMP04-T026 | AuthLayout | FE | P0 | T024 | Public layout |
| IMP04-T027 | HomePortalLayout | FE | P0 | T025 | Home shell |
| IMP04-T028 | ModuleWorkspaceLayout | FE | P0 | T025 | Workspace shell |
| IMP04-T029 | API client core | FE | P0 | T025,T016 | API wrapper |
| IMP04-T030 | Auth API service | FE | P0 | T018,T029 | login/me/logout hooks |
| IMP04-T031 | Permission checker | FE | P0 | T030 | Permission utility |
| IMP04-T032 | Route metadata registry | FE | P0 | T031 | Route guard data |
| IMP04-T033 | App registry | FE | P0 | T031 | App visibility |
| IMP04-T034 | Protected route guard | FE | P0 | T030,T032 | Route protection |
| IMP04-T035 | CI lint/typecheck/test/build | DevOps | P0 | T001,T024,T015 | CI workflow |
| IMP04-T036 | CI migration smoke | DevOps/BE | P0 | T005,T009 | DB smoke |
| IMP04-T037 | QA smoke checklist | QA | P1 | T015,T018,T024 | QA checklist |
| IMP04-T038 | Sprint 1 handoff note | All | P1 | All P0 | Handoff doc |

---

## 34. Acceptance criteria tổng Sprint 1

Sprint 1 được xem là hoàn thành khi đạt toàn bộ tiêu chí P0 sau:

| Mã | Tiêu chí tổng |
| --- | --- |
| IMP04-SPRINT-AC-001 | Repo có cấu trúc backend/frontend/docs/scripts rõ ràng. |
| IMP04-SPRINT-AC-002 | Local environment chạy được theo README. |
| IMP04-SPRINT-AC-003 | Database trống chạy migration + seed baseline thành công. |
| IMP04-SPRINT-AC-004 | Backend API shell chạy và trả health check chuẩn. |
| IMP04-SPRINT-AC-005 | Admin bootstrap có thể đăng nhập hoặc auth skeleton test được end-to-end. |
| IMP04-SPRINT-AC-006 | `/auth/me` trả user/company/permission/module access. |
| IMP04-SPRINT-AC-007 | Backend có guard skeleton cho auth/permission/data scope. |
| IMP04-SPRINT-AC-008 | Frontend public/protected route chạy được. |
| IMP04-SPRINT-AC-009 | Home Portal và Module Workspace placeholder chạy được. |
| IMP04-SPRINT-AC-010 | Frontend API client/query provider hoạt động ở mức cơ bản. |
| IMP04-SPRINT-AC-011 | CI P0 pass. |
| IMP04-SPRINT-AC-012 | QA smoke test P0 pass. |
| IMP04-SPRINT-AC-013 | Không có blocker/critical bug mở tại thời điểm Sprint Review. |
| IMP04-SPRINT-AC-014 | Có handoff rõ cho Sprint 2. |

---

## 35. Capacity & Estimation

Sprint 1 hiện thực hóa các story foundation và frontend core đã định nghĩa trong **IMPLEMENTATION-02**: EPIC-01 Foundation & Shared System (story 005-012) và EPIC-09 Frontend Core Implementation (story 093-096). Tổng story point của Sprint 1 là **91 point**.

### 35.1 Thang story point

Thang ước lượng theo **IMPLEMENTATION-02 §3.5** (Fibonacci rút gọn):

| Point | Độ phức tạp tham chiếu |
| ---: | --- |
| 1 | Sửa nhỏ, copy UI, validation đơn giản |
| 2 | Task nhỏ, ít dependency |
| 3 | Story nhỏ, 1 API hoặc 1 UI state |
| 5 | Story vừa, có API + UI + test cơ bản |
| 8 | Story lớn, có nhiều state/quyền/dependency |
| 13 | Story rất lớn, cần tách task kỹ thuật nội bộ |

Story lớn hơn 13 point phải tách nhỏ trước khi đưa vào sprint.

### 35.2 Giả định capacity

| Yếu tố | Giả định Sprint 1 |
| --- | --- |
| Sprint length | 2 tuần (10 ngày làm việc) |
| Backend | 2-4 người |
| Frontend | 2-4 người |
| QA | 1-2 người |
| DevOps | 1 người |
| Velocity giả định ban đầu | ~40-80 point/sprint, hiệu chỉnh lại sau dữ liệu thực tế của Sprint 0-1 |

Velocity ban đầu là ước lượng để lập kế hoạch; sau Sprint 0 và Sprint 1, dùng velocity thực đo để hiệu chỉnh cam kết cho các sprint sau.

### 35.3 Story point sprint này

| Story ID | Epic | Tóm tắt | Point |
| --- | --- | --- | ---: |
| IMP02-STORY-005 | EPIC-01 Foundation | Company/tenant mặc định | 5 |
| IMP02-STORY-006 | EPIC-01 Foundation | Module catalog + bật/tắt module | 5 |
| IMP02-STORY-007 | EPIC-01 Foundation | System/company settings | 8 |
| IMP02-STORY-008 | EPIC-01 Foundation | Audit log dùng chung | 8 |
| IMP02-STORY-009 | EPIC-01 Foundation | File service (metadata/private/link) | 8 |
| IMP02-STORY-010 | EPIC-01 Foundation | Sequence counter sinh mã | 5 |
| IMP02-STORY-011 | EPIC-01 Foundation | Public holiday / ngày không làm việc | 5 |
| IMP02-STORY-012 | EPIC-01 Foundation | Seed dữ liệu nền idempotent | 5 |
| IMP02-STORY-093 | EPIC-09 Frontend Core | Design System foundation | 13 |
| IMP02-STORY-094 | EPIC-09 Frontend Core | AuthLayout/HomePortalLayout/ModuleWorkspaceLayout | 13 |
| IMP02-STORY-095 | EPIC-09 Frontend Core | API client + query layer + error mapper | 8 |
| IMP02-STORY-096 | EPIC-09 Frontend Core | App/route/sidebar registry | 8 |
| **Tổng** | | | **91** |

Trong đó: Foundation BE (005-012) = **49 point**, Frontend Core (093-096) = **42 point**.

### 35.4 Cảnh báo capacity

91 point cho một sprint 2 tuần là **ngưỡng cao** nhưng **khả thi** với điều kiện:

1. **Frontend Core (093-096, 42pt) chạy song song** với Foundation Backend (005-012, 49pt). EPIC-09 có thể độc lập với BE nếu API contract/mock ổn định (xem IMPLEMENTATION-02 §8.10 ghi chú dependency).
2. Nếu velocity thực tế thấp hơn giả định, **đẩy trễ một phần FE Core (093-096)** sang carry-over Sprint 2, ưu tiên giữ Foundation BE (005-012) để không chặn các sprint nghiệp vụ sau.
3. Một số story P1 trong nhóm (ví dụ STORY-011 Public Holiday) có thể giảm xuống mức skeleton nếu cần bảo vệ các story P0.

---

## 36. Kết luận

Sprint 1 là sprint dựng nền kỹ thuật quan trọng nhất cho MVP. Nếu Sprint 1 làm chắc, các sprint sau có thể tập trung vào nghiệp vụ thay vì liên tục sửa nền.

Trọng tâm Sprint 1 là:

```text
Chạy được
-> Seed được
-> Đăng nhập/resolve permission được
-> Guard được
-> Gọi API được
-> Render shell được
-> CI/QA kiểm được
```

Không nên đánh giá Sprint 1 bằng số lượng màn hình nghiệp vụ hoàn chỉnh. Sprint này cần được đánh giá bằng mức độ ổn định, rõ ràng và khả năng tái sử dụng của nền tảng.

Sau Sprint 1, bước tiếp theo là:

```text
IMPLEMENTATION-05: Sprint 2 Auth & HR Core Execution Plan
```

Sprint 2 sẽ dựa trên nền này để triển khai Auth hoàn chỉnh (login, RBAC, guard) và HR Core, mở đường cho các sprint nghiệp vụ tiếp theo (Attendance & Leave, Task & Notification & Dashboard).
