> ⚠️ **ĐÍNH CHÍNH STACK (bắt buộc) — đọc trước:** Tài liệu này có thể còn nhắc Next.js/Prisma (lỗi thời). Stack đã CHỐT: **Vite + React 19 SPA + TanStack Router (KHÔNG Next.js)** · **Drizzle (KHÔNG Prisma)** · **Valkey** · **Vitest**. Các token an toàn đã thay inline; phần khái niệm lấy [DECISIONS-02](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md) làm chuẩn.

# BACKEND-02: DATABASE MIGRATION, ORM & SEED IMPLEMENTATION
# TRIỂN KHAI MIGRATION DATABASE, ORM & DỮ LIỆU SEED BAN ĐẦU
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · **BACKEND-02 Migration/ORM/Seed** · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Migration/Seed: DB-10](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [DB Tổng quan: DB-01](<../DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [Index/Hiệu năng: DB-09](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-02 |
| Tên tài liệu | Database Migration, ORM & Seed Implementation |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

BACKEND-02 mô tả cách triển khai thực tế lớp database của backend, bao gồm:

1. Thiết lập PostgreSQL cho môi trường local/development/staging/production.
2. Tổ chức migration database theo thứ tự module.
3. Tạo schema, constraint, foreign key, index, extension và enum/check constraint.
4. Ánh xạ database design sang ORM model/entity.
5. Chuẩn hóa cách viết repository/query/service transaction.
6. Triển khai seed data ban đầu có thể chạy lại an toàn.
7. Seed module catalog, company mặc định, settings, permissions, roles, role-permission matrix.
8. Seed dữ liệu mặc định cho HR, ATT, LEAVE, TASK, NOTI, DASH và FOUNDATION.
9. Bootstrap tài khoản admin đầu tiên an toàn.
10. Kiểm thử migration/seed từ database trống.
11. Chuẩn hóa rollback, reset local, backup trước migration production và verification sau migration.

Tài liệu này chuyển các quyết định trong DB-08, DB-09 và DB-10 thành kế hoạch triển khai backend có thể áp dụng ngay.

---

## 3. Vị trí BACKEND-02 trong roadmap backend

Roadmap backend đề xuất cho MVP:

| Mã | Tên tài liệu | Vai trò |
| --- | --- | --- |
| BACKEND-01 | Backend Architecture & Project Setup | Chốt stack backend, cấu trúc project, module boundary, config, logging, exception, security foundation |
| BACKEND-02 | Database Migration, ORM & Seed Implementation | Triển khai database schema, migration, ORM, seed, bootstrap admin |
| BACKEND-03 | Auth, Session, RBAC & Permission Guard | Login, token, refresh, session, permission, data scope, guard |
| BACKEND-04 | Foundation Backend | Company, module catalog, settings, audit log, files, sequence, public holidays |
| BACKEND-05 | HR Backend | Employee, department, position, contract, profile change, employee code |
| BACKEND-06 | Attendance Backend | Check-in/out, attendance records, shifts, rules, adjustment, remote work |
| BACKEND-07 | Leave Backend | Leave type, policy, balance, request, approval, ATT sync |
| BACKEND-08 | Task Backend | Project, task, assignee, watcher, comment, checklist, activity |
| BACKEND-09 | Notification Backend | Notification event, template, delivery, unread, dropdown, internal event |
| BACKEND-10 | Dashboard Backend | Widget registry, dashboard query, cache, invalidation |
| BACKEND-11 | File, Audit, Settings & System Jobs | File service, audit log, settings, sequence, holiday, retention, system jobs |
| BACKEND-12 | API Integration Contract & OpenAPI/Swagger | Contract API, OpenAPI/Swagger, permission-endpoint matrix, contract test |
| BACKEND-13 | Backend Testing, Security & Performance | Unit/integration/e2e, security, performance, regression |
| BACKEND-14 | Backend Release Readiness | Release checklist, observability, rollback, readiness |

BACKEND-02 là lớp nền bắt buộc trước khi triển khai nghiệp vụ AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH.

---

## 4. Căn cứ triển khai

BACKEND-02 bám theo các quyết định đã chốt:

1. Database chính là PostgreSQL.
2. Tất cả bảng chính dùng UUID primary key.
3. Hệ thống thiết kế sẵn multi-tenant bằng `company_id`.
4. Dữ liệu nghiệp vụ quan trọng dùng soft delete, không xóa cứng.
5. Foundation gồm company, module catalog, settings, audit log, files, sequence, holidays và seed tracking.
6. AUTH/RBAC là nền phân quyền cho toàn hệ thống.
7. HR là nguồn dữ liệu nhân sự trung tâm.
8. ATT, LEAVE và TASK gắn nghiệp vụ chính với `employees.id`.
9. NOTI và DASH là module dùng chung, không xử lý nghiệp vụ gốc.
10. Migration phải chạy được từ database trống đến trạng thái dùng được MVP.
11. Migration phải deterministic giữa local/development/staging/production.
12. Seed phải idempotent, có business key ổn định và có seed tracking.
13. Các index quan trọng phải bám query pattern, đặc biệt `company_id`, soft delete, notification unread, attendance date, leave pending, task due và dashboard cache.
14. Backend là nguồn kiểm soát quyền cuối cùng; frontend không được gửi `company_id` để backend tin tưởng.
15. Secret không được hardcode trong seed hoặc migration.

---

## 5. Phạm vi BACKEND-02

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Database setup | PostgreSQL, extension, timezone, connection pool, local docker |
| Migration architecture | Thư mục migration, naming, order, transaction, rollback, dry-run |
| Schema migration | Foundation, AUTH, HR, ATT, LEAVE, TASK, NOTI/DASH |
| Constraint migration | PK, FK, unique, check constraint, partial unique, cross-module FK |
| Index migration | Index theo DB-09, partial index, GIN/trigram, log index |
| ORM implementation | Drizzle ORM, model convention, repository pattern |
| Entity mapping | Mapping bảng -> model -> repository -> service |
| Transaction pattern | Unit of work, interactive transaction, row lock cho sequence counter |
| Seed architecture | Seed runner, seed_batches, seed_items, checksum, idempotent upsert |
| Initial seed | Modules, settings, company, permission, roles, role permissions, HR/ATT/LEAVE/NOTI/DASH defaults |
| Bootstrap admin | Tạo admin đầu tiên bằng env/CLI, không hardcode password |
| Verification | Migration smoke test, seed smoke test, FK/index check, login readiness check |
| Local reset | Reset database local an toàn, dev-only sample seed |
| Production safety | Backup, migration lock, no destructive migration, post-migration verification |

### 5.2 Không bao gồm

| Nội dung | Chuyển sang |
| --- | --- |
| Login/session/token API chi tiết | BACKEND-03 |
| Permission guard runtime chi tiết | BACKEND-03 |
| Foundation service chi tiết (company, settings, audit, file, sequence) | BACKEND-04 / BACKEND-11 |
| File upload/download service chi tiết | BACKEND-04 / BACKEND-11 |
| Business logic HR/ATT/LEAVE/TASK | BACKEND-05 -> BACKEND-08 |
| Notification delivery worker chi tiết | BACKEND-09 |
| Dashboard widget query/cache service chi tiết | BACKEND-10 |
| CI/CD hạ tầng cloud chi tiết | BACKEND-14 / DevOps |
| Import dữ liệu thật từ hệ thống cũ | Data migration phase riêng |

---

## 6. Stack triển khai đề xuất

### 6.1 Stack mặc định cho MVP

| Lớp | Công nghệ đề xuất | Vai trò |
| --- | --- | --- |
| Database | PostgreSQL | Database quan hệ chính |
| ORM | Drizzle ORM | Type-safe database client, model mapping, repository implementation |
| Migration | SQL migration có kiểm soát qua drizzle-kit | Tạo schema/index/constraint chính xác theo DB design |
| Seed | TypeScript seed runner dùng Drizzle | Seed idempotent, tracking, bootstrap admin |
| Backend framework | NestJS hoặc Node.js TypeScript framework tương đương | Module/service/repository/DI |
| Validation | Zod hoặc class-validator | Validate input seed/config nếu cần |
| Password hash | Argon2id hoặc bcrypt | Hash password bootstrap/dev user |
| Config | Environment variables + config module | Tách local/staging/production |
| Test | Vitest/Vitest + test database | Migration/seed/repository test |
| Local infra | Docker Compose | PostgreSQL local, optional pgAdmin/Adminer |

### 6.2 Nguyên tắc dùng ORM

ORM không được làm mất kiểm soát schema.

Vì database của hệ thống cần nhiều PostgreSQL feature như partial index, raw check constraint, trigram index, extension, cross-module FK và row lock, quy tắc triển khai là:

```text
Database design là nguồn đúng về schema
-> SQL migration là nguồn đúng về cấu trúc database
-> ORM model bám theo schema đã tạo
-> Repository/service dùng ORM để query nghiệp vụ
-> Raw SQL chỉ dùng cho phần ORM không hỗ trợ tốt
```

### 6.3 Khi dùng Drizzle

> Stack ORM đã CHỐT là **Drizzle + drizzle-kit** (KHÔNG Prisma) — xem [DECISIONS-02 §1.1](<../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md>). Lý do: Prisma phá outbox transactional + không set tenant context an toàn trên PgBouncer transaction-mode pool.

Drizzle phù hợp cho:

1. Type-safe query (schema bằng TypeScript).
2. Repository/service code rõ ràng.
3. Transaction dễ dùng + `set_config('app.current_company_id', …, true)` cho RLS.
4. Client gọn cho TypeScript backend (`drizzle(pool)`).
5. Seed runner bằng `tsx`.

Nhưng một số phần nên triển khai bằng raw SQL migration (qua `drizzle-kit` + file SQL tự viết):

1. Partial index: `WHERE deleted_at IS NULL`.
2. GIN/trigram index.
3. Một số check constraint phức tạp.
4. `CREATE EXTENSION`.
5. Partition table nếu dùng.
6. Cross-module FK thêm sau.
7. Row-level lock query `FOR UPDATE` cho `sequence_counters`.

---

## 7. Cấu trúc thư mục đề xuất

```text
backend/
  drizzle.config.ts            # dialect postgresql, schema + out path
  migrations/                  # SQL do drizzle-kit generate (+ file RLS/FORCE/append-only tự viết)
    202606200001_foundation_enable_extensions.sql
    202606200005_foundation_enable_rls_force.sql   # RLS+FORCE TRƯỚC backfill (DECISIONS-02 §2)
    202606200010_foundation_create_base_tables.sql
    202606200020_foundation_create_ops_tables.sql
    202606200030_auth_create_tables.sql
    202606200040_hr_create_tables.sql
    202606200050_att_create_tables.sql
    202606200060_leave_create_tables.sql
    202606200070_task_create_tables.sql
    202606200080_noti_dash_create_tables.sql
    202606200090_cross_module_add_foreign_keys.sql
    202606200100_cross_module_add_indexes.sql
    meta/                      # journal do drizzle-kit quản lý
  src/db/schema/               # schema bằng TypeScript (nguồn cho drizzle-kit generate)
    index.ts                   # barrel (KHÔNG re-export module out-of-scope)
    foundation.ts  auth.ts  hr.ts  attendance.ts  leave.ts  tasks.ts  noti.ts  dashboard.ts
  seed/
      index.ts
      seed-runner.ts
      seed-context.ts
      seed-utils.ts
      system/
        modules.seed.ts
        system-settings.seed.ts
        permissions.seed.ts
      tenant/
        default-company.seed.ts
        company-settings.seed.ts
        sequence-counters.seed.ts
      rbac/
        roles.seed.ts
        role-permissions.seed.ts
        bootstrap-admin.seed.ts
      business/
        hr-defaults.seed.ts
        attendance-defaults.seed.ts
        leave-defaults.seed.ts
        notification-defaults.seed.ts
        dashboard-defaults.seed.ts
      dev-only/
        sample-users.seed.ts
        sample-employees.seed.ts
        sample-attendance.seed.ts
        sample-leave.seed.ts
        sample-task.seed.ts
  src/
    database/
      database.module.ts
      db.service.ts            # drizzle(pool) + withTenant()
      transaction.service.ts
      database-health.service.ts
    common/
      types/
      errors/
      utils/
    foundation/
      repositories/
      services/
    auth/
      repositories/
      services/
    hr/
      repositories/
      services/
    attendance/
      repositories/
      services/
    leave/
      repositories/
      services/
    task/
      repositories/
      services/
    notification/
      repositories/
      services/
    dashboard/
      repositories/
      services/
  scripts/
    db-reset-local.ts
    db-check.ts
    db-create-migration.ts
    seed-dev.ts
  test/
    database/
      migration.spec.ts
      seed.spec.ts
      constraints.spec.ts
      repository-smoke.spec.ts
```

---

## 8. Environment variables

### 8.1 Biến môi trường bắt buộc

```env
DATABASE_URL="postgresql://ems_user:ems_password@localhost:5432/ems_dev?schema=public"
DIRECT_DATABASE_URL="postgresql://ems_user:ems_password@localhost:5432/ems_dev?schema=public"
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_STATEMENT_TIMEOUT_MS=30000
DATABASE_TIMEZONE="Asia/Ho_Chi_Minh"

APP_ENV="local"
APP_NAME="enterprise-management-system"
APP_VERSION="0.1.0"

BOOTSTRAP_ADMIN_EMAIL="admin@example.com"
BOOTSTRAP_ADMIN_PASSWORD="change-me-from-secret-manager"
BOOTSTRAP_ADMIN_NAME="System Admin"
BOOTSTRAP_COMPANY_CODE="DEFAULT"
BOOTSTRAP_COMPANY_NAME="Default Company"
BOOTSTRAP_COMPANY_TIMEZONE="Asia/Ho_Chi_Minh"
BOOTSTRAP_COMPANY_LOCALE="vi-VN"

SEED_ENABLE_DEV_SAMPLE=false
SEED_ALLOW_BOOTSTRAP_ADMIN=true
```

### 8.2 Nguyên tắc bảo mật env

1. Production không commit file `.env`.
2. Password admin production lấy từ secret manager hoặc input một lần qua CLI.
3. Không ghi `BOOTSTRAP_ADMIN_PASSWORD` vào log.
4. Không seed user mẫu ở production.
5. Không dùng cùng database user cho migration và runtime nếu production yêu cầu tách quyền.

---

## 9. Local Docker Compose cho PostgreSQL

```yaml
services:
  postgres:
    image: postgres:16
    container_name: ems-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ems_dev
      POSTGRES_USER: ems_user
      POSTGRES_PASSWORD: ems_password
      TZ: Asia/Ho_Chi_Minh
    ports:
      - "5432:5432"
    volumes:
      - ems_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ems_user -d ems_dev"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  ems_postgres_data:
```

Local command:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm db:check
```

---

## 10. Package scripts đề xuất

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:migrate:dev": "drizzle-kit generate && tsx src/db/migrate.ts",
    "db:migrate:status": "drizzle-kit check",
    "db:seed": "tsx seed/index.ts",
    "db:seed:dev": "SEED_ENABLE_DEV_SAMPLE=true tsx seed/index.ts",
    "db:reset:local": "tsx scripts/db-reset-local.ts",
    "db:check": "tsx scripts/db-check.ts",
    "db:studio": "drizzle-kit studio",
    "test:db": "vitest run test/database"
  }
}
```

Lưu ý:

1. `db:reset:local` chỉ được chạy khi `APP_ENV=local` hoặc `APP_ENV=test`.
2. `db:migrate:dev` chỉ dùng local để tạo migration mới.
3. `db:migrate` dùng cho CI/staging/production.
4. `db:seed` phải idempotent.
5. `db:seed:dev` không được chạy production.

---

## 11. Nguyên tắc migration tổng thể

### 11.1 Migration phải chạy được từ database trống

Kịch bản bắt buộc:

```text
create database
-> enable extensions
-> run schema migrations
-> run index migrations
-> run seed
-> bootstrap admin
-> run verification
-> backend starts successfully
```

Kết quả tối thiểu:

1. Có toàn bộ bảng MVP.
2. Có constraint/FK hợp lệ.
3. Có index quan trọng.
4. Có module catalog.
5. Có permission catalog.
6. Có role mặc định.
7. Có role-permission matrix.
8. Có company mặc định.
9. Có system/company settings mặc định.
10. Có notification events/templates.
11. Có dashboard widgets/configs.
12. Có leave types, attendance defaults, sequence counters.
13. Có admin đầu tiên để đăng nhập.

### 11.2 Migration phải deterministic

Không được:

```text
SELECT MAX(code) + 1 để sinh mã
Tạo constraint/index với tên ngẫu nhiên
Tự ý drop dữ liệu production
Tự ý update dữ liệu nhạy cảm hàng loạt
Dựa vào dữ liệu hiện có để đoán schema
```

Được phép:

```text
gen_random_uuid() cho primary key
upsert theo business key ổn định
migration có tên constraint/index rõ ràng
migration destructive phải tách riêng và cần approval
```

### 11.3 Tách schema, constraint, index và seed

```text
schema migration
-> tạo extension, table, column, enum/check cơ bản

constraint migration
-> thêm FK vòng, cross-module FK, unique/check nâng cao

index migration
-> thêm index theo query pattern

seed runner
-> tạo dữ liệu mặc định có tracking
```

### 11.4 Không dùng cascade delete cho dữ liệu nghiệp vụ quan trọng

Không dùng `ON DELETE CASCADE` cho:

1. `users`.
2. `employees`.
3. `attendance_records`.
4. `leave_requests`.
5. `tasks`.
6. `projects`.
7. `notifications`.
8. `audit_logs`.
9. `files`.

Khuyến nghị:

| Loại FK | Rule |
| --- | --- |
| Nghiệp vụ chính | `ON DELETE RESTRICT` |
| Actor audit nullable | `ON DELETE SET NULL` |
| File link | soft delete link, không cascade file |
| User avatar/logo file | `ON DELETE SET NULL` |
| Lookup/master data đang được dùng | `ON DELETE RESTRICT` |

---

## 12. Quy ước đặt tên migration

### 12.1 Format

```text
{YYYYMMDD}{NNNN}_{module}_{action}_{target}
```

Ví dụ:

```text
202606200001_foundation_enable_extensions
202606200010_foundation_create_base_tables
202606200020_foundation_create_ops_tables
202606200030_auth_create_tables
202606200040_hr_create_tables
202606200050_att_create_tables
202606200060_leave_create_tables
202606200070_task_create_tables
202606200080_noti_dash_create_tables
202606200090_cross_module_add_foreign_keys
202606200100_cross_module_add_indexes
```

### 12.2 Quy tắc version

| Thành phần | Ý nghĩa |
| --- | --- |
| `YYYYMMDD` | Ngày tạo migration |
| `NNNN` | Số thứ tự tăng dần |
| `module` | foundation/auth/hr/att/leave/task/noti_dash/cross_module |
| `action` | create/add/alter/backfill/index |
| `target` | bảng hoặc nhóm bảng tác động |

### 12.3 Checklist review migration file

- [ ] Tên migration rõ module và target.
- [ ] Không có câu lệnh destructive nếu chưa có approval.
- [ ] Constraint/index có tên rõ ràng.
- [ ] FK liên module đúng thứ tự.
- [ ] Bảng tenant-specific có `company_id`.
- [ ] Bảng nghiệp vụ có audit columns.
- [ ] Bảng soft delete có `deleted_at`, `deleted_by` nếu cần.
- [ ] Bảng lớn có index tối thiểu theo query chính.
- [ ] Migration chạy được trên database trống.
- [ ] Migration chạy được trong CI test database.

---

## 13. Thứ tự migration MVP

### 13.1 Dependency graph

```text
PostgreSQL extensions
  -> Foundation base tables
    -> Foundation ops tables
      -> AUTH tables
        -> HR tables
          -> ATT tables
          -> LEAVE tables
          -> TASK tables
            -> NOTI/DASH tables
              -> Cross-module FKs
                -> Indexes
                  -> Seed data
                    -> Bootstrap admin
                      -> Verification
```

### 13.2 Migration order chi tiết

| Bước | Nhóm | Nội dung | Phụ thuộc |
| --- | --- | --- | --- |
| M00 | Extension | `pgcrypto`, `pg_trgm`, `unaccent` | PostgreSQL |
| M01 | Foundation base | `companies`, `modules`, `system_settings`, `company_settings` | M00 |
| M02 | Foundation ops | `audit_logs`, `files`, `file_links`, `file_access_logs`, `sequence_counters`, `public_holidays`, `data_retention_policies`, `seed_batches`, `seed_items`, `system_job_runs`, `system_job_locks` | M01 |
| M03 | AUTH | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, sessions, password reset, login/security logs | M01-M02 |
| M04 | HR | departments, positions, job levels, contract types, employees, contracts, profile change, employee code configs | M03 |
| M05 | ATT | shifts, shift assignments, attendance rules, records, logs, adjustments, remote work | M04 |
| M06 | LEAVE | leave types, policies, balances, balance transactions, requests, request days, approvals | M04-M05 |
| M07 | TASK | projects, members, project files, tasks, assignees, watchers, comments, mentions, checklist, task files, activity logs | M04 |
| M08 | NOTI/DASH | events, templates, notifications, delivery logs, preferences, widgets, configs, cache, invalidations | M03-M07 |
| M09 | Cross-module FK | FK vòng và FK liên module | M01-M08 |
| M10 | Index | Index theo DB-09 | M01-M09 |
| S00 | Seed system | modules, system settings, permissions | M10 |
| S01 | Seed tenant | default company, company settings, sequences | S00 |
| S02 | Seed RBAC | roles, role permissions, bootstrap admin | S01 |
| S03 | Seed business defaults | HR/ATT/LEAVE/NOTI/DASH defaults | S02 |
| V00 | Verification | smoke test, FK/index check, permission check | S03 |

---

## 14. Migration batch chi tiết

## 14.1 M00 - Enable PostgreSQL extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Acceptance checklist:

- [ ] `gen_random_uuid()` hoạt động.
- [ ] Search extension sẵn sàng cho normalized/trigram search.
- [ ] Staging/production role có quyền tạo extension hoặc extension được DBA bật trước.

## 14.2 M01 - Foundation base tables

Tạo bảng:

```text
companies
modules
system_settings
company_settings
```

Yêu cầu chính:

- [ ] `companies.company_code` unique active.
- [ ] `companies.timezone` bắt buộc.
- [ ] `modules.module_code` unique active.
- [ ] `system_settings.setting_key` unique active.
- [ ] `company_settings.company_id + setting_key` unique active.
- [ ] `created_by`, `updated_by`, `deleted_by` tạm nullable vì `users` chưa tồn tại.

## 14.3 M02 - Foundation ops tables

Tạo bảng:

```text
audit_logs
files
file_links
file_access_logs
sequence_counters
public_holidays
data_retention_policies
seed_batches
seed_items
system_job_runs
system_job_locks
```

Yêu cầu chính:

- [ ] `audit_logs` append-only, không soft delete.
- [ ] `files.visibility` mặc định `Private`.
- [ ] `file_links` dùng `module_code`, `entity_type`, `entity_id`.
- [ ] `sequence_counters.company_id + sequence_key` unique.
- [ ] `public_holidays.company_id` nullable để hỗ trợ global holidays.
- [ ] `seed_batches` và `seed_items` có `seed_key`, `version`, `checksum`, `status`.
- [ ] `system_job_runs` ghi lịch sử chạy job nền: `job_code`, `status`, `triggered_by`, `started_at`, `finished_at`, `duration_ms`, item counts (BACKEND-11 §18.5/§22.1).
- [ ] `system_job_locks` giữ distributed lock job nền: `job_code` PK, `locked_by`, `locked_until`, `acquired_at` (BACKEND-11 §18.4/§22.2).

DDL cho `system_job_runs` và `system_job_locks` (đồng bộ BACKEND-11 §22):

```sql
CREATE TABLE system_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NULL,
  job_code VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL,
  triggered_by VARCHAR(50) NOT NULL,
  triggered_by_user_id UUID NULL,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP NULL,
  duration_ms BIGINT NULL,
  total_items INT DEFAULT 0,
  success_items INT DEFAULT 0,
  failed_items INT DEFAULT 0,
  error_message TEXT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_job_runs_job_time
ON system_job_runs (job_code, started_at DESC);

CREATE INDEX idx_system_job_runs_company_job_time
ON system_job_runs (company_id, job_code, started_at DESC);

CREATE TABLE system_job_locks (
  job_code VARCHAR(100) PRIMARY KEY,
  locked_by VARCHAR(255) NOT NULL,
  locked_until TIMESTAMP NOT NULL,
  acquired_at TIMESTAMP NOT NULL,
  metadata JSONB NULL
);
```

## 14.4 M03 - AUTH/RBAC tables

Tạo bảng:

```text
users
roles
permissions
user_roles
role_permissions
user_sessions
password_reset_tokens
login_logs
user_security_events
user_auth_providers
user_mfa_methods
```

Yêu cầu chính:

- [ ] `users.company_id + normalized_email` unique active.
- [ ] `roles.company_id` nullable cho global role.
- [ ] `permissions.permission_code` unique.
- [ ] `role_permissions.data_scope` check: Own/Team/Department/Project/Company/System.
- [ ] Session/reset token chỉ lưu hash.
- [ ] Login/security log có index theo company/time.

## 14.5 M04 - HR tables

Tạo bảng:

```text
departments
positions
job_levels
contract_types
employees
employee_contracts
employee_status_histories
employee_files
profile_change_requests
profile_change_request_items
employee_code_configs
```

Yêu cầu chính:

- [ ] Master data tạo trước employee.
- [ ] `employees.company_id + employee_code` unique active.
- [ ] `employees.company_id + user_id` unique active khi `user_id IS NOT NULL`.
- [ ] `employees.direct_manager_id` self-reference, có thể add FK sau.
- [ ] `departments.manager_employee_id` add FK sau.
- [ ] `profile_change_requests` có status machine rõ ràng.
- [ ] `employee_code_configs` phục vụ sinh mã nhân viên theo cấu hình.

## 14.6 M05 - ATT tables

Tạo bảng:

```text
shifts
shift_assignments
attendance_rules
attendance_records
attendance_logs
attendance_adjustment_requests
attendance_adjustment_items
remote_work_requests
remote_work_request_approvals
```

Yêu cầu chính:

- [ ] `shifts.company_id + shift_code` unique active.
- [ ] `shift_assignments` hỗ trợ scope Company/Department/Employee.
- [ ] `attendance_rules` hỗ trợ rule theo company/department/employee.
- [ ] `attendance_records.employee_id` FK employees.
- [ ] Unique logic: `company_id + employee_id + work_date + shift_id` nếu `shift_id` có giá trị.
- [ ] `attendance_logs` lưu log thô, server time, client metadata.
- [ ] Adjustment/remote request có status rõ ràng.

## 14.7 M06 - LEAVE tables

Tạo bảng:

```text
leave_types
leave_policies
leave_balances
leave_balance_transactions
leave_requests
leave_request_days
leave_request_approvals
```

Yêu cầu chính:

- [ ] `leave_types.company_id + leave_type_code` unique active.
- [ ] `leave_balances.company_id + employee_id + leave_type_id + balance_year` unique active.
- [ ] `leave_requests.company_id + leave_request_code` unique active.
- [ ] `leave_request_days` phục vụ lịch nghỉ và đồng bộ ATT.
- [ ] `leave_balance_transactions` là ledger, không được bỏ qua khi đổi số dư.
- [ ] Status: Draft/Pending/Approved/Rejected/Cancelled/Revoked.

## 14.8 M07 - TASK tables

Tạo bảng:

```text
projects
project_members
project_files
tasks
task_assignees
task_watchers
task_comments
task_comment_mentions
task_checklists
task_checklist_items
task_files
task_activity_logs
```

Yêu cầu chính:

- [ ] `projects.company_id + project_code` unique active.
- [ ] `tasks.company_id + task_code` unique active.
- [ ] `project_members.project_id + employee_id` unique active.
- [ ] `tasks.main_assignee_employee_id` để query nhanh.
- [ ] `task_assignees` vẫn giữ để mở rộng nhiều assignee.
- [ ] `task_activity_logs` lưu ledger nghiệp vụ.

## 14.9 M08 - NOTI/DASH tables

Tạo bảng:

```text
notification_events
notification_templates
notifications
notification_delivery_logs
notification_preferences
dashboard_widgets
dashboard_widget_configs
dashboard_widget_cache
dashboard_user_widget_states
dashboard_cache_invalidations
```

Yêu cầu chính:

- [ ] Notification event có global/company override.
- [ ] Notification template có channel/locale.
- [ ] Một dòng notification tương ứng một recipient.
- [ ] Có `dedupe_key` để chống trùng.
- [ ] Dashboard chỉ lưu catalog/config/cache, không lưu dữ liệu nghiệp vụ gốc.
- [ ] Cache có `ttl_seconds`, `generated_at`, `expires_at`, `status`.

## 14.10 M09 - Cross-module foreign keys

FK thêm sau khi các bảng đã tồn tại:

```text
companies.created_by -> users.id
companies.logo_file_id -> files.id
users.avatar_file_id -> files.id
files.uploaded_by -> users.id
departments.manager_employee_id -> employees.id
employees.user_id -> users.id
employees.direct_manager_id -> employees.id
employee_files.file_id -> files.id
project_files.file_id -> files.id
task_files.file_id -> files.id
leave_requests.employee_id -> employees.id
attendance_records.employee_id -> employees.id
notifications.recipient_user_id -> users.id
```

Rule:

1. FK nghiệp vụ chính dùng `ON DELETE RESTRICT`.
2. FK actor nullable có thể dùng `ON DELETE SET NULL`.
3. Không cascade delete employee/user/attendance/leave/task.
4. Dữ liệu nghiệp vụ dùng soft delete.

## 14.11 M10 - Index migration

Áp dụng index theo nhóm:

1. Index bắt đầu bằng `company_id` cho bảng tenant-specific.
2. Partial index cho dữ liệu active: `WHERE deleted_at IS NULL`.
3. Unique business key theo company.
4. Index FK thường join/filter.
5. Index notification unread count.
6. Index attendance theo employee/date.
7. Index leave request pending/approved day.
8. Index task theo assignee/status/due.
9. Index audit/log theo time.
10. Index search bằng trigram nếu cần.

---

## 15. ORM schema convention

### 15.1 Drizzle config (`drizzle.config.ts`)

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './migrations',
  // migration áp qua kết nối DIRECT (không qua PgBouncer transaction-mode)
  dbCredentials: { url: process.env.DATABASE_DIRECT_URL! },
});
```

### 15.2 Mapping table và column

Quy ước:

1. Database dùng `snake_case`.
2. TypeScript field dùng `camelCase`; map sang cột snake_case ở tham số `column('snake_case')`.
3. Tên biến table số nhiều: `users`, `employees`, `leaveRequests` (trỏ bảng `users`, `employees`, `leave_requests`).
4. Enum trong code dùng PascalCase nhưng database lưu string ổn định.

Ví dụ:

```ts
import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id:              uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId:       uuid('company_id').notNull(),
  email:           varchar('email', { length: 255 }).notNull(),
  normalizedEmail: varchar('normalized_email', { length: 255 }).notNull(),
  displayName:     varchar('display_name', { length: 255 }).notNull(),
  passwordHash:    text('password_hash'),
  status:          varchar('status', { length: 50 }).notNull(),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt:       timestamp('deleted_at', { withTimezone: true }),
});
```

### 15.3 Common fields

Các bảng nghiệp vụ chính nên có:

```text
id
company_id
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
metadata JSONB nếu cần mở rộng
```

Bảng ledger/log có thể không có soft delete:

```text
audit_logs
login_logs
attendance_logs
leave_balance_transactions
task_activity_logs
notification_delivery_logs
file_access_logs
```

### 15.4 Không lạm dụng enum DB

Có thể dùng `VARCHAR + CHECK constraint` thay vì PostgreSQL enum cho status trong MVP, vì:

1. Dễ migration khi bổ sung status.
2. Dễ tương thích với Drizzle.
3. Dễ seed/config theo module.

Nhưng phải có check constraint cho status quan trọng.

Ví dụ:

```sql
ALTER TABLE leave_requests
ADD CONSTRAINT chk_leave_requests_status
CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected', 'Cancelled', 'Revoked'));
```

---

## 16. ORM repository pattern

### 16.1 Nguyên tắc repository

Repository chỉ xử lý database query, không chứa business workflow phức tạp.

```text
Controller
-> DTO validation
-> Service business rule
-> Repository query/mutation
-> Drizzle/database
```

Không để controller gọi trực tiếp ORM client.

### 16.2 Base repository convention

```ts
export interface TenantContext {
  companyId: string;
  actorUserId?: string;
  requestId?: string;
}

