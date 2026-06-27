# DEVOPS-01: DEVOPS ARCHITECTURE & ENVIRONMENT STRATEGY
# KIẾN TRÚC DEVOPS & CHIẾN LƯỢC MÔI TRƯỜNG TRIỂN KHAI
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-01 |
| Tên tài liệu | DevOps Architecture & Environment Strategy |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-01 là tài liệu mở đầu cho nhánh **DevOps, Deployment & Release Operations** của hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt định hướng kiến trúc triển khai tổng thể cho MVP.
2. Xác định các môi trường cần có: local, development, staging/UAT và production.
3. Chốt chiến lược containerization, network, domain, SSL, reverse proxy và service runtime.
4. Chốt chiến lược quản lý biến môi trường, secret, config và feature flag.
5. Chốt định hướng CI/CD cho frontend, backend, database migration và seed data.
6. Chốt chiến lược database runtime, migration, backup, restore và rollback.
7. Chốt chiến lược file storage, log, monitoring, alerting và audit vận hành.
8. Chốt baseline bảo mật hạ tầng cho MVP.
9. Làm nền cho các tài liệu DevOps tiếp theo: repository/branching, CI pipeline, Docker, deployment, monitoring, backup, hardening và go-live.
10. Giúp Product, Backend, Frontend, QA và DevOps thống nhất cách đưa hệ thống từ mã nguồn lên môi trường chạy thật.

DEVOPS-01 không đi sâu vào từng script CI/CD, từng Dockerfile, từng manifest hoặc từng cấu hình cụ thể của cloud provider. Các nội dung đó sẽ được tách sang các tài liệu DEVOPS-02 trở đi.

---

## 3. Vị trí DEVOPS-01 trong chuỗi tài liệu dự án

Chuỗi triển khai tổng thể của dự án:

```text
PRD / SPEC
  -> Database Design
  -> API Design
  -> UI/UX Design
  -> Frontend Implementation
  -> Backend Implementation
  -> QA & Release Readiness
  -> DevOps, Deployment & Release Operations
  -> Go-live
  -> Monitoring & Maintenance
  -> Phase 2 Planning
```

DEVOPS-01 đứng sau QA vì hệ thống đã có đủ:

1. Phạm vi nghiệp vụ MVP.
2. Thiết kế database.
3. Thiết kế API.
4. Thiết kế UI/UX.
5. Kế hoạch triển khai frontend.
6. Kế hoạch triển khai backend.
7. Chiến lược QA, test case, regression, UAT và readiness checklist.

Nhiệm vụ của nhánh DevOps là chuyển toàn bộ thiết kế và mã nguồn thành hệ thống có thể chạy ổn định trên môi trường thật.

---

## 4. Roadmap tài liệu DevOps đề xuất

| Mã tài liệu | Tên tài liệu | Mục tiêu |
| --- | --- | --- |
| DEVOPS-01 | DevOps Architecture & Environment Strategy | Chốt kiến trúc triển khai và chiến lược môi trường |
| DEVOPS-02 | Repository, Branching & CI Pipeline | Chốt repo, branch, commit, pull request, CI check |
| DEVOPS-03 | Docker & Containerization | Dockerfile, Docker Compose, image convention, runtime container |
| DEVOPS-04 | Environment Configuration & Secrets Management | ENV, secret, config, feature flag, rotation |
| DEVOPS-05 | Database Migration & Seed Deployment | Migration, seed, rollback, backup trước migration |
| DEVOPS-06 | Backend Deployment Pipeline | Build, test, deploy backend API, worker, job |
| DEVOPS-07 | Frontend Deployment Pipeline | Build, test, deploy frontend web app, static asset |
| DEVOPS-08 | Staging, UAT & Production Environment | Thiết lập staging/UAT/prod và quy trình promote release |
| DEVOPS-09 | Monitoring, Logging & Alerting | App log, infra metric, error tracking, alert rule |
| DEVOPS-10 | Backup, Rollback & Disaster Recovery | Backup DB/file/config, restore drill, rollback plan |
| DEVOPS-11 | Security Hardening & Runtime Protection | SSL, firewall, secret, header, rate limit, scan |
| DEVOPS-12 | Release Management & Go-live Plan | Release checklist, go-live window, post-release monitoring |

---

## 5. Căn cứ thiết kế DevOps

DEVOPS-01 bám theo các quyết định đã chốt trong bộ tài liệu trước:

1. Hệ thống là **web app trước**, mobile app có thể phát triển sau.
2. MVP có các module chính: AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI và FOUNDATION.
3. Database chính đề xuất là **PostgreSQL**.
4. Hệ thống thiết kế sẵn cho **multi-tenant** bằng `company_id`, dù MVP có thể chạy cho một công ty trước.
5. Backend là nguồn kiểm soát cuối cùng về authentication, permission, data scope và business rule.
6. Frontend không được tự tin tưởng role/permission local để thay thế backend guard.
7. File trong hệ thống mặc định là private và cần kiểm tra quyền trước khi xem/tải.
8. Các thao tác quan trọng cần audit log.
9. Notification, dashboard, attendance, leave và task có thể phát sinh event quan trọng cần log/monitor.
10. QA đã có release readiness nên DevOps phải cung cấp môi trường staging/UAT đủ giống production để kiểm thử cuối.
11. Database migration và seed phải idempotent, chạy được từ database trống.
12. Hệ thống cần có khả năng backup, rollback và theo dõi lỗi sau release.

---

## 6. Phạm vi DEVOPS-01

### 6.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Deployment architecture | Kiến trúc runtime tổng thể cho frontend, backend, database, storage, cache, reverse proxy |
| Environment strategy | Local, development, staging/UAT, production |
| Infrastructure model | MVP deployment model, cloud/VPS strategy, container strategy |
| Network & domain | Domain, subdomain, SSL, reverse proxy, firewall, private network |
| Runtime service | Web app, API service, worker/job service, database, cache, object storage |
| Config & secrets | ENV, secret, feature flag, config theo môi trường |
| CI/CD overview | Build, test, scan, migration, deploy, smoke test |
| Database operations | Migration, seed, backup, restore, rollback strategy |
| File storage operations | Private file storage, upload/download, backup, retention |
| Observability | Logging, metrics, health check, alerting, error tracking |
| Security baseline | TLS, CORS, rate limit, security headers, secret protection, access control |
| Release strategy | Versioning, release gate, staging sign-off, production deploy |
| Acceptance criteria | Điều kiện hoàn tất DEVOPS-01 |

