> ✅ **ĐÍNH CHÍNH STACK (đã đồng bộ body 22/06):** Tài liệu này đã được dọn về stack CHỐT: NestJS + TypeScript + **Drizzle + drizzle-kit (KHÔNG Prisma)** · PostgreSQL + RLS/FORCE · **Valkey** · **Vitest + Supertest**. Nguồn chuẩn: [DECISIONS-02](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# BACKEND-01: BACKEND ARCHITECTURE & PROJECT SETUP

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> **BACKEND-01 Kiến trúc/Setup** · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-01](<../SPEC/SPEC-01 Tổng quan.md>) · [DB: DB-01](<../DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [Chuẩn API: API-01](<../API Design/API-01 TỔNG QUAN.md>) · [Frontend: FRONTEND-01](<../FRONTEND/FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-01 |
| Tên tài liệu | Backend Architecture & Project Setup |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

BACKEND-01 định nghĩa kiến trúc backend và kế hoạch thiết lập project backend cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt backend stack chính cho MVP.
2. Chốt mô hình kiến trúc backend: modular monolith, module boundary, shared kernel và dependency rule.
3. Chốt cấu trúc thư mục source code backend.
4. Chốt cách tổ chức API theo module và version `/api/v1`.
5. Chốt chiến lược authentication bằng access token và refresh token.
6. Chốt chiến lược authorization bằng permission + data scope, backend là lớp kiểm tra cuối cùng.
7. Chốt cách resolve auth context: user, company, employee, roles, permissions, scopes và session.
8. Chốt cơ chế multi-tenant bằng `company_id`.
9. Chốt chuẩn response, error, validation, pagination, filter, sort và idempotency ở tầng implementation.
10. Chốt kiến trúc database access, transaction, migration, seed và repository/service pattern.
11. Chốt kiến trúc audit log, file service, settings, sequence, public holiday và foundation service.
12. Chốt event architecture cho notification, dashboard cache invalidation và background jobs.
13. Chốt logging, request id, correlation id, observability, health check và performance baseline.
14. Chốt testing strategy, local development, Docker Compose, env convention và Definition of Done.
15. Làm nền cho các tài liệu BACKEND-02 trở đi.

BACKEND-01 không đi sâu vào logic nghiệp vụ chi tiết từng module như tạo employee, check-in, duyệt nghỉ phép hoặc giao task. Các phần đó được triển khai trong BACKEND-03 đến BACKEND-10.

---

## 3. Vị trí BACKEND-01 trong chuỗi tài liệu

Chuỗi tài liệu hiện tại của dự án:

```text
PRD/SPEC
  -> Database Design
  -> API Design
  -> UI/UX Design
  -> Frontend Implementation
  -> Backend Implementation
  -> Integration
  -> QA/UAT
  -> DevOps/Release
```

BACKEND-01 là tài liệu mở đầu của giai đoạn Backend Implementation.

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

Sau khi BACKEND-01 hoàn thành, đội backend có thể tạo project thật, dựng local environment, kết nối database, thiết lập middleware/guard/interceptor chung và bắt đầu BACKEND-02.

---

## 4. Căn cứ triển khai

BACKEND-01 bám theo các quyết định đã chốt trong bộ tài liệu trước:

1. API public dùng prefix `/api/v1`.
2. Internal API nếu có dùng prefix `/internal/v1` và không expose cho frontend.
3. Backend là nguồn kiểm soát quyền cuối cùng; frontend chỉ hỗ trợ UX bằng cách ẩn/hiện/disable/mask.
4. Mỗi API nghiệp vụ phải kiểm tra authentication, permission, data scope, business rule, audit log và notification event nếu có.
5. Access token và refresh token là cơ chế xác thực chính của MVP.
6. Backend resolve `company_id`, `user_id`, `employee_id`, role, permission và data scope từ auth context, không tin frontend tự gửi các trường định danh này trong nghiệp vụ thông thường.
7. Database chính là PostgreSQL.
8. Tất cả bảng chính dùng UUID primary key.
9. Hệ thống sẵn sàng multi-tenant bằng `company_id`.
10. Foundation gồm company, module catalog, settings, audit, file, sequence, public holiday và seed tracking.
11. AUTH/RBAC là nền tảng phân quyền cho toàn bộ module.
12. HR là nguồn dữ liệu nhân sự trung tâm.
13. ATT, LEAVE và TASK đều gắn nghiệp vụ chính với `employees.id`.
14. NOTI nhận event từ các module nghiệp vụ.
15. DASH tổng hợp dữ liệu từ module nguồn, không xử lý nghiệp vụ gốc.
16. Frontend đã chuẩn hóa API client, request metadata, response/error mapping, idempotency key và query/cache behavior nên backend phải trả contract ổn định.
17. OpenAPI/Swagger cần được sinh từ backend để frontend, QA và mock service dùng chung.

---

## 5. Phạm vi BACKEND-01

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Backend stack | Framework, language, ORM, database, cache, queue, logging, test |
| Architecture style | Modular monolith, layer architecture, module boundary |
| Project setup | Package manager, scripts, env, lint, format, Docker Compose |
| Folder structure | Cấu trúc `src`, `modules`, `common`, `database`, `shared`, `config` |
| API architecture | Versioning, prefix, controller convention, DTO, validation, response wrapper |
| Auth architecture | Login, refresh, logout, session, token, auth context |
| Permission architecture | Permission guard, data scope resolver, allowed actions, field masking |
| Multi-tenant architecture | Resolve company, query filter, tenant guard, cross-company rule |
| Database architecture | ORM, migration, repository, transaction, unit of work, query pattern |
| Foundation architecture | Audit, files, settings, sequence, public holidays, module catalog |
| Event architecture | Domain event, outbox, notification event, dashboard cache invalidation |
| Job architecture | Scheduler, queue, retry, idempotency, cleanup jobs |
| Error handling | Exception filter, error code, validation error, business rule error |
| Security baseline | Token, password hash, rate limit, CORS, sensitive data masking |
| Observability | Request id, correlation id, logging, metrics, health check |
| Testing | Unit, integration, API contract, permission/scope tests |
| Acceptance criteria | Definition of Done cho BACKEND-01 |

### 5.2 Không bao gồm

| Nội dung | Tài liệu xử lý sau |
| --- | --- |
| Migration chi tiết từng bảng | BACKEND-02 |
| Seed permission/role/module chi tiết | BACKEND-02 |
| Login/refresh/RBAC code chi tiết | BACKEND-03 |
| Foundation service chi tiết | BACKEND-04 hoặc BACKEND-11 |
| HR nghiệp vụ chi tiết | BACKEND-05 |
| Attendance nghiệp vụ chi tiết | BACKEND-06 |
| Leave nghiệp vụ chi tiết | BACKEND-07 |
| Task nghiệp vụ chi tiết | BACKEND-08 |
| Notification worker/template/delivery chi tiết | BACKEND-09 |
| Dashboard query/cache chi tiết | BACKEND-10 |
| CI/CD production đầy đủ | DEVOPS-01 hoặc BACKEND-14 |

---

## 6. Quyết định kiến trúc tổng thể

### 6.1 Kiến trúc đề xuất cho MVP

Backend MVP nên triển khai theo mô hình:

```text
Modular Monolith
```

Lý do:

1. MVP có nhiều module liên kết chặt: AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION.
2. Các nghiệp vụ cần transaction xuyên module, ví dụ duyệt nghỉ phép ảnh hưởng số dư phép, attendance record, audit log, notification event và dashboard cache.
3. Team có thể triển khai nhanh hơn so với microservices.
4. Dễ debug, dễ test end-to-end và dễ deploy MVP.
5. Vẫn có thể tách service sau này nếu giữ module boundary rõ.

Không nên bắt đầu bằng microservices ở MVP vì sẽ làm tăng chi phí triển khai auth, observability, distributed transaction, event consistency, deployment và debugging.

### 6.2 Module boundary cấp cao

```text
src/modules/
  auth
  foundation
  hr
  attendance
  leave
  task
  notification
  dashboard
```

Quy tắc:

1. Mỗi module có controller, service, repository, dto, entity/schema và test riêng.
2. Module nghiệp vụ không truy cập trực tiếp repository của module khác nếu có service contract phù hợp.
3. Shared/common chỉ chứa logic dùng chung thật sự, không chứa nghiệp vụ đặc thù.
4. Cross-module action quan trọng nên đi qua domain service hoặc application service.
5. Mọi module đều phải dùng chung auth context, audit service, event publisher và transaction manager.

### 6.3 Dependency direction

```text
common/shared/config/database
  -> foundation
  -> auth
  -> hr
  -> attendance
  -> leave
  -> task
  -> notification
  -> dashboard
```

Dependency nghiệp vụ:

| Module | Phụ thuộc trực tiếp | Ghi chú |
| --- | --- | --- |
| FOUNDATION | Common, Database | Company, settings, audit, file, sequence |
| AUTH | FOUNDATION | User, role, permission, session |
| HR | AUTH, FOUNDATION | Employee, department, contract |
| ATT | AUTH, HR, FOUNDATION, LEAVE read contract | Chấm công, ca, rule, adjustment, remote |
| LEAVE | AUTH, HR, ATT sync contract, FOUNDATION | Đơn nghỉ, balance, policy, sync attendance |
| TASK | AUTH, HR, FOUNDATION, LEAVE read contract | Project, task, comment, file |
| NOTI | AUTH, HR, FOUNDATION | Nhận event từ các module |
| DASH | AUTH, HR, ATT, LEAVE, TASK, NOTI, FOUNDATION | Query tổng hợp/cache, không xử lý nghiệp vụ gốc |

### 6.4 Không hard-code role

Backend không hard-code theo role thông thường như `HR`, `Manager`, `Employee`.

Đúng:

```text
Check permission + data scope + business rule.
Role chỉ là nhóm quyền được seed mặc định.
```

Ngoại lệ:

1. `Super Admin` có thể được xử lý đặc biệt cho scope `System`.
2. Một số bootstrap flow trước khi có RBAC có thể dùng system-level guard riêng.

---

## 7. Backend stack đề xuất

### 7.1 Stack chính

| Nhóm | Công nghệ đề xuất | Lý do |
| --- | --- | --- |
| Runtime | Node.js LTS | Phù hợp TypeScript, frontend cùng ecosystem |
| Language | TypeScript | Type-safe, dễ chia sẻ contract với frontend |
| Framework | NestJS | Module architecture rõ, guard/interceptor/filter mạnh |
| Database | PostgreSQL | Đã chốt trong DB Design |
| ORM | Drizzle + drizzle-kit (ĐÃ CHỐT — xem DECISIONS-02 §1.1 / ADR-0002) | Type-safe, không phá outbox transactional, set tenant context an toàn trên PgBouncer transaction-mode |
| Migration | drizzle-kit generate + migrator trên `DATABASE_DIRECT_URL` | Phải deterministic và có rollback plan |
| Validation | class-validator/class-transformer hoặc Zod | Validate DTO rõ ràng |
| Auth | JWT access token + refresh token | Bám API-01 |
| Password hash | Argon2id hoặc bcrypt | Không lưu plain text |
| Cache | Valkey | Cache permission/session/dashboard nhẹ |
| Queue/Job | BullMQ + Valkey | Notification, dashboard cache, cleanup job |
| API docs | OpenAPI/Swagger | Frontend/QA/mock contract |
| Logging | Pino hoặc Winston | Structured logging |
| Testing | Vitest + Supertest | Unit/integration/API tests |
| Container | Docker + Docker Compose | Local/staging consistency |
| Package manager | pnpm | Nhanh, workspace-friendly |

### 7.2 ORM decision

Đã CHỐT cho MVP (DECISIONS-02 §1.1 / ADR-0002):

```text
NestJS + Drizzle + PostgreSQL
```

Lý do:

1. Type-safe query tốt (schema bằng TypeScript ở `apps/api/src/db/schema/*.ts`).
2. Migration và schema dễ review (SQL sinh từ `drizzle-kit generate`).
3. Phù hợp với TypeScript.
4. Dễ sinh type và DTO mapping.
5. Không phá outbox transactional + set tenant context an toàn trên PgBouncer transaction-mode (lý do KHÔNG dùng Prisma).

Lưu ý khi dùng Drizzle:

1. Với query phức tạp/dashboard/report có thể dùng raw SQL có kiểm soát (`sql` template).
2. Transaction nghiệp vụ phải dùng `db.transaction` / `withTenant` (xem DECISIONS-02 §2.1).
3. Không để controller gọi `db` trực tiếp — đi qua repository/service.
4. Repository/service phải luôn nhận `company_id` từ auth context (qua `withTenant`), KHÔNG từ body/header.
5. Migration production phải review kỹ; áp qua migrator trên `DATABASE_DIRECT_URL`, không push schema trực tiếp.

### 7.3 Monorepo hay backend repo riêng

Nếu dự án có frontend riêng, có thể chọn một trong hai:

| Option | Mô tả | Khuyến nghị |
| --- | --- | --- |
| Backend repo riêng | `ems-backend` riêng biệt | Dễ tách deployment, đơn giản MVP |
| Monorepo | `apps/web`, `apps/api`, `packages/shared` | Tốt nếu muốn share types |

Khuyến nghị thực tế:

```text
MVP dùng backend repo riêng, nhưng chuẩn bị thư mục packages/contracts nếu sau này chuyển monorepo.
```

---

## 8. Cấu trúc thư mục backend đề xuất

```text
backend/
  package.json
  pnpm-lock.yaml
  tsconfig.json
  tsconfig.build.json
  nest-cli.json
  eslint.config.js
  prettier.config.js
  .env.example
  .gitignore
  Dockerfile
  docker-compose.yml
  README.md

  drizzle.config.ts

  src/
    db/
      schema/            # schema bằng TypeScript (*.ts)
      migrations/        # SQL sinh từ drizzle-kit + journal meta/
      seed.ts

    main.ts
    app.module.ts

    config/
      app.config.ts
      database.config.ts
      auth.config.ts
      valkey.config.ts
      file.config.ts
      queue.config.ts
      swagger.config.ts
      env.validation.ts

    common/
      constants/
      decorators/
        current-user.decorator.ts
        public.decorator.ts
        permissions.decorator.ts
        audit-action.decorator.ts
        idempotent.decorator.ts
      dto/
        pagination.dto.ts
        sort.dto.ts
        filter.dto.ts
      enums/
        data-scope.enum.ts
        error-code.enum.ts
      errors/
        app-error.ts
        business-rule.error.ts
        forbidden.error.ts
        validation.error.ts
      filters/
        http-exception.filter.ts
      guards/
        jwt-auth.guard.ts
        permission.guard.ts
        tenant.guard.ts
      interceptors/
        response.interceptor.ts
        request-context.interceptor.ts
        audit.interceptor.ts
        idempotency.interceptor.ts
      middleware/
        request-id.middleware.ts
        client-metadata.middleware.ts
      pipes/
        validation.pipe.ts
        uuid-param.pipe.ts
      types/
        auth-context.type.ts
        request-context.type.ts
        api-response.type.ts
      utils/
        crypto.util.ts
        date.util.ts
        normalize.util.ts
        pagination.util.ts
        query.util.ts

    database/
      db.module.ts
      db.service.ts          # drizzle(pool) client + withTenant()
      transaction-manager.ts
      pagination.repository-helper.ts
      soft-delete.repository-helper.ts

    shared/
      audit/
        audit.module.ts
        audit.service.ts
        audit.types.ts
      events/
        event-bus.module.ts
        domain-event.ts
        event-publisher.service.ts
        outbox.service.ts
      files/
        file.module.ts
        file.service.ts
        file-permission.service.ts
      settings/
        setting.module.ts
        setting.service.ts
      sequence/
        sequence.module.ts
        sequence.service.ts
      cache/
        cache.module.ts
        cache.service.ts
      queue/
        queue.module.ts
        queue.service.ts
      health/
        health.module.ts
        health.controller.ts

    modules/
      auth/
        auth.module.ts
        controllers/
        services/
        repositories/
        dto/
        guards/
        strategies/
        events/
        tests/
      foundation/
        foundation.module.ts
        controllers/
        services/
        repositories/
        dto/
        tests/
      hr/
        hr.module.ts
        controllers/
        services/
        repositories/
        dto/
        policies/
        tests/
      attendance/
        attendance.module.ts
        controllers/
        services/
        repositories/
        dto/
        rules/
        jobs/
        tests/
      leave/
        leave.module.ts
        controllers/
        services/
        repositories/
        dto/
        policies/
        sync/
        tests/
      task/
        task.module.ts
        controllers/
        services/
        repositories/
        dto/
        tests/
      notification/
        notification.module.ts
        controllers/
        services/
        repositories/
        dto/
        jobs/
        templates/
        tests/
      dashboard/
        dashboard.module.ts
        controllers/
        services/
        repositories/
        dto/
        widgets/
        cache/
        tests/

    docs/
      openapi/
      api-examples/

    test/
      setup.ts
      factories/
      fixtures/
      e2e/
```

---

## 9. Layer architecture

Mỗi module nên tổ chức theo 5 lớp:

```text
Controller Layer
  -> nhận HTTP request, validate input, gọi service

Application Service Layer
  -> orchestration nghiệp vụ, transaction, permission business rule

Domain/Policy Layer
  -> rule nghiệp vụ thuần, state transition, calculation

Repository/Data Access Layer
  -> query database, apply company_id/data scope, projection

Integration/Event Layer
  -> publish event, audit log, cache invalidation, notification
```

### 9.1 Controller Layer

Controller chỉ làm:

1. Khai báo endpoint.
2. Gắn guard/permission metadata.
3. Validate DTO.
4. Lấy auth context.
5. Gọi service.
6. Trả DTO response.

Controller không làm:

1. Query database trực tiếp.
2. Tính rule nghiệp vụ phức tạp.
3. Tạo audit log thủ công nếu đã có service/interceptor chung.
4. Tự resolve permission/data scope.

### 9.2 Service Layer

Service chịu trách nhiệm:

1. Orchestrate use case.
2. Kiểm tra business validation.
3. Mở transaction khi cần.
4. Gọi repository.
5. Gọi foundation service: sequence, audit, file, event.
6. Trả DTO hoặc domain result.

### 9.3 Repository Layer

Repository chịu trách nhiệm:

1. Query database.
2. Apply `company_id`.
3. Apply soft delete filter.
4. Apply data scope filter nếu query gắn với scope.
5. Dùng projection/select để không trả field nhạy cảm.
6. Tránh N+1 query.
7. Hỗ trợ pagination/search/filter/sort theo whitelist.

Repository không được tự quyết định business rule.

### 9.4 Policy/Rule Layer

Policy/rule layer dùng cho:

1. Leave balance calculation.
2. Attendance rule calculation.
3. Task state transition.
4. Profile change approval rule.
5. Field-level permission rule.
6. Dashboard widget visibility rule.

---

## 10. API architecture

### 10.1 API prefix

Public API:

```text
/api/v1
```

Internal API:

```text
/internal/v1
```

Health:

```text
/health
/api/v1/health
```

Swagger:

```text
/docs
/docs-json
```

### 10.2 Module endpoint prefix

| Module | Prefix |
| --- | --- |
| AUTH | `/api/v1/auth` |
| FOUNDATION | `/api/v1/foundation` |
| HR | `/api/v1/hr` |
| ATT | `/api/v1/attendance` |
| LEAVE | `/api/v1/leave` |
| TASK | `/api/v1/tasks`, `/api/v1/projects` |
| NOTI | `/api/v1/notifications` |
| DASH | `/api/v1/dashboard` |

### 10.3 Response wrapper

Backend phải trả response thống nhất:

```json
{
  "success": true,
  "message": "Thao tác thành công",
  "data": {},
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

List response:

```json
{
  "success": true,
  "message": "Lấy danh sách thành công",
  "data": [],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 0,
    "total_pages": 0,
    "has_next": false,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

### 10.4 Error wrapper

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
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

### 10.5 Validation error

```json
{
  "success": false,
  "message": "Dữ liệu không hợp lệ",
  "error": {
    "code": "VALIDATION-ERR-001",
    "type": "ValidationError",
    "details": [
      {
        "field": "email",
        "message": "Email không đúng định dạng",
        "rule": "email"
      }
    ]
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

### 10.6 Request metadata

Backend cần đọc và lưu metadata:

| Header | Mục đích |
| --- | --- |
| `Authorization` | Bearer access token nếu dùng bearer mode |
| `X-Request-Id` | Request id từ client, nếu không có backend tự sinh |
| `X-Correlation-Id` | Gom log theo flow nếu có |
| `X-Client-Type` | `web`, `mobile`, `system` |
| `X-Client-Version` | Version frontend/mobile |
| `Idempotency-Key` | Chống xử lý trùng cho action quan trọng |

### 10.7 Pagination, search, filter, sort

Query list chuẩn:

```http
GET /api/v1/hr/employees?page=1&per_page=20&search=nguyen&sort=created_at:desc
```

Quy tắc:

1. `page` mặc định `1`.
2. `per_page` mặc định `20`.
3. `per_page` tối đa `100` cho UI list thông thường.
4. Export lớn dùng job riêng, không trả hàng chục nghìn record trong API list.
5. `sort` chỉ cho field whitelist.
6. `filter` chỉ cho field whitelist theo từng API.
7. Query thiếu quyền không trả dữ liệu ngoài scope.

---

## 11. Authentication architecture

### 11.1 Token strategy chốt cho MVP

Khuyến nghị chốt:

```text
Access token: Bearer token ngắn hạn
Refresh token: HttpOnly Secure SameSite cookie + hash trong database
```

Lý do:

1. Frontend hiện đã có khả năng inject Bearer token.
2. Refresh token không nên expose cho JavaScript.
3. Backend có thể rotate refresh token.
4. Logout/revoke session dễ kiểm soát.

Nếu backend muốn tối ưu bảo mật hơn, có thể dùng HttpOnly cookie cho cả access token, nhưng phải thống nhất lại với frontend API client.

### 11.2 Access token claims

Access token nên chứa tối thiểu:

| Claim | Ý nghĩa |
| --- | --- |
| `sub` | User ID |
| `company_id` | Company hiện tại |
| `session_id` | Session hiện tại |
| `token_type` | `access` |
| `iat` | Issued at |
| `exp` | Expired at |

Không nên nhét toàn bộ permission vào access token vì permission có thể thay đổi.

### 11.3 Refresh token storage

Refresh token:

1. Sinh random token đủ mạnh.
2. Chỉ lưu hash trong `user_sessions` hoặc bảng session tương ứng.
3. Gắn với `session_id`, `user_id`, `company_id`, device/client metadata.
4. Rotate sau mỗi lần refresh nếu có thể.
5. Revoke khi logout.
6. Revoke khi user bị khóa hoặc đổi mật khẩu bắt buộc.

### 11.4 Public auth endpoints

```http
POST /api/v1/auth/login
POST /api/v1/auth/refresh-token
POST /api/v1/auth/logout
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
GET  /api/v1/health
```

### 11.5 Protected auth endpoints

```http
GET   /api/v1/auth/me
POST  /api/v1/auth/change-password
GET   /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/{session_id}
```

### 11.6 `/api/v1/auth/me` contract

Endpoint `/auth/me` là contract quan trọng cho frontend.

Response đề xuất:

```json
{
  "success": true,
  "message": "Lấy thông tin phiên đăng nhập thành công",
  "data": {
    "user": {
      "id": "uuid",
      "email": "admin@company.com",
      "display_name": "Admin",
      "status": "Active",
      "avatar_url": null
    },
    "company": {
      "id": "uuid",
      "name": "Default Company",
      "code": "DEFAULT",
      "timezone": "Asia/Ho_Chi_Minh",
      "locale": "vi-VN"
    },
    "employee": {
      "id": "uuid",
      "employee_code": "EMP0001",
      "full_name": "Nguyễn Văn A",
      "department_id": "uuid",
      "position_id": "uuid",
      "direct_manager_id": null,
      "employment_status": "Official"
    },
    "roles": [
      {
        "id": "uuid",
        "code": "HR",
        "name": "HR"
      }
    ],
    "permissions": [
      {
        "permission": "HR.EMPLOYEE.VIEW",
        "scopes": ["Company"]
      }
    ],
    "apps": [
      {
        "module_code": "HR",
        "name": "Nhân sự",
        "root_path": "/hr",
        "default_route": "/hr/employees",
        "status": "active",
        "order": 20
      }
    ],
    "settings": {
      "timezone": "Asia/Ho_Chi_Minh",
      "locale": "vi-VN"
    }
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

Quy tắc:

1. `permissions` trả theo permission code và scopes.
2. `roles` chỉ để hiển thị/quản trị, frontend không hard-code role.
3. `apps` có thể backend-driven để frontend lọc Home Portal/App Switcher.
4. Không trả field nhạy cảm như `password_hash`, token hash, private storage path.
5. Nếu user chưa liên kết employee, `employee` có thể null nhưng phải được xử lý theo role/system flow.

---

## 12. Authorization & data scope architecture

### 12.1 Permission guard

Mỗi endpoint nghiệp vụ cần khai báo permission:

```ts
@RequirePermissions('HR.EMPLOYEE.VIEW')
@Get('/employees')
findEmployees() {}
```

Guard thực hiện:

1. Kiểm tra request đã có auth context.
2. Lấy permission user từ cache/database.
3. Kiểm tra user có permission yêu cầu không.
4. Attach scopes của permission vào request context.
5. Nếu không có permission, trả `403 AUTH-ERR-FORBIDDEN`.

### 12.2 Data scope resolver

Data scope resolver trả điều kiện query theo context.

Scope chuẩn:

| Scope | Query logic gợi ý |
| --- | --- |
| Own | `employee_id = current_employee_id` hoặc `user_id = current_user_id` |
| Team | Employee có `direct_manager_id = current_employee_id` hoặc team tree nếu cấu hình |
| Department | `department_id IN allowed_department_ids` |
| Project | User/employee là project member/watcher/assignee |
| Company | `company_id = current_company_id` |
| System | Có thể cross-company, chỉ Super Admin/system role |

### 12.3 Apply data scope ở đâu

Data scope phải được apply ở repository/query layer, không chỉ ở controller.

Ví dụ:

```ts
const scope = await dataScopeService.resolve({
  context,
  permission: 'LEAVE.REQUEST.APPROVE',
});

return leaveRequestRepository.findPendingRequests({
  companyId: context.companyId,
  scope,
  filters,
  pagination,
});
```

### 12.4 Field-level permission

Một số field nhạy cảm cần backend kiểm soát:

| Module | Field nhạy cảm ví dụ |
| --- | --- |
| AUTH | password hash, token hash, security events chi tiết |
| HR | số giấy tờ, địa chỉ, ngày sinh, file hợp đồng, thông tin lương phase sau |
| ATT | GPS/IP/device info nếu có |
| LEAVE | lý do nghỉ nhạy cảm, file chứng minh |
| FILE | private storage path, signed URL |

Backend có 2 cách:

1. Không select field nếu user thiếu quyền.
2. Trả field masked nếu UI cần biết có dữ liệu nhưng không được xem.

Response masked đề xuất:

```json
{
  "personal_id_number": {
    "masked": true,
    "value": "********1234"
  }
}
```

### 12.5 Allowed actions

Để frontend hiển thị button chính xác, detail API có thể trả `allowed_actions` theo từng resource.

Ví dụ leave request detail:

```json
{
  "id": "uuid",
  "status": "Pending",
  "allowed_actions": ["approve", "reject", "comment"]
}
```

Backend phải tính `allowed_actions` bằng:

1. Permission.
2. Data scope.
3. Trạng thái resource.
4. Business rule.
5. Lock/version nếu có.

---

## 13. Multi-tenant architecture

### 13.1 Resolve tenant

Trong MVP, `company_id` được resolve từ:

1. Access token claim `company_id`.
2. Session trong database.
3. User-company relationship nếu sau này user thuộc nhiều company.

Không nhận `company_id` từ body/query cho API nghiệp vụ thông thường.

### 13.2 Tenant guard

Tenant guard kiểm tra:

1. Company tồn tại.
2. Company đang `Active`.
3. User thuộc company hoặc có scope `System`.
4. Session thuộc đúng company.

Nếu fail:

| Trường hợp | HTTP | Error code |
| --- | --- | --- |
| Company không tồn tại | 401/403 | `AUTH-ERR-COMPANY-NOT-FOUND` |
| Company inactive | 403 | `AUTH-ERR-COMPANY-INACTIVE` |
| User không thuộc company | 403 | `AUTH-ERR-TENANT-DENIED` |

### 13.3 Query rule bắt buộc

Mọi query bảng tenant-specific phải có:

```text
company_id = current_company_id
```

Trừ:

1. Super Admin scope `System`.
2. Bảng global catalog như `permissions` nếu không có `company_id`.
3. Public/global settings được đánh dấu public.

### 13.4 Tenant leak prevention

Checklist:

- [ ] Repository helper luôn nhận `companyId`.
- [ ] List/detail/update/delete đều filter `company_id`.
- [ ] FK target cũng kiểm tra cùng company.
- [ ] File link không trả file khác company.
- [ ] Notification chỉ trả recipient là user hiện tại.
- [ ] Dashboard không aggregate dữ liệu ngoài scope.
- [ ] Export không bỏ qua tenant filter.

---

## 14. Database architecture

### 14.1 Database chính

```text
PostgreSQL
```

### 14.2 UUID primary key

Mọi bảng chính dùng:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

### 14.3 Soft delete

Dữ liệu nghiệp vụ quan trọng dùng soft delete:

```text
deleted_at
deleted_by
```

Repository mặc định chỉ query record chưa xóa:

```text
deleted_at IS NULL
```

### 14.4 Audit fields chuẩn

Bảng nghiệp vụ nên có:

```text
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

Bảng log append-only có thể không dùng soft delete.

### 14.5 Transaction rule

Bắt buộc transaction cho:

1. Tạo employee kèm user/link/code/contract.
2. Check-in/check-out tạo/cập nhật attendance record + attendance log.
3. Duyệt/từ chối điều chỉnh công.
4. Tạo/gửi/duyệt/từ chối/hủy đơn nghỉ.
5. Điều chỉnh leave balance.
6. Tạo project/task kèm assignee/watcher/activity.
7. Tạo notification hàng loạt.
8. Upload file kèm file_links nếu cần consistency.
9. Seed RBAC/default data.

### 14.6 Repository convention

Mỗi repository method nên có input rõ:

```ts
interface FindEmployeesInput {
  companyId: string;
  scope: DataScopeCondition;
  search?: string;
  filters?: EmployeeFilters;
  pagination: PaginationInput;
  sort?: SortInput;
}
```

Không viết:

```ts
findEmployees(params: any)
```

### 14.7 Optimistic locking

Với update quan trọng nên hỗ trợ `version` hoặc `updated_at`:

```json
{
  "version": "2026-06-20T17:35:00+07:00"
}
```

Nếu record đã thay đổi:

```http
409 Conflict
```

Error code:

```text
RESOURCE-ERR-CONFLICT
```

### 14.8 Query performance baseline

Mỗi query list chính cần đảm bảo:

1. Có `company_id` filter.
2. Có pagination.
3. Có index cho filter/sort chính.
4. Không bị N+1.
5. Không select field thừa.
6. Query dashboard nặng phải dùng cache/materialized strategy nếu cần.
7. Query export lớn chạy job hoặc có giới hạn.

---

## 15. Migration & seed architecture

BACKEND-01 chỉ chốt nguyên tắc. BACKEND-02 sẽ triển khai chi tiết.

### 15.1 Migration order tổng thể

```text
M00 Extensions
M01 Foundation base
M02 Foundation ops
M03 AUTH/RBAC
M04 HR
M05 ATT
M06 LEAVE
M07 TASK
M08 NOTI/DASH
M09 Cross-module FK
M10 Index
S00 System seed
S01 Tenant seed
S02 RBAC seed
S03 Business defaults
V00 Verification
```

### 15.2 Seed phải idempotent

Seed có thể chạy nhiều lần mà không tạo dữ liệu trùng.

Business key ví dụ:

| Dữ liệu | Business key |
| --- | --- |
| Module | `module_code` |
| Permission | `permission_code` |
| Role | `company_id + role_code` |
| Setting | `company_id + setting_key` |
| Notification event | `event_code` |
| Dashboard widget | `widget_code` |
| Leave type | `company_id + leave_type_code` |
| Sequence | `company_id + sequence_key` |

### 15.3 Dev-only seed

Dev-only seed dùng cho local/test:

1. Sample employees.
2. Sample attendance records.
3. Sample leave requests.
4. Sample projects/tasks.
5. Sample notifications.

Không chạy dev-only seed ở staging/production.

---

## 16. Foundation services architecture

### 16.1 Company service

Chức năng:

1. Lấy company current context.
2. Kiểm tra company active.
3. Quản lý company settings.
4. Chuẩn bị SaaS multi-tenant phase sau.

### 16.2 Module catalog service

Chức năng:

1. Quản lý danh sách module active/inactive.
2. Trả app registry cho Home Portal/App Switcher.
3. Kiểm tra module disabled/maintenance.
4. Hỗ trợ Coming soon/locked app nếu product bật.

### 16.3 Setting service

Chức năng:

1. Lấy system settings.
2. Lấy company settings.
3. Merge default + override.
4. Cache settings theo company.
5. Không trả secret setting ra frontend.

### 16.4 Audit service

Chức năng:

1. Ghi audit log cho thao tác quan trọng.
2. Lưu actor, company, module, action, entity, old/new snapshot hoặc diff.
3. Gắn request id/correlation id/IP/user agent.
4. Hỗ trợ query audit theo quyền.

Audit log không thay thế business activity log. Ví dụ task activity log vẫn thuộc TASK.

### 16.5 File service

Chức năng:

1. Upload file private mặc định.
2. Lưu metadata vào `files`.
3. Link file vào entity qua `file_links` hoặc bảng module-specific.
4. Kiểm tra permission trước khi download/view.
5. Không trả raw storage path.
6. Ghi file access log cho file nhạy cảm.

### 16.6 Sequence service

Chức năng:

1. Sinh mã nhân viên, mã đơn nghỉ, mã project/task nếu cần.
2. Dùng transaction và row lock.
3. Hỗ trợ prefix/suffix/padding/year/company.
4. Không dùng `MAX(code) + 1`.

### 16.7 Public holiday service

Chức năng:

1. Cung cấp ngày nghỉ lễ cho ATT/LEAVE.
2. Hỗ trợ holiday global và company-specific.
3. Cache theo company/year.

---

## 17. Event architecture

### 17.1 Mục tiêu

Event architecture dùng để:

1. Tạo notification.
2. Invalidate dashboard cache.
3. Ghi activity/audit bổ sung nếu cần.
4. Chạy job bất đồng bộ.
5. Giảm coupling giữa module nguồn và NOTI/DASH.

### 17.2 Event types

| Loại event | Ví dụ | Consumer |
| --- | --- | --- |
| Domain event | `LEAVE_REQUEST_APPROVED` | NOTI, DASH, ATT sync |
| System event | `USER_LOCKED`, `PASSWORD_CHANGED` | NOTI, audit/security |
| Cache event | `DASHBOARD_WIDGET_INVALIDATE` | DASH worker |
| File event | `FILE_UPLOADED`, `FILE_ACCESSED` | Audit/file log |
| Job event | `ATT_MISSING_CHECKOUT` | NOTI, ATT |

### 17.3 Outbox pattern

Với nghiệp vụ quan trọng, event nên ghi cùng transaction vào outbox:

```text
business data update
  -> insert outbox event
  -> commit
  -> worker publish/process event
```

Lợi ích:

1. Không mất event nếu process crash sau khi commit.
2. Có thể retry.
3. Có thể dedupe.
4. Dễ debug event history.

### 17.4 Notification event payload chuẩn

```json
{
  "event_code": "LEAVE_REQUEST_APPROVED",
  "company_id": "uuid",
  "actor_user_id": "uuid",
  "target_type": "leave_request",
  "target_id": "uuid",
  "recipient_user_ids": ["uuid"],
  "payload": {
    "leave_request_code": "LV-2026-0001",
    "employee_name": "Nguyễn Văn A"
  },
  "dedupe_key": "LEAVE_REQUEST_APPROVED:uuid"
}
```

### 17.5 Dashboard cache invalidation

Mọi mutation ảnh hưởng dashboard cần publish cache invalidation event.

Ví dụ:

| Mutation | Cache cần invalidate |
| --- | --- |
| Check-in/check-out | Attendance today widget, employee dashboard |
| Approve leave | Leave balance widget, pending approval widget, calendar widget |
| Assign task | My tasks widget, team tasks widget |
| Mark notification read | Notification unread widget/badge |
| Create employee | HR summary widget |

---

## 18. Idempotency architecture

### 18.1 Khi nào cần idempotency

Bắt buộc hoặc khuyến nghị cho:

1. Check-in/check-out.
2. Tạo employee.
3. Tạo leave request.
4. Submit/approve/reject/cancel leave.
5. Adjust attendance.
6. Adjust leave balance.
7. Tạo project/task.
8. Upload file nếu backend hỗ trợ.
9. Tạo notification system manual.

### 18.2 Idempotency key storage

Cần bảng hoặc cache persistent:

```text
idempotency_keys
  id
  company_id
  user_id
  key
  method
  path
  request_hash
  response_status
  response_body
  status: Processing/Succeeded/Failed
  expires_at
  created_at
```

Có thể triển khai trong BACKEND-02/BACKEND-03 hoặc ở Foundation.

### 18.3 Idempotency rule

1. Cùng user/company/key/method/path/request_hash -> trả lại response cũ nếu succeeded.
2. Cùng key nhưng request_hash khác -> `409 Conflict`.
3. Nếu đang processing -> `409 Conflict` hoặc chờ ngắn tùy implementation.
4. TTL key đề xuất 24 giờ đến 72 giờ.

---

## 19. Background jobs architecture

### 19.1 Queue đề xuất

```text
BullMQ + Valkey
```

### 19.2 Job groups

| Nhóm job | Ví dụ |
| --- | --- |
| Notification | Render template, create notification, retry delivery |
| Dashboard | Warmup cache, invalidate cache, refresh widget |
| Attendance | Missing checkout detection, attendance recalculation |
| Leave | Leave accrual phase sau, balance reset phase sau |
| File | Cleanup temp file, expire signed URL nếu cần |
| Audit/Retention | Archive logs, cleanup old cache |
| Seed/Bootstrap | Không dùng queue production nếu không cần |

### 19.3 Job rule

1. Job phải idempotent.
2. Job có retry policy.
3. Job failure phải log đầy đủ request/correlation context nếu có.
4. Không chạy job nặng trong request lifecycle.
5. Có dashboard/monitoring queue cho staging/production.

---

## 20. Security baseline

### 20.1 Password

1. Không lưu plain text.
2. Dùng Argon2id hoặc bcrypt với cost phù hợp.
3. Password policy lấy từ settings.
4. Reset token lưu hash, có TTL.
5. Đổi mật khẩu revoke sessions nếu policy bật.

### 20.2 Token

1. Access token ngắn hạn.
2. Refresh token lưu hash.
3. Refresh token HttpOnly cookie nếu dùng web.
4. Rotate refresh token nếu có thể.
5. Logout revoke session.
6. User bị khóa không refresh/login được.

### 20.3 Rate limiting

Áp dụng rate limit cho:

| Endpoint | Gợi ý |
| --- | --- |
| Login | Theo IP + email |
| Forgot password | Theo IP + email |
| Reset password | Theo token/IP |
| Refresh token | Theo session/IP |
| Upload file | Theo user/company |
| Search/list | Giới hạn per_page/query range |

### 20.4 CORS

1. Chỉ allow frontend domain hợp lệ.
2. Local allow `localhost` theo env.
3. Nếu dùng cookie, bật credentials đúng cách.
4. Không dùng `*` ở production với credentials.

### 20.5 Sensitive logging

Không log:

1. Password.
2. Access token.
3. Refresh token.
4. Reset token.
5. Private signed URL.
6. File storage path private.
7. Raw sensitive HR fields nếu không cần.

### 20.6 File security

1. File private mặc định.
2. Download phải qua permission check.
3. URL download nếu signed phải TTL ngắn.
4. Ghi access log cho file nhạy cảm.
5. Validate file type/size.
6. Quét virus có thể đưa phase sau nếu cần.

---

## 21. Observability & logging

### 21.1 Request context

Mỗi request có context:

```text
request_id
correlation_id
company_id
user_id
session_id
employee_id
ip
user_agent
client_type
client_version
module
action
```

### 21.2 Structured log format

```json
{
  "level": "info",
  "message": "HTTP request completed",
  "request_id": "req_...",
  "company_id": "uuid",
  "user_id": "uuid",
  "method": "GET",
  "path": "/api/v1/hr/employees",
  "status": 200,
  "duration_ms": 45,
  "client_type": "web",
  "client_version": "0.1.0"
}
```

### 21.3 Health check

Endpoint:

```http
GET /health
GET /api/v1/health
```

Health check gồm:

1. App status.
2. Database connection.
3. Valkey connection.
4. Queue status nếu có.
5. Version/build info.

Response public không nên expose secret hoặc connection string.

### 21.4 Metrics cơ bản

Cần theo dõi:

1. Request count theo endpoint/status.
2. Latency p50/p95/p99.
3. Error rate.
4. Database slow query.
5. Queue job failure.
6. Auth failed attempts.
7. Notification delivery failure.
8. Dashboard cache hit/miss.

---

## 22. OpenAPI/Swagger architecture

### 22.1 Mục tiêu

OpenAPI dùng cho:

1. Frontend tích hợp API thật.
2. QA viết API test case.
3. Mock service/MSW.
4. Sinh TypeScript types nếu cần.
5. Review contract giữa BE/FE/Product.

### 22.2 Swagger route

```text
/docs
/docs-json
```

### 22.3 Swagger rule

1. Mỗi endpoint có summary rõ.
2. Có required permission/data scope trong description hoặc decorator metadata.
3. Có request/response schema.
4. Có error responses cơ bản: 400, 401, 403, 404, 409, 422, 500.
5. Có security bearer/cookie mô tả rõ.
6. Có tag theo module.

### 22.4 Contract export

Build pipeline nên export:

```text
artifacts/openapi.json
artifacts/openapi.yaml
```

Frontend có thể dùng file này để:

1. Generate client/types.
2. Validate mock API.
3. Validate contract change.

---

## 23. Environment config

### 23.1 `.env.example`

```env
NODE_ENV=development
APP_NAME="Enterprise Management System API"
APP_PORT=3000
APP_TIMEZONE=Asia/Ho_Chi_Minh
APP_LOCALE=vi-VN
APP_VERSION=0.1.0

API_PREFIX=/api/v1
INTERNAL_API_PREFIX=/internal/v1

DATABASE_URL="postgresql://ems:ems@localhost:5432/ems_db?schema=public"
VALKEY_URL="valkey://localhost:6379"

JWT_ACCESS_SECRET="change-me-access-secret"
JWT_ACCESS_TTL_MINUTES=30
JWT_REFRESH_SECRET="change-me-refresh-secret"
JWT_REFRESH_TTL_DAYS=30

PASSWORD_HASH_ALGORITHM=argon2id

CORS_ORIGINS="http://localhost:5173,http://localhost:3001"
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax

FILE_STORAGE_DRIVER=local
FILE_STORAGE_LOCAL_PATH=./storage
FILE_MAX_UPLOAD_MB=20

ENABLE_SWAGGER=true
ENABLE_QUEUE=true
ENABLE_DEV_SEED=true

LOG_LEVEL=debug
```

### 23.2 Env rule

1. `.env` không commit.
2. `.env.example` không chứa secret thật.
3. Production secret lấy từ secret manager hoặc environment runtime.
4. `ENABLE_DEV_SEED` không bật ở production.
5. `ENABLE_SWAGGER` có thể tắt hoặc bảo vệ ở production.

---

## 24. Local development setup

### 24.1 Docker Compose services

```text
postgres
valkey
mailhog hoặc mailpit nếu cần email dev
api
```

### 24.2 Scripts đề xuất

```json
{
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:e2e": "vitest --config ./test/vitest-e2e.config.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:migrate:deploy": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/db/seed.ts",
    "db:studio": "drizzle-kit studio",
    "openapi:export": "tsx scripts/export-openapi.ts"
  }
}
```

### 24.3 Setup checklist local

```text
pnpm install
cp .env.example .env
docker compose up -d postgres valkey
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
open http://localhost:3000/docs
```

---

## 25. Coding convention

### 25.1 Naming

| Thành phần | Convention | Ví dụ |
| --- | --- | --- |
| File | kebab-case | `employee-profile.service.ts` |
| Class | PascalCase | `EmployeeProfileService` |
| Variable | camelCase | `employeeId` |
| DTO | PascalCase + Dto | `CreateEmployeeDto` |
| Repository | PascalCase + Repository | `EmployeeRepository` |
| Service | PascalCase + Service | `LeaveRequestService` |
| Permission code | UPPER.DOT | `HR.EMPLOYEE.VIEW` |
| Error code | MODULE-ERR-CODE | `HR-ERR-001` |
| Event code | UPPER_SNAKE | `LEAVE_REQUEST_APPROVED` |

### 25.2 DTO convention

1. Input DTO validate bằng decorator/schema.
2. Output DTO không expose ORM model trực tiếp.
3. Không trả field nhạy cảm mặc định.
4. List item DTO khác detail DTO nếu cần.
5. Admin DTO có thể nhiều field hơn employee/self DTO.

### 25.3 Error code convention

```text
AUTH-ERR-UNAUTHENTICATED
AUTH-ERR-FORBIDDEN
AUTH-ERR-SCOPE-DENIED
VALIDATION-ERR-001
RESOURCE-ERR-NOT-FOUND
RESOURCE-ERR-CONFLICT
BUSINESS-ERR-001
SYSTEM-ERR-001
```

Module-specific:

```text
HR-ERR-EMPLOYEE-CODE-DUPLICATED
ATT-ERR-LEAVE-APPROVED
LEAVE-ERR-BALANCE-NOT-ENOUGH
TASK-ERR-INVALID-STATUS-TRANSITION
NOTI-ERR-TEMPLATE-NOT-FOUND
DASH-ERR-WIDGET-DISABLED
```

---

## 26. Testing strategy

### 26.1 Test levels

| Level | Mục tiêu |
| --- | --- |
| Unit test | Test policy/rule/service nhỏ |
| Repository test | Test query, scope, pagination, filter |
| Integration test | Test service + database transaction |
| API e2e test | Test endpoint, guard, validation, response contract |
| Permission test | Test permission + scope matrix |
| Security test | Auth, forbidden, sensitive field masking |
| Performance smoke | Test query chính không quá chậm |

### 26.2 Test database

1. Dùng database test riêng.
2. Migration test chạy từ database trống.
3. Seed test tối thiểu role/permission/company/admin.
4. Dọn dữ liệu sau test hoặc dùng transaction rollback.
5. Không dùng production data.

### 26.3 Test case bắt buộc cho BACKEND-01 foundation

- [ ] Health endpoint trả OK.
- [ ] Response wrapper success đúng format.
- [ ] Error wrapper đúng format.
- [ ] Validation error đúng details.
- [ ] Request id tự sinh nếu client không gửi.
- [ ] Request id giữ nguyên nếu client gửi.
- [ ] Auth guard chặn protected endpoint.
- [ ] Permission guard trả 403 khi thiếu quyền.
- [ ] Tenant guard chặn company inactive.
- [ ] Repository helper luôn apply `company_id`.
- [ ] Audit service ghi được log mẫu.
- [ ] Event publisher ghi outbox event mẫu.
- [ ] Swagger generate được JSON.

---

## 27. Module setup roadmap

### 27.1 Thứ tự triển khai backend khuyến nghị

```text
1. Project setup + common infrastructure
2. Database connection + migration framework
3. Foundation base: company, modules, settings
4. AUTH/RBAC base: users, roles, permissions, sessions
5. Auth context + permission guard + data scope resolver
6. HR base: employee, department, position
7. ATT base
8. LEAVE base
9. TASK base
10. NOTI event + notification
11. DASH widgets + cache
12. File/audit/jobs hardening
13. OpenAPI contract freeze
14. Backend QA/performance/security readiness
```

### 27.2 Dependency checkpoint

Không nên triển khai HR/ATT/LEAVE/TASK màn hình thật trước khi có:

1. Auth context.
2. Permission guard.
3. Data scope resolver.
4. Company/tenant filter.
5. Audit service tối thiểu.
6. Transaction manager.
7. Response/error wrapper.
8. OpenAPI contract.

---

## 28. Code skeleton tham khảo

### 28.1 Auth context type

```ts
export type DataScope = 'Own' | 'Team' | 'Department' | 'Project' | 'Company' | 'System';

export interface AuthPermission {
  permission: string;
  scopes: DataScope[];
}

export interface AuthContext {
  userId: string;
  companyId: string;
  sessionId: string;
  employeeId?: string | null;
  roles: string[];
  permissions: AuthPermission[];
  isSuperAdmin: boolean;
  clientType?: string;
  clientVersion?: string;
  requestId: string;
  correlationId?: string;
}
```

### 28.2 Permission checker

```ts
export class PermissionChecker {
  constructor(private readonly permissions: AuthPermission[]) {}

  can(permission: string): boolean {
    return this.permissions.some((item) => item.permission === permission);
  }

  getScopes(permission: string): DataScope[] {
    return this.permissions.find((item) => item.permission === permission)?.scopes ?? [];
  }

  hasScope(permission: string, scope: DataScope): boolean {
    return this.getScopes(permission).includes(scope);
  }
}
```

### 28.3 Response DTO

```ts
export interface ApiMeta {
  request_id: string;
  timestamp: string;
  correlation_id?: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  meta: ApiMeta;
  pagination?: ApiPagination;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  error: {
    code: string;
    type: string;
    details?: unknown;
  };
  meta: ApiMeta;
}
```

### 28.4 Controller example

```ts
@Controller('/api/v1/hr/employees')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @RequirePermissions('HR.EMPLOYEE.VIEW')
  async findEmployees(
    @CurrentUser() context: AuthContext,
    @Query() query: FindEmployeesQueryDto,
  ) {
    return this.employeeService.findEmployees(context, query);
  }
}
```

### 28.5 Service example

```ts
export class EmployeeService {
  constructor(
    private readonly employees: EmployeeRepository,
    private readonly dataScope: DataScopeService,
  ) {}

  async findEmployees(context: AuthContext, query: FindEmployeesQueryDto) {
    const scope = await this.dataScope.resolve({
      context,
      permission: 'HR.EMPLOYEE.VIEW',
    });

    return this.employees.findMany({
      companyId: context.companyId,
      scope,
      query,
    });
  }
}
```

---

## 29. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ | Đề xuất chốt |
| --- | --- | --- | --- | --- |
| BE01-OQ-001 | Backend dùng NestJS hay framework khác? | Tech Lead | Cao | NestJS + TypeScript |
| BE01-OQ-002 | ORM dùng gì? | BE Lead | Cao | ĐÃ CHỐT: **Drizzle + drizzle-kit** (DECISIONS-02 §1.1 / ADR-0002) |
| BE01-OQ-003 | Access token lưu ở frontend theo mode nào? | BE/FE Lead | Cao | Bearer access token memory, refresh HttpOnly cookie |
| BE01-OQ-004 | `/auth/me` có trả app registry không? | BE/FE/Product | Cao | Có, backend-driven |
| BE01-OQ-005 | Field-level permission backend omit hay mask? | BE/FE/Product | Cao | Omit mặc định, mask khi UI cần hiển thị có kiểm soát |
| BE01-OQ-006 | Notification MVP dùng polling hay WebSocket/SSE? | Product/BE/FE | Trung bình | Polling trước, chuẩn bị SSE phase sau |
| BE01-OQ-007 | File storage MVP dùng local hay S3-compatible? | BE/DevOps | Trung bình | Local dev, S3-compatible cho staging/prod nếu có |
| BE01-OQ-008 | Queue worker chạy chung app hay process riêng? | BE/DevOps | Trung bình | MVP có thể chung repo, process riêng ở deploy |
| BE01-OQ-009 | Swagger production có public không? | Security/DevOps | Trung bình | Tắt hoặc bảo vệ bằng auth/basic auth |
| BE01-OQ-010 | Export lớn xử lý sync hay async job? | Product/BE | Trung bình | Async job cho dữ liệu lớn |

---

## 30. Setup checklist BACKEND-01

### 30.1 Project setup

- [ ] Khởi tạo project NestJS + TypeScript.
- [ ] Cấu hình pnpm.
- [ ] Cấu hình ESLint/Prettier.
- [ ] Cấu hình tsconfig path alias.
- [ ] Tạo `.env.example`.
- [ ] Tạo Dockerfile.
- [ ] Tạo docker-compose cho PostgreSQL + Valkey.
- [ ] Tạo health module.
- [ ] Tạo Swagger module.

### 30.2 Common infrastructure

- [ ] Request id middleware.
- [ ] Client metadata middleware.
- [ ] Request context interceptor.
- [ ] Response wrapper interceptor.
- [ ] Global exception filter.
- [ ] Validation pipe.
- [ ] Pagination DTO/helper.
- [ ] Error code enum.
- [ ] Auth context type.

### 30.3 Database infrastructure

- [ ] Drizzle `db` module/service (drizzle(pool) client + withTenant()).
- [ ] Database connection config.
- [ ] Migration command.
- [ ] Seed command.
- [ ] Transaction manager.
- [ ] Repository helper cho `company_id` và soft delete.

### 30.4 Auth/permission foundation

- [ ] JWT auth guard skeleton.
- [ ] Tenant guard skeleton.
- [ ] Permission decorator.
- [ ] Permission guard skeleton.
- [ ] Data scope resolver interface.
- [ ] `/auth/me` contract draft.

### 30.5 Foundation skeleton

- [ ] Audit service skeleton.
- [ ] Event publisher/outbox skeleton.
- [ ] Setting service skeleton.
- [ ] File service skeleton.
- [ ] Sequence service skeleton.
- [ ] Cache service skeleton.
- [ ] Queue service skeleton.

### 30.6 Documentation/testing

- [ ] README local setup.
- [ ] API response/error examples.
- [ ] Swagger JSON generate được.
- [ ] Unit test sample.
- [ ] E2E health test.
- [ ] E2E response wrapper test.

---

## 31. Definition of Done cho BACKEND-01

BACKEND-01 được xem là hoàn thành khi:

1. Chốt được backend stack MVP.
2. Có kiến trúc modular monolith rõ ràng.
3. Có module boundary và dependency rule.
4. Có folder structure chuẩn.
5. Có project setup checklist đủ để tạo source backend.
6. Có API prefix/versioning convention.
7. Có response/error/validation wrapper strategy.
8. Có auth/session/token strategy.
9. Có permission/data scope strategy không hard-code role.
10. Có multi-tenant strategy bằng `company_id`.
11. Có database/migration/seed direction rõ.
12. Có transaction/repository convention.
13. Có foundation service architecture.
14. Có event/outbox/job architecture.
15. Có observability/logging/health strategy.
16. Có security baseline.
17. Có testing strategy.
18. Có `.env.example` và local setup direction.
19. Có open questions cần chốt trước khi code thật.
20. Có đầu vào rõ cho BACKEND-02.

---

## 32. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Backend không chốt stack sớm | Code không thống nhất | BACKEND-01 chốt NestJS + TypeScript + PostgreSQL |
| Controller chứa quá nhiều logic | Khó test, khó bảo trì | Ép layer service/repository/policy rõ |
| Query thiếu `company_id` | Rò rỉ dữ liệu tenant | Repository helper + tenant guard + test scope |
| Hard-code role | Sai khi quyền thay đổi | Permission + data scope là nguồn chính |
| Frontend/backend lệch response | Tích hợp lỗi | Response wrapper + OpenAPI + contract test |
| Permission frontend/backend lệch | Lộ hoặc thiếu chức năng | `/auth/me` trả permission/scopes/apps, backend guard cuối cùng |
| Token storage không an toàn | Rủi ro bảo mật | Refresh token HttpOnly cookie, access token ngắn hạn |
| Không có idempotency | Double submit tạo dữ liệu trùng | Idempotency interceptor cho action quan trọng |
| Event mất khi transaction commit xong | Notification/dashboard sai | Outbox pattern |
| Dashboard query chậm | UX kém | Cache/invalidation, query whitelist, index |
| Log chứa dữ liệu nhạy cảm | Rủi ro bảo mật | Sensitive logging policy |
| Migration/seed không idempotent | Lỗi staging/prod | Seed tracking, business key, checksum |

---

## 33. Roadmap sau BACKEND-01

Sau BACKEND-01, triển khai:

```text
BACKEND-02: Database Migration, ORM & Seed Implementation
```

BACKEND-02 cần tập trung:

1. Cấu hình PostgreSQL/Drizzle.
2. Tạo migration foundation/auth/hr/att/leave/task/noti/dash.
3. Tạo index theo DB-09.
4. Tạo seed modules/settings/permissions/roles.
5. Tạo bootstrap admin.
6. Tạo seed notification events/templates.
7. Tạo seed dashboard widgets/configs.
8. Tạo verification checklist.

Sau BACKEND-02, triển khai:

```text
BACKEND-03: Auth, Session, RBAC & Permission Guard
```

BACKEND-03 cần hoàn thiện:

1. Login/logout/refresh.
2. `/auth/me`.
3. Password reset/change password.
4. User sessions.
5. Permission guard.
6. Data scope resolver.
7. Role/permission admin API base.
8. Security events/login logs.

---

## 34. Kết luận

BACKEND-01 chốt nền kiến trúc backend cho MVP theo hướng:

```text
NestJS + TypeScript + PostgreSQL + Drizzle
Modular Monolith
Permission + Data Scope
Multi-tenant by company_id
API contract stable
Audit + Event + Outbox
OpenAPI-driven integration
```

Tư duy triển khai quan trọng nhất:

```text
Backend là source of truth
-> Auth context từ token/session
-> Permission + data scope ở guard/repository
-> Business rule ở service/policy
-> Audit/event/cache invalidation sau mutation
-> Response/error contract thống nhất
-> OpenAPI làm cầu nối với frontend và QA
```

Khi BACKEND-01 được chốt, dự án có thể bắt đầu tạo source backend thật và đi vào BACKEND-02 để dựng database/migration/seed từ database trống đến trạng thái có thể chạy MVP.