export interface ListQuery {
  page?: number;
  perPage?: number;
  search?: string;
  sort?: string;
  filters?: Record<string, unknown>;
}
```

Mọi repository nghiệp vụ phải nhận `companyId` từ backend auth context, không nhận từ request body frontend.

### 16.3 Ví dụ EmployeeRepository

> RLS đã ép cô lập tenant ở tầng DB, nhưng repository VẪN lọc `company_id` tường minh (defense-in-depth)
> và mọi truy vấn nghiệp vụ chạy trong `db.withTenant(companyId, (tx) => …)` để set GUC `app.current_company_id`.

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { employees } from 'src/db/schema';
import { DatabaseService } from 'src/db/db.service';

export class EmployeeRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(ctx: TenantContext, employeeId: string) {
    return this.db.withTenant(ctx.companyId, (tx) =>
      tx.query.employees.findFirst({
        where: and(
          eq(employees.id, employeeId),
          eq(employees.companyId, ctx.companyId),
          isNull(employees.deletedAt)
        )
      })
    );
  }

  async findByUserId(ctx: TenantContext, userId: string) {
    return this.db.withTenant(ctx.companyId, (tx) =>
      tx.query.employees.findFirst({
        where: and(
          eq(employees.companyId, ctx.companyId),
          eq(employees.userId, userId),
          isNull(employees.deletedAt)
        )
      })
    );
  }
}
```

