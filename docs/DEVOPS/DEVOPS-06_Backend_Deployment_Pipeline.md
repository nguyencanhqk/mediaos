# DEVOPS-06: BACKEND DEPLOYMENT PIPELINE
# BACKEND DEPLOYMENT PIPELINE
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-06 |
| Tên tài liệu | Backend Deployment Pipeline |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-05 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-06 định nghĩa pipeline triển khai backend API và worker cho development, staging/UAT và production.

Tài liệu này dùng để:

1. Chuẩn hóa luồng build, test, scan, Docker image build, image push và deploy backend.
2. Chốt deployment gate cho staging và production.
3. Chốt cách chạy migration/seed trong pipeline backend.
4. Chốt smoke test backend sau deploy.
5. Chốt rollback image và xử lý lỗi deploy.
6. Làm căn cứ để DevOps viết GitHub Actions/GitLab CI hoặc pipeline tương đương.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-06** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

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

## 5. Backend service scope

| Service | Deploy bằng pipeline | Ghi chú |
| --- | --- | --- |
| `backend-api` | Có | REST API chính |
| `worker` | Có | Background jobs, notification, scheduled task |
| Migration job | Có kiểm soát | Chạy trước/sau deploy tùy strategy |
| Seed job | Có kiểm soát | Chỉ production-safe seed ở prod |
| API docs/OpenAPI | Nên có | Publish artifact hoặc route docs nội bộ |

## 6. Pipeline trigger

| Trigger | Target | Mục đích |
| --- | --- | --- |
| Pull request | CI only | Kiểm tra chất lượng |
| Push `develop` | Development | Deploy tích hợp nếu bật |
| Push `release/*` | Staging/UAT | Release candidate |
| Tag `v*` | Production candidate | Tạo artifact release |
| Manual approval | Production | Deploy thật |
| Manual rollback | Production/Staging | Rollback image |

## 7. Backend pipeline stages

```text
checkout
  -> install dependencies
  -> lint
  -> typecheck
  -> unit test
  -> integration test optional
  -> build backend
  -> generate/check OpenAPI optional
  -> dependency scan
  -> secret scan
  -> Docker build
  -> image scan
  -> push image
  -> deploy target environment
  -> run migration/seed if approved
  -> smoke test
  -> notify result
```

## 8. CI quality gate

| Gate | Điều kiện pass |
| --- | --- |
| Lint | Không lỗi blocker |
| Typecheck | Pass |
| Unit test | Pass |
| Build | Build production thành công |
| Dependency scan | Không có critical/high chưa xử lý theo policy |
| Secret scan | Không phát hiện secret thật |
| Docker build | Image build được |
| API contract | OpenAPI không phá backward compatibility nếu có check |
| Migration check | Migration mới chạy được trên DB test |

## 9. Build artifact

Backend deployment artifact chính là Docker image.

Image metadata cần có:

| Label | Giá trị |
| --- | --- |
| `org.opencontainers.image.revision` | Commit SHA |
| `org.opencontainers.image.version` | Release version/tag |
| `org.opencontainers.image.created` | Build time |
| `ems.service` | `backend-api` |
| `ems.environment` | Target nếu build theo env |

## 10. Deployment strategy MVP

### 10.1 Development

```text
push develop
  -> build image develop-SHA
  -> deploy backend-api dev
  -> run migration dev
  -> restart worker dev
  -> smoke test dev
```

### 10.2 Staging/UAT

```text
push release/vX.Y.Z
  -> build image staging-SHA hoặc vX.Y.Z-rc
  -> backup staging DB nếu cần
  -> run migration staging
  -> deploy backend-api staging
  -> deploy worker staging
  -> run production-like seed
  -> smoke test staging
  -> QA regression/UAT
```

### 10.3 Production

```text
release approved
  -> verify staging sign-off
  -> backup production DB
  -> pull immutable image tag
  -> run migration production nếu release có migration
  -> deploy backend-api
  -> deploy worker
  -> run smoke test production
  -> monitor logs/metrics/error
```

## 11. Migration placement trong deploy

| Strategy | Khi dùng | Ưu điểm | Rủi ro |
| --- | --- | --- | --- |
| Migration trước app deploy | Migration backward compatible | App mới có schema sẵn | App cũ phải chịu được schema mới |
| Migration sau app deploy | Thay đổi không ảnh hưởng startup | Dễ deploy app trước | App mới có thể cần schema mới |
| Migration job riêng có approval | Production | Kiểm soát tốt | Thêm thao tác |

Khuyến nghị MVP: migration production là job riêng trong pipeline, có approval và backup trước khi chạy.

## 12. Backend deploy với Docker Compose

Ví dụ script định hướng:

```bash
set -e
export IMAGE_TAG="$1"
docker compose pull backend-api worker
docker compose up -d backend-api worker
docker compose ps
```

Production script cần bổ sung:

1. Check target environment.
2. Check image tag không rỗng/không latest.
3. Backup DB nếu có migration.
4. Run migration lock.
5. Health check sau deploy.
6. Rollback nếu health fail theo policy.