### 6.2 Không bao gồm sâu

| Nội dung | Tài liệu xử lý sau |
| --- | --- |
| Quy tắc branch chi tiết | DEVOPS-02 |
| GitHub Actions/GitLab CI YAML chi tiết | DEVOPS-02, DEVOPS-06, DEVOPS-07 |
| Dockerfile cụ thể | DEVOPS-03 |
| Docker Compose/Kubernetes manifest đầy đủ | DEVOPS-03, DEVOPS-08 |
| ENV matrix chi tiết từng biến | DEVOPS-04 |
| Migration command cụ thể | DEVOPS-05 |
| Backend deployment script | DEVOPS-06 |
| Frontend deployment script | DEVOPS-07 |
| Monitoring dashboard chi tiết | DEVOPS-09 |
| Backup script và restore drill chi tiết | DEVOPS-10 |
| Hardening checklist chuyên sâu | DEVOPS-11 |
| Go-live runbook chi tiết | DEVOPS-12 |

---

## 7. Nguyên tắc DevOps tổng thể

### 7.1 Production-like từ sớm

Môi trường staging/UAT phải càng giống production càng tốt về:

1. Runtime container.
2. Biến môi trường.
3. Database engine.
4. Reverse proxy.
5. SSL/TLS.
6. File storage.
7. Migration/seed flow.
8. Logging và monitoring.
9. Permission và seed role mặc định.
10. Data volume giả lập tối thiểu cho QA.

Không nên để staging chạy bằng cách quá khác production vì sẽ tạo rủi ro lỗi chỉ xuất hiện khi go-live.

### 7.2 Infrastructure reproducible

Cấu hình hạ tầng cần có khả năng dựng lại được từ tài liệu/script:

```text
source code + env + migration + seed + storage config
  -> deploy được môi trường mới
```

Tối thiểu MVP cần có:

1. Dockerfile hoặc build script chuẩn.
2. Compose/manifest mô tả service runtime.
3. ENV template cho từng service.
4. Migration command chuẩn.
5. Seed command chuẩn.
6. Backup/restore command chuẩn.
7. Health check endpoint chuẩn.

### 7.3 Separation of concerns

Các lớp cần tách rõ:

| Lớp | Trách nhiệm |
| --- | --- |
| Frontend | Static web app, routing client, gọi API |
| Backend API | Xử lý nghiệp vụ, auth, permission, API response |
| Worker/Job | Xử lý tác vụ nền: notification, cleanup, scheduled job nếu có |
| Database | PostgreSQL, dữ liệu nghiệp vụ và audit |
| Cache/Queue | Cache session/query nhẹ hoặc job queue nếu cần |
| File Storage | Lưu file upload private |
| Reverse Proxy | SSL termination, routing, compression, security header |
| Monitoring | Log, metric, alert, error tracking |

### 7.4 Backend là trust boundary

Hạ tầng và frontend không được thay thế kiểm tra quyền của backend.

Tất cả request nghiệp vụ vẫn phải qua backend guard:

1. Authentication.
2. Token/session validity.
3. Company/tenant active.
4. User active.
5. Permission.
6. Data scope.
7. Business rule.
8. Audit log.

### 7.5 Deploy an toàn hơn deploy nhanh

MVP nên ưu tiên:

1. Deploy có kiểm soát.
2. Backup trước migration.
3. Có rollback plan.
4. Có smoke test sau deploy.
5. Có log và alert cơ bản.
6. Có checklist release rõ ràng.

### 7.6 Mười nguyên tắc DevOps áp dụng xuyên suốt

Các nguyên tắc trên được cô đọng thành 10 nguyên tắc chuẩn, áp dụng nhất quán cho toàn bộ tài liệu DEVOPS-02 -> DEVOPS-12 (mỗi tài liệu lặp lại nguyên tắc này ở section 4):

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

---

## 8. Kiến trúc triển khai MVP đề xuất

### 8.1 Mô hình triển khai khuyến nghị cho MVP

Đối với MVP, khuyến nghị dùng mô hình:

```text
Cloud VM / VPS / Managed Container Host
  -> Reverse Proxy: Nginx hoặc Traefik
  -> Frontend Web Container hoặc Static Hosting
  -> Backend API Container
  -> Worker/Job Container nếu cần
  -> PostgreSQL Managed Service hoặc PostgreSQL Container/VM riêng
  -> Valkey Container/Managed Valkey nếu cần cache/queue
  -> Object Storage hoặc private volume cho file upload
  -> Monitoring/Logging agent
```

MVP có thể bắt đầu bằng **Docker Compose trên một VM mạnh vừa đủ** nếu team nhỏ và cần triển khai nhanh. Tuy nhiên cần thiết kế để sau này có thể nâng cấp sang:

1. Managed database.
2. Managed object storage.
3. Load balancer.
4. Multiple backend instances.
5. Kubernetes hoặc container orchestration.
6. Read replica/reporting database.

### 8.2 Sơ đồ runtime cấp cao

```text
User Browser
  |
  | HTTPS
  v
Reverse Proxy / Load Balancer
  |
  |-- /                    -> Frontend Web App
  |-- /api/v1/*             -> Backend API
  |-- /health               -> Health endpoint
  |
  v
Backend API
  |-- PostgreSQL
  |-- Valkey / Queue optional
  |-- File Storage
  |-- Email/Notification provider optional
  |-- Monitoring/Error Tracking

Worker / Job Service optional
  |-- PostgreSQL
  |-- Valkey / Queue optional
  |-- Notification delivery
  |-- Cleanup/retention jobs
```

### 8.3 Service chính trong MVP