### 16.4 Query luôn filter theo tenant

Mẫu đúng:

```ts
where: and(
  eq(employees.companyId, ctx.companyId),
  isNull(employees.deletedAt)
)
```

Mẫu không được dùng:

```ts
where: isNull(employees.deletedAt)
```

Ngoại lệ chỉ dành cho:

1. Super Admin có System scope.
2. Bảng global: `permissions`, `modules`, `system_settings`.
3. Query migration/seed nội bộ có kiểm soát.

---

## 17. Transaction pattern

### 17.1 Khi nào bắt buộc transaction

Bắt buộc dùng transaction khi:

1. Tạo employee kèm user/contract/status history/file link.
2. Sinh mã tự động bằng `sequence_counters`.
3. Gửi đơn nghỉ và giữ/trừ balance.
4. Duyệt đơn nghỉ và đồng bộ ATT/NOTI/DASH cache invalidation.
5. Check-in/check-out cập nhật record và insert log.
6. Tạo task kèm assignee/watcher/activity/notification event.
7. Seed nhiều bảng phụ thuộc nhau.
8. Bootstrap admin và role assignment.

### 17.2 Transaction service

> Transaction nghiệp vụ luôn đi qua `db.withTenant(companyId, …)` để set `app.current_company_id` (RLS).
> `TenantTx` = kiểu transaction-scoped client của Drizzle (xem `src/db/db.service.ts`).

