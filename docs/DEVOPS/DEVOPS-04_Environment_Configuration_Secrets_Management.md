# DEVOPS-04: ENVIRONMENT CONFIGURATION & SECRETS MANAGEMENT
# ENVIRONMENT CONFIGURATION & SECRETS MANAGEMENT
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-04 |
| Tên tài liệu | Environment Configuration & Secrets Management |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-03 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-04 định nghĩa cách quản lý biến môi trường, cấu hình runtime, secret và feature flag cho toàn bộ hệ thống.

Tài liệu này dùng để:

1. Chuẩn hóa nhóm config cho frontend, backend, worker, database, cache, storage, notification và observability.
2. Tách rõ config thường và secret nhạy cảm.
3. Định nghĩa `.env.example`, env schema validation và quy tắc override theo môi trường.
4. Chốt cách lưu secret trong local, CI/CD, staging và production.
5. Chốt quy trình rotate secret, revoke secret và audit access.
6. Đảm bảo local/dev/staging/production không dùng chung secret.
7. Làm nền cho deploy pipeline và runtime security.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-04** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

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

## 5. Phân loại configuration

| Loại | Ví dụ | Có phải secret? | Nguồn quản lý |
| --- | --- | --- | --- |
| Public frontend config | `VITE_API_BASE_URL`, `VITE_APP_ENV` | Không | Build/runtime config |
| Backend app config | `PORT`, `APP_ENV`, `LOG_LEVEL` | Không | Env file/CI |
| Database credential | `DATABASE_URL`, DB password | Có | Secret store |
| Auth secret | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Có | Secret store |
| Storage credential | S3 access key/secret | Có | Secret store |
| Email/push credential | SMTP password, push key | Có | Secret store |
| Error tracking DSN | Sentry DSN | Có thể | Secret/config tùy policy |
| Feature flag | `ENABLE_REMOTE_WORK` | Không/nhạy tùy flag | Config service/env |

## 6. Environment list

| Environment | Mục đích | Config source | Secret source |
| --- | --- | --- | --- |
| Local | Dev cá nhân | `.env.local` từ `.env.example` | Secret local giả/mock |
| Development | Tích hợp team | CI/CD + server env | CI/CD secret/dev secret |
| Staging/UAT | Test release candidate | Environment scoped config | Staging secret riêng |
| Production | Người dùng thật | Locked production config | Production secret riêng |

Không dùng chung JWT secret, database password, storage credential giữa staging và production.

## 7. Quy ước file env

```text
env/
  local/
    backend.env.example
    frontend.env.example
  development/
    backend.env.example
    frontend.env.example
  staging/
    backend.env.example
    frontend.env.example
  production/
    backend.env.example
    frontend.env.example
```

Chỉ commit file `*.env.example`. Không commit file env thật.

## 8. Backend config schema

### 8.1 Nhóm app/runtime

| Biến | Bắt buộc | Ví dụ | Ghi chú |
| --- | --- | --- | --- |
| `APP_ENV` | Có | `staging` | `local`, `development`, `staging`, `production` |
| `APP_NAME` | Có | `ems-backend-api` | Tên service |
| `APP_VERSION` | Có | `v1.0.0` | Inject từ CI |
| `PORT` | Có | `3000` | Container port |
| `LOG_LEVEL` | Có | `info` | Production không nên `debug` mặc định |
| `TIMEZONE` | Có | `Asia/Ho_Chi_Minh` | Timezone nghiệp vụ |

### 8.2 Nhóm database/cache

| Biến | Bắt buộc | Secret | Ghi chú |
| --- | --- | --- | --- |
| `DATABASE_URL` | Có | Có | Ưu tiên dùng một URL đầy đủ |
| `DB_POOL_MIN` | Có | Không | Pool tối thiểu |
| `DB_POOL_MAX` | Có | Không | Pool tối đa |
| `VALKEY_URL` | Nếu dùng | Có | Cache/queue/rate limit |
| `MIGRATION_LOCK_TIMEOUT` | Nên có | Không | Tránh migration treo |

### 8.3 Nhóm auth/session

| Biến | Bắt buộc | Secret | Ghi chú |
| --- | --- | --- | --- |
| `JWT_ACCESS_SECRET` | Có | Có | Tách từng môi trường |
| `JWT_REFRESH_SECRET` | Có | Có | Tách access/refresh |
| `ACCESS_TOKEN_TTL` | Có | Không | Ví dụ `15m` |
| `REFRESH_TOKEN_TTL` | Có | Không | Ví dụ `7d` |
| `PASSWORD_RESET_TOKEN_TTL` | Có | Không | Ví dụ `30m` |
| `COOKIE_DOMAIN` | Theo deploy | Không | Production domain |
| `COOKIE_SECURE` | Có | Không | `true` ở staging/prod |

### 8.4 Nhóm CORS/security