| Service | Bắt buộc MVP | Vai trò |
| --- | --- | --- |
| `frontend-web` | Có | Web app cho người dùng nội bộ |
| `backend-api` | Có | API nghiệp vụ chính |
| `postgres` | Có | Database chính |
| `reverse-proxy` | Có | HTTPS, routing, compression, header |
| `worker` | Nên có nếu có job | Notification, scheduled jobs, cleanup, retry |
| `valkey` | Optional nhưng khuyến nghị | Cache, rate limit, queue, session support nếu cần |
| `object-storage` | Có thể dùng local/S3 compatible | File upload private |
| `monitoring-agent` | Nên có | Log/metric/error tracking |

### 8.4 Mức độ ưu tiên theo giai đoạn

| Giai đoạn | Mô hình đề xuất |
| --- | --- |
| Local | Docker Compose hoặc native dev service |
| Development shared | Docker Compose trên dev server hoặc preview deployment |
| Staging/UAT | Gần giống production, dữ liệu test, SSL thật |
| Production MVP | Dockerized services, backup, monitoring, manual approval deploy |
| Post-MVP | Managed DB, autoscale, queue riêng, observability đầy đủ |

---

## 9. Chiến lược môi trường

### 9.1 Danh sách môi trường

| Môi trường | Mục đích | Người dùng chính | Dữ liệu | Stability |
| --- | --- | --- | --- | --- |
| Local | Dev cá nhân, chạy feature | Developer | Mock/seed local | Không ổn định |
| Development | Tích hợp sớm giữa frontend/backend | Dev team | Seed test | Trung bình |
| Staging | Kiểm thử gần production | QA, BA, Product | Test data gần thật | Cao |
| UAT | Business acceptance | Business user, Product, QA | UAT data kiểm soát | Cao |
| Production | Người dùng thật | End user | Dữ liệu thật | Rất cao |

Có thể gộp **Staging** và **UAT** trong MVP nếu nguồn lực hạn chế, nhưng cần phân biệt bằng release window và bộ dữ liệu test.

### 9.2 Local environment

Local environment phục vụ developer triển khai tính năng.

Yêu cầu:

1. Có file `.env.example` cho frontend và backend.
2. Có local database seed đủ để login và test module MVP.
3. Có thể chạy database bằng Docker.
4. Có thể reset database nhanh.
5. Có mock mail/notification provider nếu chưa dùng dịch vụ thật.
6. File upload local dùng thư mục private hoặc local object storage giả lập.
7. Không dùng production secret.

Luồng local đề xuất:

```text
clone repo
  -> copy .env.example -> .env.local
  -> docker compose up postgres valkey
  -> run migration
  -> run seed
  -> start backend
  -> start frontend
```

### 9.3 Development environment

Development environment dùng để tích hợp các nhánh đã merge vào develop.

Yêu cầu:

1. Auto deploy khi merge vào `develop` nếu CI pass.
2. Dữ liệu là test data, có thể reset định kỳ.
3. Bật debug log ở mức vừa phải.
4. Cho phép QA/dev kiểm tra sớm API, UI, permission, migration.
5. Không chứa dữ liệu thật.
6. Có thể không cần uptime nghiêm ngặt như staging/prod.

### 9.4 Staging environment

Staging là môi trường kiểm thử release candidate.

Yêu cầu:

1. Deploy từ branch/tag release candidate.
2. Cấu hình gần giống production.
3. Bật SSL, domain riêng, reverse proxy như production.
4. Dùng database riêng, không dùng chung production.
5. Dữ liệu test phải đủ cho các module AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI.
6. Chạy full regression, smoke test, permission test và UAT flow.
7. Mọi migration phải chạy trên staging trước production.
8. Có log/monitoring cơ bản.

### 9.5 UAT environment

UAT có thể tách riêng hoặc dùng chung staging theo release window.

Nếu tách riêng:

1. UAT ổn định hơn development.
2. Chỉ deploy bản đã qua QA nội bộ.
3. Dữ liệu được setup theo kịch bản business acceptance.
4. Người dùng UAT chỉ có quyền thử nghiệm trong phạm vi test.
5. Có checklist UAT và sign-off trước production.

Nếu gộp staging/UAT:

1. Cần đóng băng deploy trong thời gian UAT.
2. Không tự động deploy mọi merge vào staging trong lúc UAT.
3. Cần snapshot database trước UAT để có thể reset.

### 9.6 Production environment

Production là môi trường người dùng thật.

Yêu cầu tối thiểu:

1. Chỉ deploy từ tag/release đã được approve.
2. Có manual approval trước production deploy.
3. Có backup database trước migration.
4. Có rollback plan rõ ràng.
5. Có health check sau deploy.
6. Có smoke test sau deploy.
7. Có monitoring và alert tối thiểu.
8. Có SSL hợp lệ.
9. Không bật debug log quá chi tiết.
10. Secret được quản lý an toàn, không commit vào repo.

---

## 10. Chiến lược domain, network và reverse proxy

### 10.1 Domain đề xuất

Sơ đồ domain chuẩn dùng subdomain tách frontend/API cho mọi môi trường (thống nhất với DEVOPS-08):

| Môi trường | Domain frontend | Domain API |
| --- | --- | --- |
| Development | `dev.ems.example.com` | `api.dev.ems.example.com` |
| Staging | `staging.ems.example.com` | `api.staging.ems.example.com` |
| UAT | `uat.ems.example.com` | `api.uat.ems.example.com` |
| Production | `app.ems.example.com` | `api.ems.example.com` |

Sơ đồ subdomain production:

```text
https://app.ems.example.com        -> frontend
https://api.ems.example.com/api/v1 -> backend
```

Khi tách subdomain API cần cấu hình CORS, cookie domain và security policy chặt hơn (xem DEVOPS-11).

Phương án thay thế (path-based, cùng domain) có thể cân nhắc nếu muốn đơn giản hóa CORS/cookie:

```text
https://app.ems.example.com/          -> frontend
https://app.ems.example.com/api/v1/*  -> backend
```

Ưu điểm path-based: giảm cấu hình CORS, cookie/session dễ quản lý, người dùng chỉ cần nhớ một domain. Nhược điểm: khó tách scale frontend/API độc lập. MVP chốt theo sơ đồ subdomain ở trên để đồng bộ các môi trường.

### 10.2 Reverse proxy

Reverse proxy chịu trách nhiệm:

1. Terminate SSL/TLS.
2. Route request đến frontend/backend.
3. Compression gzip/brotli nếu phù hợp.
4. Set security headers.
5. Limit request body size cho upload.
6. Rate limit endpoint nhạy cảm như login, forgot password.
7. Log access cơ bản.
8. Forward request id và client IP đúng chuẩn.

Reverse proxy khuyến nghị:

| Option | Phù hợp |
| --- | --- |
| Nginx | Đơn giản, phổ biến, ổn định |
| Traefik | Tốt với Docker service discovery, auto SSL |
| Cloud Load Balancer | Khi dùng cloud managed infrastructure |

### 10.3 SSL/TLS

Production và staging/UAT phải dùng HTTPS.

Yêu cầu:

1. TLS certificate hợp lệ.
2. Tự động renew nếu dùng Let's Encrypt.
3. Redirect HTTP sang HTTPS.
4. Bật HSTS ở production sau khi xác nhận domain ổn định.
5. Không dùng self-signed cert cho staging/UAT nếu người dùng business truy cập.

### 10.4 Network segmentation

Nguyên tắc:

1. Database không public internet.
2. Valkey không public internet.
3. File storage private mặc định.
4. Backend chỉ expose qua reverse proxy hoặc private load balancer.
5. SSH vào server giới hạn IP hoặc dùng VPN/bastion nếu có.
6. Production không dùng port database mở ra ngoài.

Mô hình tối thiểu:

```text
Public Internet
  -> 443 Reverse Proxy
  -> Backend private port
  -> Database private network
  -> Valkey private network
```

---

## 11. Chiến lược containerization

### 11.1 Vì sao nên dùng container cho MVP

Container giúp:

1. Đồng nhất môi trường local/staging/production.
2. Giảm lỗi do khác phiên bản runtime.
3. Dễ rollback bằng image tag.
4. Dễ scale backend/worker sau này.
5. Dễ tích hợp CI/CD.
6. Dễ đóng gói frontend/backend độc lập.

### 11.2 Image chính

| Image | Nguồn build | Ghi chú |
| --- | --- | --- |
| `ems-frontend` | Frontend source | Build static app hoặc serve qua Nginx |
| `ems-backend-api` | Backend source | API service |
| `ems-worker` | Backend source | Job/worker, có thể cùng image backend khác command |
| `ems-migration` | Backend source | Optional: chạy migration/seed như job riêng |

### 11.3 Tag image

Quy ước tag đề xuất:

```text
<service>:<environment>-<git_short_sha>
<service>:v<semver>
<service>:release-YYYYMMDD.<number>
```

Ví dụ:

```text
ems-backend-api:staging-a1b2c3d
ems-backend-api:v1.0.0-rc.1
ems-frontend:v1.0.0
```

Không nên deploy bằng tag `latest` ở production vì khó rollback và khó truy vết.

### 11.4 Docker Compose cho MVP

Docker Compose phù hợp cho:

1. Local development.
2. Development server.
3. MVP production nhỏ nếu team chưa cần Kubernetes.

Tuy nhiên production dùng Compose vẫn cần:

1. Restart policy.
2. Health check.
3. Volume strategy.
4. Backup strategy.
5. Log rotation.
6. Resource limits nếu có thể.
7. Manual approval deploy.

### 11.5 Nâng cấp sau MVP

Khi tải tăng, có thể nâng lên:

1. Managed PostgreSQL.
2. Managed Valkey.
3. Object storage S3 compatible.
4. Container orchestration.
5. Load balancer.
6. Horizontal scaling backend.
7. Separate worker queue.
8. CDN cho static asset.

---

## 12. Chiến lược cấu hình và secret

### 12.1 Nguyên tắc

1. Không commit secret vào source code.
2. Không ghi secret vào log.
3. Mỗi môi trường có bộ secret riêng.
4. Production secret chỉ cấp cho người/vai trò cần thiết.
5. Secret cần có khả năng rotate.
6. ENV template chỉ chứa tên biến và mô tả, không chứa giá trị thật.
7. Backend phải validate required ENV khi khởi động.

### 12.2 Nhóm cấu hình chính

| Nhóm | Ví dụ |
| --- | --- |
| App runtime | `NODE_ENV`, `APP_ENV`, `APP_VERSION` |
| API | `API_BASE_URL`, `PUBLIC_API_URL` |
| Database | `DATABASE_URL`, `DB_POOL_MIN`, `DB_POOL_MAX` |
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` |
| CORS | `CORS_ALLOWED_ORIGINS` |
| File storage | `STORAGE_DRIVER`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `FILE_SIGNING_SECRET` |
| Email/Notification | `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `EMAIL_FROM` |
| Valkey/Queue | `VALKEY_URL`, `QUEUE_PREFIX` |
| Logging | `LOG_LEVEL`, `SENTRY_DSN` hoặc provider tương đương |
| Security | `RATE_LIMIT_ENABLED`, `COOKIE_SECURE`, `COOKIE_DOMAIN`, `HSTS_ENABLED`, `TRUST_PROXY` |
| Feature flags | `ENABLE_REMOTE_WORK`, `ENABLE_EMAIL_NOTIFICATION` |

> Tên biến đầy đủ và chính thức (schema, bắt buộc/secret theo môi trường) xem DEVOPS-04.

### 12.3 Config theo môi trường

| Loại config | Local | Dev | Staging/UAT | Production |
| --- | --- | --- | --- | --- |
| Debug log | Có | Có giới hạn | Ít | Không |
| Seed demo data | Có | Có | Có kiểm soát | Không hoặc chỉ seed nền tảng |
| SSL | Optional | Nên có | Bắt buộc | Bắt buộc |
| Email thật | Không | Optional | Có thể sandbox | Có |
| Backup | Optional | Nên có | Có | Bắt buộc |
| Monitoring | Optional | Nên có | Có | Bắt buộc |
| Rate limit | Optional | Có | Có | Bắt buộc |

### 12.4 Secret storage

Tùy môi trường có thể dùng:

| Option | Phù hợp |
| --- | --- |
| `.env` local | Chỉ local dev |
| CI/CD secret store | Build/deploy pipeline |
| Server secret file permission restricted | MVP nhỏ |
| Cloud secret manager | Production tốt hơn |
| Vault | Khi hệ thống lớn, nhiều team, nhiều service |