```ts
import { DatabaseService, type TenantTx } from 'src/db/db.service';

export class TransactionService {
  constructor(private readonly db: DatabaseService) {}

  run<T>(
    companyId: string,
    handler: (tx: TenantTx) => Promise<T>
  ): Promise<T> {
    return this.db.withTenant(companyId, handler);
  }
}
```

### 17.3 Row lock cho sequence counter

Drizzle hỗ trợ `SELECT ... FOR UPDATE` ngay trên fluent API qua `.for('update')`, nên KHÔNG cần raw SQL.
`tx` ở đây là `TenantTx` (transaction-scoped client do `withTenant` trao) — row lock phải nằm cùng
transaction với phần ghi để giữ khóa tới khi commit.

```ts
import { and, eq } from 'drizzle-orm';
import { sequenceCounters } from 'src/db/schema';
import { type TenantTx } from 'src/db/db.service';

async function nextSequence(
  tx: TenantTx,
  companyId: string,
  sequenceKey: string
): Promise<number> {
  const rows = await tx
    .select({ id: sequenceCounters.id, currentValue: sequenceCounters.currentValue })
    .from(sequenceCounters)
    .where(
      and(
        eq(sequenceCounters.companyId, companyId),
        eq(sequenceCounters.sequenceKey, sequenceKey)
      )
    )
    .for('update');

  if (rows.length === 0) {
    throw new Error(`Sequence counter not found: ${sequenceKey}`);
  }

  const currentValue = Number(rows[0].currentValue);
  const nextValue = currentValue + 1;

  await tx
    .update(sequenceCounters)
    .set({ currentValue: nextValue, updatedAt: new Date() })
    .where(eq(sequenceCounters.id, rows[0].id));

  return nextValue;
}
```

Không dùng:

```sql
SELECT MAX(employee_code) + 1
```

---

## 18. Soft delete pattern

### 18.1 Quy ước soft delete

Thay vì xóa cứng dữ liệu nghiệp vụ:

```ts
import { eq } from 'drizzle-orm';
import { employees } from 'src/db/schema';

// tx = TenantTx trong db.withTenant(companyId, …)
await tx
  .update(employees)
  .set({
    deletedAt: new Date(),
    deletedBy: actorUserId,
    updatedAt: new Date(),
    updatedBy: actorUserId
  })
  .where(eq(employees.id, id));
```

### 18.2 Query active mặc định

Repository list/detail mặc định phải thêm:

```ts
deletedAt: null
```

### 18.3 Unique active index

Ví dụ:

```sql
CREATE UNIQUE INDEX uq_employees_company_employee_code_active
ON employees (company_id, employee_code)
WHERE deleted_at IS NULL;
```

Điều này cho phép khôi phục hoặc tái sử dụng mã theo policy riêng, nhưng mặc định không nên tái sử dụng mã nhân viên nếu doanh nghiệp yêu cầu truy vết lâu dài.

---

## 19. Seed architecture

### 19.1 Mục tiêu seed

Seed phải tạo được database MVP có thể chạy ngay:

1. Module catalog.
2. Company mặc định.
3. System settings.
4. Company settings.
5. Permissions.
6. Roles mặc định.
7. Role-permission matrix.
8. Bootstrap admin.
9. HR master data.
10. Attendance defaults.
11. Leave defaults.
12. Notification events/templates.
13. Dashboard widgets/configs.
14. Sequence counters.
15. Public holidays tối thiểu.

### 19.2 Seed layers

