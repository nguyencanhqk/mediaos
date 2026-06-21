# DEVOPS-07: FRONTEND DEPLOYMENT PIPELINE
# FRONTEND DEPLOYMENT PIPELINE
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-07 |
| Tên tài liệu | Frontend Deployment Pipeline |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-06 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-07 định nghĩa pipeline build và deploy frontend web cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chuẩn hóa luồng lint, typecheck, test, build và deploy frontend.
2. Chốt cách inject config frontend theo environment.
3. Chốt static hosting/Nginx container strategy.
4. Chốt frontend smoke test, route check và asset cache strategy.
5. Chốt rollback frontend theo image/static artifact version.
6. Đảm bảo frontend deploy không phá auth/session/API integration.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-07** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

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

## 5. Frontend deployment scope

| Thành phần | Deploy | Ghi chú |
| --- | --- | --- |
| Web app build | Có | Vite/React hoặc stack tương đương |
| Static assets | Có | JS/CSS/image/font nội bộ nếu có |
| Runtime config | Nên có | `config.json` hoặc build env |
| Nginx/static server | Nếu container | Serve SPA + security headers |
| Source map | Tùy policy | Không public nếu chứa thông tin nhạy cảm |
| Storybook | Có thể | Dev/staging nội bộ, không production public |

## 6. Pipeline trigger

| Trigger | Target | Ghi chú |
| --- | --- | --- |
| Pull request | CI only | Lint/typecheck/test/build |
| Push `develop` | Development | Preview/dev deploy |
| Push `release/*` | Staging/UAT | Release candidate |
| Tag `v*` | Production candidate | Artifact/image versioned |
| Manual approval | Production | Deploy chính thức |
| Manual rollback | Target env | Rollback previous artifact/image |

## 7. Frontend pipeline stages

```text
checkout
  -> install dependencies
  -> lint
  -> typecheck
  -> unit/component test
  -> build
  -> bundle size check optional
  -> dependency scan
  -> secret scan
  -> Docker build or static artifact package
  -> image/artifact push
  -> deploy environment
  -> smoke test frontend
  -> notify result
```

## 8. Quality gate

| Gate | Điều kiện pass |
| --- | --- |
| Lint | Không lỗi blocker |
| Typecheck | Pass toàn bộ TypeScript |
| Unit/component test | Pass |
| Build | Build production thành công |
| Bundle check | Không vượt ngưỡng nếu cấu hình |
| Secret scan | Không có secret trong source/build config |
| Dependency scan | Không có critical chưa xử lý |
| Route smoke | Các route P0 load được |
| API base URL | Đúng môi trường |

## 9. Build-time config và runtime config

### 9.1 Build-time config

Ví dụ:

```text
VITE_APP_ENV=staging
VITE_API_BASE_URL=https://api.staging.ems.example.com/api/v1
VITE_APP_VERSION=v1.0.0
```

Ưu điểm: đơn giản. Nhược điểm: đổi API URL/flag phải rebuild image.

### 9.2 Runtime config khuyến nghị

Serve file:

```text
/config.json
```

Ví dụ:

```json
{
  "appEnv": "staging",
  "apiBaseUrl": "https://api.staging.ems.example.com/api/v1",
  "appVersion": "v1.0.0",
  "featureFlags": {
    "enableRemoteWork": true,
    "enableEmailNotification": false
  }
}
```

Nguyên tắc:

1. Runtime config không chứa secret.
2. Config được cache ngắn hoặc no-cache.
3. App fail rõ ràng nếu config không load được.
4. Production config thay đổi cần change log.

## 10. Static hosting strategy

| Option | Phù hợp | Ghi chú |
| --- | --- | --- |
| Nginx container | Docker Compose/VM | Dễ đồng bộ backend container |
| Object storage + CDN | Production scale tốt | Cần setup CDN/invalidation |
| PaaS frontend hosting | Nhanh triển khai | Cần kiểm soát config/security |

MVP có thể dùng Nginx container trước, thiết kế để chuyển CDN sau.

## 11. Nginx SPA config mẫu