## 13. Health check backend

| Check | Endpoint/Command | Bắt buộc |
| --- | --- | --- |
| Liveness | `/health/live` | Có |
| Readiness | `/health/ready` | Có |
| Version | `/health/version` | Có |
| Database | readiness kiểm tra DB | Có |
| Valkey | readiness kiểm tra nếu service cần | Nên có |
| Worker heartbeat | job heartbeat/log | Nên có |

## 14. Smoke test backend

Sau deploy backend cần chạy tối thiểu:

1. `GET /health/live` trả 200.
2. `GET /health/ready` trả 200.
3. `GET /health/version` đúng commit/tag.
4. Login test user staging hoặc production smoke account.
5. Gọi endpoint `/api/v1/auth/me`.
6. Gọi một endpoint list nhẹ có auth, ví dụ dashboard me hoặc notification unread count.
7. Với production, không tạo dữ liệu nghiệp vụ thật trừ khi có smoke account/test tenant rõ.

## 15. Worker deployment

Worker cần được triển khai cùng version backend API nếu dùng chung codebase.

Checklist worker:

- [ ] Worker dùng cùng image tag với backend API.
- [ ] Worker có command riêng.
- [ ] Worker không chạy trùng job scheduled nếu không có lock.
- [ ] Worker log job start/success/failure.
- [ ] Worker có retry/backoff cho job phù hợp.
- [ ] Worker không xử lý job production bằng config staging.

## 16. Rollback backend

### 16.1 Rollback image

```text
detect deploy failure
  -> stop traffic or keep old container if deployment atomic
  -> deploy previous image tag
  -> smoke test
  -> monitor
  -> open incident/release note
```

### 16.2 Khi không rollback được

Không rollback app nếu migration đã làm DB không còn tương thích version cũ. Khi đó ưu tiên:

1. Forward-fix nhanh.
2. Tắt feature bằng flag nếu có.
3. Disable endpoint/route gây lỗi nếu an toàn.
4. Restore backup chỉ khi dữ liệu bị lỗi nghiêm trọng và có quyết định.

## 17. Production deployment gate

Không deploy backend production nếu:

- [ ] CI chưa pass.
- [ ] Image scan có critical vulnerability chưa được chấp nhận.
- [ ] Migration chưa chạy staging pass.
- [ ] QA regression chưa pass.
- [ ] UAT chưa sign-off nếu release cần UAT.
- [ ] Không có backup plan trước migration.
- [ ] Không có rollback plan.
- [ ] Không rõ image tag/version.
- [ ] Production env secret chưa sẵn sàng.

## 18. Deployment notification

Pipeline nên gửi thông báo đến kênh team:

| Sự kiện | Người nhận |
| --- | --- |
| Staging deploy success/fail | Dev, QA, Product |
| Production deploy requested | Release Manager, DevOps, Tech Lead |
| Production deploy started | Stakeholders |
| Production deploy success | Stakeholders |
| Production deploy failed/rollback | Incident channel |

## 19. Checklist DEVOPS-06

### 19.1 Pipeline checklist

- [ ] Backend CI có lint/test/build.
- [ ] Docker image build và push được.
- [ ] Image tag theo SHA/version.
- [ ] Có image scan.
- [ ] Có migration job.
- [ ] Có deploy job cho dev/staging/prod.
- [ ] Production deploy cần approval.
- [ ] Có smoke test sau deploy.
- [ ] Có rollback job hoặc runbook.

### 19.2 Runtime checklist

- [ ] Backend health endpoint hoạt động.
- [ ] Backend đọc đúng env.
- [ ] DB connection pool cấu hình đúng.
- [ ] CORS/cookie domain đúng môi trường.
- [ ] Worker chạy đúng command.
- [ ] Logs có request_id, user_id nếu có, không log secret.

## 20. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Deploy sai image | Lỗi hệ thống | Tag immutable + version health |
| Migration fail giữa deploy | Downtime | Backup + migration staging + lock |
| Worker chạy trùng job | Dữ liệu trùng | Job lock/idempotency |
| Secret sai môi trường | Login/API lỗi | Env validation + scoped secret |
| Smoke test thiếu | Lỗi lọt prod | Smoke checklist bắt buộc |
| Rollback không tương thích DB | Kẹt production | Backward-compatible migration |

## 21. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO06-OQ-001 | Backend deploy dùng Docker Compose, Kubernetes hay PaaS? | DevOps | Cao |
| DO06-OQ-002 | Production migration auto hay manual approval riêng? | Tech Lead | Cao |
| DO06-OQ-003 | Có smoke account production không? | Product/QA | Trung bình |
| DO06-OQ-004 | Worker scheduling dùng Valkey queue hay cron nội bộ? | Backend Lead | Trung bình |
| DO06-OQ-005 | Có cần blue-green backend ngay MVP không? | DevOps | Thấp/Trung bình |

## 99. Tiêu chí nghiệm thu DEVOPS-06

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

**DEVOPS-06** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