| Layer | Tên | Nội dung |
| --- | --- | --- |
| S00 | System seed | Modules, system settings, permissions global |
| S01 | Tenant seed | Default company, company settings, sequence counters |
| S02 | RBAC seed | Roles, role permissions, bootstrap admin |
| S03 | HR seed | Job levels, contract types, employee code config |
| S04 | ATT seed | Shifts, attendance rules, shift assignment mặc định |
| S05 | LEAVE seed | Leave types, leave policy mặc định |
| S06 | TASK seed | Project/task sequence counters, optional status/priority lookup nếu dùng |
| S07 | NOTI seed | Notification events và templates |
| S08 | DASH seed | Dashboard widgets và widget configs |
| S09 | Dev-only seed | Sample employees/tasks/leaves cho local/test |

### 19.3 Seed tracking

Mỗi seed batch ghi:

```text
seed_batches
seed_items
```

Thông tin tối thiểu:

| Field | Ý nghĩa |
| --- | --- |
| `batch_key` | Tên batch seed, ví dụ `system.modules.v1` |
| `seed_key` | Key của từng item seed |
| `seed_version` | Version nội dung seed |
| `checksum` | Hash payload seed |
| `status` | Pending/Applied/Skipped/Failed |
| `applied_at` | Thời điểm áp dụng |
| `environment` | local/dev/staging/prod |
| `error_message` | Lỗi nếu có |

### 19.4 Seed idempotent

Business key seed:

| Dữ liệu | Business key |
| --- | --- |
| Module | `module_code` |
| Permission | `permission_code` |
| Global role | `role_code` với `company_id IS NULL` |
| Company role | `company_id + role_code` |
| System setting | `setting_key` |
| Company setting | `company_id + setting_key` |
| Notification event | `company_id/global + event_code` |
| Notification template | `event_code + channel + locale + company_id/global` |
| Dashboard widget | `widget_code` |
| Leave type | `company_id + leave_type_code` |
| Sequence counter | `company_id + sequence_key` |

---

## 20. Seed runner design

### 20.1 Seed function interface

```ts
import { type Database } from 'src/db';
import { type TenantTx } from 'src/db/db.service';

export interface SeedContext {
  db: Database | TenantTx; // Drizzle client (hoặc tx khi chạy trong transaction)
  env: string;
  now: Date;
  defaultCompanyId?: string;
  actorUserId?: string;
}

export interface SeedDefinition {
  key: string;
  version: string;
  description: string;
  run(ctx: SeedContext): Promise<void>;
}
```

### 20.2 Seed runner flow

```text
load env
-> connect database
-> verify migrations are applied
-> start seed batch
-> run seeds in fixed order
-> for each seed: compute checksum
-> check seed_items
-> apply upsert if new or changed
-> record Applied/Skipped/Failed
-> stop on critical failure
-> print summary without secrets
```

### 20.3 Pseudocode seed runner

```ts
import { and, eq } from 'drizzle-orm';
import { seedItems } from 'src/db/schema';

async function runSeed(seed: SeedDefinition, ctx: SeedContext) {
  const checksum = createChecksum(seed);

  const existing = await ctx.db.query.seedItems.findFirst({
    where: and(
      eq(seedItems.seedKey, seed.key),
      eq(seedItems.seedVersion, seed.version),
      eq(seedItems.checksum, checksum),
      eq(seedItems.status, 'Applied')
    )
  });

  if (existing) {
    await markSkipped(seed, ctx);
    return;
  }

  try {
    await ctx.db.transaction(async (tx) => {
      await seed.run({ ...ctx, db: tx });
      await markApplied(seed, checksum, ctx);
    });
  } catch (error) {
    await markFailed(seed, error, ctx);
    throw error;
  }
}
```

### 20.4 Không log dữ liệu nhạy cảm

Log được phép:

```text
Seed applied: system.modules.v1
Seed skipped: rbac.permissions.v1
Seed failed: tenant.default-company.v1, reason: duplicate key
```

Không log:

```text
Admin password
Token hash
Secret ref value
SMTP password
Private storage key
```

---

## 21. Seed modules

### 21.1 MVP active modules

| Module code | Tên module | Group | Core | MVP | Active | Sort |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH | Tài khoản & phân quyền | Core | true | true | true | 10 |
| HR | Quản lý nhân sự | Core | true | true | true | 20 |
| ATT | Chấm công | Operation | false | true | true | 30 |
| LEAVE | Nghỉ phép | Operation | false | true | true | 40 |
| TASK | Công việc & Dự án | Collaboration | false | true | true | 50 |
| DASH | Dashboard | Experience | false | true | true | 60 |
| NOTI | Thông báo hệ thống | Experience | false | true | true | 70 |

### 21.2 Phase sau inactive modules

| Module code | Tên module | Phase | Active |
| --- | --- | --- | --- |
| PAYROLL | Tiền lương | Phase 2 | false |
| RECRUIT | Tuyển dụng | Phase 2 | false |
| ASSET | Tài sản | Phase 3 | false |
| ROOM | Phòng họp | Phase 3 | false |
| CHAT | Chat nội bộ | Phase 4 | false |
| SOCIAL | Mạng xã hội nội bộ | Phase 4 | false |
| MOBILE | Mobile app | Phase sau | false |
| AI | AI & tích hợp | Phase sau | false |

---

## 22. Seed permissions

### 22.1 Permission code convention

```text
{MODULE}.{RESOURCE}.{ACTION}
```

Ví dụ:

```text
AUTH.USER.VIEW
AUTH.USER.CREATE
HR.EMPLOYEE.VIEW
HR.EMPLOYEE.CREATE
ATT.ATTENDANCE.CHECK_IN
LEAVE.REQUEST.APPROVE
TASK.TASK.UPDATE_STATUS
NOTI.NOTIFICATION.VIEW_OWN
DASH.DASHBOARD.VIEW
FOUNDATION.AUDIT_LOG.VIEW
```

### 22.2 Action convention

| Action | Ý nghĩa |
| --- | --- |
| VIEW | Xem danh sách/chi tiết |
| CREATE | Tạo mới |
| UPDATE | Cập nhật |
| DELETE | Xóa mềm |
| APPROVE | Duyệt |
| REJECT | Từ chối |
| CANCEL | Hủy |
| EXPORT | Xuất dữ liệu |
| CONFIGURE | Cấu hình |
| ASSIGN | Gán |
| CHECK_IN | Check-in |
| CHECK_OUT | Check-out |
| MARK_READ | Đánh dấu đã đọc |

### 22.3 Data scope seed

| Scope | Ý nghĩa |
| --- | --- |
| Own | Dữ liệu của chính user/employee |
| Team | Nhân viên cấp dưới trực tiếp/team quản lý |
| Department | Phòng ban hoặc đơn vị phụ trách |
| Project | Dữ liệu thuộc project mà user tham gia/quản lý |
| Company | Toàn bộ công ty hiện tại |
| System | Liên công ty/toàn hệ thống, chỉ Super Admin |

---

## 23. Seed roles mặc định

### 23.1 Role mặc định MVP

| Role code | Tên hiển thị | Company-specific | Mô tả |
| --- | --- | --- | --- |
| SUPER_ADMIN | Super Admin | No | Quản trị toàn hệ thống, có scope System |
| COMPANY_ADMIN | Company Admin | Yes | Quản trị một công ty/tenant |
| HR | HR | Yes | Quản lý nhân sự, chấm công, nghỉ phép theo quyền |
| MANAGER | Manager | Yes | Quản lý team, duyệt nghỉ/điều chỉnh công, giao task |
| EMPLOYEE | Employee | Yes | Nhân viên dùng hệ thống hằng ngày |

### 23.2 Role seed rule

1. `SUPER_ADMIN` có `company_id = NULL` hoặc company hệ thống tùy thiết kế.
2. `COMPANY_ADMIN`, `HR`, `MANAGER`, `EMPLOYEE` seed theo company.
3. Role không được hard-code trong backend business logic.
4. Permission + data scope mới là nguồn kiểm tra chính.
5. Role chỉ là seed mặc định để cấp quyền nhanh.

---

## 24. Role-permission matrix MVP

### 24.1 Matrix cấp cao

| Module | Employee | Manager | HR | Company Admin | Super Admin |
| --- | --- | --- | --- | --- | --- |
| AUTH | Account own | User limited nếu được cấp | User limited nếu được cấp | User/role/permission company | System |
| HR | My profile | Team profile basic | Company HR data | Company HR data | System |
| ATT | Own attendance | Team attendance/approval | Company attendance | Company attendance/config | System |
| LEAVE | Own leave | Team approval | Company leave/admin | Company leave/admin | System |
| TASK | Own/project task | Team/project management | View nếu tham gia/cấp quyền | Company task admin | System |
| NOTI | Own notification | Own notification | Own/admin nếu cấp | Company notification config | System |
| DASH | Own dashboard | Manager dashboard | HR dashboard | Admin dashboard | System dashboard |
| FOUNDATION | Không | Không | Một số config nếu cấp | Company settings/audit | System settings |

### 24.2 Ví dụ role-permission cụ thể

| Role | Permission | Scope |
| --- | --- | --- |
| EMPLOYEE | DASH.DASHBOARD.VIEW | Own |
| EMPLOYEE | HR.MY_PROFILE.VIEW | Own |
| EMPLOYEE | HR.PROFILE_CHANGE_REQUEST.CREATE | Own |
| EMPLOYEE | ATT.ATTENDANCE.CHECK_IN | Own |
| EMPLOYEE | ATT.ATTENDANCE.CHECK_OUT | Own |
| EMPLOYEE | ATT.ATTENDANCE_RECORD.VIEW | Own |
| EMPLOYEE | LEAVE.REQUEST.CREATE | Own |
| EMPLOYEE | LEAVE.REQUEST.VIEW | Own |
| EMPLOYEE | TASK.TASK.VIEW | Own, Project |
| EMPLOYEE | TASK.TASK.UPDATE_STATUS | Own, Project |
| EMPLOYEE | NOTI.NOTIFICATION.VIEW | Own |
| MANAGER | HR.EMPLOYEE.VIEW | Team |
| MANAGER | ATT.ATTENDANCE_RECORD.VIEW | Team |
| MANAGER | ATT.ADJUSTMENT.APPROVE | Team |
| MANAGER | LEAVE.REQUEST.APPROVE | Team |
| MANAGER | TASK.PROJECT.CREATE | Team, Project |
| MANAGER | TASK.TASK.ASSIGN | Team, Project |
| HR | HR.EMPLOYEE.VIEW | Company |
| HR | HR.EMPLOYEE.CREATE | Company |
| HR | HR.EMPLOYEE.UPDATE | Company |
| HR | ATT.ATTENDANCE_RECORD.VIEW | Company |
| HR | ATT.ADJUSTMENT.APPROVE | Company |
| HR | LEAVE.REQUEST.APPROVE | Company |
| HR | LEAVE.BALANCE.UPDATE | Company |
| COMPANY_ADMIN | AUTH.USER.MANAGE | Company |
| COMPANY_ADMIN | AUTH.ROLE.MANAGE | Company |
| COMPANY_ADMIN | FOUNDATION.SETTING.UPDATE | Company |
| SUPER_ADMIN | `*` hoặc toàn bộ permission | System |