MVP có thể bắt đầu bằng CI/CD secrets + server `.env` được phân quyền chặt, nhưng roadmap nên hướng tới secret manager.

---

## 13. Chiến lược database runtime

### 13.1 Database engine

Database chính:

```text
PostgreSQL
```

Lý do:

1. Dữ liệu quan hệ nhiều.
2. Cần transaction cho nghiệp vụ duyệt nghỉ, cập nhật bảng công, phân quyền.
3. Cần foreign key, unique constraint, check constraint.
4. Cần JSONB cho audit diff, notification payload, config linh hoạt.
5. Cần index tốt cho dashboard, notification, bảng công, task.
6. Dễ mở rộng multi-tenant theo `company_id`.

### 13.2 Database per environment

Mỗi môi trường phải có database riêng:

```text
ems_local
ems_dev
ems_staging
ems_uat
ems_prod
```

Không dùng chung database giữa staging và production.

### 13.3 Migration strategy

Migration phải:

1. Có version rõ ràng.
2. Chạy theo thứ tự xác định.
3. Có thể chạy trên database trống.
4. Không phụ thuộc dữ liệu production không kiểm soát.
5. Có rollback hoặc forward-fix strategy.
6. Được test ở staging trước production.
7. Có backup trước khi chạy production migration.
8. Không tự ý drop dữ liệu production nếu chưa có kế hoạch.

Luồng migration production đề xuất:

```text
backup database
  -> run migration dry-check nếu tool hỗ trợ
  -> run migration
  -> run required seed
  -> run smoke test
  -> monitor errors
```

### 13.4 Seed strategy

Seed chia thành 2 loại:

| Loại seed | Môi trường | Ghi chú |
| --- | --- | --- |
| Foundation seed | Mọi môi trường | Modules, permissions, roles, settings, notification events, dashboard widgets |
| Demo/test seed | Local/dev/staging/UAT | User mẫu, employee mẫu, leave/task/attendance mẫu |
| Production bootstrap seed | Production | Company đầu tiên, Super Admin, role/permission, settings mặc định |

Production không nên seed dữ liệu demo nghiệp vụ.

### 13.5 Backup strategy

Production cần backup:

1. Full database backup hằng ngày.
2. Backup trước mỗi release có migration.
3. Retention tối thiểu theo chính sách nội bộ.
4. Backup encryption nếu lưu ngoài server.
5. Kiểm tra restore định kỳ.

Staging/UAT nên có snapshot trước UAT để reset khi cần.

---

## 14. Chiến lược file storage

### 14.1 Loại file trong hệ thống

Hệ thống có thể lưu:

1. Avatar user/employee.
2. File hồ sơ nhân viên.
3. File hợp đồng.
4. File chứng minh điều chỉnh công.
5. File chứng minh nghỉ phép.
6. File đính kèm task/project.
7. File export nếu có.
8. File audit/report nếu phát sinh.

### 14.2 Nguyên tắc storage

1. File private mặc định.
2. Không expose direct public path nếu file nhạy cảm.
3. Download phải qua backend hoặc signed URL có thời hạn.
4. Metadata file lưu trong database.
5. File thật lưu ở private storage.
6. File cần virus scan ở phase sau nếu có upload từ nhiều người dùng.
7. Có retention/cleanup policy cho file tạm.
8. Có backup file production.

### 14.3 Storage option

| Option | Ưu điểm | Nhược điểm | Phù hợp |
| --- | --- | --- | --- |
| Local volume | Dễ triển khai | Khó scale, backup thủ công | Local/dev/MVP nhỏ |
| S3-compatible object storage | Dễ scale, backup tốt | Cần cấu hình cloud | Production khuyến nghị |
| Managed file storage | Tích hợp cloud | Chi phí/cấu hình | Production nếu có cloud |

Khuyến nghị:

```text
Local/dev: local private volume hoặc MinIO
Production: S3-compatible object storage hoặc private managed storage
```

---

## 15. Chiến lược cache, queue và background job

### 15.1 Cache

Cache có thể dùng cho:

1. Permission/session context ngắn hạn.
2. Dashboard widget cache.
3. Notification unread count cache nếu cần.
4. Rate limit counter.
5. API response cache cho dữ liệu ít đổi.

MVP có thể bắt đầu chưa dùng cache phức tạp, nhưng nên thiết kế sẵn Valkey để mở rộng.

### 15.2 Queue/background job

Background job có thể dùng cho:

1. Gửi notification/email retry.
2. Detect task overdue/due soon.
3. Detect missing checkout.
4. Dashboard cache warmup/invalidation.
5. Cleanup expired session/token.
6. Cleanup temp files.
7. Export report lớn ở phase sau.

Nếu chưa có queue trong MVP, có thể dùng scheduled cron job trong backend/worker. Tuy nhiên khi số lượng job tăng, nên tách worker và queue.

### 15.3 Worker service

Worker nên tách khỏi API nếu:

1. Job chạy lâu.
2. Job retry nhiều.
3. Notification/email có thể fail.
4. Dashboard cache cần xử lý định kỳ.
5. Export file lớn.

MVP có thể dùng cùng codebase backend nhưng khác command:

```text
backend-api: npm run start:api
backend-worker: npm run start:worker
```

---

## 16. Chiến lược CI/CD tổng quan

### 16.1 Mục tiêu CI/CD

CI/CD cần đảm bảo:

1. Code merge vào nhánh chính phải qua kiểm tra tự động.
2. Build frontend/backend lặp lại được.
3. Test chạy trước deploy.
4. Image/container được tag rõ ràng.
5. Staging deploy tự động hoặc bán tự động.
6. Production deploy có manual approval.
7. Migration được chạy có kiểm soát.
8. Có smoke test sau deploy.
9. Có khả năng rollback nhanh.

### 16.2 Pipeline cấp cao

```text
Pull Request
  -> lint
  -> typecheck
  -> unit test
  -> build
  -> security/dependency scan basic
  -> review
  -> merge

Merge to develop
  -> build image
  -> deploy development
  -> smoke test

Release candidate
  -> build immutable image
  -> deploy staging/UAT
  -> migration staging
  -> regression/UAT
  -> sign-off

Production release
  -> backup database
  -> deploy backend/frontend
  -> run migration/seed
  -> smoke test
  -> monitor
```