```nginx
server {
  listen 80;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  location /config.json {
    add_header Cache-Control "no-store";
    try_files $uri =404;
  }

  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

Security headers có thể đặt ở reverse proxy hoặc Nginx, nhưng cần thống nhất để không xung đột.

## 12. Frontend route smoke test

Smoke test tối thiểu sau deploy:

| Route | Check |
| --- | --- |
| `/` | Redirect hoặc load Home/Login đúng |
| `/login` | Login page load được |
| `/home` | Protected route redirect login nếu chưa auth |
| `/dashboard` | Protected route redirect login nếu chưa auth |
| Static asset | JS/CSS trả 200 |
| `/config.json` | Trả đúng env, no secret |

Nếu có smoke account staging:

1. Login thành công.
2. Home Portal load app theo permission.
3. App Switcher mở được.
4. Dashboard gọi API đúng environment.
5. Logout clear session.

## 13. Asset cache strategy

| Asset | Cache |
| --- | --- |
| `index.html` | No-cache hoặc cache rất ngắn |
| `config.json` | No-store |
| JS/CSS hashed | Long cache immutable |
| Image hashed | Long cache |
| Source map | Không public production hoặc access restricted |

Rollback frontend phải đảm bảo `index.html` và asset version tương thích.

## 14. Source map policy

| Môi trường | Source map |
| --- | --- |
| Local | Có |
| Development | Có |
| Staging/UAT | Có thể có, access nội bộ |
| Production | Không public; upload private vào error tracking nếu cần |

Không để source map production public nếu chứa source code hoặc thông tin nhạy cảm.

## 15. Frontend deployment flow

### 15.1 Development

```text
push develop
  -> CI pass
  -> build frontend dev
  -> deploy development
  -> route smoke
```

### 15.2 Staging/UAT

```text
release branch
  -> build staging artifact/image
  -> deploy staging
  -> config points to staging API
  -> smoke test login/home/dashboard
  -> QA regression/UAT
```

### 15.3 Production

```text
release approved
  -> build or promote artifact from staging candidate
  -> verify production config
  -> deploy frontend production
  -> smoke test public routes
  -> smoke test auth flow if allowed
  -> monitor frontend errors
```

Khuyến nghị promote cùng artifact/image đã test ở staging, chỉ thay runtime config nếu có thể.

## 16. Rollback frontend

Rollback dễ hơn backend nếu asset version rõ:

```text
detect frontend issue
  -> deploy previous frontend image/static artifact
  -> verify config points to correct API
  -> route smoke
  -> monitor frontend error
```

Cần chú ý nếu backend API đã thay contract không backward compatible. Do đó API contract phải tránh breaking change trong release.

## 17. Frontend monitoring sau deploy

Theo dõi:

1. JS runtime errors.
2. Failed API calls 401/403/500 tăng bất thường.
3. Chunk load error.
4. Login success rate.
5. First load performance nếu có RUM.
6. Asset 404.
7. CORS error.
8. Config load error.

## 18. Permission/security frontend

Frontend deploy phải đảm bảo:

1. Không hard-code role thay cho permission.
2. Không chứa API secret.
3. Không expose internal endpoint không cần thiết.
4. Không log token/user sensitive data ở console production.
5. Logout clear auth context và sensitive cache.
6. CSP/security headers không chặn app hợp lệ.

## 19. Checklist DEVOPS-07

### 19.1 Pipeline checklist

- [ ] Frontend CI chạy lint.
- [ ] Typecheck pass.
- [ ] Unit/component test pass.
- [ ] Build production pass.
- [ ] Dependency/secret scan pass.
- [ ] Docker image hoặc static artifact versioned.
- [ ] Deploy staging/prod có target rõ.
- [ ] Smoke test route sau deploy.
- [ ] Rollback artifact/image sẵn sàng.

### 19.2 Config checklist

- [ ] API base URL đúng môi trường.
- [ ] App version/commit hiển thị hoặc truy vết được.
- [ ] Runtime config không chứa secret.
- [ ] `config.json` no-store nếu dùng.
- [ ] `index.html` không cache dài.
- [ ] Static hashed asset cache dài.

### 19.3 Security checklist

- [ ] Source map production không public.
- [ ] Security headers hoạt động.
- [ ] Không log token ở console.
- [ ] Không dùng localStorage cho secret nếu policy cấm.
- [ ] CORS/cookie domain tương thích backend.

## 20. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Frontend trỏ sai API | Không dùng được app | Env validation + smoke test config |
| Cache giữ bản cũ | User thấy lỗi | Cache strategy đúng |
| Chunk 404 sau deploy | App trắng | Immutable asset + atomic deploy |
| Source map public | Lộ source | Private source map policy |
| Breaking API contract | UI lỗi | Contract test + backward compatibility |
| Secret trong bundle | Lộ secret | Secret scan + chỉ public config |

## 21. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO07-OQ-001 | Frontend deploy bằng Nginx container hay object storage/CDN? | DevOps/FE | Cao |
| DO07-OQ-002 | Có dùng runtime config `config.json` không? | FE/DevOps | Cao |
| DO07-OQ-003 | Production có public source map không? | Security/FE | Cao |
| DO07-OQ-004 | Có smoke account tự động cho staging không? | QA/FE | Trung bình |
| DO07-OQ-005 | Có visual regression trong CI không? | QA/FE | Thấp/Trung bình |

## 99. Tiêu chí nghiệm thu DEVOPS-07

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

**DEVOPS-07** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