| Biến | Bắt buộc | Ví dụ |
| --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | Có | `https://app.ems.example.com` |
| `RATE_LIMIT_ENABLED` | Có | `true` |
| `RATE_LIMIT_WINDOW_SECONDS` | Có | `60` |
| `RATE_LIMIT_MAX_REQUESTS` | Có | `100` |
| `SECURITY_HEADERS_ENABLED` | Có | `true` |
| `HSTS_ENABLED` | Production | `true` |

### 8.5 Nhóm storage/file

| Biến | Bắt buộc | Secret | Ghi chú |
| --- | --- | --- | --- |
| `STORAGE_DRIVER` | Có | Không | `local`, `s3` |
| `STORAGE_BUCKET` | Nếu S3 | Không | Bucket theo env |
| `STORAGE_REGION` | Nếu S3 | Không | Region |
| `STORAGE_ACCESS_KEY_ID` | Nếu S3 | Có | Secret |
| `STORAGE_SECRET_ACCESS_KEY` | Nếu S3 | Có | Secret |
| `FILE_SIGNING_SECRET` | Có | Có | Signed URL/token |
| `MAX_UPLOAD_SIZE_MB` | Có | Không | Rule file |

### 8.6 Nhóm notification/email

| Biến | Bắt buộc | Secret | Ghi chú |
| --- | --- | --- | --- |
| `NOTIFICATION_CHANNEL_IN_APP_ENABLED` | Có | Không | MVP bắt buộc |
| `SMTP_HOST` | Nếu email | Không | Phase sau hoặc staging test |
| `SMTP_USERNAME` | Nếu email | Có thể |  |
| `SMTP_PASSWORD` | Nếu email | Có |  |
| `EMAIL_FROM` | Nếu email | Không |  |

### 8.7 Nhóm observability

| Biến | Bắt buộc | Secret | Ghi chú |
| --- | --- | --- | --- |
| `REQUEST_ID_HEADER` | Có | Không | `X-Request-Id` |
| `SENTRY_DSN` | Nếu dùng | Có thể | Error tracking |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Nếu dùng | Có thể | Tracing/metric |
| `METRICS_ENABLED` | Có | Không | Bật health/metrics |

## 9. Frontend config schema

| Biến | Bắt buộc | Secret | Ghi chú |
| --- | --- | --- | --- |
| `VITE_APP_ENV` | Có | Không | Không chứa secret |
| `VITE_API_BASE_URL` | Có | Không | API endpoint |
| `VITE_APP_VERSION` | Có | Không | Inject CI |
| `VITE_SENTRY_DSN` | Nếu dùng | Có thể public | Không dùng nếu policy không cho |
| `VITE_FEATURE_FLAGS` | Nếu build-time | Không | Có thể dùng runtime config tốt hơn |

Frontend static không được chứa secret vì người dùng có thể xem bundle.

## 10. Env validation

Backend cần validate env khi start app. Nếu thiếu biến bắt buộc, app phải fail fast.

Ví dụ logic:

```ts
const required = [
  'APP_ENV',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'CORS_ALLOWED_ORIGINS',
];
```

Nguyên tắc:

1. Validate type: string, number, boolean, enum, URL.
2. Validate environment-specific rule.
3. Production không cho fallback default insecure.
4. Không log giá trị secret khi validation fail.
5. Có endpoint `/health/version` để kiểm tra config version, không trả secret.

## 11. Secret storage strategy

### 11.1 Local

| Secret | Cách xử lý |
| --- | --- |
| DB password | Dùng mật khẩu local giả |
| JWT secret | Dùng chuỗi local không dùng chung production |
| S3 key | Dùng mock/local storage nếu được |
| Email key | Dùng sandbox hoặc disabled |

### 11.2 CI/CD

1. Dùng environment secret của CI/CD platform.
2. Secret chia theo environment.
3. Production secret chỉ workflow production được đọc.
4. Không cho PR từ fork truy cập secret.
5. Dùng masking log.
6. Rotate nếu nghi ngờ leak.

### 11.3 Server/VM

1. File env thật đặt ngoài repository, ví dụ `/opt/ems/env/backend.env`.
2. Permission file env chặt, ví dụ owner deploy user, mode `600`.
3. Backup config production cần mã hóa hoặc lưu trong secret manager.
4. Không copy env qua chat/email.

### 11.4 Secret manager roadmap

| Giai đoạn | Cách lưu |
| --- | --- |
| MVP nhỏ | CI/CD secret + server env permission chặt |
| Sau MVP | Cloud secret manager hoặc Vault |
| SaaS/enterprise | Secret manager + audit access + rotation policy |

## 12. Feature flag strategy

### 12.1 Nhóm feature flag MVP