---

## 25. Seed company và settings

### 25.1 Default company

Seed khi chưa có company:

| Field | Giá trị mặc định |
| --- | --- |
| `company_code` | từ `BOOTSTRAP_COMPANY_CODE`, mặc định `DEFAULT` |
| `name` | từ `BOOTSTRAP_COMPANY_NAME`, mặc định `Default Company` |
| `timezone` | `Asia/Ho_Chi_Minh` |
| `default_locale` | `vi-VN` |
| `currency_code` | `VND` |
| `status` | Active |

### 25.2 System settings seed

| Key | Value | Public | Sensitive |
| --- | --- | --- | --- |
| `system.default_timezone` | `Asia/Ho_Chi_Minh` | true | false |
| `system.default_locale` | `vi-VN` | true | false |
| `file.max_upload_size_mb` | `20` | true | false |
| `file.allowed_mime_types` | `application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document` | true | false |
| `audit.default_retention_days` | `365` | false | false |
| `security.password_min_length` | `8` | false | false |
| `security.session_ttl_minutes` | `1440` | false | false |
| `notification.default_channel` | `in_app` | false | false |

### 25.3 Company settings seed

| Key | Value |
| --- | --- |
| `company.timezone` | `Asia/Ho_Chi_Minh` |
| `company.locale` | `vi-VN` |
| `company.currency` | `VND` |
| `module.AUTH.enabled` | true |
| `module.HR.enabled` | true |
| `module.ATT.enabled` | true |
| `module.LEAVE.enabled` | true |
| `module.TASK.enabled` | true |
| `module.DASH.enabled` | true |
| `module.NOTI.enabled` | true |
| `file.max_upload_size_mb` | 20 |
| `notification.in_app.enabled` | true |

---

## 26. Seed sequence counters

### 26.1 Sequence keys MVP

| Sequence key | Dùng cho | Prefix mặc định | Padding |
| --- | --- | --- | --- |
| `employee_code` | Mã nhân viên | EMP | 4 |
| `leave_request_code` | Mã đơn nghỉ | LR | 6 |
| `project_code` | Mã dự án | PRJ | 5 |
| `task_code` | Mã task | TASK | 6 |
| `attendance_adjustment_code` | Mã yêu cầu điều chỉnh công | ATTADJ | 6 |
| `remote_work_request_code` | Mã yêu cầu remote/công tác | REMOTE | 6 |
| `file_code` | Mã file nội bộ nếu cần | FILE | 8 |

### 26.2 Rule

1. Mỗi sequence thuộc company.
2. Không dùng `MAX(code) + 1`.
3. Service sinh mã phải lock row bằng `FOR UPDATE`.
4. Format code nên cấu hình được qua `employee_code_configs` hoặc metadata sequence.
5. Nếu có reset theo năm/tháng, cần lưu `reset_policy`, `last_reset_at`.

---

## 27. Seed HR defaults

### 27.1 Job levels

| Code | Name | Sort |
| --- | --- | --- |
| INTERN | Thực tập sinh | 10 |
| JUNIOR | Junior | 20 |
| MIDDLE | Middle | 30 |
| SENIOR | Senior | 40 |
| LEAD | Lead | 50 |
| MANAGER | Manager | 60 |
| DIRECTOR | Director | 70 |

### 27.2 Contract types

| Code | Name |
| --- | --- |
| PROBATION | Hợp đồng thử việc |
| OFFICIAL | Hợp đồng chính thức |
| FIXED_TERM | Hợp đồng xác định thời hạn |
| PART_TIME | Hợp đồng bán thời gian |
| INTERN | Thực tập |
| FREELANCER | Cộng tác viên |

### 27.3 Employee code config

| Field | Default |
| --- | --- |
| `prefix` | EMP |
| `padding_length` | 4 |
| `include_year` | false |
| `separator` | empty |
| `allow_manual_edit` | false |
| `next_sequence_key` | employee_code |

---

## 28. Seed attendance defaults

### 28.1 Default shift

| Field | Value |
| --- | --- |
| `shift_code` | OFFICE_8H |
| `name` | Ca hành chính 8 giờ |
| `start_time` | 08:30 |
| `end_time` | 17:30 |
| `break_start_time` | 12:00 |
| `break_end_time` | 13:00 |
| `required_working_minutes` | 480 |
| `is_flexible` | false |
| `status` | Active |

### 28.2 Attendance rule default

| Rule | Default |
| --- | --- |
| `allow_web_checkin` | true |
| `allow_mobile_checkin` | true |
| `late_after_minutes` | 5 |
| `early_leave_before_minutes` | 5 |
| `allow_remote_checkin` | false |
| `auto_checkout_enabled` | false |
| `block_checkin_when_approved_leave` | true |
| `require_note_for_adjustment` | true |
| `manager_can_approve_team_adjustment` | true |
| `hr_can_manual_adjust` | true |

---

## 29. Seed leave defaults

### 29.1 Leave types

| Code | Name | Paid | Requires balance | Requires attachment |
| --- | --- | --- | --- | --- |
| ANNUAL | Nghỉ phép năm | true | true | false |
| SICK | Nghỉ ốm | true | false hoặc theo policy | true nếu cấu hình |
| UNPAID | Nghỉ không lương | false | false | false |
| PERSONAL | Nghỉ việc riêng | true | true | false |
| MATERNITY | Nghỉ thai sản | true | false | true |
| BEREAVEMENT | Nghỉ tang | true | false | true nếu cấu hình |

### 29.2 Leave policy default

| Field | Default |
| --- | --- |
| `policy_code` | DEFAULT_ANNUAL_POLICY |
| `annual_days` | 12 |
| `accrual_method` | Yearly hoặc Manual trong MVP |
| `allow_half_day` | true |
| `allow_hourly` | false |
| `exclude_public_holidays` | true |
| `exclude_weekends` | true |
| `require_manager_approval` | true |
| `allow_hr_override` | true |

---

## 30. Seed notification defaults

### 30.1 Notification events MVP

| Event code | Module | Mô tả |
| --- | --- | --- |
| `USER_CREATED` | AUTH | Tài khoản được tạo |
| `USER_LOCKED` | AUTH | Tài khoản bị khóa |
| `HR_PROFILE_CHANGE_SUBMITTED` | HR | Employee gửi yêu cầu sửa hồ sơ |
| `HR_PROFILE_CHANGE_APPROVED` | HR | Yêu cầu sửa hồ sơ được duyệt |
| `ATT_ADJUSTMENT_SUBMITTED` | ATT | Gửi yêu cầu điều chỉnh công |
| `ATT_ADJUSTMENT_APPROVED` | ATT | Điều chỉnh công được duyệt |
| `ATT_ADJUSTMENT_REJECTED` | ATT | Điều chỉnh công bị từ chối |
| `ATT_MISSING_CHECKOUT` | ATT | Quên check-out |
| `ATT_REMOTE_REQUEST_SUBMITTED` | ATT | Gửi request remote/công tác |
| `LEAVE_REQUEST_SUBMITTED` | LEAVE | Gửi đơn nghỉ |
| `LEAVE_REQUEST_APPROVED` | LEAVE | Đơn nghỉ được duyệt |
| `LEAVE_REQUEST_REJECTED` | LEAVE | Đơn nghỉ bị từ chối |
| `LEAVE_REQUEST_CANCELLED` | LEAVE | Đơn nghỉ bị hủy |
| `TASK_ASSIGNED` | TASK | Được giao task |
| `TASK_STATUS_CHANGED` | TASK | Trạng thái task thay đổi |
| `TASK_COMMENT_CREATED` | TASK | Có comment mới |
| `TASK_MENTIONED` | TASK | Được mention trong task |
| `TASK_DUE_SOON` | TASK | Task sắp đến hạn |
| `TASK_OVERDUE` | TASK | Task quá hạn |

### 30.2 Template convention

| Field | Example |
| --- | --- |
| `channel` | in_app |
| `locale` | vi-VN |
| `title_template` | `Bạn có đơn nghỉ mới cần duyệt` |
| `body_template` | `{{employee_name}} đã gửi đơn nghỉ từ {{start_date}} đến {{end_date}}.` |
| `target_module` | LEAVE |
| `target_route_template` | `/leave/requests/{{request_id}}` |
| `is_active` | true |

---

## 31. Seed dashboard defaults

### 31.1 Dashboard widgets MVP

| Widget code | Dashboard type | Module nguồn | Mô tả |
| --- | --- | --- | --- |
| `attendance_today` | Employee | ATT | Trạng thái check-in/check-out hôm nay |
| `my_leave_balance` | Employee | LEAVE | Số ngày phép còn lại |
| `my_tasks_today` | Employee | TASK | Task của tôi hôm nay |
| `my_notifications` | Employee | NOTI | Thông báo mới |
| `team_leave_pending` | Manager | LEAVE | Đơn nghỉ team chờ duyệt |
| `team_attendance_exceptions` | Manager | ATT | Bất thường chấm công team |
| `team_overdue_tasks` | Manager | TASK | Task team quá hạn |
| `hr_employee_summary` | HR | HR | Tổng quan nhân sự |
| `hr_contract_expiring` | HR | HR | Hợp đồng sắp hết hạn |
| `hr_leave_pending` | HR | LEAVE | Đơn nghỉ toàn công ty chờ xử lý |
| `admin_user_summary` | Admin | AUTH | Tổng quan tài khoản |
| `system_module_status` | Admin | FOUNDATION | Trạng thái module |

