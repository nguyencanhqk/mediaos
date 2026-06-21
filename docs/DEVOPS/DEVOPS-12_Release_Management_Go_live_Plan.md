# DEVOPS-12: RELEASE MANAGEMENT & GO-LIVE PLAN
# RELEASE MANAGEMENT & GO-LIVE PLAN
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-12 |
| Tên tài liệu | Release Management & Go-live Plan |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-11 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-12 định nghĩa quy trình quản lý release, release candidate, go-live production và post-release monitoring cho MVP.

Tài liệu này dùng để:

1. Chốt quy trình tạo release candidate.
2. Chốt điều kiện staging/UAT sign-off.
3. Chốt production go-live checklist.
4. Chốt phân vai trong ngày go-live.
5. Chốt kế hoạch communication, maintenance window, smoke test và monitoring sau deploy.
6. Chốt rollback/no-go criteria.
7. Đóng vai trò tài liệu tổng kết cuối cùng của chuỗi DevOps MVP.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-12** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

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

## 5. Release management overview

Một release production không chỉ là deploy code. Release gồm:

1. Scope thay đổi.
2. Version/tag.
3. Migration/seed nếu có.
4. Test result.
5. UAT sign-off.
6. Security/hardening checklist.
7. Backup/rollback plan.
8. Communication plan.
9. Go-live window.
10. Post-release monitoring.

## 6. Versioning

Dùng semantic versioning:

```text
vMAJOR.MINOR.PATCH
```

| Loại | Khi tăng | Ví dụ |
| --- | --- | --- |
| MAJOR | Breaking change lớn | `v2.0.0` |
| MINOR | Tính năng mới backward compatible | `v1.1.0` |
| PATCH | Bugfix/hotfix | `v1.0.1` |

MVP go-live đầu tiên có thể là:

```text
v1.0.0
```

## 7. Release candidate

### 7.1 Điều kiện tạo RC

- [ ] Scope MVP đã chốt.
- [ ] PR liên quan đã merge vào release branch.
- [ ] CI backend/frontend pass.
- [ ] Migration chạy được trên test DB.
- [ ] Docker image build và scan pass hoặc exception được duyệt.
- [ ] Không còn bug blocker/critical mở.
- [ ] Release note draft sẵn sàng.

### 7.2 RC flow

```text
create release/v1.0.0
  -> build backend/frontend images
  -> deploy staging/UAT
  -> run migration/seed staging
  -> smoke test
  -> QA regression
  -> UAT
  -> fix bugs if needed
  -> rebuild RC
  -> final sign-off
```

## 8. Release note template

```markdown
# Release v1.0.0

## Summary
- MVP Enterprise Management System.

## Included modules
- AUTH
- HR
- ATT
- LEAVE
- TASK
- DASH
- NOTI
- FOUNDATION

## New features
- ...

## Fixes
- ...

## Database migration
- Có/Không
- Migration version range: ...

## Config changes
- ...

## Known issues
- ...

## Rollback notes
- Previous stable version: ...
```

## 9. Release gates

Không được go-live nếu chưa đạt:

| Gate | Owner | Bắt buộc |
| --- | --- | --- |
| CI pass | Dev/DevOps | Có |
| Backend/API smoke pass | Backend/QA | Có |
| Frontend smoke pass | Frontend/QA | Có |
| Migration pass staging | Backend/DevOps | Có nếu có migration |
| Regression pass | QA | Có |
| UAT sign-off | Product/Business | Có |
| Security checklist | DevOps/Security | Có |
| Backup verified | DevOps | Có |
| Rollback plan | DevOps/Tech Lead | Có |
| Monitoring ready | DevOps | Có |
| Go-live approval | Release Manager/Product | Có |

## 10. Go-live roles

| Vai trò | Người/nhóm | Trách nhiệm |
| --- | --- | --- |
| Release Manager |  | Điều phối go-live, quyết định proceed/rollback cùng owner |
| DevOps Owner |  | Deploy, backup, rollback, monitoring |
| Backend Lead |  | Migration, API smoke, backend issue |
| Frontend Lead |  | Frontend deploy/smoke/UI issue |
| QA Lead |  | Smoke test, regression critical |
| Product Owner |  | Business go/no-go, UAT confirmation |
| Communication Owner |  | Thông báo stakeholder/user |
| Support Owner |  | Tiếp nhận lỗi sau go-live |

