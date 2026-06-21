> 🔒 **THỨ TỰ MIGRATION (bổ sung bắt buộc):** Bật **RLS + FORCE ROW LEVEL SECURITY** cho mọi bảng có `company_id` **TRƯỚC** khi seed/backfill `company_id`. Outbox + audit append-only phải tồn tại từ Sprint 1 (trước module ghi đầu tiên). Xem [DECISIONS-02 §2–3](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# DEVOPS-05: DATABASE MIGRATION & SEED DEPLOYMENT
# DATABASE MIGRATION & SEED DEPLOYMENT
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-05 |
| Tên tài liệu | Database Migration & Seed Deployment |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-04 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-05 định nghĩa quy trình triển khai database migration và seed data từ local đến production.

Tài liệu này dùng để:

1. Chuẩn hóa cách chạy migration theo thứ tự Foundation, AUTH, HR, ATT, LEAVE, TASK, NOTI/DASH.
2. Chốt quy tắc migration an toàn cho production.
3. Chốt seed data theo môi trường: foundation seed, role/permission seed, demo/test seed, bootstrap admin.
4. Chốt quy trình backup trước migration production.
5. Chốt rollback/forward-fix khi migration lỗi.
6. Làm cơ sở cho backend pipeline và release checklist.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-05** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

Chuỗi DevOps MVP được tổ chức như sau:

```text
DEVOPS-01: DevOps Architecture & Environment Strategy
  -> DEVOPS-02: Repository, Branching & CI Pipeline
  -> DEVOPS-03: Docker & Containerization
  -> DEVOPS-04: Environment Configuration & Secrets Management
  -> DEVOPS-05: Database Migration & Seed Deployment
  -> DEVOPS-06: Backend Deployment Pipeline
  -> DEVOPS-07: Frontend Deployment Pipeline
  -> DEVOPS-08: Staging, UAT & Production Environment
  -> DEVOPS-09: Monitoring, Logging & Alerting
  -> DEVOPS-10: Backup, Rollback & Disaster Recovery
  -> DEVOPS-11: Security Hardening & Runtime Protection
  -> DEVOPS-12: Release Management & Go-live Plan
```

Mục tiêu của chuỗi này là biến mã nguồn, database migration, cấu hình môi trường, test result và checklist QA thành hệ thống có thể triển khai, giám sát, backup, rollback và go-live an toàn.

## 4. Nguyên tắc DevOps áp dụng chung

1. **Production-like từ sớm**: staging/UAT phải gần giống production về runtime, biến môi trường, SSL, reverse proxy, migration, logging và monitoring.
2. **Backend là trust boundary**: frontend có thể ẩn/hiện UI nhưng backend/API luôn kiểm tra authentication, permission, data scope và business rule.
3. **Mỗi môi trường tách biệt**: local, development, staging/UAT và production có database, secret, domain và storage riêng.
4. **Không deploy bằng `latest` ở production**: image phải có tag rõ ràng theo version hoặc commit SHA để rollback và truy vết.
5. **Migration phải được kiểm soát**: mọi migration cần chạy qua staging trước production và production phải backup trước migration.
6. **Deploy an toàn hơn deploy nhanh**: production deploy cần approval, smoke test, monitoring window và rollback plan.
7. **Secret không nằm trong source code**: secret chỉ được lưu trong secret store của CI/CD, server hoặc secret manager.
8. **Quan sát được hệ thống**: log, metric, health check, alert và audit vận hành phải có từ MVP.
9. **Tự động hóa phần lặp lại**: build, test, scan, migration, deploy và smoke test nên chuẩn hóa bằng pipeline/script.
10. **Có checklist rõ ràng**: mỗi bước release phải có điều kiện pass/fail để tránh quyết định cảm tính.

## 5. Căn cứ database

DEVOPS-05 bám theo các quyết định database đã chốt:

1. PostgreSQL là database chính.
2. Tất cả bảng chính dùng UUID.
3. Multi-tenant bằng `company_id`.
4. Soft delete cho dữ liệu quan trọng.
5. Foundation DB gồm companies, modules, settings, audit logs, files, sequence counters, public holidays, seed tracking.
6. AUTH/RBAC là nền permission cho toàn bộ hệ thống.
7. HR là nguồn dữ liệu nhân sự trung tâm.
8. ATT, LEAVE, TASK gắn nghiệp vụ với employee.
9. NOTI/DASH dùng event/template/widget/cache, không xử lý nghiệp vụ gốc.
10. Index/query pattern cần áp dụng theo DB-09.

## 6. Migration principle

1. Migration phải chạy được từ database trống.
2. Migration phải chạy tuần tự và có version rõ ràng.
3. Migration đã chạy production không được sửa nội dung; muốn đổi phải tạo migration mới.
4. Không drop dữ liệu production nếu chưa có plan và approval.
5. Migration schema và seed phải tách bạch.
6. Production migration cần backup trước khi chạy.
7. Migration phải chạy ở staging trước production.
8. Migration cần log rõ version đã chạy.
9. Migration phải tránh lock bảng lớn quá lâu.
10. Dữ liệu seed phải idempotent.

## 7. Quy ước tên migration

```text
YYYYMMDDHHMMSS_<module>_<action>_<description>.sql
```

Ví dụ:

```text
20260621090000_foundation_create_companies.sql
20260621090500_auth_create_users_roles_permissions.sql
20260621091000_hr_create_employees_departments.sql
20260621091500_att_create_attendance_records.sql
20260621092000_leave_create_leave_requests.sql
20260621092500_task_create_projects_tasks.sql
20260621093000_noti_dash_create_notifications_widgets.sql
```

Nếu dùng ORM migration, vẫn cần version và tên rõ.

## 8. Migration order MVP

| Thứ tự | Nhóm | Nội dung |
| --- | --- | --- |
| 1 | Extension | `pgcrypto`, `pg_trgm`, `unaccent` nếu cần |
| 2 | Foundation | companies, modules, settings, audit, files, sequences, holidays |
| 3 | AUTH/RBAC | users, sessions, roles, permissions, role_permissions |
| 4 | HR | departments, positions, employees, contracts, profile change |
| 5 | ATT | shifts, attendance_rules, attendance_records, logs, adjustment, remote |
| 6 | LEAVE | leave_types, policies, balances, requests, approvals |
| 7 | TASK | projects, project_members, tasks, comments, checklist |
| 8 | NOTI/DASH | notification events/templates/messages, dashboard widgets/config/cache |
| 9 | Index | Cross-module index, performance index, partial index |
| 10 | Constraints bổ sung | FK vòng/constraint sau khi đủ bảng nếu cần |

## 9. Seed strategy

### 9.1 Nhóm seed

| Nhóm seed | Môi trường | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| Foundation seed | Tất cả | Có | Modules, settings, sequence, holidays |
| Permission seed | Tất cả | Có | Permission toàn hệ thống |
| Role seed | Tất cả | Có | Super Admin, Admin, HR, Manager, Employee |
| Role-permission seed | Tất cả | Có | Theo matrix MVP |
| Notification event/template seed | Tất cả | Có | Event/template in-app |
| Dashboard widget seed | Tất cả | Có | Widget catalog/config mặc định |
| Attendance default seed | Tất cả | Nên có | Shift/rule mặc định |
| Leave default seed | Tất cả | Nên có | Leave types/policy mặc định |
| Demo/test seed | Local/dev/staging | Có thể | User/employee/task/leave mẫu |
| Bootstrap admin | Production | Có | Tài khoản quản trị đầu tiên |

### 9.2 Seed phải idempotent

Seed có thể chạy lại mà không tạo trùng dữ liệu.

Nguyên tắc:

1. Dùng `seed_key` ổn định.
2. Upsert theo code/key tự nhiên.
3. Ghi `seed_batches` và `seed_items` nếu có.
4. Không override dữ liệu production do user chỉnh nếu không có chủ đích.
5. Demo seed không chạy trên production.

## 10. Environment migration flow

### 10.1 Local

```text
create local database
  -> run migration all
  -> run foundation seed
  -> run demo seed
  -> run smoke test local
```

### 10.2 Development

```text
merge vào develop
  -> CI migration check
  -> deploy backend dev
  -> run migration dev
  -> run foundation seed/update seed
  -> smoke test dev
```

### 10.3 Staging/UAT

```text
create release branch
  -> build release candidate
  -> backup staging DB nếu cần
  -> run migration staging
  -> run production-like seed
  -> run smoke test
  -> QA regression
  -> UAT sign-off
```

### 10.4 Production

```text
release approved
  -> verify migration đã pass staging
  -> put release window/change log
  -> backup production database
  -> verify backup exists and checksum/log OK
  -> deploy backend compatible nếu cần
  -> run migration production
  -> run seed production-safe
  -> deploy app version
  -> smoke test production
  -> monitor
```

## 11. Migration safety pattern

### 11.1 Expand and contract

Với thay đổi lớn, dùng 2-3 release:

```text
Release A: add new nullable column/table, app vẫn dùng old field
Release B: app ghi/đọc new field, backfill dữ liệu
Release C: remove old field sau khi xác nhận an toàn
```

### 11.2 Không nên làm trong một migration production

- Drop column/table đang dùng.
- Rename column nếu app cũ vẫn chạy.
- Add NOT NULL không default trên bảng lớn.
- Create index blocking trên bảng lớn nếu chưa kiểm tra.
- Backfill dữ liệu lớn trong transaction dài.
- Xóa dữ liệu hàng loạt không backup.

### 11.3 Backfill data

Backfill nên:

1. Chạy theo batch.
2. Có progress log.
3. Có thể resume.
4. Không khóa bảng lâu.
5. Có kiểm tra count trước/sau.
6. Có script riêng nếu quá lớn.

## 12. Migration command convention

Ví dụ command:

```bash
npm run db:migrate
npm run db:migrate:status
npm run db:seed:foundation
npm run db:seed:demo
npm run db:rollback:last
```

Production nên dùng command được pipeline gọi, không chạy thủ công tùy tiện.

## 13. Migration lock

Cần có cơ chế chống hai migration chạy đồng thời:

1. Advisory lock PostgreSQL.
2. Migration table lock của ORM/tool.
3. Deploy pipeline chỉ cho một job migration chạy một lúc.
4. Timeout và alert nếu migration bị treo.

## 14. Backup trước migration production

### 14.1 Yêu cầu tối thiểu

- [ ] Backup full database trước release có migration.
- [ ] Backup có timestamp và release version.
- [ ] Backup lưu ở vị trí tách khỏi server app.
- [ ] Có log backup success/failure.
- [ ] Có checksum hoặc verify file backup tồn tại và dung lượng hợp lý.
- [ ] Có người chịu trách nhiệm xác nhận backup.

### 14.2 Tên backup

```text
ems_prod_db_before_v1.0.0_20260621_230000.dump
```

## 15. Rollback và forward-fix

### 15.1 Application rollback

Nếu app lỗi nhưng DB migration không phá dữ liệu:

```text
rollback image backend/frontend về tag trước
  -> giữ DB ở version mới nếu backward compatible
  -> monitor
```

### 15.2 Database rollback

Production ưu tiên **forward-fix** hơn rollback schema nếu có thể.

| Tình huống | Hướng xử lý |
| --- | --- |
| Migration thêm cột/bảng lỗi nhẹ | Tạo migration fix |
| Migration data sai nhưng có thể sửa | Script correction có review |
| App không tương thích DB mới | Rollback app nếu DB backward compatible |
| Migration phá dữ liệu nghiêm trọng | Restore backup theo DR plan |

### 15.3 Rollback script

Nếu migration tool hỗ trợ down migration, vẫn không tự động chạy down production khi chưa đánh giá vì down migration có thể làm mất dữ liệu.

## 16. Seed production rules

1. Không seed user demo vào production.
2. Không seed employee/task/leave demo vào production.
3. Bootstrap admin phải đổi mật khẩu lần đầu hoặc dùng invite/reset flow.
4. Permission/role seed không được xóa role custom của khách hàng.
5. Settings seed chỉ tạo default nếu chưa tồn tại.
6. Notification template seed cần giữ chỉnh sửa của Admin nếu policy cho phép.
7. Public holidays seed cần có phạm vi năm/quốc gia rõ.

## 17. Verification sau migration/seed

| Nhóm | Kiểm tra |
| --- | --- |
| Migration | Status all applied |
| Table | Bảng chính tồn tại |
| Constraint | FK/unique/check hoạt động |
| Index | Index critical tồn tại |
| Seed | Module, permission, role, widget, event có đủ |
| Auth | Login admin được |
| HR | Tạo/xem employee được |
| ATT | Health rule/shift tồn tại |
| LEAVE | Leave type/policy cơ bản tồn tại |
| TASK | Project/task table sẵn sàng |
| NOTI/DASH | Template/widget cơ bản tồn tại |

## 18. Checklist DEVOPS-05

### 18.1 Pre-migration checklist

- [ ] Migration đã review.
- [ ] Migration chạy local pass.
- [ ] Migration chạy CI/test DB pass.
- [ ] Migration chạy staging pass.
- [ ] Migration không chứa drop destructive chưa duyệt.
- [ ] Có backup production nếu chạy production.
- [ ] Có plan nếu migration fail.
- [ ] Có release window nếu cần downtime/risk.

### 18.2 Production migration checklist

- [ ] Confirm release version.
- [ ] Confirm database target là production đúng.
- [ ] Backup production xong.
- [ ] Verify backup.
- [ ] Run migration một lần.
- [ ] Run production-safe seed.
- [ ] Run smoke test.
- [ ] Monitor DB error/slow query.
- [ ] Ghi release log.

## 19. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Migration chạy nhầm DB | Mất dữ liệu | Env guard + confirmation + restricted credential |
| Migration destructive | Mất dữ liệu | Review + backup + expand-contract |
| Seed trùng | Dữ liệu bẩn | Idempotent seed |
| Migration treo | Downtime | Lock timeout + batch/backfill |
| Không backup | Không phục hồi được | Backup mandatory gate |
| App/DB không tương thích | Lỗi runtime | Backward compatible migration |

## 20. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO05-OQ-001 | ORM/migration tool chính là gì? | Backend Lead | Cao |
| DO05-OQ-002 | Production DB managed hay self-host để chốt backup command? | DevOps | Cao |
| DO05-OQ-003 | Có cho auto-run migration trong production pipeline không hay manual step? | Tech Lead | Cao |
| DO05-OQ-004 | Seed role-permission có được override role đã chỉnh không? | Product/BE | Trung bình |
| DO05-OQ-005 | Public holiday seed lấy theo quốc gia nào cho MVP? | Product/HR | Trung bình |

## 99. Tiêu chí nghiệm thu DEVOPS-05

| STT | Tiêu chí | Bắt buộc MVP |
| --- | --- | --- |
| 1 | Tài liệu nêu rõ mục tiêu, phạm vi và không phạm vi | Có |
| 2 | Có quy trình triển khai hoặc vận hành cụ thể | Có |
| 3 | Có checklist cho DevOps/Backend/Frontend/QA | Có |
| 4 | Có rule tách biệt môi trường local/dev/staging/production | Có |
| 5 | Có kiểm soát bảo mật, secret, permission hoặc access nếu liên quan | Có |
| 6 | Có rollback/fallback hoặc cách xử lý lỗi nếu liên quan | Có |
| 7 | Có mapping với QA/release readiness nếu liên quan | Có |
| 8 | Có open questions cần chốt trước production | Có |

---

## 100. Kết luận

**DEVOPS-05** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