### 31.2 Widget config rule

1. Widget hiển thị theo permission, không hard-code theo role.
2. Seed config mặc định theo role để UX ban đầu dễ dùng.
3. Dashboard cache có TTL ngắn cho widget thường xuyên thay đổi.
4. Widget không được lưu dữ liệu nghiệp vụ gốc, chỉ lưu cache tổng hợp.

---

## 32. Bootstrap admin

### 32.1 Mục tiêu

Sau migration + seed, hệ thống phải có ít nhất một tài khoản quản trị để đăng nhập và tiếp tục cấu hình.

### 32.2 Quy tắc bảo mật

1. Không hardcode admin password trong code.
2. Password lấy từ env/secret manager hoặc CLI input.
3. Password phải được hash bằng Argon2id hoặc bcrypt.
4. Nếu admin đã tồn tại, không overwrite password trừ khi có flag rõ ràng.
5. Production chỉ cho bootstrap admin khi `SEED_ALLOW_BOOTSTRAP_ADMIN=true`.
6. Log không in password.
7. Sau bootstrap nên yêu cầu đổi mật khẩu lần đầu nếu policy bật.

### 32.3 Bootstrap admin flow

```text
read BOOTSTRAP_ADMIN_EMAIL
-> normalize email
-> find default company
-> find/create admin user
-> hash password if creating new user
-> assign COMPANY_ADMIN role
-> assign SUPER_ADMIN role nếu môi trường single-admin/system admin yêu cầu
-> create login/security event
-> create audit log
-> mark seed item applied
```

### 32.4 Pseudocode

```ts
import { eq } from 'drizzle-orm';
import { companies, users } from 'src/db/schema';

async function bootstrapAdmin(ctx: SeedContext) {
  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing bootstrap admin credentials');
  }

  const passwordHash = await hashPassword(password);

  await ctx.db.transaction(async (tx) => {
    const company = await tx.query.companies.findFirst({
      where: eq(companies.companyCode, process.env.BOOTSTRAP_COMPANY_CODE ?? 'DEFAULT')
    });
    if (!company) {
      throw new Error('Bootstrap company not found');
    }

    // Drizzle: insert ... onConflictDoUpdate (UNIQUE company_id + normalized_email)
    const [user] = await tx
      .insert(users)
      .values({
        companyId: company.id,
        email,
        normalizedEmail: email,
        displayName: process.env.BOOTSTRAP_ADMIN_NAME ?? 'System Admin',
        passwordHash,
        status: 'Active'
      })
      .onConflictDoUpdate({
        target: [users.companyId, users.normalizedEmail],
        set: { status: 'Active', updatedAt: new Date() }
      })
      .returning();

    await assignRoleIfMissing(tx, company.id, user.id, 'COMPANY_ADMIN');
  });
}
```

---

## 33. Drizzle schema management

### 33.1 Schema-first (TypeScript) + drizzle-kit sync

Quy trình đề xuất:

```text
1. Cập nhật schema TypeScript trong src/db/schema/*.ts theo DB design.
2. drizzle-kit generate -> sinh migration.sql.
3. Bổ sung tay phần raw SQL (RLS+FORCE, partial/GIN index, trigger append-only).
4. Áp migration local (tsx src/db/migrate.ts).
5. Viết repository/service dùng drizzle qua withTenant().
6. Chạy test database.
```

### 33.2 Không để ORM tự làm hỏng constraint/index

Với các index/constraint advanced:

1. Giữ trong file `migration.sql` (raw SQL).
2. Comment rõ trong schema `*.ts` nếu Drizzle không biểu diễn được (giữ phần đó ở SQL tự viết).
3. Không tạo migration tự động làm drop partial index.
4. Review migration diff trước khi commit.

### 33.3 Drift detection

CI nên chạy:

```bash
pnpm db:migrate:status
pnpm db:check
pnpm test:db
```

`db:check` cần kiểm tra:

1. Required extensions tồn tại.
2. Required tables tồn tại.
3. Required indexes tồn tại.
4. Required seed records tồn tại.
5. Có ít nhất một admin active.

---

## 34. Index implementation checklist

### 34.1 Cross-module indexes bắt buộc

- [ ] Bảng tenant-specific có index bắt đầu bằng `company_id`.
- [ ] Business code có unique index theo company.
- [ ] Bảng soft delete có partial index active.
- [ ] FK thường join/filter có index phía child.
- [ ] `notifications` có partial index unread.
- [ ] `attendance_records` có unique/index theo employee/date/shift.
- [ ] `leave_request_days` có index employee/date.
- [ ] `tasks` có index assignee/status/due.
- [ ] `audit_logs`, `login_logs`, `attendance_logs`, `notification_delivery_logs` có index time.
- [ ] Search fields có trigram/normalized index nếu dùng search.

### 34.2 Ví dụ index quan trọng

```sql
CREATE UNIQUE INDEX uq_users_company_email_active
ON users (company_id, normalized_email)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_employees_company_employee_code_active
ON employees (company_id, employee_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_company_employee_date
ON attendance_records (company_id, employee_id, work_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_requests_pending_active
ON leave_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL AND status = 'Pending';

CREATE INDEX idx_notifications_unread_user
ON notifications (company_id, recipient_user_id, created_at DESC)
WHERE read_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_tasks_company_status_due
ON tasks (company_id, status, due_at ASC)
WHERE deleted_at IS NULL;
```

---

## 35. Database health check

### 35.1 Health check cơ bản

Endpoint nội bộ hoặc service health cần kiểm tra:

1. Kết nối PostgreSQL.
2. Query đơn giản `SELECT 1`.
3. Migration table tồn tại.
4. Required tables tồn tại.
5. Database timezone đúng expectation nếu cần.
6. Connection pool không cạn.

### 35.2 `db:check` script

Script `db:check` nên kiểm tra:

```text
Extensions:
- pgcrypto
- pg_trgm
- unaccent

Tables:
- companies
- users
- employees
- attendance_records
- leave_requests
- tasks
- notifications
- dashboard_widgets

Seeds:
- module AUTH active
- module HR active
- permission AUTH.USER.VIEW tồn tại
- role COMPANY_ADMIN tồn tại
- company DEFAULT active
- at least one active admin user

Indexes:
- uq_users_company_email_active
- uq_employees_company_employee_code_active
- idx_notifications_unread_user
```

---

## 36. Test strategy cho migration/seed

### 36.1 Test database từ trạng thái trống

Test bắt buộc trong CI:

```text
create test database
-> run migration
-> run seed
-> run db:check
-> run repository smoke tests
-> drop test database
```

### 36.2 Test cases

| Mã | Test case | Kết quả mong đợi |
| --- | --- | --- |
| BE02-TC-001 | Migration chạy trên DB trống | Thành công |
| BE02-TC-002 | Seed chạy lần đầu | Thành công, tạo dữ liệu mặc định |
| BE02-TC-003 | Seed chạy lần hai | Không tạo trùng, status Skipped/Applied đúng |
| BE02-TC-004 | Unique email user theo company | Không cho trùng active user |
| BE02-TC-005 | Unique employee_code theo company | Không cho trùng active employee |
| BE02-TC-006 | FK employee -> company | Không tạo employee company không tồn tại |
| BE02-TC-007 | Soft delete partial unique | Không conflict với bản ghi deleted nếu policy cho phép |
| BE02-TC-008 | Sequence counter concurrent | Không sinh trùng mã |
| BE02-TC-009 | Notification unread index | Query unread count không scan toàn bảng lớn |
| BE02-TC-010 | Leave pending index | Query đơn Pending theo company dùng index |
| BE02-TC-011 | Attendance date query | Query bảng công tháng dùng index |
| BE02-TC-012 | Bootstrap admin | Tạo admin active và role đúng |
| BE02-TC-013 | Dev-only seed ở production | Bị chặn |
| BE02-TC-014 | Secret không xuất hiện trong log | Không leak password/token |

### 36.3 Repository smoke test

- [ ] Tạo company test.
- [ ] Tạo user test.
- [ ] Tạo employee test.
- [ ] Tạo attendance record test.
- [ ] Tạo leave type + leave request test.
- [ ] Tạo project + task test.
- [ ] Tạo notification test.
- [ ] Query theo `company_id` không trả dữ liệu tenant khác.

---

## 37. Rollback và production safety

### 37.1 Nguyên tắc rollback

1. Migration schema additive dễ rollback hơn destructive.
2. Không drop column/table production ngay khi không dùng nữa.
3. Với thay đổi nguy hiểm, dùng quy trình expand-contract:

```text
expand: add column/table mới
-> deploy code ghi cả cũ và mới nếu cần
-> backfill
-> switch read path
-> verify
-> contract: bỏ cũ ở release sau
```

### 37.2 Trước migration production

Checklist:

- [ ] Backup database.
- [ ] Kiểm tra migration status.
- [ ] Review câu lệnh destructive.
- [ ] Estimate lock time cho index/alter lớn.
- [ ] Chạy migration trên staging với data gần production nếu có.
- [ ] Có kế hoạch rollback hoặc restore.
- [ ] Thông báo maintenance nếu migration có downtime.
- [ ] Đảm bảo dev-only seed không chạy production.

### 37.3 Sau migration production

Checklist:

- [ ] `db:migrate:status` clean.
- [ ] `db:check` pass.
- [ ] Backend health pass.
- [ ] Login admin pass.
- [ ] Kiểm tra `/api/v1/auth/me` khi BACKEND-03 đã có.
- [ ] Kiểm tra module catalog/permission/role seed.
- [ ] Kiểm tra slow query/error log.
- [ ] Kiểm tra không có seed secret trong log.