| Flag | Mục đích | Default production |
| --- | --- | --- |
| `ENABLE_REMOTE_WORK` | Bật request làm remote/công tác | Theo policy công ty |
| `ENABLE_AUTO_ATTENDANCE` | Bật tự động chấm công | Tắt mặc định nếu chưa kiểm thử |
| `ENABLE_EMAIL_NOTIFICATION` | Gửi email ngoài in-app | Tắt nếu chưa cấu hình |
| `ENABLE_DASHBOARD_CACHE` | Cache dashboard widget | Bật nếu đã test invalidation |
| `ENABLE_FILE_UPLOAD` | Upload file | Bật nếu storage sẵn sàng |
| `ENABLE_PROFILE_CHANGE_REQUEST` | Employee self-service | Bật theo SPEC-03 |

### 12.2 Rule feature flag

1. Flag không thay thế permission.
2. Flag tắt phải disable route/action an toàn.
3. Frontend có thể ẩn UI theo flag, backend vẫn phải chặn API nếu flag off.
4. Production flag thay đổi cần audit log hoặc change log.
5. Flag quan trọng cần tài liệu owner và default value.

## 13. Secret rotation

### 13.1 Khi nào rotate

| Tình huống | Bắt buộc rotate |
| --- | --- |
| Secret bị commit nhầm | Có |
| Nhân sự rời team có quyền secret | Có thể/Có theo policy |
| Định kỳ 90-180 ngày | Nên có |
| Sau incident bảo mật | Có |
| Trước go-live nếu dùng secret tạm | Có |

### 13.2 Quy trình rotate JWT secret

```text
1. Tạo secret mới.
2. Deploy backend hỗ trợ verify secret cũ + sign secret mới nếu cần grace period.
3. Theo dõi login/session error.
4. Hết grace period thì gỡ secret cũ.
5. Clear refresh token nếu cần revoke toàn bộ session.
6. Ghi change log.
```

### 13.3 Quy trình rotate DB password

```text
1. Tạo user/password mới hoặc đổi password có kế hoạch.
2. Cập nhật secret store staging.
3. Deploy/restart staging, smoke test.
4. Cập nhật production trong maintenance window nếu cần.
5. Restart service theo rolling/safe order.
6. Revoke password cũ.
7. Theo dõi DB connection error.
```

## 14. Config drift control

Config drift là tình trạng môi trường chạy khác tài liệu hoặc khác nhau ngoài ý muốn.

Kiểm soát bằng:

1. `.env.example` luôn cập nhật.
2. Env schema validation ở app startup.
3. Checklist config trước staging/prod deploy.
4. Ghi version build/config vào health version.
5. Hạn chế sửa env thủ công không qua change log.
6. Production change cần có người duyệt.

## 15. Checklist DEVOPS-04

### 15.1 Config checklist

- [ ] Có `.env.example` cho backend.
- [ ] Có `.env.example` cho frontend.
- [ ] Có env schema validation.
- [ ] Có tách config local/dev/staging/prod.
- [ ] Không dùng production secret ở local/dev/staging.
- [ ] Frontend không chứa secret.
- [ ] Có config cho CORS/cookie domain/security headers.
- [ ] Có config cho storage và file upload.
- [ ] Có config cho log/monitoring.

### 15.2 Secret checklist

- [ ] Secret không commit vào repo.
- [ ] CI secret chia theo environment.
- [ ] Production secret cần approval để sử dụng trong workflow.
- [ ] Server env file permission chặt.
- [ ] Có quy trình rotate secret.
- [ ] Có secret scan trong CI.
- [ ] Có revoke plan nếu secret leak.

### 15.3 Feature flag checklist

- [ ] Mỗi flag có owner.
- [ ] Mỗi flag có default per environment.
- [ ] Backend kiểm tra flag ở API nghiệp vụ liên quan.
- [ ] Frontend chỉ dùng flag để cải thiện UX.
- [ ] Flag production thay đổi có log.

## 16. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Secret nằm trong repo | Lộ hệ thống | Secret scan + rotate ngay |
| Staging dùng production secret | Lộ dữ liệu thật | Secret scope theo env |
| Env thiếu làm app chạy sai | Lỗi runtime | Env validation fail fast |
| Frontend chứa secret | Người dùng xem được | Chỉ public config cho frontend |
| Không rotate secret | Tăng rủi ro lâu dài | Rotation policy |
| Config drift | Lỗi chỉ xảy ra prod | Schema + checklist + change log |

## 17. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO04-OQ-001 | Có dùng cloud secret manager ngay MVP không? | DevOps | Cao |
| DO04-OQ-002 | Frontend config dùng build-time hay runtime `config.json`? | FE/DevOps | Cao |
| DO04-OQ-003 | JWT rotation có cần grace period không? | Backend Lead | Trung bình |
| DO04-OQ-004 | Feature flag lưu env hay database company settings? | Product/BE | Trung bình |
| DO04-OQ-005 | Ai được quyền đọc production secret? | Tech Lead/DevOps | Cao |

## 99. Tiêu chí nghiệm thu DEVOPS-04

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

**DEVOPS-04** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