### 16.3 Release gate

Không được deploy production nếu chưa đạt:

1. CI pass.
2. Build pass.
3. Migration pass ở staging.
4. Smoke test pass ở staging.
5. QA regression pass theo scope release.
6. UAT sign-off nếu release lớn.
7. Backup strategy sẵn sàng.
8. Rollback plan rõ ràng.
9. Người chịu trách nhiệm release được xác định.

---

## 17. Chiến lược logging, monitoring và alerting

### 17.1 Logging

Log cần hỗ trợ điều tra lỗi mà không lộ dữ liệu nhạy cảm.

Backend log nên có:

1. Timestamp.
2. Environment.
3. Service name.
4. Request ID / correlation ID.
5. User ID nếu an toàn và cần thiết.
6. Company ID nếu an toàn và cần thiết.
7. Method/path/status/duration.
8. Error code.
9. Stack trace ở staging/dev; production cần kiểm soát.

Không log:

1. Password.
2. Token.
3. Refresh token.
4. Secret.
5. File private content.
6. Dữ liệu nhạy cảm HR nếu không cần thiết.
7. Full request body của endpoint nhạy cảm.

### 17.2 Health check

Backend cần endpoint health:

```http
GET /health/live
GET /health/ready
GET /health/version
```

Gợi ý:

| Endpoint | Mục đích |
| --- | --- |
| `/health/live` | Service process còn sống |
| `/health/ready` | Service sẵn sàng nhận traffic, kiểm tra DB/cache cần thiết |
| `/health/version` | Trả app version, commit SHA, build time |

### 17.3 Metrics tối thiểu

Cần theo dõi:

1. Uptime service.
2. CPU/RAM/disk.
3. Database connection usage.
4. API latency p95/p99.
5. API error rate 4xx/5xx.
6. Login failure spike.
7. Queue backlog nếu có.
8. Notification delivery failure nếu có.
9. Disk usage file/log.
10. Backup success/failure.

### 17.4 Alert tối thiểu

Production cần alert khi:

1. API down.
2. Database không kết nối được.
3. Disk usage vượt ngưỡng.
4. Error rate tăng bất thường.
5. Backup fail.
6. SSL certificate sắp hết hạn.
7. CPU/RAM cao kéo dài.
8. Queue backlog cao nếu có.

---

## 18. Baseline bảo mật hạ tầng

### 18.1 Network security

1. Chỉ expose port 80/443 ra internet.
2. SSH giới hạn IP hoặc dùng VPN/bastion.
3. Database/Valkey không public.
4. Tắt service không dùng.
5. Firewall bật mặc định deny inbound.
6. Dùng private network cho internal service nếu cloud hỗ trợ.

### 18.2 Application security headers

Reverse proxy hoặc backend cần set:

1. `Strict-Transport-Security` ở production.
2. `X-Content-Type-Options: nosniff`.
3. `X-Frame-Options` hoặc CSP frame policy.
4. `Referrer-Policy`.
5. `Content-Security-Policy` theo khả năng triển khai.
6. Secure cookie flags nếu dùng cookie.

### 18.3 Rate limiting

Rate limit cần áp dụng cho:

1. Login.
2. Forgot password.
3. Reset password.
4. File upload.
5. API public/internal nếu có nguy cơ abuse.

### 18.4 Secret protection

1. Không commit `.env` thật.
2. Không hiển thị secret trong CI logs.
3. Rotate secret khi nghi ngờ lộ.
4. Production secret tách khỏi staging/dev.
5. Không dùng chung JWT secret giữa môi trường.

### 18.5 Dependency and image scanning

CI nên có kiểm tra cơ bản:

1. Dependency vulnerability scan.
2. Secret scan.
3. Container image scan nếu dùng registry hỗ trợ.
4. Lint Dockerfile cơ bản ở DEVOPS-03.

---

## 19. Chiến lược backup, restore và rollback cấp cao

### 19.1 Backup scope

Cần backup:

1. PostgreSQL database.
2. File storage private.
3. ENV/config production quan trọng.
4. Reverse proxy config.
5. Deployment compose/manifest.
6. Migration version history.

### 19.2 Backup timing

| Thời điểm | Nội dung |
| --- | --- |
| Hằng ngày | Full DB backup production |
| Trước release có migration | DB backup bắt buộc |
| Trước thay đổi infra lớn | Snapshot VM/config nếu có |
| Sau go-live ổn định | Xác nhận backup chạy định kỳ |

### 19.3 Restore drill

Không chỉ tạo backup, cần test restore.

Tối thiểu:

1. Restore database backup vào môi trường test.
2. Kiểm tra migration version.
3. Kiểm tra login bằng user test.
4. Kiểm tra file link nếu có backup file.
5. Ghi nhận thời gian restore.

### 19.4 Rollback strategy

Có 3 loại rollback:

| Loại | Cách xử lý |
| --- | --- |
| App rollback | Deploy lại image version trước |
| Database rollback | Ưu tiên forward-fix; restore backup nếu lỗi nghiêm trọng |
| Config rollback | Revert env/config/proxy về bản trước |

Nguyên tắc production:

1. App rollback phải nhanh và rõ image tag.
2. Database rollback khó hơn, nên migration phải cẩn trọng.
3. Migration destructive cần chia nhiều bước hoặc tránh trong MVP.
4. Với lỗi dữ liệu nghiêm trọng, cần restore từ backup sau khi đánh giá mất dữ liệu.

---

## 20. Chiến lược release và go-live cấp cao

### 20.1 Versioning

Khuyến nghị dùng semantic versioning cho release:

```text
v1.0.0-rc.1
v1.0.0-rc.2
v1.0.0
v1.0.1
```

Mỗi release cần gắn:

1. Git tag.
2. Frontend image tag.
3. Backend image tag.
4. Migration version.
5. Release note.
6. QA/UAT sign-off.

### 20.2 Release candidate

Release candidate là bản được deploy lên staging/UAT để test cuối.

Điều kiện tạo RC:

1. Feature freeze theo scope release.
2. CI pass.
3. Unit/API/E2E test pass theo mức yêu cầu.
4. Migration chạy được ở staging.
5. Không còn bug blocker/critical.

### 20.3 Production go-live

Go-live production cần có:

1. Go-live checklist.
2. Backup trước deploy.
3. Người phụ trách deploy.
4. Người phụ trách QA smoke test.
5. Người phụ trách business verify.
6. Rollback owner.
7. Monitoring owner.
8. Communication channel trong lúc release.
9. Post-release monitoring window.

### 20.4 Smoke test sau deploy

Smoke test production tối thiểu:

1. Mở trang login.
2. Login bằng tài khoản test/admin hợp lệ.
3. Load Home Portal.
4. Mở App Switcher.
5. Mở Dashboard.
6. Gọi API `/me` hoặc current user.
7. Kiểm tra danh sách nhân viên cơ bản nếu có quyền.
8. Kiểm tra notification unread count.
9. Kiểm tra health endpoint.
10. Kiểm tra log không có lỗi nghiêm trọng.

---

## 21. Chiến lược dữ liệu theo môi trường

### 21.1 Dữ liệu production

Production chỉ chứa dữ liệu thật và seed nền tảng.

Không được đưa vào production:

1. User demo.
2. Employee demo.
3. Password mặc định dễ đoán.
4. File test.
5. Debug setting.
6. Mock notification provider nếu không được cấu hình rõ.

### 21.2 Dữ liệu staging/UAT

Staging/UAT cần dữ liệu mô phỏng đủ để test:

1. Super Admin.
2. Company Admin.
3. HR.
4. Manager.
5. Employee.
6. Nhiều phòng ban.
7. Nhân viên nhiều trạng thái.
8. Ca làm/rule chấm công.
9. Đơn nghỉ pending/approved/rejected.
10. Task/project/comment/checklist.
11. Notification read/unread.
12. Dashboard widgets có dữ liệu.

Dữ liệu staging/UAT không nên lấy thẳng production nếu chưa ẩn danh/anonymize.

### 21.3 Data reset

Development có thể reset thường xuyên.

Staging/UAT chỉ reset theo lịch hoặc trước vòng test lớn.

Production không reset.

---

## 22. Quyền truy cập hạ tầng

### 22.1 Nguyên tắc phân quyền

1. Ít quyền nhất có thể.
2. Tài khoản cá nhân, không dùng chung nếu có thể.
3. Tách quyền dev/staging/production.
4. Production access cần được kiểm soát.
5. Mọi thay đổi production phải qua quy trình release/change.

### 22.2 Vai trò đề xuất

| Vai trò | Quyền |
| --- | --- |
| Developer | Local/dev, xem log dev, không truy cập production secret |
| Backend Lead | Dev/staging API, migration staging, hỗ trợ production qua quy trình |
| Frontend Lead | Dev/staging frontend, config frontend public |
| QA Lead | Truy cập staging/UAT, xem release build, không sửa hạ tầng |
| DevOps | Quản lý CI/CD, server, secret, deploy, backup |
| Product/Business UAT | Truy cập UAT bằng tài khoản app, không truy cập hạ tầng |
| Admin Production | Quyền vận hành ứng dụng, không nhất thiết có SSH/server |

---

## 23. Rủi ro DevOps chính và hướng kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Staging khác production quá nhiều | Lỗi chỉ xuất hiện khi go-live | Production-like staging |
| Migration lỗi production | Mất dữ liệu/downtime | Backup trước migration, test staging, migration review |
| Secret bị commit | Rò rỉ bảo mật | Secret scan, `.gitignore`, secret manager |
| Không có rollback rõ | Downtime kéo dài | Immutable image tag, rollback runbook |
| Backup không restore được | Không khôi phục khi sự cố | Restore drill định kỳ |
| Log chứa dữ liệu nhạy cảm | Rò rỉ HR/auth data | Log policy, mask sensitive data |
| File storage local không backup | Mất file hồ sơ/task | Backup file hoặc dùng object storage |
| Không có monitoring | Phát hiện lỗi chậm | Health check, alert, error tracking |
| Deploy thủ công không chuẩn | Lỗi môi trường | CI/CD, checklist deploy |
| Dùng `latest` image ở prod | Không truy vết version | Tag image theo release/git SHA |

---

## 24. Quyết định kiến trúc đề xuất cho MVP

### 24.1 Quyết định chính

| Nhóm | Quyết định đề xuất |
| --- | --- |
| Runtime | Containerized deployment |
| MVP host | Cloud VM/VPS hoặc managed container host |
| Reverse proxy | Nginx hoặc Traefik |
| Database | PostgreSQL |
| Cache/Queue | Valkey optional nhưng nên chuẩn bị |
| File storage | Local private volume cho dev; S3-compatible/private storage cho production nếu có điều kiện |
| CI/CD | GitHub Actions hoặc GitLab CI tùy repo |
| Deployment | Staging tự động/bán tự động, production manual approval |
| Monitoring | Health check + log aggregation + error tracking tối thiểu |
| Backup | Daily DB backup + pre-release backup |
| SSL | HTTPS bắt buộc staging/UAT/prod |
| Release | Version/tag rõ ràng, không dùng `latest` ở production |

### 24.2 Quyết định có thể điều chỉnh theo nguồn lực

| Nội dung | Lựa chọn MVP đơn giản | Lựa chọn mạnh hơn |
| --- | --- | --- |
| Database production | PostgreSQL trên VM riêng/container có backup | Managed PostgreSQL |
| File storage | Private volume + backup | S3-compatible object storage |
| Deployment | Docker Compose | Kubernetes/managed container platform |
| Monitoring | Server log + uptime monitor | Centralized logs + metrics + tracing |
| Secret | CI secrets + server env file bảo mật | Cloud Secret Manager/Vault |
| UAT | Gộp staging/UAT theo release window | UAT environment riêng |

---

## 25. Mapping DevOps với các module MVP