---

## 38. Local reset policy

### 38.1 Khi được reset

Chỉ cho phép reset database ở:

1. `APP_ENV=local`.
2. `APP_ENV=test`.
3. Database name có suffix `_dev`, `_test` hoặc nằm trong allowlist.

### 38.2 Không được reset

Không cho reset nếu:

1. `APP_ENV=production`.
2. Database host không phải local/test allowlist.
3. Env thiếu flag xác nhận.

### 38.3 Reset flow

```text
validate env is local/test
-> drop schema public cascade
-> recreate schema public
-> run migration
-> run seed
-> optional dev-only seed
-> run db:check
```

---

## 39. Dev-only seed

### 39.1 Mục tiêu

Dev-only seed giúp frontend/backend/QA có dữ liệu mẫu để phát triển nhanh.

Có thể seed:

1. Một số phòng ban.
2. Một số nhân viên mẫu.
3. Tài khoản Employee/Manager/HR.
4. Attendance records mẫu.
5. Leave requests mẫu.
6. Projects/tasks mẫu.
7. Notifications mẫu.

### 39.2 Rule

1. Chỉ chạy khi `SEED_ENABLE_DEV_SAMPLE=true`.
2. Chặn tuyệt đối ở production.
3. Dữ liệu mẫu không dùng thông tin cá nhân thật.
4. Password mẫu phải đơn giản cho local nhưng không tồn tại ở staging/production.
5. Dev seed cũng nên idempotent.

---

## 40. Audit log cho seed/migration

### 40.1 Migration log

drizzle-kit có journal (migrations/meta) riêng. Ngoài ra, seed tracking dùng `seed_batches` và `seed_items`.

### 40.2 Seed audit

Các seed quan trọng nên ghi audit/system log:

1. Bootstrap admin created.
2. Role-permission matrix changed.
3. Company settings initialized.
4. System settings initialized.

Actor có thể là system actor:

```text
actor_type = System
actor_user_id = NULL
source = seed_runner
```

---

## 41. Data masking và sensitive fields

### 41.1 Không seed dữ liệu nhạy cảm thật

Không seed:

1. CCCD/CMND thật.
2. Số điện thoại cá nhân thật.
3. Email nội bộ thật nếu chưa được phép.
4. Hợp đồng/file thật.
5. Dữ liệu lương.
6. Secret production.

### 41.2 Sensitive settings

Setting nhạy cảm phải dùng:

```text
is_sensitive = true
value_type = SecretRef
secret_ref = path/to/secret
setting_value = null hoặc masked placeholder
```

---

## 42. Integration với backend modules sau này

### 42.1 BACKEND-03 AUTH phụ thuộc BACKEND-02

AUTH cần:

1. `users`.
2. `roles`.
3. `permissions`.
4. `user_roles`.
5. `role_permissions`.
6. `user_sessions`.
7. Seed role-permission matrix.
8. Bootstrap admin.

### 42.2 BACKEND-04 FOUNDATION phụ thuộc BACKEND-02

Foundation cần:

1. `companies`.
2. `modules`.
3. `system_settings`.
4. `company_settings`.
5. `audit_logs`.
6. `files`.
7. `file_links`.
8. `sequence_counters`.
9. `public_holidays`.

### 42.3 BACKEND-05 HR phụ thuộc BACKEND-02

HR cần:

1. HR tables.
2. Employee code config.
3. Sequence counter `employee_code`.
4. HR master data seed.
5. AUTH user mapping.
6. Foundation audit/file services.

### 42.4 BACKEND-06/07/08 phụ thuộc BACKEND-02

ATT/LEAVE/TASK cần:

1. Tables đúng FK.
2. Sequence counters.
3. Default rules/policies.
4. Notification events seed.
5. Dashboard widgets seed.
6. Index theo query pattern.

---

## 43. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| BE02-OQ-001 | ĐÃ CHỐT: Drizzle (DECISIONS-02). Không mở lại. | BE Lead | Cao |
| BE02-OQ-002 | ĐÃ CHỐT: drizzle-kit generate + áp qua DATABASE_DIRECT_URL (DECISIONS-02). | BE/DevOps | Cao |
| BE02-OQ-003 | `SUPER_ADMIN` có thuộc company nào không hay là global user? | Product/BE | Cao |
| BE02-OQ-004 | Có cần tách database user cho migration và runtime không? | DevOps/BE | Trung bình |
| BE02-OQ-005 | Public holidays seed mặc định theo Việt Nam hay để company tự nhập? | Product/HR | Trung bình |
| BE02-OQ-006 | Có bắt buộc partition log ngay MVP không hay chỉ chuẩn bị index/retention? | BE/DevOps | Trung bình |
| BE02-OQ-007 | Bootstrap admin production dùng env, CLI prompt hay admin invite flow? | BE/Security | Cao |
| BE02-OQ-008 | Password hash chọn Argon2id hay bcrypt cho MVP? | BE/Security | Cao |
| BE02-OQ-009 | Có cần seed đầy đủ permission field-level cho HR sensitive fields ngay MVP không? | Product/BE | Cao |
| BE02-OQ-010 | Có cần OpenAPI generator đồng bộ type từ backend sang frontend ở giai đoạn này không? | BE/FE | Trung bình |

---

## 44. Implementation checklist

### 44.1 Database setup

- [ ] Có Docker Compose PostgreSQL local.
- [ ] Có env mẫu `.env.example`.
- [ ] Có `DATABASE_URL` và `DIRECT_DATABASE_URL`.
- [ ] Có Drizzle client (drizzle(pool)).
- [ ] Có database module/service.
- [ ] Có health check database.

### 44.2 Migration

- [ ] M00 enable extensions.
- [ ] M01 Foundation base tables.
- [ ] M02 Foundation ops tables.
- [ ] M03 AUTH tables.
- [ ] M04 HR tables.
- [ ] M05 ATT tables.
- [ ] M06 LEAVE tables.
- [ ] M07 TASK tables.
- [ ] M08 NOTI/DASH tables.
- [ ] M09 Cross-module FKs.
- [ ] M10 Index migration.
- [ ] Migration chạy được từ database trống.
- [ ] Migration status clean trong CI.

### 44.3 ORM

- [ ] Schema Drizzle (`src/db/schema/*.ts`) mapping đủ bảng MVP.
- [ ] Common field mapping đúng `snake_case`/`camelCase`.
- [ ] Repository không query thiếu `company_id`.
- [ ] Transaction service sẵn sàng.
- [ ] Sequence service dùng row lock.
- [ ] Soft delete helper sẵn sàng.
- [ ] Không để controller gọi ORM trực tiếp.

### 44.4 Seed

- [ ] Có seed runner.
- [ ] Có seed tracking bằng `seed_batches`, `seed_items`.
- [ ] Seed idempotent.
- [ ] Seed modules.
- [ ] Seed company.
- [ ] Seed settings.
- [ ] Seed permissions.
- [ ] Seed roles.
- [ ] Seed role-permission matrix.
- [ ] Seed sequence counters.
- [ ] Seed HR defaults.
- [ ] Seed ATT defaults.
- [ ] Seed LEAVE defaults.
- [ ] Seed NOTI events/templates.
- [ ] Seed DASH widgets/configs.
- [ ] Bootstrap admin an toàn.
- [ ] Dev-only seed bị chặn ở production.

### 44.5 Verification

- [ ] `db:check` pass.
- [ ] `test:db` pass.
- [ ] Admin active tồn tại.
- [ ] Role-permission matrix tồn tại.
- [ ] Query unread notification có index.
- [ ] Query attendance month có index.
- [ ] Query leave pending có index.
- [ ] Query task due có index.
- [ ] Không có secret trong log.

---

## 45. Definition of Done cho BACKEND-02

BACKEND-02 được xem là hoàn thành khi:

1. PostgreSQL local chạy được bằng Docker Compose.
2. Backend kết nối database qua ORM client thành công.
3. Có migration đầy đủ cho Foundation, AUTH, HR, ATT, LEAVE, TASK, NOTI và DASH.
4. Có extension `pgcrypto`, `pg_trgm`, `unaccent` nếu môi trường cho phép.
5. Có cross-module FK đúng thứ tự.
6. Có index quan trọng theo DB-09.
7. Có Drizzle schema (src/db/schema) mapping đủ bảng MVP.
8. Có transaction service và sequence counter service dùng row lock.
9. Có seed runner idempotent.
10. Có seed tracking bằng `seed_batches` và `seed_items`.
11. Có seed modules, company, settings, permissions, roles và role-permission matrix.
12. Có seed HR/ATT/LEAVE/NOTI/DASH defaults.
13. Có bootstrap admin không hardcode secret.
14. Có script `db:migrate`, `db:seed`, `db:check`, `db:reset:local`.
15. Có test migration từ database trống.
16. Seed chạy lần hai không tạo dữ liệu trùng.
17. Dev-only seed không thể chạy production.
18. Backend health check database pass.
19. Có checklist production migration safety.
20. Có open questions rõ để chốt trước BACKEND-03.

---

## 46. Kết luận

BACKEND-02 chốt lớp database implementation cho MVP.

Tư duy triển khai chính:

```text
PostgreSQL là nguồn dữ liệu chính
-> SQL migration kiểm soát schema/index/constraint
-> ORM phục vụ type-safe query và repository
-> Mọi dữ liệu tenant-specific có company_id
-> Seed có business key và chạy lại an toàn
-> Sequence counter dùng transaction + row lock
-> Bootstrap admin bảo mật
-> Migration/seed được kiểm thử từ database trống
```

Sau BACKEND-02, đội backend có thể triển khai tiếp:

```text
BACKEND-03: Auth, Session, RBAC & Permission Guard
```

BACKEND-03 sẽ sử dụng trực tiếp các bảng và seed của BACKEND-02 để triển khai login, refresh token, session, permission resolver, data scope guard và endpoint `/api/v1/auth/me`.