## 11. Go-live timeline mẫu

| Mốc | Hoạt động | Owner |
| --- | --- | --- |
| T-3 ngày | Chốt RC, freeze scope | Release Manager |
| T-2 ngày | QA regression cuối | QA |
| T-1 ngày | UAT sign-off, backup/rollback rehearsal | Product/DevOps |
| T-0 trước deploy | Confirm go/no-go | Release Manager |
| T-0 deploy | Backup DB, migration, deploy backend/frontend | DevOps |
| T-0 sau deploy | Smoke test production | QA/Dev/DevOps |
| T+1h | Monitoring window | All owners |
| T+1 ngày | Post-release review | Release Manager |

## 12. Pre-go-live checklist

### 12.1 Product/UAT

- [ ] UAT pass theo QA-09.
- [ ] Business acceptance có sign-off.
- [ ] Known issues đã được chấp nhận hoặc xử lý.
- [ ] User guide/training tối thiểu sẵn sàng nếu cần.
- [ ] Support contact rõ.

### 12.2 QA

- [ ] QA-10 release readiness pass.
- [ ] Regression P0/P1 pass.
- [ ] Permission/data scope test critical pass.
- [ ] API smoke test pass.
- [ ] E2E flow login/home/check-in/leave/task/notification pass.
- [ ] Performance/load test threshold MVP pass hoặc exception.

### 12.3 DevOps

- [ ] Production domain/SSL sẵn sàng.
- [ ] Production env/secret sẵn sàng.
- [ ] Database production ready.
- [ ] Storage production ready.
- [ ] Backup job ready.
- [ ] Monitoring/alert ready.
- [ ] Rollback runbook ready.
- [ ] Image/artifact versioned.
- [ ] Production access/approval ready.

### 12.4 Backend/Database

- [ ] Migration pass staging.
- [ ] Production backup command tested.
- [ ] Seed production-safe ready.
- [ ] Health endpoint ready.
- [ ] API error handling production-safe.
- [ ] Audit log critical actions ready.

### 12.5 Frontend

- [ ] Production build pass.
- [ ] API base URL production correct.
- [ ] Source map policy applied.
- [ ] Cache strategy applied.
- [ ] Login/Home/App Switcher/Dashboard routes pass smoke.

## 13. Go-live execution runbook

```text
1. Announce go-live start.
2. Confirm no active blocker.
3. Freeze deploy outside release.
4. Backup production database.
5. Verify backup.
6. Pull backend/frontend image/artifact version.
7. Run production migration if needed.
8. Run production-safe seed.
9. Deploy backend API and worker.
10. Deploy frontend.
11. Run backend health/smoke.
12. Run frontend route/auth smoke.
13. Monitor logs/metrics/error rate.
14. Announce go-live success or rollback decision.
15. Keep monitoring window active.
```

## 14. Production smoke test

### 14.1 Không đăng nhập

- [ ] Frontend production URL load được.
- [ ] Login page load được.
- [ ] Static assets không 404.
- [ ] API health live/ready pass.
- [ ] Version endpoint đúng release.

### 14.2 Có đăng nhập bằng smoke account nếu policy cho phép

- [ ] Login thành công.
- [ ] Home Portal load được.
- [ ] App Switcher mở được.
- [ ] Dashboard load được.
- [ ] Notification unread count load được.
- [ ] Logout thành công.

### 14.3 Nghiệp vụ critical nếu có smoke tenant/test data

- [ ] Check trạng thái chấm công hôm nay.
- [ ] Xem danh sách đơn nghỉ của tôi.
- [ ] Xem task của tôi.
- [ ] Xem hồ sơ cá nhân.

Không tạo dữ liệu thật không kiểm soát trong production smoke test.

## 15. Go/no-go criteria

### 15.1 Go

Có thể go-live nếu:

1. Tất cả gate bắt buộc pass.
2. Không có blocker/critical bug mở.
3. Backup verified.
4. Rollback plan sẵn sàng.
5. Owner có mặt trong go-live window.
6. Product/Release Manager approve.

### 15.2 No-go

Không go-live nếu:

1. Migration staging chưa pass.
2. QA regression P0 fail.
3. UAT chưa sign-off.
4. Production backup không tạo được.
5. Không có owner rollback.
6. Monitoring/alert production chưa sẵn sàng.
7. Có security issue critical chưa được exception approve.

## 16. Rollback criteria

Rollback hoặc stop release nếu:

1. API health fail sau deploy và không fix nhanh được.
2. Login lỗi toàn hệ thống.
3. Dashboard/Home Portal không load cho phần lớn user.
4. Database migration fail hoặc nghi ngờ corrupt data.
5. Error rate tăng vượt ngưỡng nghiêm trọng.
6. Critical module ATT/LEAVE/TASK lỗi blocker ngay sau deploy.
7. Security issue nghiêm trọng phát hiện trong go-live.

## 17. Post-release monitoring

Monitoring window tối thiểu 30-60 phút cho MVP.

Theo dõi:

1. API uptime.
2. API 5xx rate.
3. Login success/fail.
4. Frontend JS error.
5. DB connection/slow query.
6. Worker job failure.
7. Notification event failure.
8. Dashboard widget failure.
9. CPU/memory/disk.
10. User feedback/support ticket.

## 18. Communication plan

### 18.1 Trước go-live

Thông báo nội bộ:

```text
Hệ thống EMS MVP sẽ được triển khai production trong khung giờ <time>.
Trong thời gian này có thể có gián đoạn ngắn. Team phụ trách: <contacts>.
```

### 18.2 Sau go-live thành công

```text
EMS MVP v1.0.0 đã được triển khai thành công.
Vui lòng báo lỗi qua kênh <support channel> nếu gặp vấn đề.
```

### 18.3 Khi rollback

```text
Release EMS v1.0.0 tạm thời rollback do phát hiện lỗi <summary>.
Hệ thống đã quay về phiên bản ổn định trước đó. Team đang xử lý và sẽ cập nhật tiếp.
```

## 19. Post-release review

Sau go-live cần ghi nhận:

1. Release có đúng timeline không?
2. Có issue nào phát sinh?
3. Smoke test mất bao lâu?
4. Alert có hoạt động không?
5. Có phải rollback/hotfix không?
6. Người dùng phản hồi gì?
7. Checklist nào thiếu?
8. Cần cải thiện pipeline/runbook gì?

## 20. Release artifact archive

Mỗi release cần lưu:

| Artifact | Ghi chú |
| --- | --- |
| Release note | Version/scope/known issues |
| Backend image tag | SHA/version |
| Frontend image/artifact tag | SHA/version |
| Migration list | Version range |
| Test report | QA/UAT evidence |
| Backup ID/path | Pre-release backup |
| Deployment log | Pipeline/runbook log |
| Smoke test result | Production validation |
| Approval record | Go-live approval |

## 21. MVP launch support

Trong 1-3 ngày đầu sau go-live, nên có:

1. Kênh support riêng.
2. Người trực theo module AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH.
3. Bug triage nhanh theo severity.
4. Hotfix process rõ.
5. Theo dõi logs/metrics thường xuyên hơn.
6. Ghi known issues và workaround.

## 22. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Go-live khi UAT chưa xong | Lỗi nghiệp vụ | UAT sign-off gate |
| Không backup trước migration | Không restore được | Backup mandatory |
| Owner không có mặt | Chậm xử lý | Role matrix |
| Smoke test thiếu | Lỗi lọt user | Smoke checklist |
| Không communication | User hoang mang | Communication plan |
| Rollback không rõ | Downtime kéo dài | Rollback criteria/runbook |

## 23. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO12-OQ-001 | Ngày/giờ go-live MVP dự kiến là khi nào? | Product/Release Manager | Cao |
| DO12-OQ-002 | Ai là Release Manager chính thức? | Project Owner | Cao |
| DO12-OQ-003 | Có smoke account production không? | QA/Product | Cao |
| DO12-OQ-004 | Maintenance window có cần thông báo toàn công ty không? | Product/HR | Trung bình |
| DO12-OQ-005 | Support channel sau go-live là gì? | Product/Support | Cao |

## 99. Tiêu chí nghiệm thu DEVOPS-12

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

**DEVOPS-12** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