| Module | Nhu cầu DevOps liên quan |
| --- | --- |
| AUTH | Secret JWT, rate limit login, session storage, audit log, secure cookie/token |
| HR | File hồ sơ, dữ liệu nhạy cảm, backup, field-level log masking |
| ATT | Scheduled job missing checkout, bảng công theo ngày/tháng, timezone, audit |
| LEAVE | Job cộng phép/reset phép sau này, sync sang ATT, notification event |
| TASK | File đính kèm, comment/mention notification, task overdue job |
| DASH | Cache widget, refresh/invalidate, degraded state khi module nguồn lỗi |
| NOTI | Worker gửi thông báo, retry, delivery log, unread count performance |
| FOUNDATION | Company settings, file service, audit log, sequence, public holidays, seed |

---

## 26. Timezone và lịch vận hành

### 26.1 Timezone mặc định

Vì hệ thống phục vụ doanh nghiệp nội bộ tại Việt Nam trong MVP, timezone vận hành mặc định nên là:

```text
Asia/Ho_Chi_Minh
```

Nguyên tắc:

1. Database nên lưu timestamp dạng UTC nếu backend hỗ trợ chuẩn.
2. Frontend hiển thị theo timezone user/company.
3. Job chấm công/nghỉ phép cần dùng timezone company.
4. Log hệ thống nên có UTC và/hoặc timezone rõ ràng.
5. Backup/scheduled job cần ghi rõ timezone tránh nhầm ngày.

### 26.2 Scheduled job cần chú ý timezone

| Job | Timezone |
| --- | --- |
| Missing checkout detection | Company timezone |
| Attendance daily summary | Company timezone |
| Leave reminder | Company timezone |
| Task due soon/overdue | Company/user timezone |
| Notification digest phase sau | User/company timezone |
| Backup DB | Server/UTC nhưng ghi rõ lịch |

---

## 27. Tiêu chí nghiệm thu DEVOPS-01

DEVOPS-01 được xem là hoàn tất khi:

1. Xác định rõ vị trí DevOps sau QA và trước go-live.
2. Chốt được danh sách tài liệu DevOps tiếp theo.
3. Chốt được môi trường cần có cho MVP.
4. Chốt được mô hình runtime cấp cao.
5. Chốt được chiến lược containerization.
6. Chốt được chiến lược domain/network/SSL/reverse proxy.
7. Chốt được chiến lược config và secret.
8. Chốt được chiến lược database migration, seed, backup, rollback.
9. Chốt được chiến lược file storage private.
10. Chốt được baseline logging, monitoring và alerting.
11. Chốt được baseline bảo mật hạ tầng.
12. Chốt được release gate từ staging/UAT sang production.
13. Có checklist đủ để triển khai DEVOPS-02 -> DEVOPS-12.

Tiêu chí nghiệm thu chuẩn (đồng bộ với bảng §99 của DEVOPS-02 -> DEVOPS-12):

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

## 28. Checklist triển khai sau DEVOPS-01

Sau khi chốt DEVOPS-01, thứ tự triển khai đề xuất:

```text
DEVOPS-02: Repository, Branching & CI Pipeline
  -> chốt branch, PR, CI check, version/tag

DEVOPS-03: Docker & Containerization
  -> Dockerfile, docker-compose, image tag, runtime command

DEVOPS-04: Environment Configuration & Secrets Management
  -> ENV matrix, secret, feature flag, config validation

DEVOPS-05: Database Migration & Seed Deployment
  -> migration command, seed command, backup before migration

DEVOPS-06: Backend Deployment Pipeline
  -> backend build, deploy, health, smoke test

DEVOPS-07: Frontend Deployment Pipeline
  -> frontend build, static deploy, cache busting

DEVOPS-08: Staging, UAT & Production Environment
  -> provision environment, domain, SSL, data strategy

DEVOPS-09: Monitoring, Logging & Alerting
  -> log, metric, uptime, error tracking, alert

DEVOPS-10: Backup, Rollback & Disaster Recovery
  -> backup script, restore drill, rollback runbook

DEVOPS-11: Security Hardening & Runtime Protection
  -> firewall, headers, rate limit, scan, runtime security

DEVOPS-12: Release Management & Go-live Plan
  -> release checklist, go-live, post-release monitoring
```

---

## 29. Open questions cần chốt ở DEVOPS-02/03/04

| Câu hỏi | Cần chốt ở tài liệu |
| --- | --- |
| Dùng GitHub, GitLab hay nền tảng repo khác? | DEVOPS-02 |
| Dùng GitHub Actions, GitLab CI hay CI khác? | DEVOPS-02 |
| Repo mono-repo hay multi-repo frontend/backend? | DEVOPS-02 |
| Backend stack runtime cụ thể là gì? | DEVOPS-03/06 |
| Frontend build output deploy qua Nginx hay static hosting? | DEVOPS-03/07 |
| Production dùng Docker Compose hay managed container? | DEVOPS-03/08 |
| PostgreSQL production là managed hay self-hosted? | DEVOPS-08/10 |
| File storage production dùng local volume hay S3-compatible? | DEVOPS-04/08/10 |
| Có Valkey/queue ngay MVP không? | DEVOPS-03/06 |
| Có tách worker ngay MVP không? | DEVOPS-06 |
| Có UAT riêng hay gộp staging/UAT? | DEVOPS-08 |
| Dùng provider monitoring/error tracking nào? | DEVOPS-09 |
| Backup retention bao lâu? | DEVOPS-10 |
| Go-live có maintenance window không? | DEVOPS-12 |

---

## 30. Kết luận

DEVOPS-01 xác định hướng triển khai hệ thống theo mô hình **containerized, production-like, có staging/UAT, có backup/rollback và có monitoring tối thiểu**.

Đối với MVP, hướng đi phù hợp là bắt đầu đơn giản nhưng không tùy tiện:

```text
Dockerized services
  -> Reverse proxy + HTTPS
  -> PostgreSQL riêng theo môi trường
  -> ENV/secret tách biệt
  -> Migration/seed có kiểm soát
  -> Staging/UAT trước production
  -> Backup trước release
  -> Health check + smoke test + monitoring
```

Sau DEVOPS-01, bước tiếp theo nên triển khai là:

```text
DEVOPS-02: Repository, Branching & CI Pipeline
```

Tài liệu DEVOPS-02 sẽ biến định hướng kiến trúc này thành quy trình làm việc mã nguồn, branch, pull request, CI check, build validation và release tagging cụ thể.
